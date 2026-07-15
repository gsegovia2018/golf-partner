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
  // "Just off the green" after a missed approach — a normal greenside chip/pitch,
  // NOT a recovery-from-trouble lie. Broadie around-the-green scratch baselines.
  // This is the hand-off node between approach (end) and around-green (start),
  // so the same lie must be used on both sides to keep total SG conserved.
  greenside: [
    { distance:   9.1, expected: 2.18 },
    { distance:  18.3, expected: 2.38 },
    { distance:  27.4, expected: 2.52 },
    { distance:  45.7, expected: 2.75 },
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

// Bucket midpoints in METERS.
export const BUCKETS = {
  firstPutt: { '0-1': 0.5, '1-2': 1.5, '2-3': 2.5, '3-6': 4.5, '6+': 9 },
  approach:  { '0-50': 25, '50-100': 75, '100-150': 125, '150-200': 175, '200+': 230 },
  // '0-150' uses 135, not the arithmetic midpoint: real drives logged in
  // that bucket cluster near its top, and 75 would fabricate a huge miss.
  driveDist: { '0-150': 135, '150-180': 165, '180-210': 195, '210-240': 225, '240+': 255 },
};

// Private: look up a single table by distance using binary search + linear
// interpolation with endpoint clamping. Returns null for unknown lie.
function lookupOne(table, lie, distance) {
  const rows = table[lie];
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

// Private: blend scratch and amateur tables by target handicap.
// t = 0 returns scratch; t = 1 returns amateur; t = 2 extrapolates and clamps.
function blendedExpected(lie, distance, targetHandicap) {
  const t = Math.max(0, Math.min(2, (targetHandicap ?? 0) / AMATEUR_ANCHOR_HANDICAP));
  const a = lookupOne(BASELINES_SCRATCH, lie, distance);
  const b = lookupOne(BASELINES_AMATEUR, lie, distance);
  if (a == null || b == null) return null;
  return a + t * (b - a);
}

export function expectedStrokes(lie, distance, targetHandicap = 0) {
  return blendedExpected(lie, distance, targetHandicap);
}

export function expectedFromBucket(category, bucketKey, targetHandicap = 0) {
  const midpoint = BUCKETS[category]?.[bucketKey];
  if (midpoint == null) return null;
  const lie = category === 'firstPutt' ? 'green' : 'fairway';
  return expectedStrokes(lie, midpoint, targetHandicap);
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
  // Average-amateur (~14 hcp) greenside chip/pitch node — see the scratch table
  // note above. Roughly +0.28 over scratch, the same gap the other lies carry.
  greenside: [
    { distance:   9.1, expected: 2.45 },
    { distance:  18.3, expected: 2.66 },
    { distance:  27.4, expected: 2.80 },
    { distance:  45.7, expected: 3.02 },
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

// ── Off-the-tee benchmark (see spec §1.2) ──
// The OTT model compares a drive against the *benchmark drive* for the
// target handicap on a typical hole, so it needs no course distances.
// Anchor hole lengths per par; par 3s have no tee category.
export const PAR_ANCHOR_DISTANCE = { 4: 340, 5: 470 };

const SCRATCH_DRIVE_DISTANCE = 230;
const AMATEUR_DRIVE_DISTANCE = 200;

// Typical drive distance for a target handicap, blended the same way as the
// baseline tables: t = hcp / 14, clamped to [0, 2].
export function benchmarkDriveDistance(targetHandicap = 0) {
  const t = Math.max(0, Math.min(2, (targetHandicap ?? 0) / AMATEUR_ANCHOR_HANDICAP));
  return SCRATCH_DRIVE_DISTANCE + t * (AMATEUR_DRIVE_DISTANCE - SCRATCH_DRIVE_DISTANCE);
}
