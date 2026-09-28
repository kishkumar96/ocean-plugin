// impactFormat.js — shared formatting/status helpers for the Cook Islands
// RiskScape impact assessment UI (the compact ImpactTabPanel desktop tab and
// the detailed CookIslandsImpactPanel table/bottom-sheet view). Kept in one
// place so both surfaces agree on money/date formatting and, especially, on
// what "Available" vs "Older forecast" vs "Unavailable" actually means.

export const fmtUsd = (value) => {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${Math.round(value).toLocaleString()}`;
};

export const fmtDateRange = (start, end) => {
  if (!start || !end) return '—';
  const fmt = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${fmt(start)} – ${fmt(end)}`;
};

// The API only ever gives us a cycle_id like "2026090900" (YYYYMMDDHH, UTC —
// same convention as GFS_CYCLE in run_cook_islands_forecast_gpu.sh-1.sh) —
// there's no separate "impact computed at" timestamp in the response (checked
// the live payload directly, and the HTTP response carries no Last-Modified
// either). So "Forecast issued" is real and precise; a distinct "Impact
// updated" time isn't something this API can honestly report yet — showing
// one would mean fabricating it. Callers should present this single cycle
// time rather than inventing a second, different-looking timestamp.
export function parseCycleId(cycleId) {
  if (typeof cycleId !== 'string' || cycleId.length < 10) return null;
  const y = cycleId.slice(0, 4), mo = cycleId.slice(4, 6), d = cycleId.slice(6, 8), h = cycleId.slice(8, 10);
  const dt = new Date(`${y}-${mo}-${d}T${h}:00:00Z`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export const MODEL_STATUS = {
  available: { label: 'Available', color: '#2A9D8F' },
  updating: { label: 'Updating', color: '#38bdf8' },
  unavailable: { label: 'Unavailable', color: '#E63946' },
};

// `hasPriorResult`: true when impactData already held a successful result
// before this loading cycle started (i.e. this is a background refresh, not
// the first load) — distinguishes "Updating" (there's something to show
// while we wait) from the initial skeleton state (nothing to badge yet).
export function computeModelStatus({ loading, error, result, hasPriorResult }) {
  if (error) return 'unavailable';
  if (loading) return hasPriorResult ? 'updating' : null;
  if (!result || !Array.isArray(result.blocks) || result.blocks.length === 0) return 'unavailable';
  return 'available';
}

// Picks the index of the block with the highest total damage — the single
// window every headline metric (damage, buildings, population) should default
// to together, so the summary never mixes scenarios (e.g. worst-damage window's
// dollar figure next to a different window's building count).
export function worstBlockIndex(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return -1;
  return blocks.reduce((bestI, b, i) => (b.totalLoss > blocks[bestI].totalLoss ? i : bestI), 0);
}

export function fmtHectares(ha) {
  if (ha === null || ha === undefined || !Number.isFinite(ha)) return '—';
  if (ha === 0) return '0 ha';
  if (ha < 0.01) return '<0.01 ha';
  return `${ha.toFixed(ha < 10 ? 2 : 1)} ha`;
}

// ── Port assets (wharf / marina / jetty) ─────────────────────────────────
// RiskScape samples SFINCS depth at Port assets from the harbour water beside
// the structure, so their losses are often not flooding of the structure
// itself (checked against the LiDAR: the wharf decks sit above the tide line).
// These helpers let the UI show the estimate with and without them, using the
// per-asset feed that is already loaded.
export const PORT_ASSET_TYPE = 'Port';

// scenario -> total Port loss (USD), from /cok/impact/latest/assets features.
export function portLossByScenario(features) {
  const out = new Map();
  if (!Array.isArray(features)) return out;
  for (const f of features) {
    const p = f?.properties;
    if (p?.asset !== PORT_ASSET_TYPE || !p.scenario) continue;
    const loss = Number(p.total_loss);
    if (Number.isFinite(loss)) out.set(p.scenario, (out.get(p.scenario) ?? 0) + loss);
  }
  return out;
}

// The block with its Port loss removed from the total and from the sector Port
// belongs to (infrastructure). Everything else is left as reported.
export function blockWithoutPort(block, portLoss) {
  if (!block || !(portLoss > 0)) return block;
  const loss = Math.max((block.totalLoss ?? 0) - portLoss, 0);
  const sectors = { ...(block.lossesBySector ?? {}) };
  if (Number.isFinite(sectors.infrastructure)) sectors.infrastructure = Math.max(sectors.infrastructure - portLoss, 0);
  return { ...block, totalLoss: loss, lossesBySector: sectors };
}
