// harbourOutlookLayer.js -- the 16 named harbours / anchorages / passages on the Forecast map, each as an
// anchor badge whose FILL is the unloading verdict now and whose RING is the worst verdict over the next
// 24 h, so "fine now, bad by tonight" reads at a glance without opening the panel. Pure: the advisory
// bundle (reports/harbourAdvisoryBundle.js, the same facts the panel table and the PDF use) in,
// GeoJSON + popup HTML + canvas icons out.
import { HAZARD_COLORS } from './CookIslandsSuitabilityOverlay';
import { INCOMPLETE, unloadingLabel } from '../config/cookIslandsHarbourLimits';

// Verdict -> badge state. 'none' = no verdict (no limits set, or the location has no data).
export const HARBOUR_STATE_COLORS = {
  ok: HAZARD_COLORS[0],
  caution: HAZARD_COLORS[1],
  stop: HAZARD_COLORS[2],
  incomplete: '#94a3b8',
  none: '#64748b',
};
export const HARBOUR_STATES = Object.keys(HARBOUR_STATE_COLORS);

export function verdictState(verdict) {
  if (verdict === 0) return 'ok';
  if (verdict === 1) return 'caution';
  if (verdict === 2) return 'stop';
  if (verdict === INCOMPLETE) return 'incomplete';
  return 'none';
}

const ICON_PREFIX = 'cok-harbour';
export const harbourIconId = (nowState, nextState) => `${ICON_PREFIX}-${nowState}-${nextState}`;

const fmt = (v, digits, unit) => (Number.isFinite(v) ? `${v.toFixed(digits)} ${unit}` : '—');

export function buildHarbourOutlookFeatures(bundle) {
  const harbours = Array.isArray(bundle?.harbours) ? bundle.harbours : [];
  const judged = Boolean(bundle?.judged);
  return {
    type: 'FeatureCollection',
    features: harbours
      .filter((h) => Number.isFinite(h.lon) && Number.isFinite(h.lat))
      .map((h) => {
        const nowState = h.available && judged ? verdictState(h.verdictNow) : 'none';
        const nextState = h.available && judged ? verdictState(h.verdict24h) : 'none';
        return {
          type: 'Feature',
          id: h.riskPointId,
          geometry: { type: 'Point', coordinates: [h.lon, h.lat] },
          properties: {
            riskPointId: h.riskPointId,
            name: h.name,
            island: h.island,
            icon: harbourIconId(nowState, nextState),
            // Worse states draw on top where badges collide (Pukapuka, Manihiki and Penrhyn have two each).
            sortKey: { stop: 4, caution: 3, incomplete: 2, ok: 1, none: 0 }[nowState] + { stop: 0.4, caution: 0.3, incomplete: 0.2, ok: 0.1, none: 0 }[nextState],
            nowState,
            nextState,
          },
        };
      }),
  };
}

const escapeHtml = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// The popup for one harbour: verdicts in the limits' own wording, the numbers behind them, what drives
// them, and the next unloading window. Built from the bundle row, never from map feature properties
// (MapLibre flattens nested properties to strings).
export function harbourPopupHtml(h, bundle) {
  if (!h) return '';
  const basis = bundle?.basis;
  const judged = Boolean(bundle?.judged);
  const chip = (verdict) => {
    const state = verdictState(verdict);
    const color = HARBOUR_STATE_COLORS[state];
    const text = state === 'none' ? 'No verdict' : unloadingLabel(verdict, basis);
    return `<span style="display:inline-flex;align-items:center;gap:5px;font-weight:700;color:#0f172a;">
      <span style="width:9px;height:9px;border-radius:50%;background:${color};flex-shrink:0;"></span>${escapeHtml(text)}</span>`;
  };
  const row = (label, value) => `<div style="display:flex;justify-content:space-between;gap:12px;"><span style="opacity:.7;">${label}</span><span style="font-weight:600;">${value}</span></div>`;

  const body = !h.available
    ? `<div style="opacity:.8;font-style:italic;margin-top:4px;">${escapeHtml(h.unavailableReason || 'No model data for this location.')}</div>`
    : `
      ${judged ? `<div style="display:grid;grid-template-columns:auto 1fr;gap:3px 8px;margin:6px 0 4px;align-items:center;">
        <span style="opacity:.7;">Now</span>${chip(h.verdictNow)}
        <span style="opacity:.7;">Next 24 h</span>${chip(h.verdict24h)}
      </div>` : '<div style="opacity:.75;margin:6px 0 4px;">No unloading limits set: forecast values only.</div>'}
      ${h.cause ? `<div style="margin-bottom:4px;"><span style="opacity:.7;">Cause:</span> ${escapeHtml(h.cause)}</div>` : ''}
      ${h.windowText ? `<div style="margin-bottom:6px;font-weight:600;">${escapeHtml(h.windowText)}</div>` : ''}
      <div style="border-top:1px solid rgba(15,23,42,.12);padding-top:5px;display:flex;flex-direction:column;gap:1px;">
        ${row('Wave height now', fmt(h.hsM, 1, 'm'))}
        ${row('Max next 24 h', `${fmt(h.max24HsM, 1, 'm')}${h.missing24Hours > 0 ? ' *' : ''}`)}
        ${row('Wind now', fmt(h.windKt, 0, 'kt'))}
        ${Number.isFinite(h.tpS) ? row('Peak period', fmt(h.tpS, 1, 's')) : ''}
        ${h.dirPoint && Number.isFinite(h.dirDeg) ? row('Waves from', `${escapeHtml(h.dirPoint)} ${Math.round(h.dirDeg)}°`) : ''}
      </div>
      ${h.nodeFar ? `<div style="margin-top:4px;font-size:11px;color:#92400e;">Wave-model point ${h.nodeDistanceKm.toFixed(1)} km away; the harbour itself is not resolved.</div>` : ''}`;

  const basisNote = judged && (basis === 'provisional' || basis === 'draft')
    ? `<div style="margin-top:6px;font-size:10.5px;color:#92400e;">${basis === 'draft' ? 'DRAFT' : 'PROVISIONAL'} limits, not approved. Indicative only.</div>`
    : '';

  return `<div style="font:12px/1.45 system-ui,sans-serif;color:#0f172a;min-width:210px;">
    <div style="font-weight:800;font-size:13px;">${escapeHtml(h.name)}</div>
    <div style="opacity:.65;">${escapeHtml(h.island)} · barge unloading outlook</div>
    ${body}
    ${basisNote}
  </div>`;
}

// ── icons ─────────────────────────────────────────────────────────────────
// A 40 px badge (drawn at 2x): a white-edged disc in the "now" colour with an anchor, inside a thick ring
// in the "next 24 h" colour. A dark outer hairline keeps it legible on both satellite and light basemaps.
function drawAnchor(ctx, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.arc(20, 13.2, 1.9, 0, Math.PI * 2);
  ctx.moveTo(20, 15.3);
  ctx.lineTo(20, 26.5);
  ctx.moveTo(15.2, 18.6);
  ctx.lineTo(24.8, 18.6);
  ctx.moveTo(13.6, 21.6);
  ctx.bezierCurveTo(13.6, 28, 26.4, 28, 26.4, 21.6);
  ctx.stroke();
}

function makeHarbourIcon(nowState, nextState) {
  const size = 80; // 40 css px at pixelRatio 2
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);
  // outer hairline + soft shadow
  ctx.shadowColor = 'rgba(2, 6, 23, 0.45)';
  ctx.shadowBlur = 3;
  ctx.beginPath();
  ctx.arc(20, 20, 17.5, 0, Math.PI * 2);
  ctx.fillStyle = HARBOUR_STATE_COLORS[nextState];
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(2, 6, 23, 0.7)';
  ctx.stroke();
  // white separator, then the "now" disc
  ctx.beginPath();
  ctx.arc(20, 20, 12.6, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(20, 20, 11.2, 0, Math.PI * 2);
  ctx.fillStyle = HARBOUR_STATE_COLORS[nowState];
  ctx.fill();
  drawAnchor(ctx, nowState === 'caution' ? '#0f172a' : '#ffffff');
  return ctx.getImageData(0, 0, size, size);
}

export function registerHarbourIcons(map) {
  for (const now of HARBOUR_STATES) {
    for (const next of HARBOUR_STATES) {
      const id = harbourIconId(now, next);
      if (!map.hasImage(id)) {
        try {
          map.addImage(id, makeHarbourIcon(now, next), { pixelRatio: 2 });
        } catch (err) {
          // No 2D canvas (e.g. jsdom): the layer falls back to MapLibre's missing-image handling.
          return;
        }
      }
    }
  }
}
