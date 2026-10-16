// Typical-golfer model behind src/store/strokesGainedBaseline.js.
//
// The app's strokes-gained engine (src/store/statsEngine.js) only ever sees
// buckets: drive distance + lie, approach distance + hit/miss (+ bunker),
// first-putt distance, putt count, sand shots, penalties. Every expected-
// strokes value here is therefore defined by the exact formula the engine
// applies to those buckets — "engine-consistent" — so a typical golfer of
// handicap H logging a typical round scores ≈ 0 in every category against
// target H. Strokes the logging cannot see (duffed chips, far misses that
// need a pitch and a chip, second lay-ups) are NOT in these tables; they
// surface in the reconciliation card's "In-between & untracked" line.
//
// Published anchors (all distances converted to metres):
//   Putting make % by handicap and distance band ........ Shot Scope via MyGolfSpy
//     "Putting Make Percentage By Handicap (Full Chart)": 0-3 ft 98/96/96/93/90/88,
//     3-6 ft 76/67/65/59/55, 6-9 ft 49/44/39/36/33, 9-12 ft 34/34/26/22/18,
//     12-18 ft 19/19/18/16/14, 18-24 ft 12/13/10/9/7 (hcp 0/5/10/15/20[/25]);
//     tour 8 ft = 50 %, 90-golfer 5 ft = 50 %, 2 putts from 33 ft (tour) / 19 ft
//     (90-golfer) — Broadie, "Assessing Golfer Performance on the PGA TOUR",
//     Interfaces 42(2) 2012.
//   Putts per round 29.9/30.3/31.2/32.1/33.4/34.3 ........ Shot Scope (src/store/shotBenchmarks.js)
//   Up & down 0-50 yd 54/47/39/34/31/25 %, sand save 37/23/20/18/15/10 %,
//     chips <25 yd finish 10/13/15 ft (5/15/25 hcp), bunker proximity 12.5 ft
//     (2 hcp) → 17.7 ft (26 hcp) ................................ Shot Scope via MyGolfSpy
//     "How Good Is Your Short Game?" / "Greenside Bunker Play"; Broadie: pro 6 ft,
//     90-golfer 10 ft from 15-25 yd.
//   Green hit % by distance: 100 yd scratch 70 % / 10 hcp 49 %; 150 yd 55 % / 30 %;
//     150-175 yd 5 hcp 34 % / 15 hcp 19 %; 175-200 yd 23 % / 11 %; 170 yd scratch
//     43 % / 10 hcp 25 % ............ Shot Scope via MyGolfSpy, GolfLink, National Club Golfer
//     Arccos: 15 hcp hits 28 % of greens overall, scratch 51 %; 10 hcp from 100 yd
//     fairway averages 3.38 strokes, rough 3.5 (Arccos "5 stats to tame your
//     expectations") — the model gives 3.30 / 3.43.
//   GIR per round 52/37/32/23/19/15 % ......................... Shot Scope (shotBenchmarks.js)
//   Drive distance: tour 290 yd, 90-golfer 210 yd (Broadie 2012); 10 hcp 227 yd
//     (Arccos); fairway % ≈ 47-49 at every handicap (Shot Scope, shotBenchmarks.js)
//   Penalties: 11-15 hcp 1.66 / round, 41 % of rounds ≥ 2 (Arccos via MyGolfSpy);
//     tee-penalty rate 1-3 % of drives (Shot Scope, shotBenchmarks.js)
//   Average score vs par 2.0/8.0/13.0/18.4/23.2/29.9 ........ Shot Scope (shotBenchmarks.js)
//   Per-category strokes lost, 11-15 hcp vs scratch: approach 5.67, tee 3.63,
//     short game 2.93, putting 1.99 (Arccos via MyGolfSpy) — the engine-visible
//     model reproduces putting and short game, and about half of approach/tee
//     (the rest is invisible to bucket logging).
//   Tour reference: Broadie 2012 Table B.1 (fairway 100 yd 2.80, 150 yd 2.98,
//     recovery 50 yd 3.79). A scratch amateur sits 0.15-0.25 above tour.
//
// Everything beyond the 25-handicap rows (30, 36, 54) is extrapolated by hand
// and kept monotone; the target picker caps at 36.
//
// CommonJS so scripts/sgBaselineTables.mjs and Jest can both load it. No I/O.

const HANDICAP_ANCHORS = [0, 5, 10, 15, 20, 25, 30, 36, 54];

// ── Putting: make % and 3-putt % at 3/6/10/15/20/30/50 ft ──
const GREEN_ROWS = [0.91, 1.83, 3.05, 4.57, 6.10, 9.14, 15.24];
const MAKE = [
  [.95, .93, .92, .90, .88, .86, .84, .81, .74],
  [.67, .60, .57, .52, .48, .44, .40, .36, .28],
  [.36, .33, .27, .23, .19, .16, .14, .12, .08],
  [.20, .19, .17, .15, .13, .11, .10, .08, .05],
  [.13, .12, .10, .09, .07, .055, .05, .04, .025],
  [.07, .06, .05, .04, .035, .03, .025, .02, .01],
  [.03, .025, .02, .015, .012, .01, .008, .006, .003],
];
const THREE_PUTT = [
  [0, 0, 0, .002, .003, .005, .006, .008, .015],
  [.002, .004, .006, .008, .01, .015, .02, .025, .04],
  [.01, .015, .02, .03, .04, .05, .06, .07, .10],
  [.02, .03, .045, .06, .08, .10, .12, .14, .19],
  [.04, .055, .075, .10, .125, .15, .17, .20, .26],
  [.08, .10, .13, .17, .21, .25, .28, .32, .40],
  [.18, .22, .27, .33, .38, .44, .48, .53, .62],
];

// ── Short game (greenside ≈ 20 m) ──
// Mean first-putt distance (m) after a chip / after a greenside bunker shot,
// shots needed to leave the bunker, and the lognormal spread of proximity.
const CHIP_MU = [3.0, 3.4, 3.8, 4.2, 4.5, 4.8, 5.1, 5.5, 6.5];
const SAND_MU = [3.9, 4.5, 4.8, 5.0, 5.2, 5.4, 5.7, 6.0, 7.0];
const SAND_EXIT = [1.04, 1.08, 1.12, 1.16, 1.19, 1.22, 1.27, 1.32, 1.50];
const SIGMA = 0.7;           // proximity spread (log space) for chips, pitches, bunker shots
const HIT_SIGMA = 0.6;       // proximity spread for shots that hit the green

// ── Approach: green-hit % from the fairway by distance (rows) and handicap ──
const SHOT_ROWS = [25, 50, 75, 100, 125, 150, 175, 200, 230, 275, 320];
const GREEN_HIT = [
  [.90, .86, .82, .78, .74, .70, .65, .60, .48],
  [.82, .76, .70, .64, .58, .52, .47, .42, .32],
  [.74, .66, .60, .52, .46, .40, .35, .30, .22],
  [.68, .60, .48, .42, .36, .32, .27, .23, .15],
  [.60, .50, .40, .33, .27, .24, .20, .17, .10],
  [.52, .40, .31, .24, .19, .16, .13, .10, .06],
  [.43, .33, .25, .18, .13, .11, .09, .07, .04],
  [.33, .24, .17, .11, .08, .06, .04, .03, .015],
  [.22, .15, .10, .06, .04, .03, .02, .01, .005],
];
// Mean first-putt distance (m) when the green is hit, scratch, by SHOT_ROWS;
// multiplied by HIT_MU_FACTOR for the handicap.
const HIT_MU_SCRATCH = [3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 13, 14];
const HIT_MU_FACTOR = [1, 1.08, 1.16, 1.24, 1.30, 1.36, 1.42, 1.48, 1.65];
const BUNKER_SHARE = [.14, .14, .14, .13, .12, .12, .11, .11, .10]; // of missed greens
const ROUGH_K = [.72, .71, .70, .68, .66, .64, .62, .60, .55];      // green-hit multiplier from rough
const SAND_K = [.45, .42, .40, .38, .36, .34, .32, .30, .25];       // green-hit multiplier from a fairway bunker
// Lay-up regime (≥ 275 m): one full shot advances ADV metres into LAYUP_MIX.
const ADV = [200, 190, 180, 168, 158, 148, 140, 132, 110];
const LAYUP_MIX = { fairway: .55, rough: .38, sand: .07 };

// ── Off the tee ──
const DRIVE_DISTANCE_ANCHORS = [230, 222, 213, 205, 197, 188, 180, 172, 150];
const DRIVE_MIX_ANCHORS = {
  fairway: [.50, .49, .48, .47, .46, .45, .44, .43, .40],
  sand: [.03, .03, .035, .04, .04, .045, .05, .05, .06],
  recovery: [.05, .06, .08, .10, .12, .14, .16, .18, .24],
  // rough = remainder
};

// ── Per-round allowances ──
const PENALTIES_ANCHORS = [.5, .9, 1.3, 1.7, 2.1, 2.6, 3.1, 3.7, 5.5];
const SCORE_VS_PAR_ANCHORS = [2.0, 8.0, 13.0, 18.4, 23.2, 29.9, 36.5, 44, 66];

// ── helpers ──
function lookup(rows, vals, d) {
  if (d <= rows[0]) return vals[0];
  if (d >= rows[rows.length - 1]) return vals[vals.length - 1];
  let i = 0;
  while (rows[i + 1] < d) i += 1;
  const t = (d - rows[i]) / (rows[i + 1] - rows[i]);
  return vals[i] + t * (vals[i + 1] - vals[i]);
}
function erf(x) { // Abramowitz & Stegun 7.1.26
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592)
    * t * Math.exp(-a * a);
  return s * y;
}
const lnCdf = (x, mu, sigma) => 0.5 * (1 + erf((Math.log(x) - mu) / (sigma * Math.SQRT2)));
const PUTT_KEYS = ['0-1', '1-2', '2-3', '3-6', '6+'];
const PUTT_MIDS = [0.5, 1.5, 2.5, 4.5, 9];     // = BUCKETS.firstPutt midpoints
const PUTT_EDGES = [1, 2, 3, 6];
// First-putt bucket shares of a lognormal proximity with arithmetic mean `mean`.
function bucketShares(mean, sigma) {
  const mu = Math.log(mean) - (sigma * sigma) / 2;
  const c = PUTT_EDGES.map((e) => lnCdf(e, mu, sigma));
  return [c[0], c[1] - c[0], c[2] - c[1], c[3] - c[2], 1 - c[3]];
}
const col = (table, i) => table.map((r) => r[i]);

function buildTables() {
  const n = HANDICAP_ANCHORS.length;
  const idx = [...Array(n).keys()];
  const green = idx.map((i) => GREEN_ROWS.map((_, r) => 2 - MAKE[r][i] + THREE_PUTT[r][i]));
  const Eg = (i, d) => lookup(GREEN_ROWS, green[i], d);
  const puttExp = (i, shares) => shares.reduce((s, p, b) => s + p * Eg(i, PUTT_MIDS[b]), 0);
  const chip = (i, mu) => 1 + puttExp(i, bucketShares(mu, SIGMA));
  const bunker = (i, mu) => SAND_EXIT[i] + puttExp(i, bucketShares(mu, SIGMA));

  // Greenside rows: 9.1 / 20 / 30 / 45.7 m. The engine reads exactly 20 m.
  const greenside = idx.map((i) => [chip(i, CHIP_MU[i] * 0.7), chip(i, CHIP_MU[i]), chip(i, CHIP_MU[i] * 1.3), chip(i, CHIP_MU[i] * 1.7) + 0.05]);
  const sandShort = idx.map((i) => [bunker(i, SAND_MU[i] * 0.8), bunker(i, SAND_MU[i]), bunker(i, SAND_MU[i] * 1.3)]);

  // Go-at-the-green regime (< 275 m): 1 + hit·putts + miss·(bunker | chip).
  const missEnd = (i) => BUNKER_SHARE[i] * sandShort[i][1] + (1 - BUNKER_SHARE[i]) * greenside[i][1];
  const goAtGreen = (i, g, mu) => 1 + g * puttExp(i, bucketShares(mu, HIT_SIGMA)) + (1 - g) * missEnd(i);
  const fairway = idx.map(() => []);
  const rough = idx.map(() => []);
  const tee = idx.map(() => []);
  const sandLong = idx.map(() => []);
  SHOT_ROWS.forEach((d, r) => {
    if (d >= 275) return;
    idx.forEach((i) => {
      const g = GREEN_HIT[r][i];
      const mu = HIT_MU_SCRATCH[r] * HIT_MU_FACTOR[i];
      fairway[i][r] = goAtGreen(i, g, mu);
      rough[i][r] = goAtGreen(i, g * ROUGH_K[i], mu * 1.15);
      tee[i][r] = goAtGreen(i, g * 0.95, mu);
      sandLong[i][r] = goAtGreen(i, g * SAND_K[i], mu * 1.2);
    });
  });
  const short = SHOT_ROWS.slice(0, 9);
  const E = (table, i, d) => lookup(short, table[i].slice(0, 9), d);
  const mixE = (i, d, mix) => Object.entries(mix).reduce((s, [lie, w]) => s + w
    * (lie === 'fairway' ? E(fairway, i, d) : lie === 'rough' ? E(rough, i, d) : E(sandLong, i, d)), 0);
  // Lay-up regime rows (275, 320 m).
  [275, 320].forEach((d, k) => idx.forEach((i) => {
    fairway[i][9 + k] = 1 + mixE(i, d - ADV[i], LAYUP_MIX);
    rough[i][9 + k] = 1 + mixE(i, d - ADV[i] * 0.85, LAYUP_MIX);
  }));
  const sand = idx.map((i) => [...sandShort[i], E(sandLong, i, 45.7), E(sandLong, i, 91.4)]);
  const recovery = idx.map((i) => [45.7, 91.4, 137.2, 182.9]
    .map((d) => 1 + mixE(i, Math.max(30, d - 45), { fairway: .7, rough: .3 })));

  const round2 = (v) => Math.round(v * 100) / 100;
  const pack = (distances, byH) => ({
    distances,
    byHandicap: Object.fromEntries(HANDICAP_ANCHORS.map((h, i) => [h, byH[i].map(round2)])),
  });
  return {
    green: pack(GREEN_ROWS, green),
    greenside: pack([9.1, 20, 30, 45.7], greenside),
    fairway: pack(SHOT_ROWS, fairway),
    rough: pack(SHOT_ROWS, rough),
    tee: pack(short, tee),
    sand: pack([9.1, 20, 30, 45.7, 91.4], sand),
    recovery: pack([45.7, 91.4, 137.2, 182.9], recovery),
  };
}

// ── Typical-golfer round simulator (engine-visible logging only) ──
// Deterministic (seeded) rounds for anchor index `i`, in the shape
// statsEngine's sg* functions consume: { holes, scores: { me }, shotDetails: { me } }.
// Par mix 4 × par 3 (175 m logged bucket), 10 × par 4 (340 m), 4 × par 5 (470 m).
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(rng, shares) {
  let u = rng();
  for (let b = 0; b < shares.length; b += 1) { u -= shares[b]; if (u <= 0) return b; }
  return shares.length - 1;
}
const APPROACH_MID = { '0-50': 25, '50-100': 75, '100-150': 125, '150-200': 175, '200+': 230 };
const approachBucketFor = (d) => (d < 50 ? '0-50' : d < 100 ? '50-100' : d < 150 ? '100-150' : d < 200 ? '150-200' : '200+');
const DRIVE_MIDS = [135, 165, 195, 225, 255];
const DRIVE_KEYS = ['0-150', '150-180', '180-210', '210-240', '240+'];

function simulateTypicalRounds(i, rounds, seed = 1) {
  const rng = mulberry32(seed);
  const makeAt = (d) => lookup(GREEN_ROWS, col(MAKE, i), d);
  const threeAt = (d) => lookup(GREEN_ROWS, col(THREE_PUTT, i), d);
  const puttsFrom = (b) => {
    const u = rng();
    const m = makeAt(PUTT_MIDS[b]);
    return u < m ? 1 : u < m + threeAt(PUTT_MIDS[b]) ? 3 : 2;
  };
  const greenHit = (lie, d) => {
    const g = lookup(SHOT_ROWS.slice(0, 9), col(GREEN_HIT, i), d);
    return lie === 'rough' ? g * ROUGH_K[i] : lie === 'sand' ? g * SAND_K[i] : lie === 'tee' ? g * 0.95 : g;
  };
  const hitMu = (lie, d) => lookup(SHOT_ROWS, HIT_MU_SCRATCH, d) * HIT_MU_FACTOR[i]
    * (lie === 'rough' ? 1.15 : lie === 'sand' ? 1.2 : 1);
  const chipShares = bucketShares(CHIP_MU[i], SIGMA);
  const sandShares = bucketShares(SAND_MU[i], SIGMA);
  const driveD = DRIVE_DISTANCE_ANCHORS[i];
  const w = { fairway: DRIVE_MIX_ANCHORS.fairway[i], sand: DRIVE_MIX_ANCHORS.sand[i], recovery: DRIVE_MIX_ANCHORS.recovery[i] };
  const driveLies = ['fairway', 'rough', 'sand', 'trouble'];
  const driveW = [w.fairway, 1 - w.fairway - w.sand - w.recovery, w.sand, w.recovery];
  let lo = 0;
  while (lo < 3 && DRIVE_MIDS[lo + 1] <= driveD) lo += 1;
  const pHi = (driveD - DRIVE_MIDS[lo]) / 30; // bucket pair averaging to the benchmark drive
  const holes = [];
  const scores = {};
  const details = {};
  let n = 0;
  for (let r = 0; r < rounds; r += 1) {
    for (let k = 0; k < 18; k += 1) {
      const par = k < 4 ? 3 : k < 14 ? 4 : 5;
      n += 1;
      holes.push({ number: n, par, strokeIndex: 1 });
      const d = {};
      let strokes = 0;
      let lie = 'tee';
      let remaining = 175;
      if (par !== 3) {
        const li = pick(rng, driveW);
        const driveLie = driveLies[li];
        const bk = rng() < pHi ? lo + 1 : lo;
        d.drive = driveLie === 'fairway' ? 'fairway' : 'left';
        d.driveLie = driveLie;
        d.driveDistBucket = DRIVE_KEYS[bk];
        strokes += 1;
        remaining = (par === 4 ? 340 : 470) - DRIVE_MIDS[bk];
        if (driveLie === 'trouble') {
          strokes += 1; // punch-out (invisible to the engine)
          remaining = Math.max(30, remaining - 45);
          lie = rng() < 0.7 ? 'fairway' : 'rough';
        } else {
          lie = driveLie;
        }
        if (par === 5) {
          strokes += 1; // lay-up (invisible to the engine)
          remaining = Math.max(30, remaining - ADV[i]);
          const u = rng();
          lie = u < LAYUP_MIX.fairway ? 'fairway' : u < LAYUP_MIX.fairway + LAYUP_MIX.rough ? 'rough' : 'sand';
        }
      }
      const bucket = approachBucketFor(remaining);
      const dist = APPROACH_MID[bucket];
      d.approachBucket = bucket;
      d.approachLie = lie === 'tee' || lie === 'fairway' ? null : lie;
      strokes += 1;
      let fp;
      if (rng() < greenHit(lie, dist)) {
        d.approachResult = 'green';
        fp = pick(rng, bucketShares(hitMu(lie, dist), HIT_SIGMA));
      } else {
        d.approachResult = 'miss';
        if (rng() < BUNKER_SHARE[i]) {
          d.approachBunker = true;
          const extra = rng() < SAND_EXIT[i] - 1 ? 1 : 0;
          d.sandShots = 1 + extra;
          strokes += 1 + extra;
          fp = pick(rng, sandShares);
        } else {
          strokes += 1;
          fp = pick(rng, chipShares);
        }
      }
      d.firstPuttBucket = PUTT_KEYS[fp];
      d.putts = puttsFrom(fp);
      strokes += d.putts;
      const pen = rng() < PENALTIES_ANCHORS[i] / 18 ? 1 : 0;
      d.teePenalties = pen;
      strokes += pen;
      scores[n] = strokes;
      details[n] = d;
    }
  }
  return { holes, scores: { me: scores }, shotDetails: { me: details }, isComplete: true };
}

module.exports = {
  HANDICAP_ANCHORS,
  DRIVE_DISTANCE_ANCHORS,
  DRIVE_MIX_ANCHORS,
  PENALTIES_ANCHORS,
  SCORE_VS_PAR_ANCHORS,
  buildTables,
  simulateTypicalRounds,
  // exposed for the sanity tests
  model: { GREEN_ROWS, MAKE, THREE_PUTT, SHOT_ROWS, GREEN_HIT, CHIP_MU, SAND_MU, SAND_EXIT, ADV },
  lookup,
  bucketShares,
};
