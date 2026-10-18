// What one round did to the committed coach focus (round focus loop spec §2.4,
// plan §4.6 with the owner decision: a lie focus reads the miss share from that
// lie, encounters are context only). Pure: no language, no I/O.
//
// roundFocusSummary({ focus, target, round, playerId, roundStats = null }) → null | {
//   touched,   at least one shot of the focus was played and logged this round
//   thisRound  { kind: 'count', count, total }                       swing / decision
//            | { kind: 'lie', lie, count, total, shots, greens }     lie
//            | { kind: 'value', value, unit }                        outcome
//   before     { kind: 'count', count, total } | { kind: 'value', value, unit } | null
//   nowPct, beforePct   0-100 for the bars, null when the metric is not a percent
// }
// `target` is focusTarget(focus). `roundStats` is computeMyStats over this round
// alone, needed only by an outcome focus.
import { METRICS, WHY_KINDS, whyRow } from './coachMetrics';
import { missReasonStats } from './missReasons';

const WHY_KEY = /^(approach|tee|short)\.why\.(.+?)Rate(?:\.([^.]+))?$/;

const clampPct = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null);

// The baseline as the committed count when the metric is a percent with a sample.
function beforeOf(focus, unit) {
  const value = Number.isFinite(focus.baselineValue) ? focus.baselineValue : null;
  if (value == null) return { before: null, beforePct: null };
  const total = focus.baselineSample?.shots;
  const beforePct = unit === 'percent' ? clampPct(value) : null;
  if (unit === 'percent' && total > 0) {
    return { before: { kind: 'count', count: Math.round((value / 100) * total), total }, beforePct };
  }
  return { before: { kind: 'value', value, unit }, beforePct };
}

// Was a shot of the focus played and logged: swing / decision / lie rows by area.
function playedShot(round, playerId, area, scope, row) {
  if (area === 'short') return row.misses > 0;
  const byHole = round?.shotDetails?.[playerId] ?? {};
  return (round?.holes ?? []).some((hole) => {
    const d = byHole[hole.number];
    if (!d) return false;
    if (area === 'tee') return hole.par >= 4 && !!d.drive;
    return hole.par !== 3 && !!d.approachBucket && !!d.approachResult
      && (scope === 'all' || d.approachBucket === scope);
  });
}

export function roundFocusSummary({ focus, target, round, playerId, roundStats = null }) {
  if (!focus || !target) return null;
  const unit = METRICS[focus.metricKey]?.unit ?? null;
  const { before, beforePct } = beforeOf(focus, unit);

  if (target.kind === 'outcome') {
    const reading = METRICS[focus.metricKey]?.read(roundStats) ?? null;
    const touched = Object.values(reading?.sample ?? {}).some((n) => n > 0);
    const value = Number.isFinite(reading?.value) ? reading.value : null;
    return {
      touched,
      thisRound: { kind: 'value', value, unit },
      before,
      nowPct: unit === 'percent' ? clampPct(value) : null,
      beforePct,
    };
  }

  const parsed = WHY_KEY.exec(focus.metricKey ?? '');
  const why = parsed ? WHY_KINDS.find((k) => k.base === parsed[2]) : null;
  if (!why) return null;
  const [, area, , scope = 'all'] = parsed;
  const row = whyRow({ missReasons: missReasonStats([round], playerId) }, area, scope);
  if (!row) return null;
  const total = row.tagged;

  if (target.kind === 'lie') {
    const enc = row.encounters?.[target.lie] ?? { shots: 0, greens: 0 };
    const count = row.lies?.[target.lie] ?? 0;
    return {
      touched: enc.shots > 0,
      thisRound: { kind: 'lie', lie: target.lie, count, total, shots: enc.shots, greens: enc.greens },
      before,
      nowPct: total > 0 ? clampPct((count / total) * 100) : null,
      beforePct,
    };
  }

  const count = why.count(row);
  return {
    touched: playedShot(round, playerId, area, scope, row),
    thisRound: { kind: 'count', count, total },
    before,
    nowPct: total > 0 ? clampPct((count / total) * 100) : null,
    beforePct,
  };
}
