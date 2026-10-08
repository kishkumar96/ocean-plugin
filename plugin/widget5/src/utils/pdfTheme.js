// pdfTheme.js -- the single visual theme for every Widget 5 PDF (domain advisory, route
// advisory, scenario comparison, landing-area comparison and landing-site advisory), so
// they read as one product. Follows Widget 1's report look:
//   * A4 landscape editorial pages on a light background
//   * navy header band with cyan accent, white bordered content cards
//   * hazard-tinted recommendation banners, evidence panels
//   * one footer: model-guidance disclaimer (+ optional run/valid/scope/source line)
//   * one hazard palette (Suitable / Caution / Warning -- never Widget 1's "Avoid")
// Anything a report draws repeatedly (header, footer, card, banner, section title, key/value
// row) lives here, so a look-and-feel change is made once. Report modules keep only their own
// page layouts. jsPDF itself is still imported lazily by each report.
import { HAZARD_COLORS } from '../lib/CookIslandsSuitabilityOverlay';

// ── page geometry (A4 landscape, mm) ───────────────────────────────────────
export const PAGE_W = 297;
export const PAGE_H = 210;
export const MARGIN = 8;
export const HDR_H = 18;
export const FOOTER_H = 12;               // reserved at the bottom for provenance + disclaimer
export const CONTENT_TOP = HDR_H + 4;
export const contentBottom = (doc) => (doc?.internal?.pageSize?.getHeight?.() ?? PAGE_H) - FOOTER_H;
export const contentWidth = (doc) => (doc?.internal?.pageSize?.getWidth?.() ?? PAGE_W) - 2 * MARGIN;

// ── palette ────────────────────────────────────────────────────────────────
export const PAGE_BG = [248, 249, 250];
export const CARD_BG = [255, 255, 255];
export const HEADER_BG = [15, 42, 66];     // navy
export const ACCENT = [0, 212, 255];       // cyan accent
export const TEXT_LT = [255, 255, 255];
export const TEXT_MD = [90, 100, 110];
export const TEXT_DK = [30, 35, 40];
export const GRID_CLR = [220, 224, 228];
export const NO_DATA_GREY = [150, 150, 150];
export const NOTICE_BG = [255, 244, 214];
export const NOTICE_BORDER = [230, 180, 60];

const HAZARD_LIGHT = { 0: [220, 243, 240], 1: [255, 240, 219], 2: [252, 222, 224] };
const HAZARD_TEXT = { 0: [25, 94, 89], 1: [150, 95, 10], 2: [166, 34, 43] };
export const HAZARD_LABELS = { 0: 'Suitable', 1: 'Caution', 2: 'Warning' };

export function hexToRgb(hex) {
  const raw = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16));
}
export function hazardColor(h) { return HAZARD_COLORS[h] ? hexToRgb(HAZARD_COLORS[h]) : NO_DATA_GREY; }
export function hazardLight(h) { return HAZARD_LIGHT[h] ?? [235, 236, 238]; }
export function hazardText(h) { return HAZARD_TEXT[h] ?? TEXT_MD; }
export function hazardLabel(h) { return HAZARD_LABELS[h] ?? 'Unknown'; }

// ── report typeface ────────────────────────────────────────────────────────
// Lato (OFL-licensed, public/fonts/lato/) instead of jsPDF's built-in Helvetica -- every
// report reads as a designed document rather than a generic default-font PDF. Fetched once
// per browser session (module-level cache) and registered onto each jsPDF document by
// ensureReportFont, which every report's build function calls right after constructing its
// doc and before any drawing. If the fetch fails for any reason (offline export, blocked
// asset, a Node-based script with no fetch/PUBLIC_URL at all -- see scripts/pdf-smoke/) this
// degrades silently to standard Helvetica: a report must always be able to export, even
// without the custom font.
const FONT_FAMILY = 'Lato';
const FONT_FILES = { normal: 'Lato-Regular.ttf', bold: 'Lato-Bold.ttf', italic: 'Lato-Italic.ttf' };
let fontDataPromise = null;

async function fetchFontBase64(filename) {
  const base = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
  const res = await fetch(`${base}/fonts/lato/${filename}`);
  if (!res.ok) throw new Error(`font fetch failed: ${filename} (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000; // avoid a stack-overflowing single String.fromCharCode(...bytes) call
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

function loadFontData() {
  if (!fontDataPromise) {
    fontDataPromise = Promise.all(
      Object.entries(FONT_FILES).map(([style, file]) => fetchFontBase64(file).then((b64) => [style, b64])),
    ).then((pairs) => Object.fromEntries(pairs))
      .catch((err) => { fontDataPromise = null; throw err; }); // don't cache a permanent failure -- allow retry
  }
  return fontDataPromise;
}

export async function ensureReportFont(doc) {
  try {
    const data = await loadFontData();
    Object.entries(FONT_FILES).forEach(([style, file]) => {
      doc.addFileToVFS(file, data[style]);
      doc.addFont(file, FONT_FAMILY, style);
    });
    doc.__reportFontReady = true;
  } catch {
    doc.__reportFontReady = false;
  }
}

// ── low-level drawing ──────────────────────────────────────────────────────
export function setFill(doc, rgb) { doc.setFillColor(...rgb); }
export function setDraw(doc, rgb) { doc.setDrawColor(...rgb); }
export function setFont(doc, rgb, size, style = 'normal') {
  doc.setTextColor(...rgb);
  doc.setFontSize(size);
  doc.setFont(doc.__reportFontReady ? FONT_FAMILY : 'helvetica', style);
}
export function rect(doc, x, y, w, h, fill, draw, lw = 0.1) {
  setFill(doc, fill);
  if (draw) { setDraw(doc, draw); doc.setLineWidth(lw); }
  doc.rect(x, y, w, h, draw ? 'FD' : 'F');
}

// Truncates with an ellipsis so a long string can never run into its neighbour.
export function fitText(doc, str, maxWidth) {
  const s = String(str ?? '');
  if (typeof doc.getTextWidth !== 'function' || doc.getTextWidth(s) <= maxWidth) return s;
  let lo = 0; let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.getTextWidth(`${s.slice(0, mid).trimEnd()}…`) <= maxWidth) lo = mid; else hi = mid - 1;
  }
  return lo === 0 ? '…' : `${s.slice(0, lo).trimEnd()}…`;
}

// ── formatting shared by every report ──────────────────────────────────────
export function formatNumber(value, digits = 1) {
  // null/undefined must short-circuit before Number(): Number(null) is 0 (finite), which would
  // fabricate a "0" reading for an explicitly unavailable value.
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

export function formatEta(dateLike, timeDisplayZone) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timeDisplayZone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
}

// ── page furniture ─────────────────────────────────────────────────────────
// First thing every page draws: it paints the light page background, so it must be called
// before anything else on the page (report pages already begin with their header).
export function drawHeaderBand(doc, { title, subtitle, rightLine1, rightLine2, titleSize = 14 }) {
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight?.() ?? PAGE_H;
  rect(doc, 0, 0, pw, ph, PAGE_BG);
  rect(doc, 0, 0, pw, HDR_H, HEADER_BG);
  rect(doc, 0, HDR_H - 0.7, pw, 0.7, ACCENT);
  setFont(doc, TEXT_LT, 8.5);
  const rightW = Math.max(rightLine1 ? doc.getTextWidth?.(rightLine1) ?? 0 : 0, rightLine2 ? doc.getTextWidth?.(rightLine2) ?? 0 : 0);
  const leftMax = pw - 2 * MARGIN - (rightW > 0 ? rightW + 8 : 0);
  setFont(doc, TEXT_LT, titleSize, 'bold');
  doc.text(fitText(doc, title, leftMax), MARGIN, HDR_H * 0.44);
  if (subtitle) {
    setFont(doc, ACCENT, 8.5);
    doc.text(fitText(doc, subtitle, leftMax), MARGIN, HDR_H * 0.78);
  }
  if (rightLine1) {
    setFont(doc, TEXT_LT, 8.5);
    doc.text(rightLine1, pw - MARGIN, HDR_H * 0.44, { align: 'right' });
  }
  if (rightLine2) {
    setFont(doc, [200, 210, 220], 7.5);
    doc.text(rightLine2, pw - MARGIN, HDR_H * 0.78, { align: 'right' });
  }
}

export const MODEL_DISCLAIMER = 'SWAN wave model guidance. Vessel operating envelope thresholds are advisory defaults, not navigation advice — use alongside official warnings and local seamanship.';

// `provenance` (optional): one line, e.g. "Model run … · Valid … · Scope … · Source …".
export function drawFooter(doc, { provenance = null, text = MODEL_DISCLAIMER } = {}) {
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight?.() ?? PAGE_H;
  if (provenance) {
    setFont(doc, TEXT_MD, 5.8);
    doc.text(fitText(doc, provenance, pw - 2 * MARGIN), pw / 2, ph - 6.6, { align: 'center' });
  }
  setFont(doc, TEXT_MD, 5.8, 'italic');
  doc.text(fitText(doc, text, pw - 2 * MARGIN), pw / 2, ph - 2.6, { align: 'center' });
}

// ── components ─────────────────────────────────────────────────────────────
// White bordered content card (the workhorse container).
export function card(doc, x, y, w, h, { fill = CARD_BG, border = GRID_CLR, lw = 0.25 } = {}) {
  rect(doc, x, y, w, h, fill, border, lw);
}

// Full-width recommendation/finding banner tinted by hazard class (null = neutral grey).
export function banner(doc, { y, text, hazard = null, h = 9, size = 9 }) {
  const pw = doc.internal.pageSize.getWidth();
  const x = MARGIN;
  const w = pw - 2 * MARGIN;
  rect(doc, x, y, w, h, hazard === null ? [238, 242, 246] : hazardLight(hazard), hazard === null ? GRID_CLR : hazardColor(hazard), 0.3);
  setFont(doc, hazard === null ? TEXT_MD : hazardText(hazard), size, 'bold');
  doc.text(fitText(doc, text, w - 8), x + 4, y + h / 2 + size * 0.17);
}

// Amber notice panel for anything that makes a report not like-for-like or downgrades it.
// Returns the height used.
export function notice(doc, { x, y, w, text, size = 6.6 }) {
  const lines = doc.splitTextToSize(text, w - 6);
  const h = lines.length * (size * 0.5 + 0.5) + 3.5;
  rect(doc, x, y, w, h, NOTICE_BG, NOTICE_BORDER, 0.3);
  setFont(doc, hazardText(1), size, 'bold');
  doc.text(lines, x + 3, y + 4);
  return h;
}

export function sectionTitle(doc, text, x, y, { color = HEADER_BG, size = 8.5 } = {}) {
  setFont(doc, color, size, 'bold');
  doc.text(text, x, y);
}

// "Label: value" row; returns the height it consumed so callers can stack rows.
export function keyValue(doc, x, y, key, value, { keyW = 34, maxW = 80, size = 6.8 } = {}) {
  setFont(doc, TEXT_MD, size, 'bold'); doc.text(`${key}:`, x, y);
  setFont(doc, TEXT_DK, size);
  const lines = doc.splitTextToSize(String(value), maxW);
  doc.text(lines, x + keyW, y);
  return Math.max(4.4, lines.length * (size * 0.5 + 0.1) + 1);
}

// Small stat tile (label over value), used for headline evidence rows.
export function StatCard(doc, x, y, w, h, label, value, valueColor = TEXT_DK) {
  card(doc, x, y, w, h);
  setFont(doc, TEXT_MD, 6.2, 'bold');
  doc.text(label.toUpperCase(), x + 3, y + 5.5);
  setFont(doc, valueColor, 11, 'bold');
  doc.text(fitText(doc, value, w - 6), x + 3, y + 12.5);
}

// Suitable/Caution/Warning stacked share bar, shared by every report that draws one
// (domain contrast panels, comms poster vessel cards, scenario cards). Upstream shares
// are not guaranteed to sum to 100 (a rounding artefact, a partial feed) -- drawing them
// verbatim can push a segment past the bar's own right edge into whatever sits next to
// it. Scales proportionally down when the total exceeds 100, and additionally clips each
// segment to the width actually left in the bar, so it can never paint outside its box
// even if the scaling itself is somehow wrong.
export function drawHazardShareBar(doc, x, y, w, h, shares) {
  const clean = shares.map(([hz, v]) => [hz, Math.max(0, Number(v) || 0)]);
  const total = clean.reduce((sum, [, v]) => sum + v, 0);
  const scale = total > 100 ? 100 / total : 1;
  let bx = x;
  clean.forEach(([hz, v]) => {
    const remaining = Math.max(0, w - (bx - x));
    const sw = Math.min(remaining, (v * scale / 100) * w);
    if (sw <= 0) return;
    setFill(doc, hazardColor(hz));
    doc.rect(bx, y, sw, h, 'F');
    bx += sw;
  });
}

export function drawLegendRow(doc, x, y, items = null) {
  const list = items ?? [[hazardColor(0), 'Suitable'], [hazardColor(1), 'Caution'], [hazardColor(2), 'Warning'], [NO_DATA_GREY, 'Unavailable']];
  let cx = x;
  list.forEach(([color, label]) => {
    rect(doc, cx, y - 2.4, 3, 3, color);
    setFont(doc, TEXT_MD, 6.6);
    doc.text(label, cx + 4.5, y);
    cx += 27;
  });
}

// ── vessel icons ───────────────────────────────────────────────────────────
const VESSEL_ICON_FILE_STEM = {
  traditional_craft: 'Vaka',
  very_small_motorised_craft: 'Fishing Boat',
  small_craft: 'Ferry',
  larger_vessels: 'Container Ship',
};
const HAZARD_ICON_COLOR = { 0: 'Green', 1: 'Amber', 2: 'Red' };

async function loadSvgAsPngDataUrl(src, width, height) {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const svgText = await res.text();
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const objUrl = URL.createObjectURL(blob);
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(objUrl);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => { URL.revokeObjectURL(objUrl); resolve(null); };
      img.src = objUrl;
    });
  } catch {
    return null;
  }
}

// Rasterised at 2x the SVGs' natural size (288x96) for crisp print output. Returns null (never
// throws) on any failure: a missing icon degrades to text-only rendering, not a failed export.
export async function loadVesselSvgIcon(vesselCode, hazardClass) {
  const stem = VESSEL_ICON_FILE_STEM[vesselCode];
  if (!stem) return null;
  const color = HAZARD_ICON_COLOR[hazardClass] ?? 'Green';
  const base = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
  const src = `${base}/vessels/${encodeURIComponent(`${stem} ${color}.svg`)}`;
  return loadSvgAsPngDataUrl(src, 576, 192);
}
