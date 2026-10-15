// Pure geometry for the Game Stats line charts (progression, round race).

// A "nice" step (1, 2, 2.5 or 5 × 10^k) at least `raw` wide.
function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const m = [1, 2, 2.5, 5, 10].find((f) => f * mag >= raw);
  return m * mag;
}

// Y axis from 0 to a rounded max with about three steps: 68 → 0/25/50/75.
export function yAxis(maxValue) {
  const step = Math.max(1, niceStep((maxValue > 0 ? maxValue : 1) / 3));
  const max = Math.max(step, Math.ceil((maxValue > 0 ? maxValue : 1) / step) * step);
  const ticks = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return { max, ticks };
}

// Spread end labels so none sit closer than `gap` px, keeping their order and
// staying inside [lo, hi]. `ys` are the labels' wanted centres; returns the
// placed centres in the same order.
export function nudgeLabels(ys, gap, lo, hi) {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y || a.i - b.i);
  const placed = order.map((o) => Math.min(Math.max(o.y, lo), hi));
  for (let k = 1; k < placed.length; k++) {
    if (placed[k] - placed[k - 1] < gap) placed[k] = placed[k - 1] + gap;
  }
  if (placed.length && placed[placed.length - 1] > hi) {
    placed[placed.length - 1] = hi;
    for (let k = placed.length - 2; k >= 0; k--) {
      if (placed[k + 1] - placed[k] < gap) placed[k] = placed[k + 1] - gap;
    }
  }
  const out = new Array(ys.length);
  order.forEach((o, k) => { out[o.i] = placed[k]; });
  return out;
}

// SVG path for a series with gaps: a null value lifts the pen.
export function linePath(values, x, y) {
  let d = '';
  let pen = false;
  values.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
    pen = true;
  });
  return d.trim();
}

// Index of the last non-null value, or -1.
export const lastIndex = (values) => values.reduce((last, v, i) => (v == null ? last : i), -1);
