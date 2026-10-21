/**
 * How a layer's timesteps are picked and labelled. "seasonal": each step is a
 * 3-month mean stamped with its centre month (e.g. Dec = Nov–Jan). "custom":
 * a dropdown of the layer's own `stepLabels`, one per timestep.
 */
export type TimeStep = "monthly" | "daily" | "seasonal" | "custom";

const SEASON_MONTH_FMT = new Intl.DateTimeFormat("en", {
  month: "short",
  timeZone: "UTC",
});

/** "2026-12-01T00:00:00Z" (centre month) -> "Nov 2026 – Jan 2027". */
export function seasonLabel(centre: string): string {
  const d = new Date(centre);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const sy = start.getUTCFullYear();
  const ey = end.getUTCFullYear();
  const s = SEASON_MONTH_FMT.format(start);
  const e = SEASON_MONTH_FMT.format(end);
  return sy === ey ? `${s} – ${e} ${ey}` : `${s} ${sy} – ${e} ${ey}`;
}

/** Nearest available timestep to a partial ISO date like "2015-12" or "2025-06-15". */
export function nearestTime(times: string[], target: string): string {
  const [y, m = "01", d = "01"] = target.slice(0, 10).split("-");
  const ms = Date.parse(`${y}-${m}-${d}T00:00:00Z`);
  return times.reduce((best, t) =>
    Math.abs(Date.parse(t) - ms) < Math.abs(Date.parse(best) - ms) ? t : best,
  );
}

/**
 * Starting timestep: the requested one if given, otherwise the latest.
 * `initial` is a date ("2015-12", "2025-06-15"), an offset back from the
 * latest timestep ("-10y", "-6m", "-30d"), "first" or "latest".
 */
export function startTime(times: string[], initial?: string): string | null {
  if (!times.length) return null;
  const latest = times[times.length - 1];
  if (!initial || initial === "latest") return latest;
  if (initial === "first") return times[0];

  const offset = initial.match(/^-(\d+)([ymd])$/);
  if (offset) {
    const n = Number(offset[1]);
    const d = new Date(latest);
    if (offset[2] === "y") d.setUTCFullYear(d.getUTCFullYear() - n);
    if (offset[2] === "m") d.setUTCMonth(d.getUTCMonth() - n);
    if (offset[2] === "d") d.setUTCDate(d.getUTCDate() - n);
    return nearestTime(times, d.toISOString());
  }
  return nearestTime(times, initial);
}
