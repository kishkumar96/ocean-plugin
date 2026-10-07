export type RGB = readonly [number, number, number];

export type ColormapName = "jet" | "red-blue" | "rdbu-r" | "puor-r";

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ] as const;
}

function jet(t: number): RGB {
  const x = clamp01(t);
  const r = Math.round(clamp01(1.5 - Math.abs(4 * x - 3)) * 255);
  const g = Math.round(clamp01(1.5 - Math.abs(4 * x - 2)) * 255);
  const b = Math.round(clamp01(1.5 - Math.abs(4 * x - 1)) * 255);
  return [r, g, b] as const;
}

function redBlue(t: number): RGB {
  const x = clamp01(t);
  const blue: RGB = [0, 0, 255];
  const white: RGB = [255, 255, 255];
  const red: RGB = [255, 0, 0];

  if (x <= 0.5) {
    return lerpRgb(blue, white, x / 0.5);
  }

  return lerpRgb(white, red, (x - 0.5) / 0.5);
}

// ColorBrewer RdBu reversed (matplotlib "RdBu_r"): dark blue -> white -> dark red.
// Matches the ocean portal SST anomaly legend.
const RDBU_R_STOPS: RGB[] = [
  [5, 48, 97],
  [33, 102, 172],
  [67, 147, 195],
  [146, 197, 222],
  [209, 229, 240],
  [247, 247, 247],
  [253, 219, 199],
  [244, 165, 130],
  [214, 96, 77],
  [178, 24, 43],
  [103, 0, 31],
];

// ColorBrewer PuOr reversed (matplotlib "PuOr_r"): dark purple -> white -> dark orange.
const PUOR_R_STOPS: RGB[] = [
  [45, 0, 75],
  [84, 39, 136],
  [128, 115, 172],
  [178, 171, 210],
  [216, 218, 235],
  [247, 247, 247],
  [254, 224, 182],
  [253, 184, 99],
  [224, 130, 20],
  [179, 88, 6],
  [127, 59, 8],
];

/** Piecewise-linear colormap through evenly spaced stops. */
function fromStops(stops: RGB[]) {
  return (t: number): RGB => {
    const x = clamp01(t) * (stops.length - 1);
    const i = Math.min(Math.floor(x), stops.length - 2);
    return lerpRgb(stops[i], stops[i + 1], x - i);
  };
}

const rdbuR = fromStops(RDBU_R_STOPS);
const puorR = fromStops(PUOR_R_STOPS);

export function normalizeColormapName(value: unknown): ColormapName | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "jet") {
    return "jet";
  }

  if (normalized === "red-blue" || normalized === "redblue" || normalized === "red_blue") {
    return "red-blue";
  }

  if (normalized === "rdbu-r" || normalized === "rdbu_r") {
    return "rdbu-r";
  }

  if (normalized === "puor-r" || normalized === "puor_r") {
    return "puor-r";
  }

  return null;
}

export function getColormap(name: unknown): (t: number) => RGB {
  const normalized = normalizeColormapName(name) ?? "jet";

  switch (normalized) {
    case "red-blue":
      return redBlue;
    case "rdbu-r":
      return rdbuR;
    case "puor-r":
      return puorR;
    case "jet":
    default:
      return jet;
  }
}
