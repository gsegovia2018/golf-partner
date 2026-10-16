// Committed coach focus, v2 (coach v2 spec §3.4, §4.3, §12): one focus at a
// time, device-local. It is committed from a diagnosis leak (or one of its
// bucket children, or the leak's cause) and verdicted by re-reading the very
// metric that triggered it through the coachMetrics registry. Pure logic
// first; AsyncStorage adapters below.
//
// v2 record:
//   { v: 2, leakId, category, bucket, causeId, metricKey,
//     baselineValue, baselineSample, baselineSe, minChange, baselineVersion,
//     committedAt, roundCountAtCommit, swingId?,
//     targetHandicap?,                           ← the target the baseline was read against
//     roundCountAtBaseline?, rebasedAt?,
//     rebaseReason? }                            ← only after an SG rebase; { kind: 'target', from, to }
//                                                  when the target handicap changed
//
// v1 records (the insight-based shape: insightId, area, title, metric, basis,
// baselineImpact, baselineVersion, rebasedAt …) are not verdicted any more:
// loadFocus archives one as `resolved` the first time it sees it and leaves a
// one-time notice for the Coach tab (decision §12 / §11.4).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SG_BASELINE_VERSION } from './strokesGainedBaseline';
import { METRICS, readMetric } from './coachMetrics';

const FOCUS_PREFIX = '@mystats_coach_focus:';
const HISTORY_PREFIX = '@mystats_coach_focus_history:';
const NOTICE_PREFIX = '@mystats_coach_focus_notice:';
const HISTORY_MAX = 10;

export const FOCUS_VERSION = 2;
export const MIN_VERDICT_ROUNDS = 2;   // under this: needs-more-rounds
export const EARLY_ROUNDS = 4;         // under this: an "early read"
export const MAX_LEVEL = 3;
export const ROUNDS_PER_LEVEL = 2;
// Smallest change that counts as moving, per metric unit, before the
// baseline's own se raises it: 0.25 strokes a round; 10 points on a rate.
// A per-shot SG metric converts the 0.25 strokes through its shots per round
// at commit (MIN_CHANGE.sgPerShot is the fallback when that is unknown).
export const MIN_CHANGE = {
  sgPerRound: 0.25,
  sgPerShot: 0.08,
  perRound: 0.25,
  percent: 10,
  metres: 10,
};
const STROKES_MIN = 0.25;

export function isV2Focus(focus) {
  return focus?.v === FOCUS_VERSION && typeof focus.leakId === 'string';
}

// The insight-based shape this module stored before coach v2.
export function isV1Focus(focus) {
  return !!focus && typeof focus === 'object' && !focus.leakId && typeof focus.insightId === 'string';
}

const finite = (x) => (Number.isFinite(x) ? x : null);

// Commits a focus.
//   chain  a diagnosis Leak, or { leak, bucket?, cause?, swingId? }
//          bucket  commit to that child of the leak (its sg bucket metric)
//          cause   { id, metricKey? } — a cause that names a metricKey is
//                  verified by that metric instead
// Returns null when there is nothing to verify against: no leak, an unknown
// bucket or metric, or a metric with no current value.
export function makeFocusCommit(chain, stats, committedAt) {
  const wrapped = !!chain?.leak;
  const leak = wrapped ? chain.leak : (chain?.metricKey && chain?.id ? chain : null);
  if (!leak?.id || !leak.category) return null;
  // A bare leak's own `bucket` names its worst child; only { leak, bucket }
  // commits to a child.
  const bucket = wrapped ? (chain.bucket ?? null) : null;
  const child = bucket ? (leak.children ?? []).find((c) => c.bucket === bucket) : null;
  if (bucket && !child) return null;
  const cause = wrapped ? (chain.cause ?? null) : null;
  const metricKey = cause?.metricKey ?? child?.metricKey ?? leak.metricKey;
  const reading = readMetric(metricKey, stats);
  if (!reading || reading.value == null) return null;

  // se and the minimum change, both in the metric's own unit. A per-shot
  // bucket metric scales by the bucket's shots per round (the factor the
  // diagnosis used to put it in strokes per round).
  const { unit } = METRICS[metricKey];
  let baselineSe = null;
  let minChange = MIN_CHANGE[unit];
  if (metricKey === leak.metricKey) {
    baselineSe = finite(leak.se);
  } else {
    const match = (leak.children ?? []).find((c) => c.metricKey === metricKey);
    const rounds = leak.sample?.rounds ?? 0;
    const perRound = match && rounds > 0 ? (match.sample?.shots ?? 0) / rounds : 0;
    if (perRound > 0) {
      baselineSe = Number.isFinite(match.se) ? match.se / perRound : null;
      if (unit === 'sgPerShot') minChange = STROKES_MIN / perRound;
    }
  }

  return {
    v: FOCUS_VERSION,
    leakId: child ? `leak:${leak.category}:${child.bucket}` : leak.id,
    category: leak.category,
    bucket: child ? child.bucket : (leak.bucket ?? null),
    causeId: cause?.id ?? null,
    metricKey,
    baselineValue: reading.value,
    baselineSample: reading.sample,
    baselineSe,
    minChange,
    baselineVersion: SG_BASELINE_VERSION,
    targetHandicap: finite(stats?.targetHandicap),
    committedAt: committedAt ?? new Date().toISOString(),
    roundCountAtCommit: stats?.roundCount ?? 0,
    ...(wrapped && chain.swingId ? { swingId: chain.swingId } : {}),
  };
}

// Practice level from rounds played since the commit (§4.3, §12 answer 2):
// 1 + one level per two rounds, capped at 3. A `worse` verdict withholds the
// step the latest rounds earned; it never goes below 1.
export function focusLevel(roundsSince, state) {
  const rounds = Math.max(0, Math.floor(roundsSince ?? 0));
  const earned = Math.min(MAX_LEVEL, 1 + Math.floor(rounds / ROUNDS_PER_LEVEL));
  return state === 'worse' ? Math.max(1, earned - 1) : earned;
}

// A focus on a strokes-gained metric goes stale when the SG baseline tables
// change (SG_BASELINE_VERSION): its baselineValue is in the old currency.
export function isSgFocus(focus) {
  return isV2Focus(focus) && focus.metricKey.startsWith('sg.');
}

// An SG baseline is read against the target handicap, so a changed target is
// as stale as a changed table. Records without a stored target (written before
// it was kept) count as matching.
export function targetChanged(focus, stats) {
  return isSgFocus(focus) && Number.isFinite(focus.targetHandicap)
    && Number.isFinite(stats?.targetHandicap) && focus.targetHandicap !== stats.targetHandicap;
}

export function needsRebase(focus, stats) {
  return isSgFocus(focus) && ((focus.baselineVersion ?? 1) !== SG_BASELINE_VERSION || targetChanged(focus, stats));
}

// Re-anchors a stale SG focus on today's reading of its metric (kept as-is
// when the metric has no sample now). The commit — date, round count, level —
// stays; only the verdict's window restarts at roundCountAtBaseline. A target
// change is stamped as the reason ({ kind: 'target', from, to }).
export function rebaseFocus(focus, stats, rebasedAt) {
  const reading = readMetric(focus.metricKey, stats);
  const fresh = reading && reading.value != null;
  const { rebaseReason, ...rest } = focus; // eslint-disable-line no-unused-vars
  const changed = targetChanged(focus, stats);
  return {
    ...rest,
    baselineValue: fresh ? reading.value : focus.baselineValue,
    baselineSample: fresh ? reading.sample : focus.baselineSample,
    roundCountAtBaseline: stats?.roundCount ?? 0,
    baselineVersion: SG_BASELINE_VERSION,
    ...(changed ? { targetHandicap: stats.targetHandicap, rebaseReason: { kind: 'target', from: focus.targetHandicap, to: stats.targetHandicap } } : {}),
    rebasedAt,
  };
}

// → null (no v2 focus) | {
//     state: 'needs-more-rounds' | 'improving' | 'flat' | 'worse' | 'resolved',
//     early,          true under EARLY_ROUNDS judged rounds ("early read")
//     roundsSince,    rounds since the commit (progress: "K rounds in")
//     roundsNeeded,   only on needs-more-rounds
//     level,          focusLevel(roundsSince, state)
//     metricKey, unit, polarity,
//     baseline, current, currentSample,
//     delta,          current − baseline turned so positive = better
//                     (null unless improving / flat / worse)
//     threshold,      max(minChange, baselineSe)
//   }
export function focusVerdict(focus, stats) {
  if (!isV2Focus(focus)) return null;
  const metric = METRICS[focus.metricKey] ?? null;
  const roundCount = stats?.roundCount ?? 0;
  const roundsSince = Math.max(0, roundCount - (focus.roundCountAtCommit ?? 0));
  const judged = Math.max(0, roundCount - (focus.roundCountAtBaseline ?? focus.roundCountAtCommit ?? 0));
  const reading = metric ? metric.read(stats) : null;
  const unit = metric?.unit ?? null;
  const minChange = Number.isFinite(focus.minChange) ? focus.minChange : (MIN_CHANGE[unit] ?? 0);
  const base = {
    early: judged < EARLY_ROUNDS,
    roundsSince,
    metricKey: focus.metricKey,
    unit,
    polarity: metric?.polarity ?? null,
    baseline: finite(focus.baselineValue),
    current: finite(reading?.value),
    currentSample: reading?.sample ?? null,
    delta: null,
    threshold: Math.max(minChange, finite(focus.baselineSe) ?? 0),
  };
  const result = (state, extra) => ({ ...base, ...extra, state, level: focusLevel(roundsSince, state) });

  // Never compare across SG baselines or targets: until the rebase lands, stay neutral.
  if (needsRebase(focus, stats)) {
    return result('needs-more-rounds', { roundsNeeded: MIN_VERDICT_ROUNDS });
  }
  if (judged < MIN_VERDICT_ROUNDS) {
    return result('needs-more-rounds', { roundsNeeded: MIN_VERDICT_ROUNDS - judged });
  }
  if (!metric || base.current == null || base.baseline == null) return result('resolved');
  const sign = metric.polarity === 'lower' ? -1 : 1;
  const delta = sign * (base.current - base.baseline);
  const state = delta >= base.threshold ? 'improving' : delta <= -base.threshold ? 'worse' : 'flat';
  return result(state, { delta });
}

const focusKey = (userId) => `${FOCUS_PREFIX}${userId ?? 'anon'}`;
const historyKey = (userId) => `${HISTORY_PREFIX}${userId ?? 'anon'}`;
const noticeKey = (userId) => `${NOTICE_PREFIX}${userId ?? 'anon'}`;

async function readJson(key, fallback) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

async function readHistory(userId) {
  const history = await readJson(historyKey(userId), []);
  return Array.isArray(history) ? history : [];
}

const sameV1 = (a, b) => a?.v === 1 && a.endedBy === 'upgrade'
  && a.insightId === b.insightId && a.committedAt === b.committedAt;

// Closes a v1 focus once: the one-time notice, the history entry (v: 1,
// resolved, endedBy 'upgrade'), then the active slot. Written in that order
// and deduplicated on the history entry, so an interrupted or doubled load
// never archives it twice and never loses the notice.
async function archiveV1(userId, focus, now) {
  const history = await readHistory(userId);
  if (!history.some((e) => sameV1(e, focus))) {
    const entry = {
      ...focus, v: 1, endedAt: now, endedBy: 'upgrade', finalState: 'resolved', finalImpact: null,
    };
    await AsyncStorage.setItem(noticeKey(userId), JSON.stringify({ kind: 'v1-closed', closedAt: now }));
    await AsyncStorage.setItem(historyKey(userId), JSON.stringify([entry, ...history].slice(0, HISTORY_MAX)));
  }
  await AsyncStorage.removeItem(focusKey(userId));
}

// The active focus, or null. A v1 record is archived (once) and reads null;
// anything else that is not a v2 record reads null and is left alone.
export async function loadFocus(userId, now) {
  const focus = await readJson(focusKey(userId), null);
  if (isV2Focus(focus)) return focus;
  if (isV1Focus(focus)) {
    try {
      await archiveV1(userId, focus, now ?? new Date().toISOString());
    } catch (_) {
      // Storage failed: still never hand a v1 record to the v2 verdict.
    }
  }
  return null;
}

export function saveFocus(userId, focus) {
  return AsyncStorage.setItem(focusKey(userId), JSON.stringify(focus));
}

export function clearFocus(userId) {
  return AsyncStorage.removeItem(focusKey(userId));
}

// Ended focuses, newest first. Both shapes live here: v1 entries (insightId,
// finalImpact) and v2 entries (leakId, metricKey, finalValue). Entries
// written before v2 carry no `v` and read as v: 1.
export async function loadFocusHistory(userId) {
  const history = await readHistory(userId);
  return history.map((e) => (e && typeof e === 'object' && e.v == null ? { ...e, v: 1 } : e));
}

// Prepends the ended focus (with its final verdict) to a capped history and
// clears the active slot.
export async function archiveFocus(userId, focus, verdict) {
  const history = await readHistory(userId);
  const final = verdict?.current ?? null;
  const entry = {
    ...focus,
    v: focus?.v ?? 1,
    endedAt: new Date().toISOString(),
    finalState: verdict?.state ?? 'unknown',
    ...(isV2Focus(focus) ? { finalValue: final } : { finalImpact: final }),
  };
  const next = [entry, ...history].slice(0, HISTORY_MAX);
  await AsyncStorage.setItem(historyKey(userId), JSON.stringify(next));
  await clearFocus(userId);
  return next;
}

// One-time notice left by loadFocus when it closed a v1 focus:
// { kind: 'v1-closed', closedAt } or null. The Coach tab shows "Your old focus
// was closed; pick a new one" and dismisses it.
export async function loadFocusNotice(userId) {
  const notice = await readJson(noticeKey(userId), null);
  return notice && typeof notice === 'object' && notice.kind ? notice : null;
}

export function dismissFocusNotice(userId) {
  return AsyncStorage.removeItem(noticeKey(userId));
}
