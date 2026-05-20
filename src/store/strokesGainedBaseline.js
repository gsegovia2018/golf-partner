// src/store/strokesGainedBaseline.js
//
// Mark Broadie scratch-golfer baselines from "Every Shot Counts"
// (Putnam, 2014). All distances in METERS for non-green lies and
// METERS for green. Values are expected strokes-to-hole-out from
// that lie and distance.
//
// These approximate the published Broadie tables; refine with the exact
// rows when convenient — the lookup helper interpolates linearly so
// small revisions stay stable.

// All distances in METERS for non-green lies and METERS for green.
// (Phase B used yards for non-green and feet for green; this is a clean
// retrofit before Phase B sees significant real-world data.)
export const BASELINES_SCRATCH = {
  tee: [
    { distance:  91.4, expected: 2.79 },
    { distance: 137.2, expected: 2.91 },
    { distance: 182.9, expected: 3.12 },
    { distance: 228.6, expected: 3.41 },
    { distance: 274.3, expected: 3.71 },
    { distance: 320.0, expected: 4.00 },
    { distance: 365.8, expected: 4.29 },
    { distance: 411.5, expected: 4.55 },
    { distance: 457.2, expected: 4.78 },
    { distance: 502.9, expected: 5.00 },
  ],
  fairway: [
    { distance:  45.7, expected: 2.55 },
    { distance:  91.4, expected: 2.80 },
    { distance: 137.2, expected: 2.92 },
    { distance: 182.9, expected: 3.32 },
    { distance: 228.6, expected: 3.70 },
    { distance: 274.3, expected: 4.04 },
  ],
  rough: [
    { distance:  45.7, expected: 2.74 },
    { distance:  91.4, expected: 2.98 },
    { distance: 137.2, expected: 3.10 },
    { distance: 182.9, expected: 3.50 },
    { distance: 228.6, expected: 3.91 },
  ],
  sand: [
    { distance:   9.1, expected: 2.42 },
    { distance:  18.3, expected: 2.55 },
    { distance:  27.4, expected: 2.70 },
    { distance:  45.7, expected: 2.93 },
    { distance:  91.4, expected: 3.25 },
  ],
  recovery: [
    { distance:  45.7, expected: 2.85 },
    { distance:  91.4, expected: 3.05 },
    { distance: 137.2, expected: 3.20 },
    { distance: 182.9, expected: 3.60 },
  ],
  green: [
    { distance:  0.91, expected: 1.05 },
    { distance:  1.83, expected: 1.50 },
    { distance:  3.05, expected: 1.70 },
    { distance:  4.57, expected: 1.83 },
    { distance:  6.10, expected: 1.91 },
    { distance:  9.14, expected: 2.10 },
    { distance: 15.24, expected: 2.40 },
  ],
};

// Backward-compatibility export so existing callers keep working
// until they're migrated. Will be removed in a follow-up.
export const BASELINES = BASELINES_SCRATCH;

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

// Mark Broadie "average amateur" (~14 hcp) baselines from Every Shot
// Counts (Putnam 2014) and follow-up papers, distances in meters.
// Values are approximate; verify against published tables when refining.
export const BASELINES_AMATEUR = {
  tee: [
    { distance:  91.4, expected: 2.85 },
    { distance: 137.2, expected: 3.10 },
    { distance: 182.9, expected: 3.42 },
    { distance: 228.6, expected: 3.78 },
    { distance: 274.3, expected: 4.18 },
    { distance: 320.0, expected: 4.55 },
    { distance: 365.8, expected: 4.92 },
    { distance: 411.5, expected: 5.27 },
    { distance: 457.2, expected: 5.58 },
    { distance: 502.9, expected: 5.86 },
  ],
  fairway: [
    { distance:  45.7, expected: 2.85 },
    { distance:  91.4, expected: 3.10 },
    { distance: 137.2, expected: 3.32 },
    { distance: 182.9, expected: 3.70 },
    { distance: 228.6, expected: 4.10 },
    { distance: 274.3, expected: 4.50 },
  ],
  rough: [
    { distance:  45.7, expected: 3.10 },
    { distance:  91.4, expected: 3.30 },
    { distance: 137.2, expected: 3.55 },
    { distance: 182.9, expected: 3.95 },
    { distance: 228.6, expected: 4.40 },
  ],
  sand: [
    { distance:   9.1, expected: 2.75 },
    { distance:  18.3, expected: 2.90 },
    { distance:  27.4, expected: 3.05 },
    { distance:  45.7, expected: 3.30 },
    { distance:  91.4, expected: 3.65 },
  ],
  recovery: [
    { distance:  45.7, expected: 3.20 },
    { distance:  91.4, expected: 3.40 },
    { distance: 137.2, expected: 3.60 },
    { distance: 182.9, expected: 4.00 },
  ],
  green: [
    { distance:  0.91, expected: 1.10 },
    { distance:  1.83, expected: 1.65 },
    { distance:  3.05, expected: 1.85 },
    { distance:  4.57, expected: 1.96 },
    { distance:  6.10, expected: 2.03 },
    { distance:  9.14, expected: 2.20 },
    { distance: 15.24, expected: 2.50 },
  ],
};

export const AMATEUR_ANCHOR_HANDICAP = 14;
