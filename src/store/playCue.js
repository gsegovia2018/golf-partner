// What the Play tab knows that the tab bar shows on every tab: the live
// round (the strip above the bar) and the quick-start courses (Play's hold
// menu). HomeScreen publishes it; FloatingTabBar reads it.
//
// cue = {
//   live: { tournamentId, roundIndex, courseName, hole, points } | null
//   quickStart: [{ id, name }]   at most QUICK_START_LIMIT
// }
import { useSyncExternalStore } from 'react';

export const QUICK_START_LIMIT = 3;

const EMPTY = { live: null, quickStart: [] };
let cue = EMPTY;
const listeners = new Set();

// The strip's slice of a live phase entry and its liveModel: the hole to
// play next and my points, only when the round is scored in points.
export function liveCue(entry, model) {
  if (!entry?.tournament?.id || !model) return null;
  return {
    tournamentId: entry.tournament.id,
    roundIndex: entry.roundIndex,
    courseName: model.courseName || '',
    hole: model.next?.number ?? null,
    points: model.unit === 'pts' ? model.myPoints ?? null : null,
  };
}

export function quickStartCue(courses) {
  return (courses ?? [])
    .filter((c) => c?.id)
    .slice(0, QUICK_START_LIMIT)
    .map((c) => ({ id: c.id, name: c.layoutName || c.name || '' }));
}

export function getPlayCue() {
  return cue;
}

export function setPlayCue(next) {
  const value = next ?? EMPTY;
  if (JSON.stringify(value) === JSON.stringify(cue)) return;
  cue = value;
  listeners.forEach((fn) => fn());
}

export function subscribePlayCue(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function usePlayCue() {
  return useSyncExternalStore(subscribePlayCue, getPlayCue, getPlayCue);
}
