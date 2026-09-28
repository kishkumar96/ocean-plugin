// mapOverlay.js -- geometry helpers for drawing vector overlays (e.g. the wave model's
// domain boundary) on top of a server-rendered map image whose lon/lat bounds are known.

// Liang-Barsky clip of one segment [[lon,lat],[lon,lat]] to bounds; null if fully outside.
export function clipSegmentToBounds(seg, b) {
  const [[x0, y0], [x1, y1]] = seg;
  const dx = x1 - x0; const dy = y1 - y0;
  let t0 = 0; let t1 = 1;
  const checks = [[-dx, x0 - b.west], [dx, b.east - x0], [-dy, y0 - b.south], [dy, b.north - y0]];
  for (const [p, q] of checks) {
    if (p === 0) { if (q < 0) return null; } else {
      const r = q / p;
      if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
  }
  return [[x0 + t0 * dx, y0 + t0 * dy], [x0 + t1 * dx, y0 + t1 * dy]];
}

export const segmentsInBounds = (segments, bounds) => (
  Array.isArray(segments) && bounds ? segments.map((s) => clipSegmentToBounds(s, bounds)).filter(Boolean) : []
);

// Draws the boundary segments that fall inside `bounds` onto the image rect {x,y,w,h}
// (plate carree, as the service renders). Dashed hairline; no-op without segments.
export function drawBoundaryOverlay(doc, segments, bounds, rect) {
  const inside = segmentsInBounds(segments, bounds);
  if (!inside.length || !rect) return 0;
  const X = (lon) => rect.x + ((lon - bounds.west) / (bounds.east - bounds.west)) * rect.w;
  const Y = (lat) => rect.y + ((bounds.north - lat) / (bounds.north - bounds.south)) * rect.h;
  doc.setDrawColor(20, 20, 20);
  doc.setLineWidth(0.18);
  doc.setLineDashPattern?.([1.1, 0.9], 0);
  inside.forEach(([[a, b], [c, d]]) => doc.line(X(a), Y(b), X(c), Y(d)));
  doc.setLineDashPattern?.([], 0);
  return inside.length;
}

export const BOUNDARY_CAPTION = 'Dashed line: edge of the wave model mesh (outer domain and island cut-outs).';
