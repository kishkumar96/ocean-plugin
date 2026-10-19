// Layer definitions served by the SPC ocean middleware (layer_web_map endpoint).
export type WmsLayerConfig = {
  id: number;
  url: string;
  layer_title: string;
  layer_name: string;
  style: string;
  image_format: string;
  transparent: boolean;
  colormin: number;
  colormax: number;
  numcolorbands: number;
  abovemaxcolor: string;
  belowmincolor: string;
  logscale: boolean;
  opacity: number;
  has_specific_timestep: boolean;
  specific_timestemps: string;
  timeIntervalStart: string;
  timeIntervalEnd: string;
  datetime_format: string; // e.g. "MONTHLY", "DAILY"
  interval_step: string | null; // hours between steps, when not monthly
  update_thredds: boolean; // read available dates from THREDDS
  legend_url: string | null;
};

import type { TimeStep } from "./time";

export function timeStep(cfg: WmsLayerConfig): TimeStep {
  return cfg.datetime_format === "MONTHLY" ? "monthly" : "daily";
}

const MIDDLEWARE =
  "https://ocean-middleware.spc.int/middleware/api/layer_web_map";

export async function fetchLayerConfig(id: number): Promise<WmsLayerConfig> {
  const res = await fetch(`${MIDDLEWARE}/${id}/?format=json`);
  if (!res.ok) throw new Error(`Failed to load layer ${id} (${res.status})`);
  return res.json();
}

/** MapLibre source/layer id for a middleware layer. */
export const wmsLayerId = (layerId: number) => `wms-${layerId}`;

const iso = (d: Date) => d.toISOString().replace(".000Z", "Z");

/** Available timesteps as ISO strings with a Z suffix, oldest first. */
export async function fetchLayerTimes(cfg: WmsLayerConfig): Promise<string[]> {
  if (cfg.has_specific_timestep && cfg.specific_timestemps) {
    return cfg.specific_timestemps
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (t.endsWith("Z") ? t : `${t}Z`));
  }
  if (cfg.update_thredds) {
    try {
      return await fetchThreddsDates(cfg);
    } catch {
      // Fall through to the configured interval.
    }
  }
  return intervalTimes(cfg);
}

/** Dates with data, from ncWMS GetMetadata (months are 0-based). */
async function fetchThreddsDates(cfg: WmsLayerConfig): Promise<string[]> {
  const params = new URLSearchParams({
    request: "GetMetadata",
    item: "layerDetails",
    layerName: cfg.layer_name,
  });
  const res = await fetch(`${cfg.url}?${params}`);
  if (!res.ok) throw new Error(`GetMetadata failed (${res.status})`);
  const { datesWithData } = (await res.json()) as {
    datesWithData: Record<string, Record<string, number[]>>;
  };
  const times: string[] = [];
  for (const [y, months] of Object.entries(datesWithData)) {
    for (const [m, days] of Object.entries(months)) {
      for (const d of days) times.push(iso(new Date(Date.UTC(+y, +m, d))));
    }
  }
  if (!times.length) throw new Error("No dates with data");
  return times.sort();
}

function intervalTimes(cfg: WmsLayerConfig): string[] {
  const times: string[] = [];
  const d = new Date(cfg.timeIntervalStart);
  const end = new Date(cfg.timeIntervalEnd);
  const hours = Number(cfg.interval_step) || 24;
  while (d <= end) {
    times.push(iso(d));
    if (timeStep(cfg) === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
    else d.setUTCHours(d.getUTCHours() + hours);
  }
  return times;
}

/** GetMap URL template; MapLibre fills in {bbox-epsg-3857} per tile. */
export function wmsTileUrl(cfg: WmsLayerConfig, time: string): string {
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: cfg.layer_name,
    STYLES: cfg.style,
    FORMAT: cfg.image_format,
    TRANSPARENT: String(cfg.transparent),
    CRS: "EPSG:3857",
    WIDTH: "256",
    HEIGHT: "256",
    TIME: time,
    COLORSCALERANGE: `${cfg.colormin},${cfg.colormax}`,
    NUMCOLORBANDS: String(cfg.numcolorbands),
    ABOVEMAXCOLOR: cfg.abovemaxcolor,
    BELOWMINCOLOR: cfg.belowmincolor,
    LOGSCALE: String(cfg.logscale),
  });
  return `${cfg.url}?${params}&BBOX={bbox-epsg-3857}`;
}
