// suitabilityReportService.js -- the only place report code talks to the Cook
// Islands suitability endpoints. Everything returned is normalised (snake_case
// wire fields -> the camelCase shapes the report bundle uses) and carries the
// provenance the API reports: statistics_basis, requested/applied bounds,
// eligible/total point counts, valid time. Drawing code never sees raw payloads.

export class ReportAbortError extends Error {
  constructor() { super('Report generation cancelled.'); this.name = 'ReportAbortError'; }
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw new ReportAbortError();
}

async function getJson(url, signal) {
  assertNotAborted(signal);
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const err = new Error(`${url}: HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export function boundsParams(bounds) {
  if (!bounds) return '';
  const { west, south, east, north } = bounds;
  if (![west, south, east, north].every(Number.isFinite)) return '';
  return `&west=${west}&south=${south}&east=${east}&north=${north}`;
}

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== undefined && v !== '' ? Number(v) : null);

function normalizeBounds(b) {
  if (!b) return null;
  const out = { west: num(b.west), south: num(b.south), east: num(b.east), north: num(b.north) };
  return Object.values(out).every((v) => v !== null) ? out : null;
}

// /cok/suitability/summary: run-level metadata (no per-timestep statistics).
export async function fetchSuitabilityMeta({ signal } = {}) {
  const body = await getJson('/cok/suitability/summary', signal);
  const locations = (Array.isArray(body?.advisory_locations) ? body.advisory_locations : []).map((l) => ({
    name: l.name, island: l.island ?? null, type: l.type ?? null,
    lon: num(l.display_lon), lat: num(l.display_lat),
  }));
  return {
    runId: body?.run_id != null ? String(body.run_id) : null,
    modelRunTime: body?.model_run_time ? new Date(body.model_run_time) : null,
    methodologyVersion: body?.methodology_version ?? null,
    hindcastHoursBeforeRun: num(body?.hindcast_hours_before_run),
    schemaVersion: body?.schema_version ?? null,
    forecastStart: body?.forecast_start ? new Date(`${String(body.forecast_start).replace(/Z$/, '')}Z`) : null,
    forecastEnd: body?.forecast_end ? new Date(`${String(body.forecast_end).replace(/Z$/, '')}Z`) : null,
    timestepCount: num(body?.n_timesteps),
    pointCount: num(body?.n_forecast_points),
    status: body?.status ?? null,
    locations,
    vessels: body?.vessels ?? {},
  };
}

// /cok/suitability/summary/{t}?vessel=..[&bounds]: one vessel, one timestep.
export function normalizeSummaryStep(body, { timeIndex, vessel }) {
  const counts = body?.counts ?? {};
  const pct = body?.percentages ?? {};
  const eligible = num(body?.eligible_point_count);
  const total = num(body?.total_points);
  const classified = ['suitable', 'caution', 'warning'].reduce((s, k) => s + (num(counts[k]) ?? 0), 0);
  const usable = (eligible ?? total ?? 0) > 0 && classified > 0;
  return {
    timeIndex: num(body?.time_index) ?? timeIndex,
    validTime: body?.valid_time_utc || body?.valid_time ? new Date(body.valid_time_utc ?? body.valid_time).getTime() : null,
    vessel: body?.vessel ?? vessel,
    available: usable,
    suitable: usable ? num(pct.suitable) : null,
    caution: usable ? num(pct.caution) : null,
    warning: usable ? num(pct.warning) : null,
    counts: { suitable: num(counts.suitable), caution: num(counts.caution), warning: num(counts.warning) },
    classifiedPoints: classified,
    eligiblePoints: eligible,
    totalPoints: total,
    statisticsBasis: body?.statistics_basis ?? null,
    // Optional provenance: read when the service supplies it (see the reporting contract), else null.
    runId: body?.run_id != null ? String(body.run_id) : null,
    methodologyVersion: body?.methodology_version ?? null,
    requestedBounds: normalizeBounds(body?.requested_bounds),
    appliedBounds: normalizeBounds(body?.applied_bounds),
    domainBounds: body?.bounds ? { west: num(body.bounds.lon_min), south: num(body.bounds.lat_min), east: num(body.bounds.lon_max), north: num(body.bounds.lat_max) } : null,
    wind: body?.wind_speed_kt ?? null,
    wave: body?.wave_height_m ?? null,
  };
}

export async function fetchVesselStep(timeIndex, vessel, bounds, { signal } = {}) {
  const body = await getJson(`/cok/suitability/summary/${timeIndex}?vessel=${encodeURIComponent(vessel)}${boundsParams(bounds)}`, signal);
  return normalizeSummaryStep(body, { timeIndex, vessel });
}

// /cok/suitability/summary/timeseries: every vessel class over a range of time steps in
// ONE request (replaces vessels x steps single-step calls). Throws if the endpoint is not
// deployed yet (callers fall back to per-step requests).
export async function fetchSummarySeries(bounds, { startIndex, endIndex, stride = 1, signal } = {}) {
  const range = `&start_time_index=${startIndex}&end_time_index=${endIndex}&stride=${stride}`;
  const body = await getJson(`/cok/suitability/summary/timeseries?vessel=all_classes${boundsParams(bounds)}${range}`, signal);
  const eligible = num(body?.eligible_point_count);
  const total = num(body?.total_points_in_scope);
  const vessels = {};
  Object.entries(body?.vessels ?? {}).forEach(([code, steps]) => {
    vessels[code] = (Array.isArray(steps) ? steps : []).map((s) => {
      const usable = (s.classified_points ?? 0) > 0 && s.percentages?.suitable != null;
      return {
        timeIndex: num(s.time_index),
        validTime: s.valid_time ? new Date(s.valid_time).getTime() : null,
        vessel: code,
        available: usable,
        suitable: usable ? num(s.percentages.suitable) : null,
        caution: usable ? num(s.percentages.caution) : null,
        warning: usable ? num(s.percentages.warning) : null,
        counts: s.counts ?? null,
        classifiedPoints: num(s.classified_points) ?? 0,
        eligiblePoints: eligible,
        totalPoints: total,
        statisticsBasis: body?.statistics_basis ?? null,
        requestedBounds: normalizeBounds(body?.requested_bounds),
        appliedBounds: normalizeBounds(body?.applied_bounds),
        runId: body?.run_id != null ? String(body.run_id) : null,
        methodologyVersion: body?.methodology_version ?? null,
      };
    });
  });
  return { vessels, runId: body?.run_id != null ? String(body.run_id) : null };
}

// /cok/suitability/domain-boundary: the wave model mesh's boundary edges as
// [[lon,lat],[lon,lat]] segments. Throws if not deployed (callers skip the overlay).
export async function fetchDomainBoundary({ signal } = {}) {
  const body = await getJson('/cok/suitability/domain-boundary', signal);
  const coords = body?.features?.[0]?.geometry?.coordinates;
  return Array.isArray(coords) ? coords.filter((s) => Array.isArray(s) && s.length === 2) : [];
}

// /cok/suitability/best-contrast-timestep: the time at which vessel classes differ most.
export async function fetchBestContrast(bounds, { startIndex, endIndex, signal } = {}) {
  const range = `${Number.isFinite(startIndex) ? `&start_time_index=${startIndex}` : ''}${Number.isFinite(endIndex) ? `&end_time_index=${endIndex}` : ''}`;
  const q = `${boundsParams(bounds)}${range}`.replace(/^&/, '');
  const body = await getJson(`/cok/suitability/best-contrast-timestep${q ? `?${q}` : ''}`, signal);
  return {
    timeIndex: num(body?.best_time_index ?? body?.time_index),
    validTime: body?.valid_time_utc || body?.valid_time ? new Date(body.valid_time_utc ?? body.valid_time).getTime() : null,
    contrastScore: num(body?.contrast?.contrast_score),
    suitableByVessel: body?.contrast?.suitable_percent_by_vessel ?? {},
    mostSuitableVessel: body?.contrast?.most_suitable_vessel ?? null,
    leastSuitableVessel: body?.contrast?.least_suitable_vessel ?? null,
    statisticsBasis: body?.statistics_basis ?? null,
    appliedBounds: normalizeBounds(body?.applied_bounds),
  };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read map image.'));
    reader.readAsDataURL(blob);
  });
}

function parseAppliedBoundsHeader(value) {
  if (!value) return null;
  const parts = Object.fromEntries(String(value).split(',').map((p) => p.split('=')));
  return normalizeBounds(parts);
}

// Server-rendered map for one vessel/time/bounds, with the diagnostic overlays
// (stats box, scale/north arrow) suppressed so the PDF supplies its own captions.
export async function fetchOperationalMap(vessel, timeIndex, bounds, { signal } = {}) {
  assertNotAborted(signal);
  const q = `${boundsParams(bounds).slice(1)}&show_stats=false&show_legend=false`;
  const res = await fetch(`/cok/suitability/operational-map/${encodeURIComponent(vessel)}/${timeIndex}?${q}`, { signal });
  if (!res.ok) throw new Error(`operational-map ${vessel} t${timeIndex}: HTTP ${res.status}`);
  const appliedBounds = parseAppliedBoundsHeader(res.headers?.get?.('x-applied-bounds'));
  const dataUrl = await blobToDataUrl(await res.blob());
  // x-classified-cells: how many on-mesh cells the render actually drew (0 means
  // a genuinely empty map -- e.g. bounds landing entirely off-mesh). null on an
  // older/unpatched deployment that doesn't send the header yet -- callers must
  // treat that as "unknown", not "empty", so this stays additive until the
  // backend ships it everywhere.
  const classifiedCellsHeader = res.headers?.get?.('x-classified-cells');
  const classifiedCells = classifiedCellsHeader != null && classifiedCellsHeader !== '' && Number.isFinite(Number(classifiedCellsHeader))
    ? Number(classifiedCellsHeader) : null;
  return {
    dataUrl, appliedBounds, statisticsBasis: res.headers?.get?.('x-statistics-basis') ?? null, classifiedCells,
  };
}

// Runs fn over items with at most `limit` in flight; results keep input order.
export async function mapWithLimit(items, limit, fn, { signal, onEach } = {}) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      assertNotAborted(signal);
      const i = next; next += 1;
      out[i] = await fn(items[i], i);
      onEach?.();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
