// seriesAnalysis.js -- pure analysis of a per-timestep suitability series, used by
// the outlook and trend pages. A step is
//   { timeIndex, validTime (ms), available, suitable, caution, warning }  (percent of points)
// An unavailable step (fetch failed, or zero assessed points) is a gap: it breaks
// every run and is never counted as Suitable.
import { stepLevel } from './reportRules';

const isAvail = (s) => s && s.available !== false;

// Consecutive available steps satisfying `test`; each run = first/last step.
export function findRuns(series, test) {
  const runs = [];
  let cur = null;
  for (const step of series) {
    if (isAvail(step) && test(step)) {
      if (!cur) cur = { start: step, end: step, steps: 0 };
      cur.end = step;
      cur.steps += 1;
    } else if (cur) {
      runs.push(cur);
      cur = null;
    }
  }
  if (cur) runs.push(cur);
  return runs;
}

const level = (s) => stepLevel(s.warning, s.caution);

// Longest run with no Caution/Warning at all ("best operating window" in the model).
export function bestWindow(series) {
  const runs = findRuns(series, (s) => level(s) === 0);
  return runs.reduce((best, r) => (!best || r.steps > best.steps ? r : best), null);
}

// "Least-bad" period, for when no all-Suitable window exists: the run of `minSteps` consecutive available
// steps with the lowest mean Warning share (then lowest Caution). It answers "when is modelled exposure
// lowest?", not "when is it safe". `flat` = the Warning share never varies across the series (e.g. 100%
// throughout), in which case there is no meaningfully better period to point to.
export function lowestExposureWindow(series, minSteps = 1) {
  const n = Math.max(1, minSteps);
  let best = null;
  for (const run of findRuns(series, () => true)) {
    const start = series.indexOf(run.start);
    for (let i = start; i + n - 1 <= series.indexOf(run.end); i += 1) {
      const win = series.slice(i, i + n);
      const warning = win.reduce((a, st) => a + st.warning, 0) / n;
      const caution = win.reduce((a, st) => a + st.caution, 0) / n;
      if (!best || warning < best.warning - 1e-9 || (Math.abs(warning - best.warning) <= 1e-9 && caution < best.caution)) {
        best = { start: win[0], end: win[n - 1], steps: n, warning, caution };
      }
    }
  }
  if (!best) return null;
  const warnings = series.filter(isAvail).map((st) => st.warning);
  best.flat = Math.max(...warnings) - Math.min(...warnings) < 0.5;
  best.highestWarning = Math.max(...warnings);
  return best;
}

// Step with the highest Warning share (ties: earliest, then higher Caution).
export function highestRiskStep(series) {
  return series.filter(isAvail).reduce((best, s) => (
    !best || s.warning > best.warning || (s.warning === best.warning && s.caution > best.caution && s.warning > 0) ? s : best
  ), null);
}

export const elevatedRuns = (series) => findRuns(series, (s) => level(s) === 2);

// After each elevated run: the stretch until the next elevated step (or series end)
// in which conditions are no longer elevated. Gaps end a recovery window too.
export function recoveryWindows(series) {
  const out = [];
  for (const run of elevatedRuns(series)) {
    const idx = series.indexOf(run.end);
    let last = null;
    for (let i = idx + 1; i < series.length; i += 1) {
      const s = series[i];
      if (!isAvail(s) || level(s) === 2) break;
      last = s;
    }
    if (last) out.push({ from: series[idx + 1], to: last });
  }
  return out;
}

// Runs of unavailable steps as {start, end} step pairs.
export function unavailableRuns(series) {
  const runs = [];
  let cur = null;
  for (const s of series) {
    if (!isAvail(s)) {
      if (!cur) cur = { start: s, end: s, steps: 0 };
      cur.end = s;
      cur.steps += 1;
    } else if (cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  return runs;
}

export function coverageOf(series) {
  const total = series.length;
  const available = series.filter(isAvail).length;
  return { total, available, ratio: total ? available / total : 0 };
}
