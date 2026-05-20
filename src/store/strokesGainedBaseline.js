// src/store/strokesGainedBaseline.js
//
// Mark Broadie scratch-golfer baselines from "Every Shot Counts"
// (Putnam, 2014). Distances in YARDS for tee/fairway/rough/sand/recovery
// and in FEET for green. Values are expected strokes-to-hole-out from
// that lie and distance.
//
// These approximate the published Broadie tables; refine with the exact
// rows when convenient — the lookup helper interpolates linearly so
// small revisions stay stable.

export const BASELINES = {
  tee: [
    { distance: 100, expected: 2.79 },
    { distance: 150, expected: 2.91 },
    { distance: 200, expected: 3.12 },
    { distance: 250, expected: 3.41 },
    { distance: 300, expected: 3.71 },
    { distance: 350, expected: 4.00 },
    { distance: 400, expected: 4.29 },
    { distance: 450, expected: 4.55 },
    { distance: 500, expected: 4.78 },
    { distance: 550, expected: 5.00 },
  ],
  fairway: [
    { distance:  50, expected: 2.55 },
    { distance: 100, expected: 2.80 },
    { distance: 150, expected: 2.92 },
    { distance: 200, expected: 3.32 },
    { distance: 250, expected: 3.70 },
    { distance: 300, expected: 4.04 },
  ],
  rough: [
    { distance:  50, expected: 2.74 },
    { distance: 100, expected: 2.98 },
    { distance: 150, expected: 3.10 },
    { distance: 200, expected: 3.50 },
    { distance: 250, expected: 3.91 },
  ],
  sand: [
    { distance:  10, expected: 2.42 },
    { distance:  20, expected: 2.55 },
    { distance:  30, expected: 2.70 },
    { distance:  50, expected: 2.93 },
    { distance: 100, expected: 3.25 },
  ],
  recovery: [
    { distance:  50, expected: 2.85 },        // blended fairway+rough
    { distance: 100, expected: 3.05 },
    { distance: 150, expected: 3.20 },
    { distance: 200, expected: 3.60 },
  ],
  green: [
    { distance:  3, expected: 1.05 },         // feet
    { distance:  6, expected: 1.50 },
    { distance: 10, expected: 1.70 },
    { distance: 15, expected: 1.83 },
    { distance: 20, expected: 1.91 },
    { distance: 30, expected: 2.10 },
    { distance: 50, expected: 2.40 },
  ],
};

export const BUCKETS = {
  firstPutt: { '0-3': 1.5, '3-6': 4.5, '6-10': 8, '10-20': 15, '20+': 30 },         // feet
  approach:  { '0-50': 25, '50-100': 75, '100-150': 125, '150-200': 175, '200+': 230 },  // yards
};

// Binary-search lookup with linear interpolation. Clamps to endpoints.
export function expectedStrokes(lie, distance) {
  const rows = BASELINES[lie];
  if (!rows || rows.length === 0) return null;
  if (distance <= rows[0].distance) return rows[0].expected;
  if (distance >= rows[rows.length - 1].distance) return rows[rows.length - 1].expected;
  let lo = 0, hi = rows.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].distance <= distance) lo = mid; else hi = mid;
  }
  const a = rows[lo], b = rows[hi];
  const t = (distance - a.distance) / (b.distance - a.distance);
  return a.expected + t * (b.expected - a.expected);
}

export function expectedFromBucket(category, bucketKey) {
  const midpoint = BUCKETS[category]?.[bucketKey];
  if (midpoint == null) return null;
  const lie = category === 'firstPutt' ? 'green' : 'fairway';
  return expectedStrokes(lie, midpoint);
}
