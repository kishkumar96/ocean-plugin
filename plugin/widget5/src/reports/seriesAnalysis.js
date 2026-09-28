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
