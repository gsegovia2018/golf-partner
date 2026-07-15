// Committed coach focus (spec §2.2): one focus at a time, device-local,
// verdicted deterministically against the same stats pipeline that
// produced the insight. Pure logic first; AsyncStorage adapters below.
import AsyncStorage from '@react-native-async-storage/async-storage';

const FOCUS_PREFIX = '@mystats_coach_focus:';
const HISTORY_PREFIX = '@mystats_coach_focus_history:';
const HISTORY_MAX = 10;
const MIN_VERDICT_ROUNDS = 2;

export function makeFocusCommit(insight, stats, committedAt) {
  if (!insight?.id) return null;
  return {
    insightId: insight.id,
    area: insight.area,
    areaLabel: insight.areaLabel ?? insight.area,
    title: insight.title,
    metric: insight.metric ?? null,
    baselineImpact: Number.isFinite(insight.impact) ? insight.impact : null,
    committedAt: committedAt ?? new Date().toISOString(),
    roundCountAtCommit: stats?.roundCount ?? 0,
  };
}

function findInsightById(coach, id) {
  if (!coach) return null;
  if (coach.hero?.id === id) return coach.hero;
  const groups = coach.board ?? {};
  const keys = Object.keys(groups);
  for (let i = 0; i < keys.length; i += 1) {
    const found = (groups[keys[i]] ?? []).find((insight) => insight.id === id);
    if (found) return found;
  }
  return null;
}

// Verdicts are relative to the committed baseline. Insight impacts are
// universally higher-is-better (leaks negative), so a positive delta is
// improvement regardless of the insight's unit.
export function focusVerdict(focus, stats) {
  if (!focus) return null;
  const roundsSince = Math.max(0, (stats?.roundCount ?? 0) - (focus.roundCountAtCommit ?? 0));
  const current = findInsightById(stats?.coach, focus.insightId);
  const base = {
    roundsSince,
    baseline: focus.baselineImpact,
    current: Number.isFinite(current?.impact) ? current.impact : null,
    currentMetric: current?.metric ?? null,
  };
  if (roundsSince < MIN_VERDICT_ROUNDS) {
    return { ...base, state: 'needs-more-rounds', roundsNeeded: MIN_VERDICT_ROUNDS - roundsSince };
  }
  if (base.current == null || !Number.isFinite(focus.baselineImpact)) {
    return { ...base, state: 'resolved' };
  }
  const threshold = Math.max(Math.abs(focus.baselineImpact) * 0.1, 0.05);
  const delta = base.current - focus.baselineImpact;
  const state = delta >= threshold ? 'improving' : delta <= -threshold ? 'worse' : 'flat';
  return { ...base, state, delta };
}

const focusKey = (userId) => `${FOCUS_PREFIX}${userId ?? 'anon'}`;
const historyKey = (userId) => `${HISTORY_PREFIX}${userId ?? 'anon'}`;

async function readJson(key, fallback) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

export function loadFocus(userId) {
  return readJson(focusKey(userId), null);
}

export function saveFocus(userId, focus) {
  return AsyncStorage.setItem(focusKey(userId), JSON.stringify(focus));
}

export function clearFocus(userId) {
  return AsyncStorage.removeItem(focusKey(userId));
}

export function loadFocusHistory(userId) {
  return readJson(historyKey(userId), []);
}

// Prepends the ended focus (with its final verdict) to a capped history and
// clears the active slot.
export async function archiveFocus(userId, focus, verdict) {
  const history = await loadFocusHistory(userId);
  const entry = {
    ...focus,
    endedAt: new Date().toISOString(),
    finalState: verdict?.state ?? 'unknown',
    finalImpact: verdict?.current ?? null,
  };
  const next = [entry, ...history].slice(0, HISTORY_MAX);
  await AsyncStorage.setItem(historyKey(userId), JSON.stringify(next));
  await clearFocus(userId);
  return next;
}
