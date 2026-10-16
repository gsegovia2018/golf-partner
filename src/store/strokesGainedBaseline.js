// src/store/strokesGainedBaseline.js
//
// Per-handicap strokes-gained baselines: expected strokes to hole out from a
// lie and distance (METRES) for a typical golfer of each anchor handicap.
//
// GENERATED — do not hand-edit BASELINES. The numbers come from the typical-
// golfer model in scripts/lib/sgBaselineModel.js (sources cited there:
// Shot Scope / Arccos benchmarks by handicap, Broadie's tour tables), and
// scripts/__tests__/sgBaselineModel.test.js fails if this literal drifts
// from the model. Regenerate with `node scripts/sgBaselineTables.mjs`.
//
// Every value is "engine-consistent": it is defined by the exact formula
// statsEngine applies to the buckets the app logs, so a typical golfer of
// handicap H scores ~0 in every category against target H. Strokes the
// logging cannot see (duffed chips, far misses, second lay-ups) are not in
// these tables; the reconciliation card shows them as "In-between & untracked".
//
// Bump SG_BASELINE_VERSION whenever BASELINES or the anchors below change in a
// way that moves SG numbers — coachFocus rebases committed SG focuses on it.
export const SG_BASELINE_VERSION = 2;

export const HANDICAP_ANCHORS = [0, 5, 10, 15, 20, 25, 30, 36, 54];

export const BASELINES = {
  green: {
    distances: [0.91, 1.83, 3.05, 4.57, 6.1, 9.14, 15.24],
    byHandicap: {
      0: [1.05, 1.33, 1.65, 1.82, 1.91, 2.01, 2.15],
      5: [1.07, 1.40, 1.68, 1.84, 1.93, 2.04, 2.20],
      10: [1.08, 1.44, 1.75, 1.88, 1.98, 2.08, 2.25],
      15: [1.10, 1.49, 1.80, 1.91, 2.01, 2.13, 2.32],
      20: [1.12, 1.53, 1.85, 1.95, 2.05, 2.18, 2.37],
      25: [1.15, 1.58, 1.89, 1.99, 2.10, 2.22, 2.43],
      30: [1.17, 1.62, 1.92, 2.02, 2.12, 2.26, 2.47],
      36: [1.20, 1.67, 1.95, 2.06, 2.16, 2.30, 2.52],
      54: [1.27, 1.76, 2.02, 2.14, 2.24, 2.39, 2.62],
    },
  },
  greenside: {
    distances: [9.1, 20, 30, 45.7],
    byHandicap: {
      0: [2.36, 2.50, 2.61, 2.76],
      5: [2.45, 2.59, 2.69, 2.84],
      10: [2.52, 2.67, 2.77, 2.91],
      15: [2.61, 2.75, 2.85, 2.99],
      20: [2.67, 2.82, 2.92, 3.05],
      25: [2.74, 2.89, 2.98, 3.11],
      30: [2.80, 2.94, 3.03, 3.16],
      36: [2.87, 3.01, 3.10, 3.22],
      54: [3.02, 3.15, 3.23, 3.34],
    },
  },
  fairway: {
    distances: [25, 50, 75, 100, 125, 150, 175, 200, 230, 275, 320],
    byHandicap: {
      0: [2.69, 2.85, 2.97, 3.05, 3.13, 3.20, 3.27, 3.33, 3.40, 4.06, 4.18],
      5: [2.80, 2.97, 3.10, 3.18, 3.27, 3.35, 3.40, 3.46, 3.52, 4.21, 4.34],
      10: [2.91, 3.09, 3.22, 3.34, 3.41, 3.48, 3.53, 3.59, 3.63, 4.38, 4.49],
      15: [3.02, 3.22, 3.35, 3.45, 3.54, 3.61, 3.65, 3.71, 3.74, 4.53, 4.64],
      20: [3.12, 3.33, 3.47, 3.56, 3.64, 3.71, 3.76, 3.79, 3.82, 4.66, 4.75],
      25: [3.22, 3.45, 3.58, 3.66, 3.73, 3.80, 3.84, 3.87, 3.90, 4.77, 4.85],
      30: [3.32, 3.54, 3.67, 3.75, 3.82, 3.87, 3.91, 3.95, 3.96, 4.87, 4.93],
      36: [3.44, 3.66, 3.78, 3.85, 3.91, 3.97, 3.99, 4.03, 4.04, 4.97, 5.02],
      54: [3.70, 3.89, 4.00, 4.07, 4.12, 4.15, 4.17, 4.19, 4.20, 5.17, 5.20],
    },
  },
  rough: {
    distances: [25, 50, 75, 100, 125, 150, 175, 200, 230, 275, 320],
    byHandicap: {
      0: [2.96, 3.07, 3.15, 3.20, 3.26, 3.30, 3.34, 3.39, 3.44, 4.14, 4.25],
      5: [3.07, 3.18, 3.27, 3.32, 3.38, 3.43, 3.47, 3.51, 3.55, 4.29, 4.41],
      10: [3.18, 3.30, 3.38, 3.46, 3.50, 3.55, 3.58, 3.62, 3.65, 4.45, 4.55],
      15: [3.29, 3.42, 3.50, 3.57, 3.62, 3.67, 3.70, 3.73, 3.75, 4.60, 4.68],
      20: [3.39, 3.52, 3.61, 3.67, 3.72, 3.76, 3.79, 3.81, 3.83, 4.71, 4.79],
      25: [3.49, 3.63, 3.71, 3.76, 3.80, 3.84, 3.87, 3.89, 3.90, 4.82, 4.87],
      30: [3.59, 3.72, 3.80, 3.84, 3.88, 3.91, 3.93, 3.96, 3.97, 4.90, 4.95],
      36: [3.70, 3.82, 3.90, 3.94, 3.97, 4.00, 4.02, 4.03, 4.04, 5.00, 5.03],
      54: [3.94, 4.04, 4.10, 4.13, 4.16, 4.18, 4.19, 4.20, 4.20, 5.18, 5.20],
    },
  },
  tee: {
    distances: [25, 50, 75, 100, 125, 150, 175, 200, 230],
    byHandicap: {
      0: [2.73, 2.88, 3.00, 3.08, 3.15, 3.22, 3.28, 3.34, 3.40],
      5: [2.84, 3.00, 3.13, 3.20, 3.29, 3.36, 3.41, 3.47, 3.53],
      10: [2.95, 3.12, 3.24, 3.35, 3.42, 3.49, 3.54, 3.59, 3.64],
      15: [3.06, 3.24, 3.38, 3.47, 3.55, 3.62, 3.66, 3.71, 3.74],
      20: [3.16, 3.36, 3.49, 3.58, 3.65, 3.72, 3.76, 3.80, 3.82],
      25: [3.26, 3.47, 3.60, 3.67, 3.74, 3.80, 3.84, 3.88, 3.90],
      30: [3.36, 3.57, 3.69, 3.76, 3.82, 3.88, 3.91, 3.95, 3.96],
      36: [3.47, 3.67, 3.80, 3.86, 3.92, 3.97, 4.00, 4.03, 4.04],
      54: [3.72, 3.91, 4.01, 4.08, 4.12, 4.15, 4.17, 4.19, 4.20],
    },
  },
  sand: {
    distances: [9.1, 20, 30, 45.7, 91.4],
    byHandicap: {
      0: [2.56, 2.65, 2.75, 3.23, 3.32],
      5: [2.69, 2.78, 2.87, 3.35, 3.43],
      10: [2.80, 2.88, 2.97, 3.46, 3.55],
      15: [2.89, 2.98, 3.07, 3.57, 3.65],
      20: [2.98, 3.07, 3.15, 3.66, 3.74],
      25: [3.06, 3.15, 3.24, 3.75, 3.82],
      30: [3.17, 3.25, 3.33, 3.83, 3.90],
      36: [3.28, 3.36, 3.44, 3.93, 3.99],
      54: [3.60, 3.67, 3.75, 4.12, 4.17],
    },
  },
  recovery: {
    distances: [45.7, 91.4, 137.2, 182.9],
    byHandicap: {
      0: [3.80, 3.90, 4.08, 4.20],
      5: [3.91, 4.01, 4.20, 4.34],
      10: [4.02, 4.13, 4.34, 4.47],
      15: [4.14, 4.25, 4.46, 4.59],
      20: [4.24, 4.36, 4.57, 4.70],
      25: [4.34, 4.47, 4.67, 4.78],
      30: [4.44, 4.57, 4.76, 4.86],
      36: [4.55, 4.68, 4.86, 4.95],
      54: [4.80, 4.91, 5.07, 5.14],
    },
  },
};

// Bucket midpoints in METERS.
export const BUCKETS = {
  firstPutt: { '0-1': 0.5, '1-2': 1.5, '2-3': 2.5, '3-6': 4.5, '6+': 9 },
  approach:  { '0-50': 25, '50-100': 75, '100-150': 125, '150-200': 175, '200+': 230 },
  // '0-150' uses 135, not the arithmetic midpoint: real drives logged in
  // that bucket cluster near its top, and 75 would fabricate a huge miss.
  driveDist: { '0-150': 135, '150-180': 165, '180-210': 195, '210-240': 225, '240+': 255 },
};

// Linear interpolation over HANDICAP_ANCHORS. Beyond either end the last
// segment's slope continues (linear extrapolation) — never clamped, so every
// target handicap gets its own baseline and the tables stay monotone.
export function interpHandicap(valuesByAnchor, targetHandicap) {
  const h = Number.isFinite(targetHandicap) ? targetHandicap : 0;
  let i = 0;
  while (i < HANDICAP_ANCHORS.length - 2 && HANDICAP_ANCHORS[i + 1] <= h) i += 1;
  const t = (h - HANDICAP_ANCHORS[i]) / (HANDICAP_ANCHORS[i + 1] - HANDICAP_ANCHORS[i]);
  return valuesByAnchor[i] + t * (valuesByAnchor[i + 1] - valuesByAnchor[i]);
}

// Private: distance lookup in one anchor row — binary search + linear
// interpolation with endpoint clamping.
function lookupRow(distances, values, distance) {
  if (distance <= distances[0]) return values[0];
  if (distance >= distances[distances.length - 1]) return values[values.length - 1];
  let lo = 0, hi = distances.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (distances[mid] <= distance) lo = mid; else hi = mid;
  }
  const t = (distance - distances[lo]) / (distances[hi] - distances[lo]);
  return values[lo] + t * (values[hi] - values[lo]);
}

function tableExpected(lie, distance, targetHandicap) {
  const table = BASELINES[lie];
  if (!table) return null;
  const byAnchor = HANDICAP_ANCHORS.map((h) => lookupRow(table.distances, table.byHandicap[h], distance));
  return interpHandicap(byAnchor, targetHandicap);
}

// ── Off-the-tee benchmark (see spec §1.2) ──
// The OTT model compares a drive against the target handicap's TYPICAL tee
// shot on an anchor-length hole: its typical distance AND its typical lie mix
// (Shot Scope: fairways ~47-49 % at every handicap; what grows with the
// handicap is trouble). A fairway-only benchmark made every typical golfer
// "lose" ~2 strokes a round off the tee. Par 3s have no tee category.
export const PAR_ANCHOR_DISTANCE = { 4: 340, 5: 470 };

export const DRIVE_DISTANCE_ANCHORS = [230, 222, 213, 205, 197, 188, 180, 172, 150];
export const DRIVE_MIX_ANCHORS = {
  fairway:  [.50, .49, .48, .47, .46, .45, .44, .43, .40],
  sand:     [.03, .03, .035, .04, .04, .045, .05, .05, .06],
  recovery: [.05, .06, .08, .10, .12, .14, .16, .18, .24],
  // rough = the remainder
};

export function typicalDriveMix(targetHandicap = 0) {
  const fairway = interpHandicap(DRIVE_MIX_ANCHORS.fairway, targetHandicap);
  const sand = interpHandicap(DRIVE_MIX_ANCHORS.sand, targetHandicap);
  const recovery = interpHandicap(DRIVE_MIX_ANCHORS.recovery, targetHandicap);
  return { fairway, rough: 1 - fairway - sand - recovery, sand, recovery };
}

// `lie` is a BASELINES key, or 'typicalDrive': the target's drive-outcome mix
// at that remaining distance (the OTT benchmark node).
export function expectedStrokes(lie, distance, targetHandicap = 0) {
  const h = targetHandicap ?? 0;
  if (lie === 'typicalDrive') {
    const w = typicalDriveMix(h);
    return w.fairway * tableExpected('fairway', distance, h)
      + w.rough * tableExpected('rough', distance, h)
      + w.sand * tableExpected('sand', distance, h)
      + w.recovery * tableExpected('recovery', distance, h);
  }
  return tableExpected(lie, distance, h);
}

export function expectedFromBucket(category, bucketKey, targetHandicap = 0) {
  const midpoint = BUCKETS[category]?.[bucketKey];
  if (midpoint == null) return null;
  const lie = category === 'firstPutt' ? 'green' : 'fairway';
  return expectedStrokes(lie, midpoint, targetHandicap);
}

// Typical drive distance for a target handicap (Broadie tour 290 yd, 90-golfer
// 210 yd; Arccos 10 hcp 227 yd), linear between anchors and extrapolated.
export function benchmarkDriveDistance(targetHandicap = 0) {
  return interpHandicap(DRIVE_DISTANCE_ANCHORS, targetHandicap ?? 0);
}

// How far each tee club carries relative to the driver, so a deliberate
// club-down is benchmarked against that club's typical shot rather than
// scored as a short drive. Ratios follow typical amateur gapping.
export const TEE_CLUB_FACTOR = { driver: 1, wood: 0.92, hybrid: 0.85, iron: 0.78 };

// Benchmark tee-shot distance for a target handicap with a given club.
// Unknown / null club means driver.
export function benchmarkTeeShotDistance(targetHandicap = 0, teeClub = 'driver') {
  const factor = TEE_CLUB_FACTOR[teeClub] ?? 1;
  return benchmarkDriveDistance(targetHandicap) * factor;
}

// Typical penalty strokes per round for a target handicap (Arccos: 11-15 hcp
// average 1.66; Shot Scope tee-penalty rate 1-3 % of drives). Scratch is 0.5,
// not 0 — scratch golfers take penalties too, and the calibration needs it.
export const PENALTIES_ANCHORS = [.5, .9, 1.3, 1.7, 2.1, 2.6, 3.1, 3.7, 5.5];
export function expectedPenaltiesPerRound(targetHandicap = 0) {
  return interpHandicap(PENALTIES_ANCHORS, targetHandicap ?? 0);
}

// What a typical golfer of that handicap index actually averages over par
// (Shot Scope rows <= 25, the same ones as shotBenchmarks.js; hand-extrapolated
// above). A handicap is "best 8 of 20", so the typical round is a few strokes
// worse than par + index. sgReconciliation's expected score.
export const SCORE_VS_PAR_ANCHORS = [2.0, 8.0, 13.0, 18.4, 23.2, 29.9, 36.5, 44, 66];
export function typicalScoreVsPar(targetHandicap = 0) {
  return interpHandicap(SCORE_VS_PAR_ANCHORS, targetHandicap ?? 0);
}
