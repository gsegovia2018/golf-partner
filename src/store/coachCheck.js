// Coach v2 "Check" step: the one number the verdict will re-read, now, against
// the target handicap's benchmark where the stores have one in the same unit
// (spec §3.4, §12.4). Pure: descriptors and numbers, no language.
//
// buildCheck({ leak, cause, focus, stats }) →
//   { metricKey, label: descriptor, unit, polarity, value, sample, benchmark, hcp, baseline,
//     minRounds, settlesAt } | null
//   metric     the focus's metric when one is committed, else the cause's, else the
//              leak's worst bucket, else the category (same order as makeFocusCommit)
//   benchmark  null unless a table gives the same metric for the target handicap

import { msg, lower } from './statsMsg';
import { METRICS, readMetric } from './coachMetrics';
import { MIN_VERDICT_ROUNDS, EARLY_ROUNDS } from './coachFocus';
import { shotBenchmarkForHandicap } from './shotBenchmarks';
import { benchmarkDriveDistance } from './strokesGainedBaseline';
import { expectedUpAndDown } from './coachCauses';

const K = 'stats.my.coach.ui.metric.';
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round1 = (v) => Math.round(v * 10) / 10;

const side = (s) => lower(msg(`stats.my.fan.${s}`));
const area = (c) => msg(`stats.my.coach.plan.area.${c}`);

// The metric key → the sentence naming it (descriptor).
export function metricLabel(key) {
  const p = String(key ?? '').split('.');
  if (p[0] === 'sg' && p.length === 2) return msg(`${K}sgCategory`, { area: area(p[1]) });
  if (p[0] === 'sg' && p[1] === 'putting') return msg(`${K}sgPutt`, { bucket: p[3] });
  if (p[0] === 'sg' && p[1] === 'approach') return msg(`${K}sgApproach`, { bucket: p[3] });
  if (p[0] === 'putting' && p[1] === 'threePuttRate') return msg(`${K}threePuttRate`, { bucket: p[2] });
  if (p[0] === 'putting' && p[1] === 'per18') return msg(`${K}puttsPer18`);
  if (p[0] === 'putting' && p[1] === 'threePuttsPer18') return msg(`${K}threePuttsPer18`);
  if (p[0] === 'approach') {
    if (p[1] === 'shortRate') return msg(`${K}approachShort`, { bucket: p[2] });
    if (p[1] === 'bunkerRate') return msg(`${K}approachBunker`, { bucket: p[2] });
    return msg(`${K}approachSide`, { bucket: p[2], side: side(p[1] === 'leftRate' ? 'left' : 'right') });
  }
  if (key === 'tee.troubleRate') return msg(`${K}teeTrouble`);
  if (p[0] === 'tee' && p[1] === 'penaltyPct') return msg(`${K}teePenalty`);
  if (p[0] === 'tee' && p[1] === 'missSideShare') return msg(`${K}teeMissSide`, { side: side(p[2]) });
  if (key === 'tee.distance') return msg(`${K}teeDistance`);
  if (p[0] === 'short') {
    return msg(`${K}${p[2] === 'sand' ? 'upDownSand' : p[2] === 'nonSand' ? 'upDownGrass' : 'upDown'}`);
  }
  if (p[0] === 'penalties') return msg(`${K}${p[2] === 'tee' ? 'penaltiesTee' : 'penaltiesOther'}`);
  return null;
}

// The same metric, for the target handicap, when a table has it.
function benchmarkFor(key, target) {
  if (!Number.isFinite(target)) return null;
  if (/^sg\./.test(key)) return 0; // SG is already measured against the target
  const row = shotBenchmarkForHandicap(target);
  if (key === 'putting.per18') return finite(row?.puttsPerRound);
  if (key === 'putting.threePuttsPer18') return finite(row?.threePuttsPerRound);
  if (key === 'tee.penaltyPct.driver') return finite(row?.teePenaltyPct);
  if (key === 'tee.distance') return finite(benchmarkDriveDistance(target));
  if (key === 'short.upDownRate') {
    const e = expectedUpAndDown(target);
    return e == null ? null : e * 100;
  }
  return null;
}

export function buildCheck({ leak, cause, focus, stats } = {}) {
  const child = leak?.bucket ? leak.children?.find((c) => c.bucket === leak.bucket) : null;
  const metricKey = focus?.metricKey ?? cause?.metricKey ?? child?.metricKey ?? leak?.metricKey ?? null;
  if (!metricKey || !Object.prototype.hasOwnProperty.call(METRICS, metricKey)) return null;
  const reading = readMetric(metricKey, stats);
  const target = leak?.benchmark?.targetHandicap ?? stats?.targetHandicap ?? null;
  const bench = benchmarkFor(metricKey, target);
  return {
    metricKey,
    label: metricLabel(metricKey),
    unit: METRICS[metricKey].unit,
    polarity: METRICS[metricKey].polarity,
    value: finite(reading?.value),
    sample: reading?.sample ?? null,
    benchmark: bench == null ? null : round1(bench),
    hcp: Number.isFinite(target) ? target : null,
    baseline: finite(focus?.baselineValue),
    minRounds: MIN_VERDICT_ROUNDS,
    settlesAt: EARLY_ROUNDS,
  };
}
