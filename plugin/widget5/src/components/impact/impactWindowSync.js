// impactWindowSync.js -- detects when the map's inundation range no longer matches the impact
// window whose damage/exposure/land-area figures are on screen. Clicking a window row sets the
// map's "Custom Max" range to it, but a manual Custom Max, a range restored from a saved view,
// or a switch back to a single time step can leave the raster describing a different period than
// the numbers beside it. The UI shows this notice and offers a one-click re-sync.
const TOLERANCE_MS = 90 * 60 * 1000;

const ms = (v) => { const t = v instanceof Date ? v.getTime() : new Date(v).getTime(); return Number.isFinite(t) ? t : null; };

function shortRange(startMs, endMs, timeZone) {
  const fmt = (t) => new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short' }).format(new Date(t));
  return `${fmt(startMs)} – ${fmt(endMs)}`;
}

// block: the selected impact window ({windowStart,windowEnd} ISO or {dateStart,dateEnd} dates).
// rangeWindow: the map's range ({mode:'custom', startTime, endTime} | {mode:'single'|...}).
// available ({ minMs, maxMs }, optional): the time span the map layer actually has. The impact window
// can reach past it (the impact run may be older or newer than the layer's forecast, and the last
// block is "everything remaining"), and the map clamps to what exists, so the comparison is made
// against the window clipped to that span.
// Returns null when they agree (or there is nothing to compare), else the two labels.
export function describeWindowMismatch(block, rangeWindow, timeZone = 'Pacific/Rarotonga', available = null) {
  if (!block) return null;
  let bStart = ms(block.windowStart ?? (block.dateStart ? `${block.dateStart}T00:00:00Z` : null));
  let bEnd = ms(block.windowEnd ?? (block.dateEnd ? `${block.dateEnd}T23:59:59Z` : null));
  if (bStart === null || bEnd === null) return null;
  if (Number.isFinite(available?.minMs)) bStart = Math.max(bStart, available.minMs);
  if (Number.isFinite(available?.maxMs)) bEnd = Math.min(bEnd, available.maxMs);
  if (bEnd <= bStart) return null;
  const impactLabel = shortRange(bStart, bEnd, timeZone);
  if (!rangeWindow || rangeWindow.mode !== 'custom') {
    // The "Next 48h Max" button's mode id is 'rolling-48h'; checking for '48h' never matched, so it was
    // described as "a single time step".
    const mapLabel = rangeWindow?.mode === 'rolling-48h' || rangeWindow?.mode === '48h'
      ? 'the next 48 h maximum'
      : 'a single time step';
    return { impactLabel, mapLabel };
  }
  let rStart = ms(rangeWindow.startTime);
  let rEnd = ms(rangeWindow.endTime);
  if (rStart === null || rEnd === null) return null;
  // The map stores the range that was requested, but only ever shows what exists: clip it to the
  // layer's span too, or a range reaching a few hours past the last timestep looks like a mismatch.
  if (Number.isFinite(available?.minMs)) rStart = Math.max(rStart, available.minMs);
  if (Number.isFinite(available?.maxMs)) rEnd = Math.min(rEnd, available.maxMs);
  if (Math.abs(rStart - bStart) <= TOLERANCE_MS && Math.abs(rEnd - bEnd) <= TOLERANCE_MS) return null;
  return { impactLabel, mapLabel: shortRange(rStart, rEnd, timeZone) };
}

// The hazard block to draw, or null. The block is one fixed multi-day maximum, so it is shown only while
// the map's range IS that impact window; for a single time step, the first-48 h maximum or any other
// custom range the user's own choice must win (drawing the block over it froze the map while the
// slider moved). selection: { cycleId, block, window } from the selected impact window.
export function selectHazardBlock(selection, rangeWindow, surfaceVisible) {
  if (!surfaceVisible || !selection?.cycleId || !selection?.block) return null;
  if (describeWindowMismatch(selection.window, rangeWindow) !== null) return null;
  return { cycleId: selection.cycleId, block: selection.block };
}
