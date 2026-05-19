// Pure geometry for the My Stats charts. No React, no SVG — just numbers, so
// it is trivially unit-testable.

// Maps an array of values (numbers, or null for a gap) to {x, y, value}
// points inside a box. The min value sits on the bottom edge of the inner
// area, the max on the top edge. A flat series is pinned to the vertical
// middle of the inner area.
export function scalePoints(values, { width, height, padX = 0, padTop = 0, padBottom = 0 }) {
  if (!values || values.length === 0) return [];
  const nums = values.filter((v) => v != null);
  const min = nums.length ? Math.min(...nums) : 0;
  const max = nums.length ? Math.max(...nums) : 0;
  const span = max - min;
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBottom;
  const n = values.length;
  return values.map((v, i) => {
    const x = n === 1 ? width / 2 : padX + (innerW * i) / (n - 1);
    if (v == null) return { x, y: null, value: null };
    const ratio = span === 0 ? 0.5 : (v - min) / span;
    const y = padTop + innerH * (1 - ratio);
    return { x, y, value: v };
  });
}

// Splits scaled points into contiguous runs that have a non-null y, so a
// polyline can skip gaps instead of drawing a line through them.
export function toSegments(points) {
  const segments = [];
  let current = [];
  (points || []).forEach((p) => {
    if (p.y == null) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push(p);
    }
  });
  if (current.length) segments.push(current);
  return segments;
}
