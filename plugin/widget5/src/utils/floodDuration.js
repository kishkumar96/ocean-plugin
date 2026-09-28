// Hours of a depth timeseries spent above a flood threshold. Each sample is
// weighted by the length of its own interval (to the next sample; the last one
// reuses the previous interval), so uneven spacing or a gap in the series is not
// treated as if every step were as long as the first. Samples without a usable
// time contribute nothing.
export function computeFloodedHours(series, thresholdM) {
  if (!Array.isArray(series) || series.length < 2) return 0;
  const times = series.map((d) => new Date(d?.time).getTime());
  let hours = 0;
  for (let i = 0; i < series.length; i += 1) {
    const depth = series[i]?.depth_m ?? 0;
    if (!(depth > thresholdM)) continue;
    const next = i < series.length - 1 ? times[i + 1] - times[i] : times[i] - times[i - 1];
    if (Number.isFinite(next) && next > 0) hours += next / 3.6e6;
  }
  return hours;
}
