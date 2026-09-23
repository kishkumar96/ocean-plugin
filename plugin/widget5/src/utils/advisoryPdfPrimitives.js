// advisoryPdfPrimitives.js
// Shared jsPDF drawing helpers for the Cook Islands advisory PDFs --
// extracted from CookIslandsRouteAdvisoryPdf.js's own local copies (same
// constant values, so nothing already shipped changes appearance) rather
// than a second, slightly different palette. New PDF exports (the domain
// advisory) import from here directly; CookIslandsRouteAdvisoryPdf.js keeps
// its own copies for now rather than risking its existing tests on a
// same-turn refactor -- migrating it to this module is a follow-up, not a
// requirement for the domain advisory to work.
import { HAZARD_COLORS } from '../lib/CookIslandsSuitabilityOverlay';

export const PAGE_W = 210; // A4 portrait, mm
export const HDR_H = 22;
export const HEADER_BG = [15, 42, 66];      // dark navy, matches the app's header band
export const ACCENT = [0, 212, 255];        // #00d4ff, the app's own accent cyan
export const TEXT_LT = [255, 255, 255];
export const TEXT_MD = [90, 100, 110];
export const TEXT_DK = [30, 35, 40];
export const GRID_CLR = [220, 224, 228];
export const NO_DATA_GREY = [150, 150, 150];

const HAZARD_LIGHT = {
  0: [220, 243, 240],
  1: [255, 240, 219],
  2: [252, 222, 224],
};
const HAZARD_TEXT = {
  0: [25, 94, 89],
  1: [150, 95, 10],
  2: [166, 34, 43],
};
export const HAZARD_LABELS = { 0: 'Suitable', 1: 'Caution', 2: 'Warning' };

export function hexToRgb(hex) {
  const raw = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16));
}
export function hazardColor(h) { return HAZARD_COLORS[h] ? hexToRgb(HAZARD_COLORS[h]) : NO_DATA_GREY; }
export function hazardLight(h) { return HAZARD_LIGHT[h] ?? [235, 236, 238]; }
export function hazardText(h) { return HAZARD_TEXT[h] ?? TEXT_MD; }
export function hazardLabel(h) { return HAZARD_LABELS[h] ?? 'Unknown'; }

export function setFill(doc, rgb) { doc.setFillColor(...rgb); }
export function setDraw(doc, rgb) { doc.setDrawColor(...rgb); }
export function setFont(doc, rgb, size, style = 'normal') {
  doc.setTextColor(...rgb);
  doc.setFontSize(size);
  doc.setFont('helvetica', style);
}
export function rect(doc, x, y, w, h, fill, draw, lw = 0.1) {
  setFill(doc, fill);
  if (draw) { setDraw(doc, draw); doc.setLineWidth(lw); }
  doc.rect(x, y, w, h, draw ? 'FD' : 'F');
}

export function drawHeaderBand(doc, { title, subtitle, rightLine1, rightLine2 }) {
  rect(doc, 0, 0, PAGE_W, HDR_H, HEADER_BG);
  setFont(doc, TEXT_LT, 15, 'bold');
  doc.text(title, 8, HDR_H * 0.45);
  if (subtitle) {
    setFont(doc, ACCENT, 9);
    doc.text(subtitle, 8, HDR_H * 0.8);
  }
  if (rightLine1) {
    setFont(doc, TEXT_LT, 8.5);
    doc.text(rightLine1, PAGE_W - 8, HDR_H * 0.45, { align: 'right' });
  }
  if (rightLine2) {
    setFont(doc, [200, 210, 220], 7.5);
    doc.text(rightLine2, PAGE_W - 8, HDR_H * 0.8, { align: 'right' });
  }
}

const MODEL_DISCLAIMER = 'SWAN wave model guidance. Vessel operating envelope thresholds are advisory defaults, not navigation advice — use alongside official warnings and local seamanship.';
export function drawFooter(doc, text = MODEL_DISCLAIMER) {
  const H = doc.internal.pageSize.getHeight();
  setFont(doc, TEXT_MD, 6.2, 'italic');
  const lines = doc.splitTextToSize(text, PAGE_W - 16);
  doc.text(lines, PAGE_W / 2, H - 4 - (lines.length - 1) * 3, { align: 'center' });
}

// ── vessel icons ─────────────────────────────────────────────────────────
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

// Rasterised at 2x the SVGs' natural size (288x96) for crisp print output,
// same technique widget1's loadVesselSvgIcon uses. Returns null (never
// throws) on any failure -- a missing icon should degrade to text-only
// rendering, not fail the whole PDF export.
export async function loadVesselSvgIcon(vesselCode, hazardClass) {
  const stem = VESSEL_ICON_FILE_STEM[vesselCode];
  if (!stem) return null;
  const color = HAZARD_ICON_COLOR[hazardClass] ?? 'Green';
  const base = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
  const src = `${base}/vessels/${encodeURIComponent(`${stem} ${color}.svg`)}`;
  return loadSvgAsPngDataUrl(src, 576, 192);
}
