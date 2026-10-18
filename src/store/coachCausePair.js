// The Coach tab's verdict card (design B): the issue's name and the two numbers
// that show it. Pure: descriptors and raw numbers, no language (docs/i18n.md).
//
// issueMsg(leak, cause) → descriptor of the issue name ("Short putts from 2-3 m"),
//   one catalogue key per cause id (`stats.my.coach.ui.issue.<id>`); the area and
//   bucket when no cause fired.
//
// causePair({ cause, check, isFocus }) → null | Pair
//   Pair { kind: 'pair', caption, rows: [{ label, value: { n, unit }, fraction }, ...] }
//     two labelled bars: "you" against a reference (a target handicap's number, or
//     the golfer's own other lies). `fraction` is the bar length, 0..1.
//   Pair { kind: 'single', text, fraction }
//     a cause with no comparable number: one bar with its count ("10 of 21 misses
//     short"). `fraction` is null when there is no count to draw.
//   label { kind: 'you' | 'now' | 'target' | 'scratch' | 'start' | 'otherLies', hcp? }
//   In the focus state the pair is drawn from the check baseline ("At start" /
//   "Now") so it agrees with the focus card.

import { msg, n, lower } from './statsMsg';

const ISSUE = 'stats.my.coach.ui.issue.';
const PAIR = 'stats.my.coach.ui.pair.';

// Every id coachCauses can emit (side causes come in both directions).
// Why causes (miss reasons): swing subs with their sides, lie, decision.
const WHY_SWING = ['start', 'curve', 'strike'].flatMap((sub) => ['left', 'right'].map((side) => `swing:${sub}:${side}`));
const WHY_IDS = (area, reasons) => reasons.map((r) => `cause:${area}:why:${r}`);

export const CAUSE_IDS = [
  'cause:putting:lag',
  'cause:putting:short',
  'cause:putting:general',
  'cause:approach:short',
  'cause:approach:side:left',
  'cause:approach:side:right',
  'cause:approach:bunker',
  'cause:approach:distance',
  'cause:tee:trouble:driver',
  'cause:tee:side:left',
  'cause:tee:side:right',
  'cause:tee:distance',
  'cause:short:sand',
  'cause:short:chip',
  'cause:penalty:tee',
  'cause:penalty:other',
  ...WHY_IDS('approach', [...WHY_SWING, 'swing:lowPoint', 'lie', 'decision']),
  ...WHY_IDS('tee', [...WHY_SWING, 'swing:lowPoint', 'lie', 'decision']),
  ...WHY_IDS('short', ['swing:lowPoint', 'lie', 'decision']),
];

export const issueKey = (causeId) => `${ISSUE}${String(causeId).replace(/^cause:/, '').replace(/:/g, '.')}`;

export function issueMsg(leak, cause) {
  if (cause && CAUSE_IDS.includes(cause.id)) return msg(issueKey(cause.id), { bucket: leak?.bucket ?? undefined });
  const area = msg(`stats.my.coach.plan.area.${leak?.category}`);
  return leak?.bucket
    ? msg('stats.my.coach.ui.kicker.bucket', { area, bucket: leak.bucket })
    : msg('stats.my.coach.ui.kicker', { area });
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const side = (s) => lower(msg(`stats.my.fan.${s}`));

const refLabel = (hcp) => (hcp === 0 ? { kind: 'scratch' } : { kind: 'target', hcp });

function fractionOf(count, total) {
  return finite(count) && finite(total) && total > 0 ? Math.min(1, Math.max(0, count / total)) : null;
}

// Two bars scaled to the longer one.
function pair(caption, you, ref, unit, refKind) {
  if (!finite(you) || !finite(ref)) return null;
  const top = Math.max(Math.abs(you), Math.abs(ref)) || 1;
  return {
    kind: 'pair',
    caption,
    rows: [
      { label: { kind: 'you' }, value: { n: you, unit }, fraction: Math.abs(you) / top },
      { label: refKind, value: { n: ref, unit }, fraction: Math.abs(ref) / top },
    ],
  };
}

function single(key, params, fraction) {
  // a count the rule did not report would render as "{count}"
  if (Object.values(params).some((v) => v == null || (typeof v === 'number' && !Number.isFinite(v)))) return null;
  return { kind: 'single', text: msg(`${PAIR}single.${key}`, params), fraction };
}

// The cause's own numbers (cause.evidence) against its benchmark. A benchmark
// the rule did not find leaves the single bar with the count.
function fromCause(cause) {
  const e = cause.evidence ?? {};
  const b = cause.benchmark ?? null;
  const tgt = refLabel(b?.targetHandicap);
  switch (cause.id) {
    case 'cause:putting:lag':
      return (b && pair(msg(`${PAIR}caption.puttsTry`), e.avgPutts, b.expectedPutts, 'putts', tgt))
        || single('threePutt', { count: e.threePutts, total: e.attempts }, fractionOf(e.threePutts, e.attempts));
    case 'cause:putting:short':
      return (b && pair(msg(`${PAIR}caption.puttsTry`), e.avgPutts, b.expectedPutts, 'putts', tgt))
        || (finite(e.avgPutts) ? single('puttsTry', { avg: n(e.avgPutts, { decimals: 1 }) }, null) : null);
    case 'cause:putting:general':
      return b && pair(msg(`${PAIR}caption.putts18`), e.per18, b.puttsPerRound, 'putts', tgt);
    case 'cause:approach:short':
      return single('short', { count: e.shortCount, total: e.directionKnown }, fractionOf(e.shortCount, e.directionKnown));
    case 'cause:approach:side:left':
    case 'cause:approach:side:right':
      return single('side', { count: e.count, total: e.directionKnown, side: side(e.side) }, fractionOf(e.count, e.directionKnown));
    case 'cause:approach:bunker':
      return single('bunker', { count: e.bunkerCount, total: e.misses }, fractionOf(e.bunkerCount, e.misses));
    case 'cause:approach:distance':
      return finite(e.perShot) ? single('distance', { cost: n(Math.abs(e.perShot), { decimals: 2 }) }, null) : null;
    case 'cause:tee:trouble:driver':
      return (finite(b?.teePenaltyPct) && pair(msg(`${PAIR}caption.penaltyPct`), e.driverPenaltyPct, b.teePenaltyPct, 'percent', tgt))
        || single('trouble', { count: e.troubleCount, total: e.drives }, fractionOf(e.troubleCount, e.drives));
    case 'cause:tee:side:left':
    case 'cause:tee:side:right':
      return (finite(b?.sidePct) && pair(msg(`${PAIR}caption.sideMiss`, { side: side(e.side) }), e.sidePct, b.sidePct, 'percent', tgt))
        || single('sideMiss', { count: e.count, total: e.drives, side: side(e.side) }, fractionOf(e.count, e.drives));
    case 'cause:tee:distance':
      return b && pair(msg(`${PAIR}caption.distance`), e.distance, b.driveDistance, 'metres', tgt);
    case 'cause:short:sand':
      return pair(msg(`${PAIR}caption.upDownSand`), e.sandRate, e.nonSandRate, 'percent', { kind: 'otherLies' });
    case 'cause:short:chip':
      return b && pair(msg(`${PAIR}caption.upDown`), e.rate, e.expectedRate, 'percent', tgt);
    case 'cause:penalty:tee':
    case 'cause:penalty:other': {
      const tee = cause.id === 'cause:penalty:tee';
      return (finite(b?.penaltiesPerRound) && pair(msg(`${PAIR}caption.penaltiesRound`), e.perRound, b.penaltiesPerRound, 'penalties', tgt))
        || single(tee ? 'penaltyTee' : 'penaltyOther', { count: tee ? e.tee : e.other, total: e.total }, fractionOf(tee ? e.tee : e.other, e.total));
    }
    default:
      if (/^cause:(approach|tee|short):why:/.test(cause.id)) {
        return single('why', { count: e.count, total: e.tagged }, fractionOf(e.count, e.tagged));
      }
      return null;
  }
}

export function causePair({ cause = null, check = null, isFocus = false } = {}) {
  if (isFocus && check && finite(check.baseline) && finite(check.value)) {
    const top = Math.max(Math.abs(check.value), Math.abs(check.baseline)) || 1;
    return {
      kind: 'pair',
      caption: check.label,
      rows: [
        { label: { kind: 'now' }, value: { n: check.value, unit: check.unit }, fraction: Math.abs(check.value) / top },
        { label: { kind: 'start' }, value: { n: check.baseline, unit: check.unit }, fraction: Math.abs(check.baseline) / top },
      ],
    };
  }
  return cause ? fromCause(cause) : null;
}
