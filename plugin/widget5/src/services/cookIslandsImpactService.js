// cookIslandsImpactService.js
// Fetch-and-normalize glue for the Cook Islands RiskScape impact endpoints
// (/cok/impact/latest, /cok/impact/latest/regions). Mirrors
// cookIslandsRouteForecastService.js's shape: a null-safe number coercion
// helper, a normalizer that's tolerant of backend field-shape drift, and a
// thin fetch wrapper that turns HTTP status into a readable message.

export const IMPACT_SECTOR_ORDER = [
  'education', 'infrastructure', 'productive', 'public', 'residential', 'other',
];

export const IMPACT_SECTOR_LABELS = {
  education: 'Education',
  infrastructure: 'Infrastructure',
  productive: 'Productive',
  public: 'Public',
  residential: 'Residential',
  other: 'Other',
  unknown: 'Unknown',
};

// Same palette family as HAZARD_COLORS in CookIslandsSuitabilityOverlay.js
// (teal/amber/red), extended with a few more hues since there are six
// sectors, not three hazard classes -- picked to stay distinguishable next
// to that palette rather than clashing with it.
export const IMPACT_SECTOR_COLORS = {
  education: '#38bdf8',
  infrastructure: '#F4A261',
  productive: '#a78bfa',
  public: '#E63946',
  residential: '#2A9D8F',
  other: '#94a3b8',
  unknown: '#64748b',
};

// `Number(null) === 0`, so a naive coercion would turn a genuinely-missing
// field into a real zero -- same rationale as toNumber() in
// cookIslandsRouteForecastService.js.
function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeSectorMap(raw) {
  const out = {};
  for (const key of IMPACT_SECTOR_ORDER) {
    out[key] = toNumber(raw?.[key]) ?? 0;
  }
  return out;
}

// Population is gated behind an explicit backend-declared validity signal
// rather than assumed safe -- a known past discrepancy between this run's
// event-impact.csv and demographics-total.csv means a wrong number here
// could get quoted as fact. Tolerant of a few possible backend shapes since
// exactly how that signal is structured wasn't nailed down before this was
// written; when a validity flag can't be found at all, the panel shows the
// figure as unconfirmed rather than hiding it outright or trusting it blindly.
function normalizePopulation(block) {
  const exposed = toNumber(block?.exposed_population);
  const censusTotal = toNumber(block?.exposed_census_total);
  const explicit = block?.population;

  if (explicit && typeof explicit === 'object') {
    return {
      value: toNumber(explicit.exposed) ?? exposed,
      validated: explicit.validated === true,
      note: explicit.note ?? null,
    };
  }

  if (exposed !== null && censusTotal !== null) {
    return {
      value: exposed,
      validated: exposed === censusTotal,
      note: exposed === censusTotal
        ? null
        : `Disagrees with the demographic cross-check for this cycle (${exposed} vs ${censusTotal}) -- treat as unconfirmed.`,
    };
  }

  return { value: exposed, validated: false, note: exposed === null ? null : 'Not cross-checked.' };
}

function normalizeBlock(raw) {
  return {
    scenario: raw?.scenario ?? null,
    dateStart: raw?.dates?.start ?? null,
    dateEnd: raw?.dates?.end ?? null,
    // Hour-precise window, when the backend could compute one (needs a
    // parseable cycle_id -- see main.py's _cok_impact_block_dates). null
    // whenever it couldn't, so callers fall back to reconstructing from
    // dateStart/dateEnd the same way they always have. Real blocks start
    // at the forecast's own issue hour, not midnight, and end one native
    // timestep before the next block's own start -- dateStart/dateEnd
    // alone (calendar-day strings) can't represent that, which is exactly
    // what let a window's applied range bleed hours into the next block's.
    windowStart: raw?.dates?.window_start ?? null,
    windowEnd: raw?.dates?.window_end ?? null,
    totalLoss: toNumber(raw?.total_loss) ?? 0,
    totalExposedValue: toNumber(raw?.total_exposed_value) ?? 0,
    totalExposedBuildings: toNumber(raw?.total_exposed_buildings) ?? 0,
    exposedRoadKm: toNumber(raw?.exposed_road_km) ?? 0,
    population: normalizePopulation(raw),
    lossesBySector: normalizeSectorMap(raw?.losses_by_sector),
    exposedValueBySector: normalizeSectorMap(raw?.exposed_value_by_sector),
  };
}

function normalizeRegion(raw) {
  return {
    scenario: raw?.scenario ?? null,
    dateStart: raw?.dates?.start ?? null,
    dateEnd: raw?.dates?.end ?? null,
    region: raw?.region ?? 'Unknown',
    regionId: raw?.region_id ?? null,
    totalLoss: toNumber(raw?.total_loss) ?? 0,
    totalExposedValue: toNumber(raw?.total_exposed_value) ?? 0,
    totalExposedBuildings: toNumber(raw?.total_exposed_buildings) ?? 0,
    lossesBySector: normalizeSectorMap(raw?.losses_by_sector),
  };
}

// /cok/impact/latest/districts -- see main.py's cok_impact_latest_districts.
// Unlike /latest/regions (a RiskScape-native CSV read), this is a spatial
// join computed server-side against a census-district boundary layer, so a
// district_id of 'unmatched' is a real, expected bucket (an asset outside
// the join's buffer distance) rather than a data error -- kept as its own
// row instead of dropped, so no loss silently disappears from the total.
function normalizeDistrict(raw) {
  return {
    scenario: raw?.scenario ?? null,
    dateStart: raw?.dates?.start ?? null,
    dateEnd: raw?.dates?.end ?? null,
    districtId: raw?.district_id ?? null,
    districtName: raw?.district_name ?? 'Unknown',
    islandGroup: raw?.island_group ?? null,
    unmatched: raw?.district_id === 'unmatched',
    totalLoss: toNumber(raw?.total_loss) ?? 0,
    totalExposedValue: toNumber(raw?.total_exposed_value) ?? 0,
    totalExposedBuildings: toNumber(raw?.total_exposed_buildings) ?? 0,
    lossesBySector: normalizeSectorMap(raw?.losses_by_sector),
  };
}

// Sums each block's per-sector economic damage and compares against that block's own
// reported total -- same reconciliation check the Partner2 reference app
// runs (validateDataQuality in its csvDataNormalizer.ts), flagging a >1%
// drift as a data-quality warning rather than silently trusting either
// number. Cheap insurance: costs nothing when the numbers agree (the normal
// case), and would have caught real discrepancies seen earlier in this
// data's history.
function checkSectorReconciliation(blocks) {
  return blocks.map((block) => {
    const sectorSum = IMPACT_SECTOR_ORDER.reduce((sum, key) => sum + block.lossesBySector[key], 0);
    const total = block.totalLoss;
    const drift = total > 0 ? Math.abs(sectorSum - total) / total : 0;
    return { ...block, sectorReconciles: total === 0 ? sectorSum === 0 : drift <= 0.01 };
  });
}

export function normalizeImpactLatestResponse(payload) {
  const rawBlocks = Array.isArray(payload?.blocks) ? payload.blocks : [];
  const blocks = checkSectorReconciliation(rawBlocks.map(normalizeBlock));
  return {
    cycleId: payload?.cycle_id ?? null,
    label: payload?.label ?? 'forecast impact estimate',
    blocks,
  };
}

export function normalizeImpactRegionsResponse(payload) {
  const rawRegions = Array.isArray(payload?.regions) ? payload.regions : [];
  return {
    cycleId: payload?.cycle_id ?? null,
    regions: rawRegions.map(normalizeRegion),
  };
}

export function normalizeImpactDistrictsResponse(payload) {
  const rawDistricts = Array.isArray(payload?.districts) ? payload.districts : [];
  return {
    cycleId: payload?.cycle_id ?? null,
    districts: rawDistricts.map(normalizeDistrict),
  };
}

function apiErrorMessage(status, payload) {
  if (status === 503) return payload?.detail || 'Impact data is not available yet -- no successful RiskScape cycle has been published.';
  if (status === 404) return 'Impact assessment is not available in this deployment yet.';
  return 'Impact assessment failed to load. Please try again.';
}

async function fetchJson(url) {
  const response = await fetch(url);
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    throw new Error(apiErrorMessage(response.status, body));
  }
  return body;
}

export async function fetchCookIslandsImpactLatest() {
  const body = await fetchJson('/cok/impact/latest');
  return normalizeImpactLatestResponse(body);
}

export async function fetchCookIslandsImpactRegions() {
  const body = await fetchJson('/cok/impact/latest/regions');
  return normalizeImpactRegionsResponse(body);
}

export async function fetchCookIslandsImpactDistricts() {
  const body = await fetchJson('/cok/impact/latest/districts');
  return normalizeImpactDistrictsResponse(body);
}

// ── district choropleth map layer ────────────────────────────────────────
// /cok/impact/latest/districts/geojson carries the same rows as
// /latest/districts above (computed by the same backend helper, so the two
// always agree) but with each district's polygon geometry attached -- one
// Feature per (district, scenario) pair, every window in one fetch, same
// shape convention as /latest/assets. Fetched without ?scenario= here for
// the same reason assets is: the map layer scenario-filters client-side
// (see useZarrMap's impactDistrictsScenario effect) rather than re-fetching
// on every window-chip click. The synthetic "unmatched" bucket has no
// polygon and is never present in this endpoint's features.
function normalizeDistrictFeature(raw) {
  const props = raw?.properties ?? {};
  return {
    type: 'Feature',
    geometry: raw?.geometry ?? null,
    properties: {
      districtId: props.district_id ?? null,
      districtName: props.district_name ?? 'Unknown',
      islandGroup: props.island_group ?? null,
      scenario: props.scenario ?? null,
      totalLoss: toNumber(props.total_loss) ?? 0,
      totalExposedValue: toNumber(props.total_exposed_value) ?? 0,
      totalExposedBuildings: toNumber(props.total_exposed_buildings) ?? 0,
    },
  };
}

export function normalizeImpactDistrictsGeojsonResponse(payload) {
  const rawFeatures = Array.isArray(payload?.features) ? payload.features : [];
  return {
    type: 'FeatureCollection',
    cycleId: payload?.cycle_id ?? null,
    // A feature with no geometry would otherwise reach MapLibre's setData()
    // and throw there instead of failing gracefully here -- same guard
    // normalizeImpactAssetsResponse uses below.
    features: rawFeatures.filter((f) => f?.geometry).map(normalizeDistrictFeature),
  };
}

export async function fetchCookIslandsImpactDistrictsGeojson() {
  const body = await fetchJson('/cok/impact/latest/districts/geojson');
  return normalizeImpactDistrictsGeojsonResponse(body);
}

// ── full district-boundary coverage ──────────────────────────────────────
// /cok/impact/latest/districts/geojson only emits a Feature for a
// (district, scenario) pair that had at least one exposed asset spatially
// join to it -- the backend groups over the joined assets, it doesn't left-
// join against the full district layer. Confirmed directly: the boundary
// file below has 44 districts, a real cycle's response has features for
// only ~6 of them per scenario -- so most districts don't come back as
// "zero loss", they don't come back at all, and the map only ever shows
// whichever handful happened to flood. Bundled as a static asset (rather
// than fetched from the backend, which has no endpoint for it) so the
// choropleth can still draw every district's boundary regardless, via
// buildFullDistrictChoropleth below synthesizing a zero-loss feature for
// whatever the API's response left out.
const DISTRICT_BOUNDARIES_URL = `${process.env.PUBLIC_URL || ''}/data/cok_districts_4326.geojson`;

function normalizeDistrictBoundaryFeature(raw) {
  const props = raw?.properties ?? {};
  return {
    districtId: props.cdid != null ? String(props.cdid) : null,
    districtName: props.district_name ?? 'Unknown',
    islandGroup: props.gid ?? null,
    geometry: raw?.geometry ?? null,
  };
}

export async function fetchCookIslandsDistrictBoundaries() {
  const response = await fetch(DISTRICT_BOUNDARIES_URL);
  if (!response.ok) throw new Error('District boundaries are not available in this deployment.');
  const body = await response.json();
  const rawFeatures = Array.isArray(body?.features) ? body.features : [];
  return rawFeatures.filter((f) => f?.geometry).map(normalizeDistrictBoundaryFeature);
}

// Cross-joins the full 44-district boundary set against whichever
// (district, scenario) rows the API actually returned (normalized
// features, e.g. from normalizeImpactDistrictsGeojsonResponse), for every
// scenario present in that response -- so a district the API left out
// still gets a Feature, just a zero-loss one carrying its own real
// geometry/name, colored as "No modelled damage" by
// DISTRICT_LOSS_COLOR_STOPS same as any other $0 district.
export function buildFullDistrictChoropleth(boundaries, impactFeatures) {
  const scenarios = [...new Set(impactFeatures.map((f) => f.properties.scenario).filter(Boolean))];
  const byKey = new Map(
    impactFeatures.map((f) => [`${f.properties.districtId}|${f.properties.scenario}`, f])
  );
  const features = [];
  for (const scenario of scenarios) {
    for (const boundary of boundaries) {
      const existing = byKey.get(`${boundary.districtId}|${scenario}`);
      if (existing) {
        features.push(existing);
        continue;
      }
      features.push({
        type: 'Feature',
        geometry: boundary.geometry,
        properties: {
          districtId: boundary.districtId,
          districtName: boundary.districtName,
          islandGroup: boundary.islandGroup,
          scenario,
          totalLoss: 0,
          totalExposedValue: 0,
          totalExposedBuildings: 0,
        },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

// Sequential violet ramp keyed on total_loss (USD). Originally a red ramp,
// changed after it was confirmed visually colliding with the SFINCS
// inundation raster's own turbo-style depth colormap on the same map --
// both used red for "bad", so a dark-red district polygon sitting near a
// dark-red high-depth raster cell read as one continuous hazard instead of
// two different measurements. Violet doesn't appear anywhere in that
// raster's visible range (turbo's own violet end corresponds to near-zero
// depth, which DRY_DEPTH_THRESHOLD masks out before it's ever drawn) or in
// HAZARD_COLORS/COK_SUIT_COLORS' teal/amber/red vessel-suitability scale,
// so this reads as its own, unambiguous measurement regardless of what
// else is on screen. Breakpoints are a first-pass default, not derived
// from real product guidance -- picked so a real cycle's data (worst
// district ~$1.2M, several $0) spreads across more than the two extreme
// bins; worth revisiting once more cycles' worth of real district totals
// are in.
export const DISTRICT_LOSS_COLOR_STOPS = [
  { max: 0, color: '#e2e8f0', label: 'No modelled damage' },
  { max: 50000, color: '#ddd6fe', label: 'Up to $50k' },
  { max: 250000, color: '#a78bfa', label: '$50k–$250k' },
  { max: 1000000, color: '#7c3aed', label: '$250k–$1M' },
  { max: Infinity, color: '#4c1d95', label: 'Over $1M' },
];

// ── per-asset (building/road) map layer ─────────────────────────────────────
// /cok/impact/latest/assets serves RiskScape's raw-results.gpkg reshaped to
// GeoJSON -- one Feature per building/road/point asset, already reprojected
// to WGS84 server-side. Normalized the same tolerant way as the blocks/
// regions above (unknown/missing sector -> 'unknown' rather than throwing,
// numeric fields null-safe) rather than trusted as-is, even though this API
// is newer and less field-tested than /latest and /latest/regions.

// RiskScape's "Details" column is a "; "-joined concat of several source
// columns, so rows with no real name come through as "Nan ; nan" and partly
// named ones as "White brick office ; nan ; nan ; nan". Keeps only the real
// parts; null when nothing real is left.
export function cleanAssetDetails(raw) {
  if (typeof raw !== 'string') return null;
  const parts = raw.split(';').map((part) => part.trim()).filter((part) => part && part.toLowerCase() !== 'nan');
  return parts.length ? parts.join(' · ') : null;
}

function normalizeAssetFeature(raw) {
  const props = raw?.properties ?? {};
  const sector = typeof props.sector === 'string' ? props.sector.toLowerCase() : 'unknown';
  return {
    type: 'Feature',
    geometry: raw?.geometry ?? null,
    properties: {
      useType: props.use_type ?? null,
      subUse: props.sub_use ?? null,
      asset: props.asset ?? null,
      // Falls back to 'unknown' for any sector string this palette doesn't
      // recognize (not just a missing one) -- an unrecognized key would
      // otherwise render with MapLibre's paint-expression fallback color
      // instead of the legend's own "Unknown" swatch.
      sector: IMPACT_SECTOR_COLORS[sector] ? sector : 'unknown',
      originalValue: toNumber(props.original_value) ?? 0,
      totalLoss: toNumber(props.total_loss) ?? 0,
      lossRatio: toNumber(props.loss_ratio) ?? 0,
      sizeM2: toNumber(props.size_m2),
      scenario: props.scenario ?? null,
      // Real name when RiskScape's "Details" column has one (reliable for
      // named infrastructure -- "Avatiu Harbour" -- but null/blank for most
      // residential/commercial rows). null here means "no real name",
      // not "loading" -- callers needing an always-present label should
      // build one from useType + a stable index (buildImpactAssetLabel
      // below), not treat null as a temporary gap to paper over.
      details: cleanAssetDetails(props.details),
      // Flood depth (m), independent of $ loss -- present even for a $0-loss
      // asset (original_value 0, or a shallow depth the damage curve
      // assigns no loss to).
      hazard: toNumber(props.hazard),
    },
  };
}

// Human-readable label for a per-asset list row: the real name when one
// exists, else "<UseType> #<n>" -- deliberately not a fabricated proper
// name (no "Building 4 on Ara Tapu"), since RiskScape's own geometry/
// UseType is the only thing actually known about most of these rows.
export function buildImpactAssetLabel(feature, indexWithinCategory) {
  const props = feature?.properties ?? {};
  if (props.details) return props.details;
  const useType = props.useType || 'Asset';
  return `${useType} #${indexWithinCategory + 1}`;
}

// Mirrors the same fixed cutoffs the backend would use for a server-side
// rollup (there isn't one -- this is computed client-side from the same
// per-asset GeoJSON already fetched for the map layer, avoiding a second
// endpoint/round-trip for what's only a few hundred features). Deliberately
// "severity", not "risk" -- see summarizeImpactAssetsByCategory's own note.
const IMPACT_SEVERITY_BANDS = [
  [0.15, 'low'],
  [0.35, 'low_medium'],
  [0.65, 'medium'],
];
const IMPACT_SEVERITY_RANK = { none: -1, low: 0, low_medium: 1, medium: 2, high: 3 };
export const IMPACT_SEVERITY_LABELS = {
  low: 'Low', low_medium: 'Low–Medium', medium: 'Medium', high: 'High',
};

// affected = lossRatio > 0, not hazard > 0 -- checked live against a real
// cycle's block01: every one of its rows has hazard > 0 (RiskScape only
// emits a row when there's some overlap with the flood extent at all), so
// "hazard > 0" would mark 100% of every category "affected" regardless of
// whether it actually took damage. lossRatio is 0 for a real subset of rows
// (trace depth / zero asset value the damage curve assigns no loss to) --
// that's what makes "affected < total" mean something.
export function classifyImpactSeverity(lossRatio) {
  if (!(lossRatio > 0)) return null;
  for (const [cutoff, label] of IMPACT_SEVERITY_BANDS) {
    if (lossRatio <= cutoff) return label;
  }
  return 'high';
}

// Groups already-normalized asset features (see normalizeAssetFeature) by
// useType for the category accordion -- affected/total counts, a severity
// distribution, and the features themselves (pre-sorted worst-first) so the
// accordion can expand a category without a second fetch. useType (e.g.
// "Commercial", "Residential road"), not the coarser 6-bucket sector, since
// that's the granularity a planner actually browses by ("show me
// Commercial"), not RiskScape's own damage-reconciliation grouping.
export function summarizeImpactAssetsByCategory(features) {
  const groups = new Map();
  for (const feature of features) {
    const useType = feature?.properties?.useType || 'Unknown';
    const severity = classifyImpactSeverity(feature?.properties?.lossRatio ?? 0);
    let group = groups.get(useType);
    if (!group) {
      group = {
        useType,
        totalCount: 0,
        affectedCount: 0,
        severityCounts: { low: 0, low_medium: 0, medium: 0, high: 0 },
        maxSeverity: null,
        features: [],
      };
      groups.set(useType, group);
    }
    group.totalCount += 1;
    group.features.push(feature);
    if (severity) {
      group.affectedCount += 1;
      group.severityCounts[severity] += 1;
      if (IMPACT_SEVERITY_RANK[severity] > IMPACT_SEVERITY_RANK[group.maxSeverity ?? 'none']) {
        group.maxSeverity = severity;
      }
    }
  }

  const bySeverityDesc = (a, b) => IMPACT_SEVERITY_RANK[b] - IMPACT_SEVERITY_RANK[a];
  for (const group of groups.values()) {
    group.features.sort((a, b) => (b.properties.lossRatio ?? 0) - (a.properties.lossRatio ?? 0));
  }

  return Array.from(groups.values()).sort((a, b) => {
    const severityDiff = bySeverityDesc(a.maxSeverity ?? 'none', b.maxSeverity ?? 'none');
    if (severityDiff !== 0) return severityDiff;
    if (b.affectedCount !== a.affectedCount) return b.affectedCount - a.affectedCount;
    return b.totalCount - a.totalCount;
  });
}

// RiskScape splits linear/areal assets (ports, roads, pipes) into many
// segments, each its own row carrying only its slice of the loss (one wharf
// is 100+ rows in a single window). Buildings, bridges and points are one row
// per asset. Mirrors the "can_segment" exclusion list in RiskScape's
// partner_segment_exposures subpipeline.
const UNSEGMENTED_ASSETS = new Set(['Building', 'Bridge', 'Population', 'Water', 'Power Generation', 'Power Pole']);

export const IMPACT_ASSET_TYPE_LABELS = {
  Building: 'Buildings',
  Road: 'Roads',
  Bridge: 'Bridges',
  Port: 'Ports',
  Waterpipe: 'Water pipes',
};

export function impactAssetTypeLabel(asset) {
  return IMPACT_ASSET_TYPE_LABELS[asset] ?? asset ?? 'Other';
}

// Collapses a scenario's per-row features into one unit per real-world asset,
// so counts and rankings mean "assets", not "segments". Segmented assets merge
// on type + use + name (an unnamed one, e.g. the ringmain, merges into a
// single network unit); their losses sum, and the highest-loss segment stands
// in as the map target. Population rows are people, not assets, and are left
// out.
export function groupImpactAssetUnits(features) {
  const list = Array.isArray(features) ? features : [];

  // Same "<UseType> #n" numbering the category accordion shows, so an
  // unnamed building carries one label across both views.
  const accordionLabel = new Map();
  for (const group of summarizeImpactAssetsByCategory(list)) {
    group.features.forEach((f, i) => accordionLabel.set(f, buildImpactAssetLabel(f, i)));
  }

  const units = new Map();
  list.forEach((feature, index) => {
    const props = feature?.properties ?? {};
    const asset = props.asset || 'Unknown';
    if (asset === 'Population') return;
    const segmented = !UNSEGMENTED_ASSETS.has(asset);
    const key = segmented
      ? `${asset}|${props.useType ?? ''}|${props.subUse ?? ''}|${props.details ?? ''}`
      : `feature:${index}`;
    const loss = props.totalLoss ?? 0;
    const depth = Number.isFinite(props.hazard) ? props.hazard : null;
    let unit = units.get(key);
    if (!unit) {
      unit = {
        key,
        asset,
        useType: props.useType ?? null,
        sector: props.sector ?? 'unknown',
        label: segmented ? (props.details ?? props.useType ?? asset) : (accordionLabel.get(feature) ?? buildImpactAssetLabel(feature, index)),
        totalLoss: 0,
        maxDepth: null,
        segmentCount: 0,
        representative: feature,
        representativeLoss: -1,
      };
      units.set(key, unit);
    }
    unit.totalLoss += loss;
    unit.segmentCount += 1;
    if (depth !== null && (unit.maxDepth === null || depth > unit.maxDepth)) unit.maxDepth = depth;
    if (loss > unit.representativeLoss) {
      unit.representative = feature;
      unit.representativeLoss = loss;
    }
  });
  return Array.from(units.values());
}

export function topImpactAssetUnits(units, limit) {
  return units
    .filter((unit) => unit.totalLoss > 0)
    .sort((a, b) => b.totalLoss - a.totalLoss)
    .slice(0, limit);
}

// Exposed-asset roll-up across every asset type in the window: how many
// distinct assets of each type the flood touches and what they lose, with the
// assets themselves (worst first) for expanding a type.
export function summarizeImpactAssetTypes(units) {
  const byType = new Map();
  for (const unit of units) {
    let row = byType.get(unit.asset);
    if (!row) {
      row = { asset: unit.asset, label: impactAssetTypeLabel(unit.asset), count: 0, loss: 0, units: [] };
      byType.set(unit.asset, row);
    }
    row.count += 1;
    row.loss += unit.totalLoss;
    row.units.push(unit);
  }
  for (const row of byType.values()) row.units.sort((a, b) => b.totalLoss - a.totalLoss);
  return Array.from(byType.values()).sort((a, b) => b.loss - a.loss || b.count - a.count);
}

export function normalizeImpactAssetsResponse(payload) {
  const rawFeatures = Array.isArray(payload?.features) ? payload.features : [];
  return {
    type: 'FeatureCollection',
    cycleId: payload?.cycle_id ?? null,
    scenario: payload?.scenario ?? null,
    // A feature with no geometry (shouldn't happen, but the backend passes
    // raw-results.gpkg rows through fairly directly) would otherwise reach
    // MapLibre's setData() and throw there instead of failing gracefully here.
    //
    // `id` (not just `properties.id`) is required for MapLibre's
    // setFeatureState()-based map selection (see useZarrMap's
    // flyToImpactAsset) -- generated here from array position since the
    // backend doesn't provide a stable per-asset id, stable for as long as
    // this same fetched array/order is in use (one fetch per session; see
    // Home.jsx's impactAssetsFetchedRef).
    features: rawFeatures.filter((f) => f?.geometry).map((f, i) => ({ ...normalizeAssetFeature(f), id: i })),
  };
}

export async function fetchCookIslandsImpactAssets(scenario) {
  const url = scenario
    ? `/cok/impact/latest/assets?scenario=${encodeURIComponent(scenario)}`
    : '/cok/impact/latest/assets';
  const body = await fetchJson(url);
  return normalizeImpactAssetsResponse(body);
}

// Names the water mark the backend actually applied (MHWS plus its margin), so a
// raised mark is never labelled as plain MHWS.
export function mhwsMarginLabel(marginM) {
  if (!Number.isFinite(marginM) || marginM <= 0) return 'MHWS';
  return `MHWS + ${Number((marginM * 100).toFixed(1))} cm`;
}

// ── area inundated above MHWS ────────────────────────────────────────────
// /cok/inundation/latest/mhws-adjusted: the forecast event footprint (SFINCS
// hmax depth >= min_depth_m) restricted to LiDAR-derived land above Mean High
// Water Springs plus a small margin the scientists advised (sea, lagoon and the
// intertidal beach are excluded). The margin is reported by the backend so the
// UI always labels the line it is really using. Unlike RiskScape's
// Total_Exposed_Area_Or_Length this measures land actually inundated, not
// the extent of whatever exposure layer was sampled. It serves only the
// single latest published cycle, so the response's own cycleId is compared
// against the impact result's before the two are shown side by side.

// 10 cm: thin sheet flow at the wet/dry edge is where model noise concentrates (5 cm inflated the
// area by about 30% on the live cycle); 5 cm stays available as the other option.
export const MHWS_DEFAULT_MIN_DEPTH_M = 0.1;
export const MHWS_DEPTH_OPTIONS_M = [0.05, 0.1];

// The impact windows are named "block01_<start>_to_<end>" (see
// _cok_impact_block_dates in the backend) and the hazard blocks share that
// 1-based numbering, so the window prefix is the block index.
export function mhwsBlockIndexFromScenario(scenario) {
  const match = /^block0*(\d+)(?:_|$)/.exec(String(scenario ?? ''));
  const index = match ? Number(match[1]) : null;
  return index >= 1 ? index : null;
}

export function normalizeMhwsInundationResponse(payload) {
  const totalM2 = toNumber(payload?.area_inundated_m2);
  const districts = (Array.isArray(payload?.districts) ? payload.districts : [])
    .map((d) => ({
      districtId: String(d?.cdid ?? ''),
      districtName: d?.district_name ?? 'Unknown',
      areaM2: toNumber(d?.area_inundated_m2) ?? 0,
      areaHa: toNumber(d?.area_inundated_ha) ?? 0,
      percentOfTotal: toNumber(d?.percentage_of_total) ?? 0,
    }))
    .sort((a, b) => b.areaM2 - a.areaM2);
  return {
    cycleId: payload?.cycle_id != null ? String(payload.cycle_id) : null,
    block: toNumber(payload?.block),
    areaM2: totalM2,
    areaHa: toNumber(payload?.area_inundated_ha),
    areaKm2: toNumber(payload?.area_inundated_km2),
    depthThresholdM: toNumber(payload?.depth_threshold_m),
    mhwsElevationM: toNumber(payload?.mhws_elevation_m_msl),
    marginAboveMhwsM: toNumber(payload?.margin_above_mhws_m),
    filterElevationM: toNumber(payload?.filter_elevation_m_msl),
    landMaskSource: payload?.land_mask_source ?? null,
    methodologyVersion: payload?.methodology_version ?? null,
    districts,
    outsideDistrictsHa: toNumber(payload?.outside_districts_ha) ?? 0,
    // Inundated-land footprint (WGS84 GeoJSON), drawn on the map; null on a dry window.
    geometry: payload?.geometry ?? null,
  };
}

function mhwsErrorMessage(status, payload) {
  if (status === 404) return 'Not available in this deployment yet.';
  if (status === 503) return payload?.detail || 'No forecast hazard cycle has been published yet.';
  return 'Area inundated above MHWS failed to load.';
}

export async function fetchCookIslandsMhwsInundation({ block = 1, minDepthM = MHWS_DEFAULT_MIN_DEPTH_M } = {}) {
  const url = `/cok/inundation/latest/mhws-adjusted?block=${encodeURIComponent(block)}&min_depth_m=${encodeURIComponent(minDepthM)}`;
  const response = await fetch(url);
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) throw new Error(mhwsErrorMessage(response.status, body));
  return normalizeMhwsInundationResponse(body);
}

// The water marks the backend serves, as a margin above MHWS in cm. 17.5 is the
// working mark; 0 (plain MHWS) and 15/20 (the scientists' "15-20 cm") are shown
// beside it so the choice can be judged. `kind` matches the contour file.
export const MHWS_LINES = [
  { marginCm: 0, kind: 'mhws', label: 'MHWS', short: 'MHWS' },
  { marginCm: 15, kind: 'range', label: 'MHWS + 15 cm', short: '+15 cm' },
  { marginCm: 17.5, kind: 'working', label: 'MHWS + 17.5 cm', short: '+17.5 cm' },
  { marginCm: 20, kind: 'range', label: 'MHWS + 20 cm', short: '+20 cm' },
];

// /cok/inundation/latest/mhws-adjusted/summary: area above every water mark for
// one block (no geometry), so the marks can be compared in a table.
export function normalizeMhwsSummaryResponse(payload) {
  const levels = (Array.isArray(payload?.levels) ? payload.levels : []).map((lv) => ({
    marginCm: toNumber(lv?.margin_above_mhws_cm),
    filterElevationM: toNumber(lv?.filter_elevation_m_msl),
    areaHa: toNumber(lv?.area_inundated_ha) ?? 0,
    outsideDistrictsHa: toNumber(lv?.outside_districts_ha) ?? 0,
    districts: (Array.isArray(lv?.districts) ? lv.districts : []).map((d) => ({
      districtId: String(d?.cdid ?? ''),
      districtName: d?.district_name ?? 'Unknown',
      areaHa: toNumber(d?.area_inundated_ha) ?? 0,
    })),
  }));
  return {
    cycleId: payload?.cycle_id != null ? String(payload.cycle_id) : null,
    block: toNumber(payload?.block),
    depthThresholdM: toNumber(payload?.depth_threshold_m),
    defaultMarginCm: toNumber(payload?.default_margin_cm),
    levels,
  };
}

export async function fetchCookIslandsMhwsSummary({ block = 1, minDepthM = MHWS_DEFAULT_MIN_DEPTH_M } = {}) {
  const url = `/cok/inundation/latest/mhws-adjusted/summary?block=${encodeURIComponent(block)}&min_depth_m=${encodeURIComponent(minDepthM)}`;
  const response = await fetch(url);
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) throw new Error(mhwsErrorMessage(response.status, body));
  return normalizeMhwsSummaryResponse(body);
}

// Static MHWS contour: the line where the LiDAR ground crosses +0.328 m above
// mean sea level along the shore (the seaward edge of "land above MHWS" that
// the backend uses). Built once from the DTM; drawn on the map as a reference
// line, the usual way a tidal datum is shown.
const MHWS_CONTOUR_URL = `${process.env.PUBLIC_URL || ''}/data/cok_mhws_contour_4326.geojson`;

export async function fetchCookIslandsMhwsContour() {
  const response = await fetch(MHWS_CONTOUR_URL);
  if (!response.ok) throw new Error('The MHWS contour is not available in this deployment.');
  return response.json();
}

// Wraps a result's geometry as a FeatureCollection for a MapLibre geojson source.
export function mhwsFloodFeatureCollection(result) {
  if (!result?.geometry) return { type: 'FeatureCollection', features: [] };
  return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: result.geometry, properties: {} }] };
}
