// Coach cause rules (coach v2 spec §3.2, with the §12 decisions). For one
// ranked leak, a table of pattern rules over the logged data says what most
// likely drives it. Each rule has its own minimum sample, a strength, and a
// language-neutral message descriptor (docs/i18n.md "Pure store modules").
//
// causesForLeak(leak, stats) → { primary, alsoPossible[] }
//   primary       the strongest cause, or null when no rule fires
//   alsoPossible  every other cause that fired, strongest first
//
// Cause { id, leakId, strength, lead, evidence, benchmark, metricKey, sample, msg }
//   strength   'likely' | 'consistent' | 'possible'
//   lead       descriptor for the honest-wording lead-in ("Most of this comes
//              from" / "This is consistent with" / "One possibility:"); the
//              screen renders lead + msg
//   evidence   the numbers behind the sentence
//   benchmark  null when the sentence has no comparison, else
//              { source: 'target' | 'own', ... }. One benchmark per cause:
//              the Why sentence cites it (§12 edge 4); the verdict metric's
//              own benchmark is the Check step's business.
//   metricKey  coachMetrics key the verdict re-reads
//   sample     size of the evidence behind it (tie-break between equal strengths)
//   msg        the evidence sentence. With a benchmark its key ends in
//              `.bench`; without one the sibling key carries no comparison.
//
// Pure: no language, no clock, no I/O.

import { msg, n, lower } from './statsMsg';
import { readMetric } from './coachMetrics';
import { SHOT_HANDICAP_BENCHMARKS, shotBenchmarkForHandicap } from './shotBenchmarks';
import {
  benchmarkDriveDistance, expectedPenaltiesPerRound, expectedStrokes,
} from './strokesGainedBaseline';

export const STRENGTHS = ['likely', 'consistent', 'possible'];

// Minimum samples and trigger thresholds, in one place so tests pin them.
export const CAUSE_MIN = {
  puttBucketShots: 10,
  lagThreePuttPct: 25,
  lagLikelyPct: 35,
  shortLikelySg: -0.15,
  generalPuttHoles: 36,
  generalPuttsOver: 1,
  generalThreePuttsOver: 0.8,
  approachMisses: 8,
  approachDirectionPct: 50,
  approachLikelyPct: 70,
  approachBunkerPct: 30,
  approachBunkerLikelyPct: 40,
  approachSandAttempts: 4,
  approachSandRateMax: 0.4,
  approachCostHoles: 3,
  teeDrives: 15,
  teeTroubleRatePct: 25,
  teeDriverPenaltyPct: 10,
  teeSideMisses: 10,
  teeSideRatio: 2,
  teeSideLikelyRatio: 3,
  teeDistanceGap: 20,
  teeDistanceConsistentGap: 35,
  teeCostHoles: 3,
  upDownAttempts: 6,
  sandGap: 0.2,
  sandLikelyGap: 0.3,
  chipGap: 0.1,
  chipConsistentGap: 0.2,
  penaltiesTotal: 4,
  penaltyTeeRatio: 2,
  penaltyTeeLikelyRatio: 3,
};

const finite = (v) => Number.isFinite(v);
const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;
const dec1 = (v) => n(round1(v), { decimals: 1 });

// A benchmark sentence names the target handicap; at 0 it says "scratch"
// instead, through the key's `.scratch` sibling (no `hcp` param).
function benchMsg(ctx, key, params) {
  if (ctx.target !== 0) return msg(key, params);
  const { hcp, ...rest } = params; // eslint-disable-line no-unused-vars
  return msg(`${key}.scratch`, rest);
}
const rankOf = (strength) => STRENGTHS.indexOf(strength);
const lowerSide = (side) => lower(msg(`stats.my.fan.${side}`));
const KEY = 'stats.my.coach.cause.';

const LAST_BENCHMARK_HANDICAP = SHOT_HANDICAP_BENCHMARKS[SHOT_HANDICAP_BENCHMARKS.length - 1].handicap;

// Shot Scope row for the target handicap; none beyond the last published row.
function benchmarkRow(target) {
  if (!finite(target) || target > LAST_BENCHMARK_HANDICAP) return null;
  return shotBenchmarkForHandicap(target);
}

// Approximate greenside up-and-down rate a target handicap converts: the
// greenside expected strokes at 20 m, taking a miss as 3.3 strokes (chip plus
// two putts). Derived from the same SG table the around-the-green category
// uses, so the expectation and the leak agree on the target.
export function expectedUpAndDown(target) {
  const e = expectedStrokes('greenside', 20, target);
  if (!finite(e)) return null;
  return Math.min(1, Math.max(0, (3.3 - e) / 1.3));
}

function makeCause(leak, id, strength, fields) {
  return {
    id,
    leakId: leak.id,
    strength,
    lead: msg(`${KEY}lead.${strength}`),
    evidence: fields.evidence,
    benchmark: fields.benchmark ?? null,
    metricKey: fields.metricKey,
    sample: fields.sample,
    msg: fields.msg,
  };
}

// ── Putting ──────────────────────────────────────────────────────────────

const LAG_BUCKETS = ['3-6', '6+'];
const SHORT_BUCKETS = ['0-1', '1-2', '2-3'];

function puttBucketFacts(leak, stats, buckets) {
  const b = leak.bucket;
  if (!buckets.includes(b)) return null;
  const sg = readMetric(`sg.putting.bucket.${b}`, stats);
  if (!sg || !(sg.sample.shots >= CAUSE_MIN.puttBucketShots) || !(sg.value < 0)) return null;
  const row = stats?.puttingTarget?.buckets?.[b] ?? {};
  return { bucket: b, sg: sg.value, attempts: sg.sample.shots, row };
}

function lagRule(leak, stats, ctx) {
  const facts = puttBucketFacts(leak, stats, LAG_BUCKETS);
  if (!facts) return null;
  const { bucket, attempts, row } = facts;
  const rate = readMetric(`putting.threePuttRate.${bucket}`, stats)?.value;
  if (!(rate >= CAUSE_MIN.lagThreePuttPct)) return null;
  const count = Math.round((rate * attempts) / 100);
  const strength = rate >= CAUSE_MIN.lagLikelyPct ? 'likely' : 'consistent';
  const hasBench = finite(ctx.target) && finite(row.expectedPutts);
  const params = {
    bucket, avgPutts: dec1(row.avgPutts ?? 0), pct: rate, count, total: attempts,
  };
  return makeCause(leak, 'cause:putting:lag', strength, {
    evidence: {
      bucket, attempts, threePuttRate: rate, threePutts: count, avgPutts: row.avgPutts ?? null, sgPerPutt: facts.sg,
    },
    benchmark: hasBench ? { source: 'target', targetHandicap: ctx.target, expectedPutts: row.expectedPutts } : null,
    metricKey: `putting.threePuttRate.${bucket}`,
    sample: attempts,
    msg: hasBench
      ? benchMsg(ctx, `${KEY}putting.lag.bench`, { ...params, expected: dec1(row.expectedPutts), hcp: n(ctx.target) })
      : msg(`${KEY}putting.lag`, params),
  });
}

function shortPuttRule(leak, stats, ctx) {
  const facts = puttBucketFacts(leak, stats, SHORT_BUCKETS);
  if (!facts) return null;
  const { bucket, attempts, row } = facts;
  const strength = facts.sg <= CAUSE_MIN.shortLikelySg ? 'likely' : 'consistent';
  const hasBench = finite(ctx.target) && finite(row.expectedPutts);
  const params = { bucket, avgPutts: dec1(row.avgPutts ?? 0), total: attempts };
  return makeCause(leak, 'cause:putting:short', strength, {
    evidence: { bucket, attempts, sgPerPutt: facts.sg, avgPutts: row.avgPutts ?? null },
    benchmark: hasBench ? { source: 'target', targetHandicap: ctx.target, expectedPutts: row.expectedPutts } : null,
    metricKey: `sg.putting.bucket.${bucket}`,
    sample: attempts,
    msg: hasBench
      ? benchMsg(ctx, `${KEY}putting.short.bench`, { ...params, expected: dec1(row.expectedPutts), hcp: n(ctx.target) })
      : msg(`${KEY}putting.short`, params),
  });
}

function generalPuttingRule(leak, stats, ctx) {
  if (!ctx.bench) return null;
  const putts = readMetric('putting.per18', stats);
  const threes = readMetric('putting.threePuttsPer18', stats);
  if (!putts || !(putts.sample.holes >= CAUSE_MIN.generalPuttHoles)) return null;
  const puttsOver = putts.value >= ctx.bench.puttsPerRound + CAUSE_MIN.generalPuttsOver;
  const threesOver = finite(threes?.value)
    && threes.value >= ctx.bench.threePuttsPerRound + CAUSE_MIN.generalThreePuttsOver;
  if (!puttsOver && !threesOver) return null;
  return makeCause(leak, 'cause:putting:general', 'possible', {
    evidence: { per18: putts.value, threePuttsPer18: threes?.value ?? null, holes: putts.sample.holes },
    benchmark: {
      source: 'target',
      targetHandicap: ctx.target,
      puttsPerRound: ctx.bench.puttsPerRound,
      threePuttsPerRound: ctx.bench.threePuttsPerRound,
    },
    metricKey: puttsOver ? 'putting.per18' : 'putting.threePuttsPer18',
    sample: putts.sample.holes,
    msg: benchMsg(ctx, `${KEY}putting.general.bench`, {
      per18: dec1(putts.value),
      benchPer18: dec1(ctx.bench.puttsPerRound),
      threePutts: dec1(threes?.value ?? 0),
      benchThreePutts: dec1(ctx.bench.threePuttsPerRound),
      hcp: n(ctx.target),
    }),
  });
}

// ── Approach (the leak's own bucket) ─────────────────────────────────────

function approachFacts(leak, stats) {
  const bucket = leak.bucket;
  const row = bucket ? stats?.approachMissByDistance?.buckets?.[bucket] : null;
  if (!row || !(row.misses >= CAUSE_MIN.approachMisses)) return null;
  return {
    bucket,
    row,
    known: row.directionKnown ?? 0,
    missPct: row.missRate ?? null,
  };
}

function approachShortRule(leak, stats) {
  const f = approachFacts(leak, stats);
  if (!f) return null;
  const rate = readMetric(`approach.shortRate.${f.bucket}`, stats)?.value;
  if (!(rate >= CAUSE_MIN.approachDirectionPct)) return null;
  const count = Math.round((rate * f.known) / 100);
  return makeCause(leak, 'cause:approach:short', rate >= CAUSE_MIN.approachLikelyPct ? 'likely' : 'consistent', {
    evidence: {
      bucket: f.bucket, misses: f.row.misses, directionKnown: f.known, shortRate: rate, shortCount: count, missRate: f.missPct,
    },
    metricKey: `approach.shortRate.${f.bucket}`,
    sample: f.row.misses,
    msg: msg(`${KEY}approach.short`, {
      bucket: f.bucket, missPct: f.missPct ?? 0, pct: rate, count, total: f.known,
    }),
  });
}

function approachSideRule(leak, stats) {
  const f = approachFacts(leak, stats);
  if (!f) return null;
  const left = readMetric(`approach.leftRate.${f.bucket}`, stats)?.value ?? 0;
  const right = readMetric(`approach.rightRate.${f.bucket}`, stats)?.value ?? 0;
  const side = right > left ? 'right' : 'left';
  const rate = side === 'left' ? left : right;
  if (!(rate >= CAUSE_MIN.approachDirectionPct)) return null;
  const count = Math.round((rate * f.known) / 100);
  const finish = stats?.approachMissCost?.byFinish ?? {};
  const green = finish.green;
  const cost = finish[side];
  const hasCost = green?.holes >= CAUSE_MIN.approachCostHoles && cost?.holes >= CAUSE_MIN.approachCostHoles
    && finite(green.avgPoints) && finite(cost.avgPoints);
  const params = {
    bucket: f.bucket, side: lowerSide(side), pct: rate, count, total: f.known,
  };
  return makeCause(leak, `cause:approach:side:${side}`, rate >= CAUSE_MIN.approachLikelyPct ? 'likely' : 'consistent', {
    evidence: {
      bucket: f.bucket, side, misses: f.row.misses, directionKnown: f.known, rate, count,
      greenPoints: hasCost ? green.avgPoints : null, sidePoints: hasCost ? cost.avgPoints : null,
    },
    benchmark: hasCost ? { source: 'own', greenPoints: green.avgPoints, sidePoints: cost.avgPoints } : null,
    metricKey: `approach.${side}Rate.${f.bucket}`,
    sample: f.row.misses,
    msg: hasCost
      ? msg(`${KEY}approach.side.cost`, { ...params, cost: n(round2(green.avgPoints - cost.avgPoints), { noMinus: true }) })
      : msg(`${KEY}approach.side`, params),
  });
}

function approachBunkerRule(leak, stats) {
  const f = approachFacts(leak, stats);
  if (!f) return null;
  const rate = readMetric(`approach.bunkerRate.${f.bucket}`, stats)?.value;
  if (!(rate >= CAUSE_MIN.approachBunkerPct)) return null;
  const sand = stats?.upAndDown?.byLie?.sand;
  if (!(sand?.attempts >= CAUSE_MIN.approachSandAttempts) || !(sand.rate <= CAUSE_MIN.approachSandRateMax)) return null;
  const count = Math.round((rate * f.row.misses) / 100);
  const sandPct = Math.round(sand.rate * 100);
  return makeCause(leak, 'cause:approach:bunker', rate >= CAUSE_MIN.approachBunkerLikelyPct ? 'likely' : 'consistent', {
    evidence: {
      bucket: f.bucket, misses: f.row.misses, bunkerRate: rate, bunkerCount: count, sandRate: sandPct, sandAttempts: sand.attempts,
    },
    metricKey: `approach.bunkerRate.${f.bucket}`,
    sample: f.row.misses,
    msg: msg(`${KEY}approach.bunker`, {
      bucket: f.bucket, pct: rate, count, total: f.row.misses, sandPct, sandAttempts: sand.attempts,
    }),
  });
}

// Fallback: none of the miss patterns fired, so say which distance costs.
function approachDistanceRule(leak, stats, ctx) {
  const bucket = leak.bucket;
  const child = (leak.children ?? []).find((c) => c.bucket === bucket);
  if (!child || child.confidence === 'insufficient' || !(child.perShot < 0)) return null;
  const best = (leak.children ?? [])
    .filter((c) => c.bucket !== bucket && c.confidence !== 'insufficient' && finite(c.perShot))
    .sort((a, b) => b.perShot - a.perShot)[0] ?? null;
  const hasBench = finite(ctx.target);
  const params = { bucket, cost: n(round2(-child.perShot), { noMinus: true }), shots: child.sample.shots };
  return makeCause(leak, 'cause:approach:distance', child.confidence === 'high' ? 'consistent' : 'possible', {
    evidence: {
      bucket, perShot: child.perShot, shots: child.sample.shots,
      bestBucket: best?.bucket ?? null, bestPerShot: best?.perShot ?? null,
    },
    benchmark: hasBench ? { source: 'target', targetHandicap: ctx.target } : null,
    metricKey: `sg.approach.bucket.${bucket}`,
    sample: child.sample.shots,
    msg: hasBench
      ? benchMsg(ctx, `${KEY}approach.distance.bench`, { ...params, hcp: n(ctx.target) })
      : msg(`${KEY}approach.distance`, params),
  });
}

// ── Off the tee ──────────────────────────────────────────────────────────

function teeTroubleRule(leak, stats, ctx) {
  const lies = readMetric('tee.troubleRate', stats);
  const pen = readMetric('tee.penaltyPct.driver', stats);
  const byLies = lies && lies.sample.shots >= CAUSE_MIN.teeDrives && lies.value >= CAUSE_MIN.teeTroubleRatePct;
  const byPen = pen && pen.sample.shots >= CAUSE_MIN.teeDrives && pen.value >= CAUSE_MIN.teeDriverPenaltyPct;
  if (!byLies && !byPen) return null;
  const strength = byLies && byPen ? 'likely' : 'consistent';
  const byLie = stats?.driveLies?.byLie ?? {};
  const troubleCount = (byLie.sand ?? 0) + (byLie.trouble ?? 0);
  const evidence = {
    drives: lies?.sample.shots ?? 0,
    troubleRate: lies?.value ?? null,
    troubleCount,
    driverHoles: pen?.sample.shots ?? 0,
    driverPenaltyPct: pen?.value ?? null,
  };
  if (byLies) {
    return makeCause(leak, 'cause:tee:trouble:driver', strength, {
      evidence,
      metricKey: 'tee.troubleRate',
      sample: lies.sample.shots,
      msg: msg(`${KEY}tee.trouble.driver`, { pct: lies.value, count: troubleCount, total: lies.sample.shots }),
    });
  }
  const penaltyCount = Math.round((pen.value * pen.sample.shots) / 100);
  const params = { pct: pen.value, count: penaltyCount, total: pen.sample.shots };
  const row = ctx.bench;
  return makeCause(leak, 'cause:tee:trouble:driver', strength, {
    evidence,
    benchmark: row ? { source: 'target', targetHandicap: ctx.target, teePenaltyPct: row.teePenaltyPct } : null,
    metricKey: 'tee.penaltyPct.driver',
    sample: pen.sample.shots,
    msg: row
      ? benchMsg(ctx, `${KEY}tee.penalty.driver.bench`, { ...params, benchPct: row.teePenaltyPct, hcp: n(ctx.target) })
      : msg(`${KEY}tee.penalty.driver`, params),
  });
}

function teeSideRule(leak, stats, ctx) {
  const buckets = stats?.driveImpact?.buckets;
  const left = buckets?.left?.holes ?? 0;
  const right = buckets?.right?.holes ?? 0;
  const side = right > left ? 'right' : 'left';
  const count = side === 'left' ? left : right;
  const other = side === 'left' ? right : left;
  const share = readMetric(`tee.missSideShare.${side}`, stats);
  if (!share || !(share.sample.shots >= CAUSE_MIN.teeSideMisses)) return null;
  if (!(count >= CAUSE_MIN.teeSideRatio * other) || count === 0) return null;
  const drives = ['fairway', 'super', 'left', 'right', 'short']
    .reduce((sum, k) => sum + (buckets?.[k]?.holes ?? 0), 0);
  const sidePct = Math.round((count / drives) * 100);
  const fairway = buckets?.fairway;
  const cost = buckets?.[side];
  const costPts = fairway?.holes >= CAUSE_MIN.teeCostHoles && cost?.holes >= CAUSE_MIN.teeCostHoles
    && finite(fairway.avgPoints) && finite(cost.avgPoints)
    ? round2(fairway.avgPoints - cost.avgPoints) : null;
  const benchPct = ctx.bench ? ctx.bench[`${side}MissPct`] : null;
  const params = {
    side: lowerSide(side), count, misses: share.sample.shots, pct: sidePct,
  };
  const strength = count >= CAUSE_MIN.teeSideLikelyRatio * other ? 'likely' : 'consistent';
  return makeCause(leak, `cause:tee:side:${side}`, strength, {
    evidence: {
      side, count, other, misses: share.sample.shots, drives, sidePct, share: share.value, costPts,
    },
    benchmark: finite(benchPct) ? { source: 'target', targetHandicap: ctx.target, sidePct: benchPct } : null,
    metricKey: `tee.missSideShare.${side}`,
    sample: share.sample.shots,
    msg: finite(benchPct)
      ? benchMsg(ctx, `${KEY}tee.side.bench`, { ...params, benchPct, hcp: n(ctx.target) })
      : msg(`${KEY}tee.side`, params),
  });
}

function teeDistanceRule(leak, stats, ctx, found) {
  // "lies fine": the trouble rule did not fire.
  if (found.some((c) => c.id === 'cause:tee:trouble:driver') || !finite(ctx.target)) return null;
  const d = readMetric('tee.distance', stats);
  if (!d || !(d.sample.shots >= CAUSE_MIN.teeDrives) || !finite(d.value)) return null;
  const bench = benchmarkDriveDistance(ctx.target);
  const gap = bench - d.value;
  if (!(gap >= CAUSE_MIN.teeDistanceGap)) return null;
  return makeCause(leak, 'cause:tee:distance', gap >= CAUSE_MIN.teeDistanceConsistentGap ? 'consistent' : 'possible', {
    evidence: { distance: d.value, benchDistance: bench, gap, drives: d.sample.shots },
    benchmark: { source: 'target', targetHandicap: ctx.target, driveDistance: bench },
    metricKey: 'tee.distance',
    sample: d.sample.shots,
    msg: benchMsg(ctx, `${KEY}tee.distance.bench`, {
      distance: n(Math.round(d.value), { decimals: 0 }),
      benchDistance: n(Math.round(bench), { decimals: 0 }),
      drives: d.sample.shots,
      hcp: n(ctx.target),
    }),
  });
}

// ── Around the green ─────────────────────────────────────────────────────

function sandRule(leak, stats) {
  const sand = stats?.upAndDown?.byLie?.sand;
  const grass = stats?.upAndDown?.byLie?.nonSand;
  const min = CAUSE_MIN.upDownAttempts;
  if (!(sand?.attempts >= min) || !(grass?.attempts >= min) || !finite(sand.rate) || !finite(grass.rate)) return null;
  const gap = grass.rate - sand.rate;
  if (!(gap >= CAUSE_MIN.sandGap)) return null;
  return makeCause(leak, 'cause:short:sand', gap >= CAUSE_MIN.sandLikelyGap ? 'likely' : 'consistent', {
    evidence: {
      sandRate: Math.round(sand.rate * 100), nonSandRate: Math.round(grass.rate * 100),
      sandAttempts: sand.attempts, nonSandAttempts: grass.attempts, gap: round2(gap),
    },
    benchmark: { source: 'own', nonSandRate: Math.round(grass.rate * 100) },
    metricKey: 'short.upDownRate.sand',
    sample: sand.attempts + grass.attempts,
    msg: msg(`${KEY}short.sand`, {
      sandPct: Math.round(sand.rate * 100),
      nonSandPct: Math.round(grass.rate * 100),
      sandAttempts: sand.attempts,
      nonSandAttempts: grass.attempts,
    }),
  });
}

function chipRule(leak, stats, ctx) {
  const u = readMetric('short.upDownRate', stats);
  if (!u || !(u.sample.shots >= CAUSE_MIN.upDownAttempts) || !finite(u.value) || !finite(ctx.target)) return null;
  const expected = expectedUpAndDown(ctx.target);
  if (!finite(expected)) return null;
  const gap = expected - u.value / 100;
  if (!(gap >= CAUSE_MIN.chipGap)) return null;
  const expectedPct = Math.round(expected * 100);
  return makeCause(leak, 'cause:short:chip', gap >= CAUSE_MIN.chipConsistentGap ? 'consistent' : 'possible', {
    evidence: { rate: u.value, expectedRate: expectedPct, attempts: u.sample.shots },
    benchmark: { source: 'target', targetHandicap: ctx.target, upAndDownRate: expectedPct },
    metricKey: 'short.upDownRate',
    sample: u.sample.shots,
    msg: benchMsg(ctx, `${KEY}short.chip.bench`, {
      pct: u.value, expectedPct, attempts: u.sample.shots, hcp: n(ctx.target),
    }),
  });
}

// ── Penalties ────────────────────────────────────────────────────────────

function penaltyRule(leak, stats, ctx) {
  const tee = stats?.shots?.penalties?.tee;
  const other = stats?.shots?.penalties?.other;
  const rounds = readMetric('penalties.perRound.tee', stats)?.sample.rounds ?? 0;
  if (!finite(tee) || !finite(other) || rounds <= 0) return null;
  const total = tee + other;
  if (total < CAUSE_MIN.penaltiesTotal) return null;
  const isTee = tee >= CAUSE_MIN.penaltyTeeRatio * other;
  const id = isTee ? 'cause:penalty:tee' : 'cause:penalty:other';
  let strength = 'possible';
  if (isTee) strength = tee >= CAUSE_MIN.penaltyTeeLikelyRatio * other ? 'likely' : 'consistent';
  else if (other >= CAUSE_MIN.penaltyTeeRatio * tee) strength = 'consistent';
  const perRound = total / rounds;
  const hasBench = finite(ctx.target);
  const benchPerRound = hasBench ? expectedPenaltiesPerRound(ctx.target) : null;
  const params = { count: isTee ? tee : other, total };
  return makeCause(leak, id, strength, {
    evidence: { tee, other, total, rounds, perRound: round2(perRound) },
    benchmark: hasBench ? { source: 'target', targetHandicap: ctx.target, penaltiesPerRound: round2(benchPerRound) } : null,
    metricKey: isTee ? 'penalties.perRound.tee' : 'penalties.perRound.other',
    sample: total,
    msg: hasBench
      ? benchMsg(ctx, `${KEY}${isTee ? 'penalty.tee' : 'penalty.other'}.bench`, {
        ...params, perRound: dec1(perRound), benchPerRound: dec1(benchPerRound), hcp: n(ctx.target),
      })
      : msg(`${KEY}${isTee ? 'penalty.tee' : 'penalty.other'}`, params),
  });
}

// ── Table ────────────────────────────────────────────────────────────────

// Rules per leak category, in tie-break order. A `fallback` rule runs only
// when no other rule of the category fired. `found` is every cause so far.
const RULES = {
  putting: [{ run: lagRule }, { run: shortPuttRule }, { run: generalPuttingRule }],
  approach: [
    { run: approachShortRule }, { run: approachSideRule }, { run: approachBunkerRule },
    { run: approachDistanceRule, fallback: true },
  ],
  offTheTee: [{ run: teeTroubleRule }, { run: teeSideRule }, { run: teeDistanceRule }],
  aroundGreen: [{ run: sandRule }, { run: chipRule }],
  penalties: [{ run: penaltyRule }],
};

function byStrength(a, b) {
  return rankOf(a.strength) - rankOf(b.strength) || b.sample - a.sample;
}

export function causesForLeak(leak, stats) {
  const rules = RULES[leak?.category];
  if (!rules) return { primary: null, alsoPossible: [] };
  const targetRaw = leak.benchmark?.targetHandicap ?? stats?.targetHandicap;
  const target = finite(targetRaw) ? targetRaw : null;
  const ctx = { target, bench: benchmarkRow(target) };
  const found = [];
  rules.filter((r) => !r.fallback).forEach((r) => {
    const cause = r.run(leak, stats, ctx, found);
    if (cause) found.push(cause);
  });
  if (found.length === 0) {
    rules.filter((r) => r.fallback).forEach((r) => {
      const cause = r.run(leak, stats, ctx, found);
      if (cause) found.push(cause);
    });
  }
  // Array.sort is stable: equal strength and sample keep table order.
  const ranked = [...found].sort(byStrength);
  return { primary: ranked[0] ?? null, alsoPossible: ranked.slice(1) };
}
