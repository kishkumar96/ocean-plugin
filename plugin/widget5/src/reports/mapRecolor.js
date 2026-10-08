// mapRecolor.js -- gives the service-rendered suitability maps their own, softer MAP-FILL colours.
//
// The operational-map service paints classes in the interface colours (bright, and shaded: one image
// holds thousands of reds between ~(217,75,72) and (229,86,83)). Large areas of that red read as an alarm
// block rather than a map. Interface elements (banner, card bars, badges) keep the strong colours; map
// fills move to a slightly darker, less saturated set. Each pixel is matched to its class by HUE and
// keeps its shading offset from the class's base colour, so relief/texture in the render survives.
// Low-saturation pixels (land, background, coastline, anti-aliased edges) are left untouched.

// What the service paints (modal colour of each class, sampled from live renders).
export const SERVICE_CLASS_RGB = { 0: [72, 170, 159], 1: [246, 155, 38], 2: [229, 86, 83] };
// Map-fill colours: same hues, calmer. Interface colours are unchanged (HAZARD_COLORS).
export const MAP_FILL_RGB = { 0: [88, 172, 162], 1: [234, 168, 74], 2: [214, 104, 98] };

function hueSatVal(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const v = max / 255;
  const s = max === 0 ? 0 : d / max;
  if (d === 0) return [0, s, v];
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return [h < 0 ? h + 360 : h, s, v];
}

// Class of a pixel by hue, or null for anything that is not a class colour.
export function pixelClass(r, g, b) {
  const [h, s, v] = hueSatVal(r, g, b);
  if (s < 0.3 || v < 0.35) return null;
  if (h >= 340 || h < 15) return 2;
  if (h >= 20 && h < 50) return 1;
  if (h >= 150 && h < 195) return 0;
  return null;
}

const clamp = (x) => (x < 0 ? 0 : x > 255 ? 255 : Math.round(x));

// Recolours RGBA pixel data in place; returns how many pixels changed.
export function recolorRgba(data) {
  let changed = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const cls = pixelClass(data[i], data[i + 1], data[i + 2]);
    if (cls === null) continue;
    const base = SERVICE_CLASS_RGB[cls];
    const fill = MAP_FILL_RGB[cls];
    data[i] = clamp(fill[0] + (data[i] - base[0]));
    data[i + 1] = clamp(fill[1] + (data[i + 1] - base[1]));
    data[i + 2] = clamp(fill[2] + (data[i + 2] - base[2]));
    changed += 1;
  }
  return changed;
}

// Browser only: decodes the PNG, recolours it, re-encodes it. Resolves null wherever there is no real
// canvas (jsdom tests, Node report scripts) or anything fails, so callers keep the original image.
export function recolorMapDataUrl(dataUrl, { timeoutMs = 5000 } = {}) {
  const realBrowser = typeof window !== 'undefined' && typeof document !== 'undefined'
    && !/jsdom/i.test(window.navigator?.userAgent ?? '') && typeof Image !== 'undefined';
  if (!realBrowser || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) { clearTimeout(timer); resolve(null); return; }
        ctx.drawImage(img, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        recolorRgba(pixels.data);
        ctx.putImageData(pixels, 0, 0);
        clearTimeout(timer);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        clearTimeout(timer);
        resolve(null);
      }
    };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = dataUrl;
  });
}
