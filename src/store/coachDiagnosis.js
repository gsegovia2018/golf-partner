// Coach diagnosis, step 1 (coach v2 spec §3.1): one ranked list of leaks in
// one currency — strokes per round vs the target handicap (≈ Stableford
// points) — with a sample-and-variance confidence. Pure: input is
// computeMyStats output.
//
// Leaks live in a tree. Only the five SG categories are ranked; inside
// putting and approach the distance buckets are children that say *where*
// the loss sits (the worst one becomes the leak's `bucket`), so a category,
// its worst bucket and a related trend can never appear as three leaks.
// Tee club / lie / direction, sand vs grass and tee vs other penalties are
// evidence only.

import { SG_CATEGORIES, PUTT_BUCKETS, APPROACH_BUCKETS } from './coachMetrics';

export const LEAK_MIN = 0.4;              // strokes/round; above −LEAK_MIN nothing is "Fix first"
export const TIE_MIN = 0.3;               // top two within max(TIE_MIN, se₁ + se₂) are a tie
export const CATEGORY_MIN_HOLES = 10;
export const CATEGORY_MIN_ROUNDS = 3;
export const BUCKET_MIN_SHOTS = 8;
export const SE_HIGH = 2;                 // |mean| ≥ 2·se → high
export const SE_MEDIUM = 1;               // |mean| ≥ 1·se → medium, else low
// Strokes/round are compared on this grid before the tiebreaks, so two leaks
// that read the same in copy ("1.4 strokes") fall to confidence, then to
// how cheap the area is to move.
export const ORDER_STEP = 0.1;
// Cheaper to move first.
export const TRAINABILITY = ['putting', 'aroundGreen', 'approach', 'penalties', 'offTheTee'];

const CONFIDENCE_RANK = { high: 0, medium: 1, low: 2, insufficient: 3 };
const BUCKETED = {
  putting: {
    buckets: PUTT_BUCKETS,
    source: (stats) => stats?.puttingTarget?.buckets,
    shots: (b) => b.attempts ?? 0,
    perShot: (b) => b.sgPerPutt,
    evidence: (b) => ({
      avgPutts: b.avgPutts ?? null, expectedPutts: b.expectedPutts ?? null, threePuttRate: b.threePuttRate ?? null,
    }),
  },
  approach: {
    buckets: APPROACH_BUCKETS,
    source: (stats) => stats?.approachTarget?.buckets,
    shots: (b) => b.holes ?? 0,
    perShot: (b) => b.avgSg,
    evidence: (b) => ({
      greenRate: b.greenRate ?? null, girRate: b.girRate ?? null,
      targetStrokes: b.targetStrokes ?? null, yourStrokes: b.yourStrokes ?? null,
    }),
  },
};

function meanSe(values) {
  const count = values.length;
  if (count === 0) return { mean: null, se: null, count };
  const mean = values.reduce((a, x) => a + x, 0) / count;
  if (count < 2) return { mean, se: null, count };
  const variance = values.reduce((a, x) => a + (x - mean) ** 2, 0) / (count - 1);
  return { mean, se: Math.sqrt(variance) / Math.sqrt(count), count };
}

// Confidence of a sufficient sample: how many standard errors the mean sits
// from zero.
export function confidenceOf(mean, se) {
  if (!Number.isFinite(mean) || !Number.isFinite(se)) return 'low';
  const size = Math.abs(mean);
  if (size >= SE_HIGH * se) return 'high';
  if (size >= SE_MEDIUM * se) return 'medium';
  return 'low';
}

// The category's per-round SG over the rounds that sampled it.
function categorySeries(stats, category) {
  const values = [];
  let holes = 0;
  (stats?.strokesGained?.perRound ?? []).forEach((r) => {
    const sampled = r?.sampleHolesByCategory?.[category] ?? 0;
    const value = r?.byCategory?.[category];
    if (sampled <= 0 || !Number.isFinite(value)) return;
    values.push(value);
    holes += sampled;
  });
  return { values, holes };
}

function bucketChildren(stats, category, rounds) {
  const spec = BUCKETED[category];
  if (!spec) return [];
  const source = spec.source(stats) ?? {};
  return spec.buckets.map((bucket) => {
    const b = source[bucket];
    const shots = b ? spec.shots(b) : 0;
    const perShotSg = (b?.breakdown ?? []).map((e) => e?.sg).filter(Number.isFinite);
    const fromShots = meanSe(perShotSg);
    // The breakdown carries the unrounded per-shot SG; the summary is the fallback.
    const summary = b ? spec.perShot(b) : null;
    const fallback = Number.isFinite(summary) ? summary : null;
    const perShot = fromShots.count > 0 ? fromShots.mean : fallback;
    const scale = rounds > 0 && perShot != null ? shots / rounds : null;
    const strokesPerRound = scale != null ? perShot * scale : null;
    const se = scale != null && fromShots.se != null ? fromShots.se * scale : null;
    const confidence = shots < BUCKET_MIN_SHOTS || strokesPerRound == null
      ? 'insufficient'
      : confidenceOf(perShot, fromShots.se);
    return {
      bucket,
      strokesPerRound,
      perShot,
      se,
      sample: { shots },
      confidence,
      metricKey: `sg.${category}.bucket.${bucket}`,
      evidence: b ? spec.evidence(b) : {},
    };
  });
}

const compactDrive = (d) => ({ holes: d?.holes ?? 0, avgPoints: d?.avgPoints ?? null, penaltyRate: d?.penaltyRate ?? null });

// Evidence-only numbers per category (spec §3.1 tree): explain, never ranked.
function categoryEvidence(stats, category) {
  switch (category) {
    case 'offTheTee': {
      const drive = stats?.driveImpact?.buckets ?? {};
      return {
        byClub: stats?.teeClubAccuracy?.byClub ?? null,
        lies: stats?.driveLies ?? null,
        directions: {
          fairway: compactDrive(drive.fairway), super: compactDrive(drive.super),
          left: compactDrive(drive.left), right: compactDrive(drive.right), short: compactDrive(drive.short),
        },
      };
    }
    case 'aroundGreen':
      return {
        upAndDown: stats?.upAndDown?.byLie ?? null,
        sandSaves: stats?.sandSaves
          ? { attempts: stats.sandSaves.attempts, saves: stats.sandSaves.saves, rate: stats.sandSaves.rate }
          : null,
      };
    case 'penalties':
      return {
        tee: stats?.shots?.penalties?.tee ?? null,
        other: stats?.shots?.penalties?.other ?? null,
        rounds: stats?.shots?.roundsWithData ?? 0,
      };
    case 'putting':
      return {
        puttsPer18: stats?.shots?.putts?.per18 ?? null,
        threePuttsPer18: stats?.shots?.putts?.threePuttPer18 ?? null,
      };
    case 'approach':
      return {
        attempts: stats?.approachTendency?.attempts ?? 0,
        greenRate: stats?.approachTendency?.greenRate ?? null,
      };
    default:
      return {};
  }
}

function worstChild(children) {
  let worst = null;
  children.forEach((c) => {
    if (c.confidence === 'insufficient' || !(c.strokesPerRound < 0)) return;
    if (!worst || c.strokesPerRound < worst.strokesPerRound) worst = c;
  });
  return worst;
}

function assessCategory(stats, category) {
  const { values, holes } = categorySeries(stats, category);
  const { mean, se, count: rounds } = meanSe(values);
  const sufficient = holes >= CATEGORY_MIN_HOLES && rounds >= CATEGORY_MIN_ROUNDS;
  const children = bucketChildren(stats, category, rounds);
  const worst = worstChild(children);
  const bucket = worst ? worst.bucket : null;
  return {
    id: bucket ? `leak:${category}:${bucket}` : `leak:${category}`,
    category,
    bucket,
    strokesPerRound: mean,
    se,
    sample: { rounds, holes },
    confidence: sufficient ? confidenceOf(mean, se) : 'insufficient',
    needs: sufficient ? null : {
      holes: Math.max(0, CATEGORY_MIN_HOLES - holes),
      rounds: Math.max(0, CATEGORY_MIN_ROUNDS - rounds),
    },
    metricKey: `sg.${category}`,
    children,
    evidence: categoryEvidence(stats, category),
    benchmark: { targetHandicap: stats?.targetHandicap ?? null },
  };
}

const onGrid = (x) => Math.round(x / ORDER_STEP);

// Most negative first; then confidence; then trainability. Total and
// deterministic: the last key is unique per category.
export function compareLeaks(a, b) {
  const byStrokes = onGrid(a.strokesPerRound) - onGrid(b.strokesPerRound);
  if (byStrokes !== 0) return byStrokes;
  const byConfidence = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
  if (byConfidence !== 0) return byConfidence;
  return TRAINABILITY.indexOf(a.category) - TRAINABILITY.indexOf(b.category);
}

export function tieBand(a, b) {
  return Math.max(TIE_MIN, (a?.se ?? 0) + (b?.se ?? 0));
}

// The untracked residual of the score gap (duffs, second chips, far misses)
// when it is a real leak (≤ −LEAK_MIN) and bigger than the top leak: the
// category chain then explains the minority of the gap, and the card says so.
// → { residual, gap } (strokes a round, negative = worse) | null
export function untrackedDominant(stats, top) {
  const r = stats?.strokesGained?.reconciliation;
  if (!top || !(r?.rounds > 0) || r.residualAvg == null || r.gapAvg == null) return null;
  if (r.residualAvg > -LEAK_MIN || Math.abs(r.residualAvg) <= Math.abs(top.strokesPerRound)) return null;
  return { residual: r.residualAvg, gap: r.gapAvg };
}

// → { leaks, top, tie, candidate, insufficient, categories, targetHandicap }
//   leaks        ranked leaks (strokesPerRound ≤ −LEAK_MIN, confidence ≥ low)
//   top          leaks[0] or null
//   tie          leaks[1] when it is within tieBand of the top, else null
//   candidate    no leaks: the most negative sufficient category below zero
//                ("nothing clearly costs you yet; the biggest candidate is …")
//   insufficient categories with some sample but under the gates, each with
//                `needs` — rendered as "needs N more holes/rounds", never ranked
//   categories   all five assessments, SG category order
export function buildDiagnosis(stats) {
  const categories = SG_CATEGORIES.map((c) => assessCategory(stats, c));
  const sufficient = categories.filter((l) => l.confidence !== 'insufficient');
  const leaks = sufficient
    .filter((l) => l.strokesPerRound <= -LEAK_MIN)
    .sort(compareLeaks);
  const top = leaks[0] ?? null;
  const second = leaks[1] ?? null;
  const tie = top && second
    && Math.abs(top.strokesPerRound - second.strokesPerRound) <= tieBand(top, second)
    ? second
    : null;
  const candidate = top
    ? null
    : (sufficient.filter((l) => l.strokesPerRound < 0).sort(compareLeaks)[0] ?? null);
  const insufficient = categories.filter((l) => l.confidence === 'insufficient' && l.sample.holes > 0);
  return {
    leaks,
    top,
    tie,
    candidate,
    insufficient,
    categories,
    targetHandicap: stats?.targetHandicap ?? null,
  };
}
