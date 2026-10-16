# Strokes Gained Baselines per Handicap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task names the model tier to run it on (think expensive, build cheap).

**Goal:** Replace the two-table scratch/amateur blend behind every strokes-gained number with a continuous, monotone, per-handicap baseline `E_H(lie, distance)` that is *self-consistent with the engine*: a typical golfer of handicap H logging a typical round scores ≈ 0 in every SG category against target H, no clamp at 28, and the reconciliation card's expected score is the typical score of that handicap.

**Architecture:** `src/store/strokesGainedBaseline.js` becomes a set of per-handicap anchor tables (H = 0, 5, 10, 15, 20, 25, 30, 36, 54) interpolated linearly in H (and extrapolated, never clamped). The tables are *generated*, not hand-tuned: `scripts/lib/sgBaselineModel.js` holds a small typical-golfer model (green-hit %, proximity, up-and-down, putting make %, drive distance and lie mix, penalties per round — all anchored on published Shot Scope / Arccos / Broadie data) and derives each table value with the *exact formula the engine applies*, so calibration holds by construction. `scripts/sgBaselineTables.mjs` prints the literal; a script test fails if the committed literal drifts from the model. The engine (`statsEngine.js`) changes in two lines: the off-the-tee benchmark becomes the target's typical tee shot (a lie mix, not a fairway-only drive), and reconciliation's expected score becomes the typical score of the target handicap. Everything stays pure, on-device JS — OTA-shippable, no native change, no network.

**Tech Stack:** Expo SDK 54 / React Native 0.81 / React 19, Jest (jest-expo). Branch `fix/sg-per-handicap-baselines` from a freshly pulled `master`.

**Spec lineage:** `docs/superpowers/specs/2026-05-20-strokes-gained-per-handicap-target-design.md` (the blend), `docs/superpowers/specs/2026-07-15-sg-coach-improvements-design.md` (Phase 1 + penalties amendment). This plan adds an amendment to the latter (Task 7).

---

## 0. The bug and its root cause

Verified on `master` (b284fb0e-era engine, `targetHandicap` blend `t = H/14` clamped to `[0, 2]`):

1. **Clamp.** `expectedStrokes(lie, d, H)` is identical for every H ≥ 28 — targets 30, 36, 54 all read the H = 28 numbers (`benchmarkDriveDistance` and `expectedPenaltiesPerRound` clamp the same way). Probe on a synthetic 15-like round (`sgTotal` per category, per round):

   | target | offTheTee | approach | aroundGreen | putting | penalties |
   |---|---|---|---|---|---|
   | 0 | −1.86 | −4.21 | +0.81 | −8.99 | −1.00 |
   | 15 | +0.76 | −1.05 | +2.94 | −6.68 | +0.07 |
   | 28 / 30 / 40 / 54 | +5.18 | +1.69 | +4.79 | −4.68 | +1.00 |

2. **The tables are not self-consistent per handicap.** `SG_approach = E(start) − E(end) − 1` where `end` is the first-putt bucket on a green hit or `E(greenside | sand, 20 m)` on a miss (`approachEndState`). Raising the target raises `E(fairway, 125)` and `E(greenside, 20)` by almost the same amount (+0.40 vs +0.30 from 0 → 15), so the miss cost barely moves while the "amateur" table was built as "scratch + ~0.3 everywhere". Against the H = 15 tables a player had to hit ~57 % of greens from 125 m to break even; a typical 15 hits ~23 % GIR (33 % per shot from 125 m fairway). The strokes "lost" on approach reappeared as fake gains in putting / around the green and in the reconciliation residual. The scratch table was also inconsistent with Broadie's tour table (fairway 150 yd 2.92 < tour 2.98; green rows worse than tour).

3. **Bucket assumptions.** The `0-50` approach bucket's midpoint (25 m) clamped to the first fairway row at 45.7 m — fixed here by giving every table a 25 m row. "Misses always end at 20 m greenside" is *not* fixed (see §2.4): with engine-consistent tables it no longer biases the typical golfer; the strokes it hides stay honestly in the reconciliation residual.

## 1. Method (what was decided and why)

### 1.1 Engine-consistent per-handicap tables

The engine only ever sees buckets: drive distance + lie, approach bucket + hit/miss (+ bunker), first-putt bucket, putt count, sand shots, penalties. So each table value is **defined** by the formula the engine applies to those buckets for a typical golfer of handicap H:

- `E_H(green, d) = 2 − make_H(d) + threePutt_H(d)` — Shot Scope make % by handicap and band, Broadie's 50 %-distances (tour 8 ft, 90-golfer 5 ft) and "2 putts from 33 ft / 19 ft".
- `E_H(greenside, 20) = 1 + Σ_b q_H(b) · E_H(green, mid_b)` where `q_H` is the first-putt bucket distribution after a typical chip (lognormal proximity, mean 3.0 m scratch → 4.2 m at 15 → 6.5 m at 54; Shot Scope chips < 25 yd finish 10 / 13 / 15 ft at 5 / 15 / 25 hcp, Broadie pro 6 ft vs 90-golfer 10 ft). Implied up-and-down at 20 m: 51 / 43 / 37 / 31 / 26 / 22 % (0…25) vs Shot Scope 0-50 yd 54 / 47 / 39 / 34 / 31 / 25.
- `E_H(sand, 20) = exit_H + Σ_b q^sand_H(b) · E_H(green, mid_b)` — Shot Scope sand save 37 / 23 / 20 / 18 / 15 / 10 %, bunker proximity 12.5 ft (2 hcp) → 17.7 ft (26 hcp).
- `E_H(fairway, d) = 1 + g_H(d) · E[putts | hit] + (1 − g_H(d)) · [s_H · E_H(sand, 20) + (1 − s_H) · E_H(greenside, 20)]` for d ≤ 230 m — green-hit % per shot from Shot Scope (100 yd scratch 70 % / 10 hcp 49 %; 150 yd 55 % / 30 %; 150-175 yd 5 hcp 34 % / 15 hcp 19 %; 175-200 yd 23 % / 11 %), bunker share of misses 10-14 %. Cross-check: Arccos says a 10-handicap averages **3.38** from 100 yd fairway and **3.5** from rough; the model gives **3.34 / 3.43**. Broadie tour: 2.80 / 2.98 at 100 / 150 yd; the scratch row sits at 3.05 / 3.16 (a scratch amateur ≈ tour + 0.2).
- `rough`, `tee` (par 3), long `sand`: same formula with lower green-hit (× 0.72…0.55, × 0.95, × 0.45…0.25) and worse proximity (× 1.15 / 1.0 / 1.2). **No "invisible" duff strokes in any row** — a duffed rough shot is logged as "miss → greenside" and the engine can never see the extra stroke, so including it would make the typical golfer look like they gain (that was the original bug's mechanism in reverse). Rows ≥ 275 m use a lay-up model (one full shot of 200 → 110 m into a fairway/rough/sand mix).
- `recovery(d) = 1 + E_H(fairway/rough mix, d − 45)` — a punch-out (tour check: Broadie recovery 50 yd 3.79, model 3.80).
- **Off the tee**: the benchmark becomes `E_H('typicalDrive', anchor − D_H)` where `typicalDrive` is the target's drive-outcome mix (fairway 50 → 40 %, sand 3 → 6 %, trouble 5 → 24 %, rough the rest; Shot Scope fairway % is flat ≈ 47-49 at every handicap, what changes is distance and trouble) and `D_H` = 230 / 213 / 205 / 197 / 188 / 180 / 172 / 150 m (Broadie tour 290 yd, 90-golfer 210 yd; Arccos 10 hcp 227 yd). With a fairway-only benchmark a typical golfer loses ~2 strokes/round off the tee at every handicap, because half their drives are not in the fairway — so this one-string engine change is required by the calibration goal, not optional.
- **Penalties**: 0.5 / 0.9 / 1.3 / 1.7 / 2.1 / 2.6 / 3.1 / 3.7 / 5.5 per round (Arccos: 11-15 hcp average 1.66, 41 % of rounds ≥ 2; Shot Scope tee-penalty rate 1-3 % of drives). Scratch moves from 0 to 0.5 (decision D2).
- **Typical score vs par**: 2.0 / 8.0 / 13.0 / 18.4 / 23.2 / 29.9 / 36.5 / 44 / 66 (Shot Scope rows already in `shotBenchmarks.js` up to 25; hand-extrapolated above).

Anchors above 25 (30, 36, 54) are hand-extrapolated and kept monotone; the target picker caps at 36, 54 only gives the interpolation headroom. Beyond 54 the functions keep extrapolating linearly — there is no clamp anywhere.

### 1.2 Calibration evidence (real engine, generated tables, seeded typical-H rounds — 1 500 rounds per anchor)

Per-round SG of a typical golfer of handicap H against target H:

| H | offTheTee | approach | aroundGreen | putting | penalties |
|---|---|---|---|---|---|
| 0 | −0.11 | −0.16 | −0.04 | −0.01 | −0.03 |
| 5 | −0.01 | +0.04 | 0.00 | −0.07 | −0.01 |
| 10 | −0.01 | −0.05 | −0.09 | +0.09 | +0.01 |
| 15 | +0.02 | +0.01 | −0.06 | −0.02 | −0.02 |
| 20 | +0.04 | −0.03 | +0.01 | +0.03 | −0.02 |
| 25 | +0.05 | −0.01 | +0.04 | −0.01 | +0.02 |
| 30 | −0.03 | −0.02 | −0.06 | +0.03 | +0.03 |
| 36 | +0.01 | +0.04 | −0.04 | +0.06 | +0.01 |
| 54 | +0.07 | −0.01 | −0.03 | +0.05 | +0.01 |

(Monte-Carlo noise ≈ ±0.06.) A typical 15 against other targets:

| target | offTheTee | approach | aroundGreen | putting | penalties | total |
|---|---|---|---|---|---|---|
| 0 | −2.48 | −2.83 | −1.94 | −2.00 | −1.17 | −10.4 |
| 15 | +0.01 | +0.09 | −0.04 | +0.06 | +0.03 | +0.2 |
| 28 | +1.56 | +1.50 | +0.94 | +1.93 | +1.23 | +7.2 |
| 30 | +1.65 | +1.73 | +1.06 | +2.17 | +1.43 | +8.1 |
| 40 | +2.04 | +2.43 | +1.75 | +3.22 | +2.43 | +11.9 |

Arccos (real, every shot seen) says an 11-15 handicapper loses 3.63 tee / 5.67 approach / 2.93 short game / 1.99 putting per round to scratch (14.2 total ≈ the 14.3-stroke average-score gap). The engine-visible model reproduces putting and short game and about half of tee/approach — the rest are strokes bucket logging cannot see (far misses, duffs, second lay-ups), which is exactly what the reconciliation residual is for. Other checks: implied putts per round 30.3 / 31.0 / 31.8 / 32.7 / 33.6 / 34.8 vs Shot Scope 29.9 / 30.3 / 31.2 / 32.1 / 33.4 / 34.3; implied GIR 50 / 40 / 30 / 22 / 16 / 11 % vs 52 / 37 / 32 / 23 / 19 / 15. Every table column is monotone in H; the brief's 15-like round is monotone in every category for H = 0…60 and 28 ≠ 30 ≠ 40.

### 1.3 Decisions needed from Marcos (defaults are what the tasks implement)

- **D1 — Reconciliation expected score.** *(A, recommended)* expected = par + `typicalScoreVsPar(H)` × holes/18 — what a typical golfer of that index actually averages (scratch ≈ par + 2, a 15 ≈ par + 18.4, a 30 ≈ par + 36.5). With the categories calibrated to the typical golfer, this makes a typical golfer's residual ≈ 0 and turns "In-between & untracked" into the honest line it claims to be. *(B)* keep par + H: the typical 15 would show a −3.4 residual labelled "untracked" that is really the index-vs-average gap. B also makes the SG tables disagree with the Shots-tab benchmark rows (`shotBenchmarkForHandicap`, same Shot Scope rows). A changes one line in `sgReconciliation`, the "EXPECTED · SCRATCH" value (74 instead of 72 on a par 72) and the explainer copy.
- **D2 — Scratch penalty allowance.** *(recommended)* 0.5 / round (scratch golfers do take penalties; the typical-scratch calibration needs it). *(alt)* keep 0 so "vs scratch" stays the raw count; costs ≈ −0.4/round bias in the scratch penalties category and the scratch test tolerance.
- **D3 — In-flight committed focus.** *(recommended)* auto-rebase the stored `baselineImpact` of an SG-based focus the first time the new numbers load, and show a one-line "baseline recalibrated on {date}" note on the Focus card. *(quick)* rebase silently, no note.
- **D4 (optional)** raise the target picker / profile cap from 36 to 54 now that the tables reach 54 — not required; left out of scope unless asked.

### 1.4 Bucket assumptions — fixed now vs follow-up

- Fixed now: `0-50` approach bucket no longer clamps to 45.7 m (new 25 m row); greenside/sand tables get an explicit 20 m row (the only distance the engine reads).
- Follow-up (not in this PR, listed in Task 7's amendment): (a) infer "extra shots after a missed approach" from `strokes − putts − known shots` on par 4s without trouble drives and charge them in around-the-green, which would let the around-green baseline carry real multi-chip strokes instead of the residual; (b) a miss-severity chip in the approach finish grid so far misses stop looking like 20 m chips; (c) a `200+` bucket that models "go for it from 230" realistically once the engine can see where the miss ended; (d) engine-visible pricing of sand approach lies; (e) replace the hand-extrapolated 30/36/54 anchors with real rows when the app has enough logged rounds.

---

## Global Constraints

- All distances in **metres**; all tables and anchors live in `src/store/strokesGainedBaseline.js` (runtime) and `scripts/lib/sgBaselineModel.js` (generator). **Never hand-edit `BASELINES`** — edit the model, run `node scripts/sgBaselineTables.mjs`, paste.
- No network, no `Date.now()` in stats maths (the focus rebase timestamp is UI metadata, written where `committedAt` already is).
- Store modules stay pure; no React imports in `src/store/`.
- Minimal diff: no refactors beyond the listed files. Match existing style.
- Run tests with `npx jest <path>`; full suite `npm test`; lint `npm run lint` (CI-blocking). Ignore failures under `.worktrees/` / `.claude/worktrees/` (known artefact).
- Commit after every task with the message given. Conventional Commits, imperative, ≤ 72 chars. Never commit to `master`.
- Prototype artefacts (read-only reference while this session lives): generator `…/scratchpad/final/scripts/lib/sgBaselineModel.js`, runner `…/scratchpad/final/scripts/sgBaselineTables.mjs`, literal `…/scratchpad/final/BASELINES.literal.js` (full absolute paths in Appendix A). Appendix A also contains the complete code, so the plan is self-sufficient.

---

### Task 1: Generator — typical-golfer model, runner, script test — **Sonnet**

**Files:**
- Create: `scripts/lib/sgBaselineModel.js` (CommonJS, like `scripts/lib/osmGeometry.js`)
- Create: `scripts/sgBaselineTables.mjs`
- Create: `scripts/__tests__/sgBaselineModel.test.js`

**Interfaces (produced, used by Tasks 2-4):**
- `HANDICAP_ANCHORS = [0, 5, 10, 15, 20, 25, 30, 36, 54]`
- `DRIVE_DISTANCE_ANCHORS`, `DRIVE_MIX_ANCHORS { fairway, sand, recovery }`, `PENALTIES_ANCHORS`, `SCORE_VS_PAR_ANCHORS` (arrays aligned with the anchors)
- `buildTables() → { green, greenside, fairway, rough, tee, sand, recovery }`, each `{ distances: number[], byHandicap: { [h]: number[] } }` rounded to 2 dp
- `simulateTypicalRounds(anchorIndex, rounds, seed) → round` in the shape `statsEngine`'s `sg*` functions consume (`{ holes, scores: { me }, shotDetails: { me }, isComplete }`)
- `lookup(rows, vals, d)`, `bucketShares(mean, sigma)`, `model` (the raw parameter tables)

- [ ] **Step 1: Write the lib and the runner**

Copy Appendix A.1 to `scripts/lib/sgBaselineModel.js` and Appendix A.2 to `scripts/sgBaselineTables.mjs` verbatim (they are tested as-is). Keep the source comments — they are the citation record.

- [ ] **Step 2: Write the failing script test**

`scripts/__tests__/sgBaselineModel.test.js`:

```js
const {
  HANDICAP_ANCHORS, buildTables, lookup, DRIVE_DISTANCE_ANCHORS, PENALTIES_ANCHORS, SCORE_VS_PAR_ANCHORS,
} = require('../lib/sgBaselineModel');
const { SHOT_HANDICAP_BENCHMARKS } = require('../../src/store/shotBenchmarks');

const tables = buildTables();
const E = (lie, h, d) => lookup(tables[lie].distances, tables[lie].byHandicap[h], d);

describe('sgBaselineModel tables', () => {
  test('every lie has a row per anchor, sorted distances, 2-dp values', () => {
    Object.values(tables).forEach(({ distances, byHandicap }) => {
      for (let i = 1; i < distances.length; i++) expect(distances[i]).toBeGreaterThan(distances[i - 1]);
      HANDICAP_ANCHORS.forEach((h) => {
        expect(byHandicap[h]).toHaveLength(distances.length);
        byHandicap[h].forEach((v) => expect(v).toBeCloseTo(Math.round(v * 100) / 100, 10));
      });
    });
  });
  test('monotone in handicap at every distance, and in distance for every lie', () => {
    Object.values(tables).forEach(({ distances, byHandicap }) => {
      distances.forEach((_, r) => {
        for (let i = 1; i < HANDICAP_ANCHORS.length; i++) {
          expect(byHandicap[HANDICAP_ANCHORS[i]][r]).toBeGreaterThanOrEqual(byHandicap[HANDICAP_ANCHORS[i - 1]][r]);
        }
      });
      HANDICAP_ANCHORS.forEach((h) => {
        for (let r = 1; r < distances.length; r++) expect(byHandicap[h][r]).toBeGreaterThanOrEqual(byHandicap[h][r - 1]);
      });
    });
    [DRIVE_DISTANCE_ANCHORS].forEach((a) => { for (let i = 1; i < a.length; i++) expect(a[i]).toBeLessThan(a[i - 1]); });
    [PENALTIES_ANCHORS, SCORE_VS_PAR_ANCHORS].forEach((a) => { for (let i = 1; i < a.length; i++) expect(a[i]).toBeGreaterThan(a[i - 1]); });
  });
  test('published anchors: Arccos 10 hcp 100 yd fairway 3.38 / rough 3.5; Broadie tour 100 / 150 yd 2.80 / 2.98', () => {
    expect(E('fairway', 10, 91.4)).toBeCloseTo(3.38, 0);   // ±0.5 band; model ≈ 3.30
    expect(Math.abs(E('fairway', 10, 91.4) - 3.38)).toBeLessThan(0.15);
    expect(Math.abs(E('rough', 10, 91.4) - 3.5)).toBeLessThan(0.15);
    expect(E('fairway', 0, 91.4) - 2.80).toBeGreaterThan(0.1);   // scratch amateur sits above tour
    expect(E('fairway', 0, 91.4) - 2.80).toBeLessThan(0.35);
    expect(E('fairway', 0, 137.2) - 2.98).toBeLessThan(0.3);
  });
  test('score-vs-par anchors ≤ 25 are the Shot Scope rows in shotBenchmarks', () => {
    SHOT_HANDICAP_BENCHMARKS.forEach((row) => {
      const i = HANDICAP_ANCHORS.indexOf(row.handicap);
      expect(SCORE_VS_PAR_ANCHORS[i]).toBeCloseTo(row.avgScoreVsPar, 0);
    });
  });
});
```

- [ ] **Step 3: Run**

`npx jest scripts/__tests__/sgBaselineModel.test.js` → PASS. `node scripts/sgBaselineTables.mjs --report` prints the calibration report (putts, GIR and wedge values should match §1.2). `node scripts/sgBaselineTables.mjs > /tmp/baselines.js` and diff against Appendix A.3 — identical.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/sgBaselineModel.js scripts/sgBaselineTables.mjs scripts/__tests__/sgBaselineModel.test.js
git commit -m "feat(sg): typical-golfer model that generates per-handicap SG baselines"
```

---

### Task 2: `strokesGainedBaseline.js` — per-handicap tables, no clamp — **Sonnet**

**Files:**
- Modify: `src/store/strokesGainedBaseline.js` (rewrite the table section and the blend; keep `BUCKETS`, `PAR_ANCHOR_DISTANCE`, `TEE_CLUB_FACTOR`, `benchmarkTeeShotDistance` as they are)
- Modify: `src/store/__tests__/strokesGainedBaseline.test.js` (rewrite)

**Interfaces:**
- Removed exports: `BASELINES_SCRATCH`, `BASELINES_AMATEUR`, `AMATEUR_ANCHOR_HANDICAP` (only the test imports them; `statsEngine` imports `expectedFromBucket, expectedStrokes, BUCKETS, PAR_ANCHOR_DISTANCE, benchmarkTeeShotDistance, expectedPenaltiesPerRound` — all kept).
- New exports: `SG_BASELINE_VERSION = 2`, `HANDICAP_ANCHORS`, `BASELINES` (the generated literal — replaces the old compat alias), `interpHandicap(valuesByAnchor, h)`, `DRIVE_DISTANCE_ANCHORS`, `DRIVE_MIX_ANCHORS`, `typicalDriveMix(h)`, `PENALTIES_ANCHORS`, `SCORE_VS_PAR_ANCHORS`, `typicalScoreVsPar(h)`.
- `expectedStrokes(lie, distance, targetHandicap = 0)`: unchanged signature; accepts the extra lie `'typicalDrive'` (the drive-outcome mix). Unknown lie → `null` as before.

- [ ] **Step 1: Write the failing tests** (replace the file)

```js
import {
  BASELINES, BUCKETS, HANDICAP_ANCHORS, SG_BASELINE_VERSION,
  expectedStrokes, expectedFromBucket, interpHandicap, typicalDriveMix,
  benchmarkDriveDistance, benchmarkTeeShotDistance, PAR_ANCHOR_DISTANCE,
  expectedPenaltiesPerRound, typicalScoreVsPar,
} from '../strokesGainedBaseline';

describe('BASELINES', () => {
  test('one row set per lie, every anchor present, sorted, monotone in handicap', () => {
    expect(HANDICAP_ANCHORS).toEqual([0, 5, 10, 15, 20, 25, 30, 36, 54]);
    ['tee', 'fairway', 'rough', 'sand', 'recovery', 'greenside', 'green'].forEach((lie) => {
      const { distances, byHandicap } = BASELINES[lie];
      for (let i = 1; i < distances.length; i++) expect(distances[i]).toBeGreaterThan(distances[i - 1]);
      HANDICAP_ANCHORS.forEach((h, k) => {
        expect(byHandicap[h]).toHaveLength(distances.length);
        if (k > 0) byHandicap[h].forEach((v, r) => expect(v).toBeGreaterThanOrEqual(byHandicap[HANDICAP_ANCHORS[k - 1]][r]));
      });
    });
    expect(SG_BASELINE_VERSION).toBe(2);
  });
  test('greenside and sand carry an explicit 20 m row (the only distance the engine reads)', () => {
    expect(BASELINES.greenside.distances).toContain(20);
    expect(BASELINES.sand.distances).toContain(20);
  });
});

describe('interpHandicap', () => {
  const v = [0, 5, 10, 15, 20, 25, 30, 36, 54]; // identity on the anchors
  test('exact on anchors, linear between, extrapolates past both ends, never clamps', () => {
    expect(interpHandicap(v, 15)).toBe(15);
    expect(interpHandicap(v, 12.5)).toBeCloseTo(12.5, 10);
    expect(interpHandicap(v, 40)).toBeCloseTo(40, 10);
    expect(interpHandicap(v, 60)).toBeCloseTo(60, 10);
    expect(interpHandicap(v, -2)).toBeCloseTo(-2, 10);
    expect(interpHandicap(v, null)).toBe(0);
  });
});

describe('expectedStrokes(lie, distance, targetHandicap)', () => {
  test('anchor rows read back exactly; distance interpolates and clamps', () => {
    expect(expectedStrokes('fairway', 125, 0)).toBeCloseTo(BASELINES.fairway.byHandicap[0][4], 10);
    expect(expectedStrokes('fairway', 125, 15)).toBeCloseTo(BASELINES.fairway.byHandicap[15][4], 10);
    const a = BASELINES.green.byHandicap[0];
    expect(expectedStrokes('green', 0, 0)).toBeCloseTo(a[0], 10);                       // clamp low
    expect(expectedStrokes('green', 100, 0)).toBeCloseTo(a[a.length - 1], 10);          // clamp high
    expect(expectedStrokes('green', (0.91 + 1.83) / 2, 0)).toBeCloseTo((a[0] + a[1]) / 2, 10);
  });
  test('default target is scratch; unknown lie is null', () => {
    expect(expectedStrokes('fairway', 125)).toBeCloseTo(expectedStrokes('fairway', 125, 0), 10);
    expect(expectedStrokes('lava', 150)).toBeNull();
  });
  test('no clamp: 28, 30 and 40 differ, and every lie is non-decreasing in the target', () => {
    const lies = ['tee', 'fairway', 'rough', 'sand', 'recovery', 'greenside', 'green', 'typicalDrive'];
    const dist = { tee: 125, fairway: 125, rough: 125, sand: 20, recovery: 91.4, greenside: 20, green: 4.5, typicalDrive: 135 };
    lies.forEach((lie) => {
      expect(expectedStrokes(lie, dist[lie], 30)).toBeGreaterThan(expectedStrokes(lie, dist[lie], 28));
      expect(expectedStrokes(lie, dist[lie], 40)).toBeGreaterThan(expectedStrokes(lie, dist[lie], 30));
      let prev = -Infinity;
      for (let h = 0; h <= 60; h += 0.5) { const v = expectedStrokes(lie, dist[lie], h); expect(v).toBeGreaterThanOrEqual(prev - 1e-12); prev = v; }
    });
  });
  test('typicalDrive is the target\'s lie mix and sits above a fairway-only drive', () => {
    const mix = typicalDriveMix(15);
    expect(mix.fairway + mix.rough + mix.sand + mix.recovery).toBeCloseTo(1, 10);
    const mixed = mix.fairway * expectedStrokes('fairway', 135, 15) + mix.rough * expectedStrokes('rough', 135, 15)
      + mix.sand * expectedStrokes('sand', 135, 15) + mix.recovery * expectedStrokes('recovery', 135, 15);
    expect(expectedStrokes('typicalDrive', 135, 15)).toBeCloseTo(mixed, 10);
    expect(expectedStrokes('typicalDrive', 135, 15)).toBeGreaterThan(expectedStrokes('fairway', 135, 15));
  });
  test('published sanity: 10 hcp from 100 yd fairway ≈ 3.3 (Arccos 3.38); scratch 6 ft putt ≈ 1.33; typical 15 chip node 2.75', () => {
    expect(expectedStrokes('fairway', 91.4, 10)).toBeCloseTo(3.30, 1);
    expect(expectedStrokes('green', 1.83, 0)).toBeCloseTo(1.33, 2);
    expect(expectedStrokes('greenside', 20, 15)).toBeCloseTo(2.75, 2);
  });
});

describe('expectedFromBucket', () => {
  test('maps bucket key to midpoint then to expected, threading the target', () => {
    expect(expectedFromBucket('approach', '100-150')).toBeCloseTo(expectedStrokes('fairway', 125), 10);
    expect(expectedFromBucket('firstPutt', '3-6', 10)).toBeCloseTo(expectedStrokes('green', 4.5, 10), 10);
    expect(expectedFromBucket('approach', '0-50', 0)).toBeCloseTo(BASELINES.fairway.byHandicap[0][0], 10); // 25 m row, no clamp to 45.7
  });
});

describe('drive, penalty and score anchors', () => {
  test('bucket midpoints and par anchors unchanged', () => {
    expect(BUCKETS.driveDist).toEqual({ '0-150': 135, '150-180': 165, '180-210': 195, '210-240': 225, '240+': 255 });
    expect(PAR_ANCHOR_DISTANCE).toEqual({ 4: 340, 5: 470 });
  });
  test('benchmarkDriveDistance: 230 scratch, 205 at 15, 180 at 30, keeps falling past 36', () => {
    expect(benchmarkDriveDistance(0)).toBe(230);
    expect(benchmarkDriveDistance(15)).toBe(205);
    expect(benchmarkDriveDistance(30)).toBe(180);
    expect(benchmarkDriveDistance(7)).toBeCloseTo(218.4, 1);
    expect(benchmarkDriveDistance(40)).toBeLessThan(benchmarkDriveDistance(36));
    expect(benchmarkDriveDistance()).toBe(230);
    expect(benchmarkTeeShotDistance(0, 'iron')).toBeCloseTo(230 * 0.78, 10);
  });
  test('expectedPenaltiesPerRound: 0.5 scratch, 1.7 at 15, 3.1 at 30, 1.62 at 14, rising past 36', () => {
    expect(expectedPenaltiesPerRound(0)).toBe(0.5);
    expect(expectedPenaltiesPerRound()).toBe(0.5);
    expect(expectedPenaltiesPerRound(15)).toBeCloseTo(1.7, 10);
    expect(expectedPenaltiesPerRound(14)).toBeCloseTo(1.62, 10);
    expect(expectedPenaltiesPerRound(30)).toBeCloseTo(3.1, 10);
    expect(expectedPenaltiesPerRound(50)).toBeGreaterThan(expectedPenaltiesPerRound(36));
  });
  test('typicalScoreVsPar follows the Shot Scope rows and extrapolates', () => {
    expect(typicalScoreVsPar(0)).toBe(2.0);
    expect(typicalScoreVsPar(15)).toBe(18.4);
    expect(typicalScoreVsPar(18)).toBeCloseTo(18.4 + 0.6 * (23.2 - 18.4), 10);
    expect(typicalScoreVsPar(30)).toBe(36.5);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

`npx jest src/store/__tests__/strokesGainedBaseline.test.js` → FAIL (`HANDICAP_ANCHORS` undefined etc.).

- [ ] **Step 3: Implement**

Replace everything from the header comment through `AMATEUR_ANCHOR_HANDICAP` and the two clamped helpers with the following (keep `BUCKETS`, `PAR_ANCHOR_DISTANCE`, `TEE_CLUB_FACTOR`, `benchmarkTeeShotDistance` and their comments; delete `BASELINES_SCRATCH`, `BASELINES_AMATEUR`, `AMATEUR_ANCHOR_HANDICAP`, `blendedExpected`, `SCRATCH_DRIVE_DISTANCE`, `AMATEUR_DRIVE_DISTANCE`, `AMATEUR_PENALTIES_PER_ROUND`):

```js
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
// handicap H scores ≈ 0 in every category against target H. Strokes the
// logging cannot see (duffed chips, far misses, second lay-ups) are not in
// these tables; the reconciliation card shows them as "In-between & untracked".
//
// Bump SG_BASELINE_VERSION whenever BASELINES or the anchors below change in a
// way that moves SG numbers — coachFocus rebases committed SG focuses on it.
export const SG_BASELINE_VERSION = 2;

export const HANDICAP_ANCHORS = [0, 5, 10, 15, 20, 25, 30, 36, 54];

<PASTE Appendix A.3 — the `export const BASELINES = { … }` literal — here>

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

// ── Off-the-tee benchmark ──
// The OTT model compares a drive against the target handicap's TYPICAL tee
// shot on an anchor-length hole: its typical distance AND its typical lie mix
// (Shot Scope: fairways ≈ 47-49 % at every handicap; what grows with the
// handicap is trouble). A fairway-only benchmark made every typical golfer
// "lose" ~2 strokes a round off the tee.
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

export function benchmarkDriveDistance(targetHandicap = 0) {
  return interpHandicap(DRIVE_DISTANCE_ANCHORS, targetHandicap ?? 0);
}

// (keep TEE_CLUB_FACTOR + benchmarkTeeShotDistance unchanged)

// Typical penalty strokes per round for a target handicap (Arccos: 11-15 hcp
// average 1.66; Shot Scope tee-penalty rate 1-3 % of drives). Scratch is 0.5,
// not 0 — scratch golfers take penalties too, and the calibration needs it.
export const PENALTIES_ANCHORS = [.5, .9, 1.3, 1.7, 2.1, 2.6, 3.1, 3.7, 5.5];
export function expectedPenaltiesPerRound(targetHandicap = 0) {
  return interpHandicap(PENALTIES_ANCHORS, targetHandicap ?? 0);
}

// What a typical golfer of that handicap index actually averages over par
// (Shot Scope rows ≤ 25, the same ones as shotBenchmarks.js; hand-extrapolated
// above). A handicap is "best 8 of 20", so the typical round is a few strokes
// worse than par + index. sgReconciliation's expected score.
export const SCORE_VS_PAR_ANCHORS = [2.0, 8.0, 13.0, 18.4, 23.2, 29.9, 36.5, 44, 66];
export function typicalScoreVsPar(targetHandicap = 0) {
  return interpHandicap(SCORE_VS_PAR_ANCHORS, targetHandicap ?? 0);
}
```

(`BUCKETS` stays where it is, above the lookup helpers. Keep the file's existing ordering conventions — tables first, helpers after.)

- [ ] **Step 4: Run** `npx jest src/store/__tests__/strokesGainedBaseline.test.js` → PASS. `npx jest src/store/__tests__/statsEngine.test.js` → FAIL on the pinned numbers (expected; Task 3 fixes them).

- [ ] **Step 5: Commit**

```bash
git add src/store/strokesGainedBaseline.js src/store/__tests__/strokesGainedBaseline.test.js
git commit -m "fix(sg): per-handicap baselines interpolated over anchors, no clamp"
```

---

### Task 3: Engine — typical-drive benchmark, typical-score reconciliation, calibration tests — **Sonnet** (final review **Opus**)

**Files:**
- Modify: `src/store/statsEngine.js` — `sgOffTheTee` (~line 2744) and `sgReconciliation` (~line 2983); extend the import on line 3-6 with `typicalScoreVsPar`
- Modify: `src/store/__tests__/statsEngine.test.js` (pinned numbers — Appendix B)
- Create: `src/store/__tests__/sgCalibration.test.js`

**Interfaces:** no signature changes. `sgOffTheTee` benchmark node is `'typicalDrive'`. `sgReconciliation(...).perRound[i].expected = parPlayed + typicalScoreVsPar(targetHandicap) · holesPlayed / 18` (D1 = A; if Marcos picks B, skip Step 3b and keep the old formula and tests).

- [ ] **Step 1: Write the failing calibration tests**

`src/store/__tests__/sgCalibration.test.js`:

```js
// Calibration contract for the per-handicap SG baselines: a typical golfer of
// handicap H, logging a typical round, scores ≈ 0 in every category against
// target H; a better target is always harder; no target clamps.
import { sgTotal, sgReconciliation } from '../statsEngine';
import { HANDICAP_ANCHORS } from '../strokesGainedBaseline';

const { simulateTypicalRounds } = require('../../../scripts/lib/sgBaselineModel');

const CATS = ['offTheTee', 'approach', 'aroundGreen', 'putting', 'penalties'];
const ROUNDS = 800; // ≈ ±0.08/round Monte-Carlo noise per category (seeded, deterministic).
// If a seed ever lands outside the ±0.3 band, raise ROUNDS — never widen the band.
const perRound = (round, h) => {
  const t = sgTotal(round, 'me', h);
  return Object.fromEntries(CATS.map((c) => [c, t.byCategory[c] / ROUNDS]));
};

describe('typical golfer vs own target', () => {
  [0, 10, 15, 25, 36].forEach((h) => {
    test(`handicap ${h}: every category within ±0.3 strokes/round of zero`, () => {
      const i = HANDICAP_ANCHORS.indexOf(h);
      const sg = perRound(simulateTypicalRounds(i, ROUNDS, 100 + i), h);
      CATS.forEach((c) => expect(Math.abs(sg[c])).toBeLessThan(0.3));
    });
  });
  test('typical 15 gains in every category against a 30 target and loses in every one against scratch', () => {
    const round = simulateTypicalRounds(HANDICAP_ANCHORS.indexOf(15), ROUNDS, 7);
    const vs30 = perRound(round, 30);
    const vs0 = perRound(round, 0);
    CATS.forEach((c) => { expect(vs30[c]).toBeGreaterThan(0.5); expect(vs0[c]).toBeLessThan(-0.5); });
  });
  test('reconciliation expects the typical score of the target, not par + handicap', () => {
    // (The simulator only produces engine-visible strokes, so its score sits
    // below the typical score; the residual identity is covered elsewhere.)
    const round = {
      holes: [{ number: 1, par: 4, strokeIndex: 1 }], scores: { me: { 1: 5 } },
      shotDetails: { me: { 1: { putts: 2, firstPuttBucket: '2-3' } } }, isComplete: true,
    };
    expect(sgReconciliation([round], 'me', 15).perRound[0].expected).toBeCloseTo(4 + 18.4 / 18, 10);
    expect(sgReconciliation([round], 'me', 0).perRound[0].expected).toBeCloseTo(4 + 2.0 / 18, 10);
  });
});

describe('monotone in the target, no clamp', () => {
  // The brief's 15-like round: fairway 125 m, 30 % greens hit to 4.5 m, misses chipped to 1-2 m, 2 putts, one tee penalty.
  const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
  const scores = {}; const details = {};
  holes.forEach((h, i) => {
    const green = i % 10 < 3;
    details[h.number] = {
      drive: i % 2 === 0 ? 'fairway' : 'left', driveLie: i % 2 === 0 ? 'fairway' : 'rough',
      driveDistBucket: i % 3 === 0 ? '210-240' : '180-210',
      approachBucket: '100-150', approachResult: green ? 'green' : 'miss',
      putts: 2, firstPuttBucket: green ? '3-6' : '1-2', sandShots: 0, teePenalties: i === 4 ? 1 : 0,
    };
    scores[h.number] = (green ? 4 : 5) + (i === 4 ? 1 : 0);
  });
  const round = { holes, scores: { me: scores }, shotDetails: { me: details }, isComplete: true };

  test('every category is non-decreasing from target 0 to 60', () => {
    let prev = null;
    for (let h = 0; h <= 60; h += 1) {
      const t = sgTotal(round, 'me', h).byCategory;
      if (prev) CATS.forEach((c) => expect(t[c]).toBeGreaterThanOrEqual(prev[c] - 1e-9));
      prev = t;
    }
  });
  test('28, 30 and 40 are three different baselines', () => {
    const a = sgTotal(round, 'me', 28).byCategory, b = sgTotal(round, 'me', 30).byCategory, c = sgTotal(round, 'me', 40).byCategory;
    CATS.forEach((k) => { expect(b[k]).toBeGreaterThan(a[k]); expect(c[k]).toBeGreaterThan(b[k]); });
  });
  test('the brief: a 15 who misses 70 % of greens from 125 m gains on approach against a 30 target', () => {
    expect(sgTotal(round, 'me', 30).byCategory.approach).toBeGreaterThan(2);   // ≈ +3.9
    expect(sgTotal(round, 'me', 0).byCategory.approach).toBeLessThan(0);        // ≈ −1.4
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npx jest src/store/__tests__/sgCalibration.test.js` → FAIL (typical golfer loses ≈ 2/round off the tee with the fairway-only benchmark; reconciliation still expects par + handicap).

- [ ] **Step 3a: `sgOffTheTee` benchmark node**

Extend the import block at the top of `statsEngine.js` with `typicalScoreVsPar`. In `sgOffTheTee` replace

```js
    const bench = expectedStrokes(
      'fairway',
      Math.max(MIN_REMAINING_DISTANCE, anchor - benchmarkTeeShotDistance(targetHandicap, d?.teeClub ?? 'driver')),
      targetHandicap,
    );
```

with

```js
    // The benchmark is the target's TYPICAL tee shot — its distance and its
    // lie mix (fairway / rough / sand / trouble), not a fairway-only drive.
    const bench = expectedStrokes(
      'typicalDrive',
      Math.max(MIN_REMAINING_DISTANCE, anchor - benchmarkTeeShotDistance(targetHandicap, d?.teeClub ?? 'driver')),
      targetHandicap,
    );
```

and update the function's lead comment ("…the end position of the target handicap's typical drive (fairway lie)…" → "…typical tee shot (its distance and lie mix)…").

- [ ] **Step 3b (D1 = A): `sgReconciliation` expected score**

Replace

```js
    const expected = parPlayed + targetHandicap * (holesPlayed / 18);
```

with

```js
    // What a typical golfer of the target handicap actually averages (a
    // handicap is "best 8 of 20", so par + index is a good day, not a typical
    // one) — the same typical golfer the SG baselines are calibrated to, so a
    // typical round leaves ≈ 0 in the residual.
    const expected = parPlayed + typicalScoreVsPar(targetHandicap) * (holesPlayed / 18);
```

and update the block comment above the function ("Expected score = par + targetHandicap…" → the typical-score wording).

- [ ] **Step 4: Update the pinned numbers in `statsEngine.test.js`** — every value and the matching inline maths comment, per Appendix B. Use `toBeCloseTo(x, 2)` where a test used `toBe` on a penalties value that now carries the scratch allowance.

- [ ] **Step 5: Run** `npx jest src/store/__tests__/statsEngine.test.js src/store/__tests__/sgCalibration.test.js src/store/__tests__/strokesGainedBaseline.test.js` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store/statsEngine.js src/store/__tests__/statsEngine.test.js src/store/__tests__/sgCalibration.test.js
git commit -m "fix(sg): benchmark the typical tee shot; reconcile against the typical score"
```

---

### Task 4: Downstream test expectations — **Haiku**

**Files:**
- Modify: `src/store/__tests__/personalStats.test.js` — the `puttingRound` helper comment and `computeSgFormDelta` numbers: `E(green, 2.5 m, scratch) = 1.506 → 2-putt SG/hole = −0.494, 1-putt = +0.506`; `previous` −7.02 → **−8.90**, `recent` 10.98 → **+9.10**, `delta` stays **18.0**.
- Check (no change expected, run them): `src/store/__tests__/roundReportCard.test.js` (+ snapshot), `src/components/mystats/__tests__/SGReconciliationCard.test.js` (uses invariants and fixed fixtures), `ShotDashboard.test.js`, `SGTrendCard.test.js`, `StatsTabs.test.js` (its `target 31.9 / 18 holes`, `target 25%`, `target 3.9` strings come from `shotBenchmarks`, not SG), `coachInsights.test.js` and `coachStrategy.test.js` (synthetic `byCategory` fixtures), `src/screens/__tests__/MyStatsScreen.test.js`.

- [ ] **Step 1:** apply the personalStats numbers; run `npx jest src/store src/components/mystats src/screens` → PASS (if any other suite pins an old SG number, fix the expectation with the value from the new tables and note it in the commit body — do not loosen tolerances).
- [ ] **Step 2: Commit** — `git commit -m "test(sg): update expectations for per-handicap baselines"`

---

### Task 5: Committed coach focus survives the recalibration — **Sonnet**

The focus card stores `baselineImpact` (an SG/round number computed with the old tables) and verdicts by comparing it with today's `insight.impact`. After this change the comparison is old-baseline vs new-baseline → spurious "improving"/"worse". Points-based focuses (`basis: 'vs your avg'`) are unaffected.

**Files:**
- Modify: `src/store/coachFocus.js`
- Modify: `src/screens/MyStatsScreen.js` (one effect near the focus load, ~line 440-480)
- Modify: `src/components/mystats/FocusCard.js` (one line, D3 recommended)
- Modify: `src/i18n/locales/en/myStats.js`, `src/i18n/locales/es/myStats.js` (`stats.my.focus.rebased`)
- Test: `src/store/__tests__/coachFocus.test.js` (extend)

**Interfaces:**
- `makeFocusCommit` adds `basis: insight.basis ?? null` and `baselineVersion: SG_BASELINE_VERSION` (import from `./strokesGainedBaseline`).
- `isSgFocus(focus)` (export): `focus.basis === 'vs target hcp' || /\bSG\b/.test(focus.metric ?? '')` (the regex covers focuses committed before `basis` was stored).
- `needsRebase(focus)` (export): `isSgFocus(focus) && (focus.baselineVersion ?? 1) !== SG_BASELINE_VERSION`.
- `rebaseFocus(focus, stats, rebasedAt)` (export, pure): returns `{ ...focus, baselineImpact: currentImpact ?? focus.baselineImpact, roundCountAtCommit: stats.roundCount ?? 0, baselineVersion: SG_BASELINE_VERSION, rebasedAt }` where `currentImpact` is the live insight's impact (reuse `findInsightById`). If the insight is no longer on the board, keep `baselineImpact` but still stamp the version (verdict then resolves as today).
- `focusVerdict`: when `needsRebase(focus)` return `{ ...base, state: 'needs-more-rounds', roundsNeeded: MIN_VERDICT_ROUNDS }` — a safe interim state for the single render before the rebase effect lands (never compares across baselines).
- `MyStatsScreen`: `useEffect` — when `coachFocus && stats && needsRebase(coachFocus)`: `const next = rebaseFocus(coachFocus, stats, new Date().toISOString()); setCoachFocus(next); saveFocus(user?.id, next).catch(() => {});`.
- `FocusCard` (D3 recommended): under the verdict row, when `focus.rebasedAt` is set, render `t('stats.my.focus.rebased', { date: formatDate(focus.rebasedAt) })` in the muted caption style the card already uses (`s.committedAt` or equivalent). EN: `"Baselines recalibrated on {date} — progress is measured from then."` ES: `"Referencias recalibradas el {date}: el progreso se mide desde entonces."` Use the date formatter the file (or its neighbours) already import; do not add a dependency.

- [ ] **Step 1: Failing tests** (append to `coachFocus.test.js`; follow its existing fixture style):
  - `makeFocusCommit` stamps `baselineVersion` and `basis`.
  - `needsRebase`: true for `{ basis: 'vs target hcp', baselineVersion: 1 }` and for a legacy `{ metric: '-1.2 SG / round' }` with no version; false for a points focus and for a current-version SG focus.
  - `rebaseFocus` takes the live impact and stamps version + `rebasedAt`; keeps `baselineImpact` when the insight is gone.
  - `focusVerdict` on a stale-version SG focus never returns `improving`/`worse`.
- [ ] **Step 2:** implement; `npx jest src/store/__tests__/coachFocus.test.js src/screens/__tests__/MyStatsScreen.test.js src/components/mystats` → PASS.
- [ ] **Step 3: Commit** — `git commit -m "fix(coach): rebase committed SG focuses when the baselines change"`

---

### Task 6: Explainer copy stays truthful (EN + ES) — **Haiku**

**Files:**
- Modify: `src/i18n/locales/en/statExplainers.js`, `src/i18n/locales/es/statExplainers.js` — `stats.explainer.strokesGained.explainer` and `.explainerTarget`
- Modify: `src/components/mystats/statExplainers.js` — pass `typicalOverPar` (D1 = A)
- Modify: `src/components/mystats/__tests__/statExplainers.test.js` (keep the `compares to a handicap-12 golfer` assertion; add one for the new sentence)

Replace the last paragraph of both EN variants ("A category only shows a number once it has enough logged holes behind it. Because you log buckets instead of exact yardage, numbers are estimates built on Mark Broadie's published baselines — accurate to about ±0.2 strokes per round.") with:

> EN (scratch): "A category only shows a number once it has enough logged holes behind it. The baselines are built per handicap from published Shot Scope and Arccos benchmarks (greens hit by distance, chip and bunker proximity, putting make rates, penalties) on Mark Broadie's strokes-gained method, so a typical scratch golfer scores about zero in every category here. The expected score on \"Where your strokes go\" is what a typical scratch golfer averages (about 2 over par), not par. Because you log distance buckets rather than exact yardages, read the numbers as trends over several rounds."
>
> EN (target): same text with "a typical handicap-{handicap} golfer scores about zero…" and "…what a typical handicap-{handicap} golfer averages (about {typicalOverPar} over par), not par plus handicap."
>
> ES (scratch): "Una categoría solo muestra un número cuando tiene suficientes hoyos registrados detrás. Las referencias se construyen por hándicap a partir de los datos publicados por Shot Scope y Arccos (greens cogidos por distancia, proximidad en chips y bunkers, porcentaje de putts embocados, penalizaciones) con el método de golpes ganados de Mark Broadie, de modo que un golfista scratch típico obtiene aquí cerca de cero en cada categoría. El resultado esperado de “Dónde se van tus golpes” es lo que promedia un scratch típico (unos 2 golpes sobre par), no el par. Como registras tramos de distancia y no yardas exactas, lee los números como tendencias a lo largo de varias vueltas."
>
> ES (target): "…un golfista de hándicap {handicap} típico obtiene aquí cerca de cero en cada categoría…" and "…lo que promedia un golfista de hándicap {handicap} típico (unos {typicalOverPar} golpes sobre par), no el par más el hándicap."

In `getStatExplainer`, when `infoKey === 'strokesGained'`, add `typicalOverPar: formatNumber(typicalScoreVsPar(targetHandicap ?? 0), { maxDecimals: 1 })` to `params` (import `typicalScoreVsPar` from `../../store/strokesGainedBaseline`; also pass `params` on the scratch branch so the scratch copy can use it if ever needed — keep "about 2" literal in the scratch text to avoid a param in a static string). Follow `docs/i18n.md` conventions. If D1 = B, drop the expected-score sentences from both languages.

- [ ] Run `npx jest src/components/mystats/__tests__/statExplainers.test.js src/components/mystats/__tests__/MyStatsSpanish.test.js src/i18n` → PASS. Commit: `git commit -m "docs(sg): explainer describes per-handicap calibrated baselines (en, es)"`

---

### Task 7: Docs — spec amendment and CLAUDE.md — **Haiku**

**Files:**
- Modify: `docs/superpowers/specs/2026-07-15-sg-coach-improvements-design.md` — append `## Amendment (2026-10-16): per-handicap baselines` summarising §0, §1.1, §1.3 decisions as taken, §1.4 follow-ups, and the generator workflow (`scripts/lib/sgBaselineModel.js` → `node scripts/sgBaselineTables.mjs` → paste → script test guards drift).
- Modify: `CLAUDE.md` → Architecture Notes, one bullet after the `src/engine/` note: "SG baselines (`store/strokesGainedBaseline.js`) are per-handicap, engine-consistent tables **generated** from the typical-golfer model in `scripts/lib/sgBaselineModel.js` (`node scripts/sgBaselineTables.mjs`); edit the model, regenerate, never hand-edit `BASELINES`; bump `SG_BASELINE_VERSION` when numbers move."
- Copy this plan to `docs/superpowers/plans/2026-10-16-sg-baselines-per-handicap.md`.

- [ ] Commit: `git commit -m "docs(sg): per-handicap baselines amendment, plan and CLAUDE note"`

---

### Task 8: Verification, PR, ship — **Sonnet** (review at top tier)

- [ ] `npm test` — all green (ignore `.worktrees/` copies). `npm run lint` — clean (the new `scripts/lib` file is CommonJS like its neighbours).
- [ ] **Before/after numeric probe** for the brief's 15-like round (the fixture in `sgCalibration.test.js`), `sgTotal(...).byCategory` per round — record both in the PR body:

  | target | before (master) | after |
  |---|---|---|
  | 0 | OTT −1.9 · app −4.2 · AG +0.8 · putt −9.0 · pen −1.0 | OTT −0.4 · app −1.4 · AG +3.3 · putt −10.4 · pen −0.5 |
  | 15 | OTT +0.8 · app −1.1 · AG +2.9 · putt −6.7 · pen +0.1 | OTT +1.5 · app +2.0 · AG +4.8 · putt −8.4 · pen +0.7 |
  | 30 | = 28 (clamped): OTT +5.2 · app +1.7 · AG +4.8 · putt −4.7 · pen +1.0 | OTT +3.3 · app +3.9 · AG +5.8 · putt −6.4 · pen +2.1 |
  | 40 | = 28 (clamped) | OTT +4.0 · app +4.8 · AG +6.3 · putt −5.3 · pen +3.1 |

  (This fixture 2-putts everything from 1-2 m on misses, hence the big putting loss — the point is the approach sign flip and that 30 ≠ 40.) Run `node scripts/sgBaselineTables.mjs --report` and paste the table too.
- [ ] **Dev verification through the UI** (`verify` skill, Expo web on the throwaway account — see memory `web-qa-login`): My Stats → Shots with target 30: Approach reads positive for a 15-like history; Coach tab: no spurious "Getting worse" on a committed focus (the rebased note shows if D3); "Where your strokes go": expected reads the typical score (e.g. 108.5 for target 30 on par 72) and the residual is small for typical rounds. Spanish locale: explainer renders the new paragraph.
- [ ] PR: `gh pr create --fill` on `fix/sg-per-handicap-baselines` → base `master`. Body answers **Why / What / How verified** (the probe table above, `npm test`, the UI check), notes decisions D1-D3 as taken, lists the §1.4 follow-ups, `Closes #N` if an issue exists. Review of Tasks 2-3 at the top tier before merge. `gh pr merge --squash --delete-branch`.
- [ ] **Deploy:** JS-only ⇒ OTA. Follow memory `ota-runtimes-split` (fingerprint:compare first), then `GOLF_ANDROID_BUILD_ARCHS=arm64-v8a npx eas-cli update --branch preview -m "fix(sg): per-handicap baselines"`. UAT check on the phone: Shots tab vs target 30 shows approach gains; focus card not spuriously red.

---

## Impact map (what moves, what needs code)

| Consumer | Effect | Action |
|---|---|---|
| `statsEngine.js` sgApproach / sgAroundGreen / sgPutting / sgPenalties / puttingTargetGaps / approachTargetGaps / sgVsGroup / sgSeason | numbers shift; formulas unchanged | none beyond Task 3 |
| `sgOffTheTee` | benchmark node | Task 3a |
| `sgReconciliation` | expected score | Task 3b (D1) |
| `personalStats.js` `computeSgFormDelta`, `strokesGained.personalDelta` | recent vs previous both recomputed with the new tables — consistent; no stored snapshots | tests only (Task 4) |
| `coachInsights.js` `strokesGainedCategoryInsights` | reads `byCategory`, gate `|v| < 0.05`; insights re-rank naturally | none |
| `coachStrategy.js` club-down rule (`teeSg <= -0.3` with trouble rate ≥ 25 %) | OTT now ≈ 0 for a typical player and negative mostly for real trouble — the rule fires more precisely | none |
| `coachFocus.js` | stored `baselineImpact` snapshot goes stale | Task 5 |
| `SGTrendCard` (`perRound` totals), `ShotDashboard` bars, `PerformanceSnapshot`, `OverviewTab` | recomputed each render; no fixed scale assumptions | none |
| `SGReconciliationCard` | `expectedAvg` value changes (D1); labels unchanged | none (copy covered in Task 6) |
| `statExplainers` + `locales/{en,es}/statExplainers.js` | copy must describe the new baselines | Task 6 |
| `TargetHandicapPicker` / `ProfileScreen` | cap 36 unchanged; tables reach 54 | none (D4 optional) |
| `shotBenchmarks.js` (Shots-tab target rows) | unchanged; the same Shot Scope rows now also anchor the SG tables | none |
| Stored data / Supabase | nothing persisted depends on baselines (device-local focus handled in Task 5) | none |

## Risks

- **Model is a model.** Anchors above 25 are hand-extrapolated; green-hit-by-distance for rough/sand is scaled, not measured. Mitigation: all parameters are in one cited file, the script test pins the published anchors, and the calibration test pins the behaviour (typical ≈ 0, monotone, no clamp).
- **Engine-visible ≠ real.** A typical 15 "loses" −10.4 engine-visible strokes to scratch where Arccos sees −14.2; the rest lives in the residual. The explainer says so; follow-ups (a)-(c) in §1.4 would move those strokes into categories.
- **Every SG number on every screen changes.** Communicated in the PR; committed focuses rebase (Task 5); no persisted SG values elsewhere.
- **Scratch expected score = 74** on a par 72 (D1 = A) may surprise; the explainer sentence covers it.

---

## Appendix A — generator code and generated literal

Reference copies (this session): `/private/tmp/claude-501/-Users-marcospecker-Projects-golf-partner/fc5f9cc9-7f57-40a9-b0a1-58218ac79d6a/scratchpad/final/scripts/lib/sgBaselineModel.js`, `…/scratchpad/final/scripts/sgBaselineTables.mjs`, `…/scratchpad/final/BASELINES.literal.js`. Verified: `node sgBaselineTables.mjs` reproduces A.3; the real engine with these tables reproduces §1.2.

### A.1 `scripts/lib/sgBaselineModel.js`

```js
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
```

### A.2 `scripts/sgBaselineTables.mjs`

```js
#!/usr/bin/env node
// Prints the per-handicap strokes-gained baseline tables as the JS literal
// pasted into src/store/strokesGainedBaseline.js (BASELINES). Re-run after
// changing scripts/lib/sgBaselineModel.js; scripts/__tests__/sgBaselineModel.test.js
// fails if the committed literal drifts from the model.
//
//   node scripts/sgBaselineTables.mjs            # the BASELINES literal
//   node scripts/sgBaselineTables.mjs --report   # calibration report per anchor
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  HANDICAP_ANCHORS, buildTables, lookup, model, DRIVE_DISTANCE_ANCHORS, DRIVE_MIX_ANCHORS,
  PENALTIES_ANCHORS, SCORE_VS_PAR_ANCHORS,
} = require('./lib/sgBaselineModel.js');

const tables = buildTables();

if (process.argv.includes('--report')) {
  const Ex = (lie, h, d) => lookup(tables[lie].distances, tables[lie].byHandicap[h], d);
  const rows = HANDICAP_ANCHORS.map((h, i) => {
    const w = { fairway: DRIVE_MIX_ANCHORS.fairway[i], sand: DRIVE_MIX_ANCHORS.sand[i], recovery: DRIVE_MIX_ANCHORS.recovery[i] };
    w.rough = 1 - w.fairway - w.sand - w.recovery;
    const mix = (d) => Object.entries(w).reduce((s, [lie, p]) => s + p * Ex(lie, h, d), 0);
    const par3 = Ex('tee', h, 160);
    const par4 = 1 + mix(340 - DRIVE_DISTANCE_ANCHORS[i]);
    const par5 = 1 + mix(470 - DRIVE_DISTANCE_ANCHORS[i]);
    const visible = 4 * par3 + 10 * par4 + 4 * par5 - 72 + PENALTIES_ANCHORS[i];
    return {
      hcp: h,
      par3: +par3.toFixed(2), par4: +par4.toFixed(2), par5: +par5.toFixed(2),
      visibleVsPar: +visible.toFixed(1), typicalVsPar: SCORE_VS_PAR_ANCHORS[i],
      invisible: +(SCORE_VS_PAR_ANCHORS[i] - visible).toFixed(1),
      'fw 100 m': Ex('fairway', h, 100), 'fw 137 m': +Ex('fairway', h, 137.2).toFixed(2),
      'rough 91 m': +Ex('rough', h, 91.4).toFixed(2), 'greenside 20': Ex('greenside', h, 20),
      'sand 20': Ex('sand', h, 20), 'green 1.5': +Ex('green', h, 1.5).toFixed(2), 'green 4.5': +Ex('green', h, 4.5).toFixed(2),
    };
  });
  console.table(rows);
  process.exit(0);
}

const lines = ['export const BASELINES = {'];
Object.entries(tables).forEach(([lie, { distances, byHandicap }]) => {
  lines.push(`  ${lie}: {`);
  lines.push(`    distances: [${distances.join(', ')}],`);
  lines.push('    byHandicap: {');
  HANDICAP_ANCHORS.forEach((h) => {
    lines.push(`      ${h}: [${byHandicap[h].map((v) => v.toFixed(2)).join(', ')}],`);
  });
  lines.push('    },');
  lines.push('  },');
});
lines.push('};');
console.log(lines.join('\n'));
```

### A.3 `BASELINES` literal (output of `node scripts/sgBaselineTables.mjs`)

```js
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
```

## Appendix B — replacement values for pinned tests (`src/store/__tests__/statsEngine.test.js`)

Scratch unless stated. New table reads: `E(green, 0.5 → clamps 0.91) = 1.05`, `E(green, 1.5) = 1.230`, `E(green, 2.5) = 1.506`, `E(green, 4.5) = 1.812`, `E(green, 9) = 2.005`, `E(fairway, 25) = 2.69`, `E(fairway, 75) = 2.97`, `E(fairway, 125) = 3.13`, `E(rough, 125) = 3.26`, `E(sand, 125) → clamps to 91.4 row = 3.32`, `E(tee, 125) = 3.15`, `E(greenside, 20) = 2.50`, `E(sand, 20) = 2.65`, `E(fairway, 115) = 3.098`, `E(rough, 145) = 3.292`, `E(recovery, 175) = 4.179`, `E(fairway, 215) = 3.365`, `E(typicalDrive, 110) = 3.193`, `E(typicalDrive, 240) = 3.593`; at 14: `E(green, 4.5) = 1.899`, `E(green, 9) = 2.115`, `E(fairway, 125) = 3.514`, `E(fairway, 230) = 3.718`, `E(greenside, 20) = 2.734`, `E(typicalDrive, 135) = 3.659`, `E(fairway, 115) = 3.480`. `benchmarkDriveDistance`: 0 → 230, 7 → 218.4, 14 → 206.6, 28 → 183.2, 50 → 154.9. `expectedPenaltiesPerRound`: 0 → 0.5, 14 → 1.62, 25 → 2.6, 50 → 5.1.

| describe / test | old | new | maths |
|---|---|---|---|
| sgAroundGreen · sand save from 0-1 | 0.53 | **0.60** | 2.65 − 1.05 − 1 |
| sgAroundGreen · non-sand greenside, 2-putt from 2-3 | −0.20 | **−0.01** | 2.50 − 1.506 − 1 |
| sgApproach · par-3 100-150, 2 putts 3-6 | 0.05 | **0.34** | 3.15 − 1.812 − 1 |
| sgApproach · GIR from 100-150 | 0.06 | **0.32** | 3.13 − 1.812 − 1 |
| sgApproach · explicit green from 50-100 | −0.11 | **+0.16** | 2.97 − 1.812 − 1 |
| sgApproach · missed green → greenside node | −0.52 | **−0.37** | 3.13 − 2.50 − 1 |
| sgApproach · bunker miss (relative test; value for the comment) | — | **−0.52** | 3.13 − 2.65 − 1 |
| sgApproach with approachLie · fairway / null (both tests) | 0.06 | **0.32** | |
| sgApproach with approachLie · rough | 0.24 | **0.45** | 3.26 − 1.812 − 1 |
| sgApproach with approachLie · sand (clamped at 91.4 m) | 0.43 | **0.51** | 3.32 − 1.812 − 1 |
| sgApproach with approachLie · trouble drive → fairway default; explicit fairway beats default | 0.06 | **0.32** | |
| sgPutting · 2-putt from 2-3 | −0.39 | **−0.49** | 1.506 − 2 |
| sgPenalties · subtracts all logged penalties (scratch) | −3 / total −3 | **−2.972** (`toBeCloseTo(-3 + 0.5/18, 3)`) | 0.5/18 − 3 |
| sgPenalties · penalty-free holes | `[-1, 0, null]`, total −1 | **`[0.5/18 − 1, 0.5/18, null]`**, total **−0.944** (toBeCloseTo) | |
| sgTotal · includes other penalties | penalties −1 | **0.5/18 − 1** (toBeCloseTo) | |
| sgTotal with offTheTee · rough 180-210 | −0.32 | **−0.10** | 3.193 − 3.292 |
| sgSeason with offTheTee · fairway 210-240 × 18 | 18 × −0.0131 | **18 × 0.095 = 1.71** | 3.193 − 3.098 |
| sgPutting/sgAroundGreen/sgApproach/sgTotal/sgSeason "with targetHandicap" (14 > 0 inequalities) | — | unchanged | |
| puttingTargetGaps (target 14) · 3-6 | expectedPutts 1.95, sgPerPutt −0.05 | **1.90, −0.10** | E14(green, 4.5) |
| puttingTargetGaps (target 14) · 6+ | 2.19, −0.81 | **2.11, −0.89** | E14(green, 9) |
| approachTargetGaps · par-3 tee baseline | avgSg 0.05 | **0.34** | |
| approachTargetGaps (target 14) · 100-150 | 0.31 | **0.62** | 3.514 − 1.899 − 1 |
| approachTargetGaps (target 14) · 200+ miss | 0.43 | **−0.02** | 3.718 − 2.734 − 1 (comment: a 230 m miss to a greenside lie is about par for a 14) |
| approachTargetGaps · explicit green 50-100 | −0.11 | **+0.16** | |
| approachTargetGaps you-vs-target | 2.89 / 2.82 | **3.13 / 2.81** | |
| sgOffTheTee · fairway 210-240 (rename: "a 225 m fairway drive beats the typical scratch tee shot") | −0.01 | **+0.10** (`toBeCloseTo(0.095, 2)`) | 3.193 − 3.098 |
| sgOffTheTee · rough 180-210 (both tests) | −0.32 | **−0.10** (`-0.099`) | 3.193 − 3.292 |
| sgOffTheTee · trouble 150-180 | −0.68 | **−0.99** (`-0.986`) | 3.193 − 4.179 |
| sgOffTheTee · par 5 240+ | 0.20 | **+0.23** (`0.228`) | 3.593 − 3.365 |
| sgOffTheTee · same drive vs 14 | 0.13 | **+0.18** (`0.176`) | 3.659 − 3.480 |
| sgPenalties vs target · scratch clean 18 | 0 | **0.5** | |
| sgPenalties vs target · clean 18 at 14 / 25 | 1.0 / 25/14 | **1.62 / 2.6** | |
| sgPenalties vs target · per-hole at 14 | 1/18 − 2, 1/18 | **1.62/18 − 2, 1.62/18** | |
| sgPenalties vs target · sgTotal threads | 1/18 − 1; scratch −1 | **1.62/18 − 1; scratch 0.5/18 − 1** | |
| sgReconciliation (D1 = A) · expected one par-4 hole, H = 0 | 4 | **4 + 2.0/18 = 4.111**, gap **−0.889** | |
| sgReconciliation (D1 = A) · one hole, H = 18 | 5, gap 1 | **4 + 21.28/18 = 5.182**, gap **1.182** | typicalScoreVsPar(18) = 18.4 + 0.6·4.8 |
| personalStats · computeSgFormDelta (Task 4) | −7.02 / 10.98 / 18.0 | **−8.90 / 9.10 / 18.0** | 18 × (1.506 − 2), 18 × (1.506 − 1) |
| strokesGainedBaseline.test.js | — | rewritten in Task 2 | |

## Appendix C — sources

- Broadie, M. (2012) "Assessing Golfer Performance on the PGA TOUR", *Interfaces* 42(2): Table B.1 tour expected strokes (fairway 100 yd 2.80, 150 yd 2.98; recovery 50 yd 3.79), tour one-putt 50 % from 8 ft vs 90-golfer 5 ft, two putts from 33 ft vs 19 ft, 90-golfer 2.3 three-putts/round, drive 290 vs 210 yd. https://business.columbia.edu/sites/default/files-efs/pubfiles/4996/assessing_golfer_performance.full.pdf
- Broadie, *Every Shot Counts* (2014), via summaries: short-game proximity pro 6 ft vs 90-golfer 10 ft from 15-25 yd; 80/90/100-golfer three-putts ≈ 1/2/3 per round.
- Shot Scope via MyGolfSpy: "Putting Make Percentage By Handicap (Full Chart)" (0-3 / 3-6 / 6-9 / 9-12 / 12-18 / 18-24 ft by handicap); "How Good Is Your Short Game?" (up & down 54/47/39/34/31/25 %, sand save 37/23/20/18/15/10 %, chips < 25 yd 10/13/15 ft); "Greenside Bunker Play" (12.5 ft vs 17.7 ft); "100 Yards Feels Like A Scoring Shot…" (100 yd scratch 70 % / 31 ft, 10 hcp 49 % / 49 ft; 150 yd 55 % / 44 ft, 30 % / 72 ft); "The Secret Weapon Every Tour Pro Uses" (Arccos: 11-15 hcp lose 5.67 approach / 3.63 tee / 2.93 short game / 1.99 putting per round to scratch; 1.66 penalties/round; 15 hcp hit 28 % of greens, scratch 51 %).
- Shot Scope via GolfLink "Why 150 to 200 Yards Costs 15-Handicappers So Many Shots" (150-175 yd: 5 hcp 34 % / 71 ft, 15 hcp 19 % / 106 ft; 175-200 yd: 23 % / 101 ft, 11 % / 145 ft); National Club Golfer, Augusta 16th (170 yd: scratch 43 % / 50 ft, 10 hcp 25 % / 82 ft).
- Arccos "5 Arccos Stats to Tame Your Golf Expectations": 10 hcp from 100 yd fairway 3.38 strokes, rough 3.5; 10 hcp driver 226.6 yd; 25 % of 10-hcp rounds have ≥ 3 penalties.
- Shot Scope rows already in `src/store/shotBenchmarks.js` (GIR, putts, 3-putts, driver, fairway %, tee-penalty %, score vs par by handicap).
- Where approximated: green-hit % at 25-75 m and ≥ 200 m, all rough/sand multipliers, proximity spreads, bunker share of misses, the drive lie mix, penalties outside the 11-15 band, and every anchor above 25.
