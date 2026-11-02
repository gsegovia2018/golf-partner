// The live round's finish estimate and daylight check — see store/roundPace.js.
//
// Reads the round's cards on this phone (hole `ts`, no network), the pace
// history the feed keeps, and where the course is: its map, else the round's
// GPS fix, else the phone's last known position — only when location is
// already allowed (never prompts; most library courses have no map).
// Re-derives every minute.
// Null when disabled, finished, or nothing is left to play.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { useRoundCards } from './useRoundCards';
import { useMinuteClock } from './useMinuteClock';
import { useCourseGeometry } from './useCourseGeometry';
import { roundSpan, roundStartAt } from '../store/roundDuration';
import { roundStartedAt } from '../store/finishStamp';
import {
  sunTimes, priorPace, holesToPlay, projectRound,
} from '../store/roundPace';
import {
  getPaceHistory, getPaceHistoryVersion, loadPaceHistory, subscribePaceHistory,
} from '../store/paceHistory';
import { coursePoint } from '../store/weatherStore';
import { getLiveFix } from '../lib/roundTracking';

const LAST_KNOWN_MAX_AGE_MS = 12 * 3600e3;

// The phone's last known [lat, lng], without prompting or waiting for a fix.
async function lastKnownPoint() {
  if (Platform.OS === 'web') return null;
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status !== 'granted') return null;
  const loc = await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS });
  return loc?.coords ? [loc.coords.latitude, loc.coords.longitude] : null;
}

function scoredHoles(scores) {
  const done = new Set();
  for (const byHole of Object.values(scores ?? {})) {
    for (const [h, v] of Object.entries(byHole ?? {})) if (v) done.add(Number(h));
  }
  return [...done];
}

// `scores` defaults to round.scores; the scorecard passes its live merged view.
export function useRoundPace({
  tournamentId, round, scores: scoresIn = null, createdAt = null, enabled = true,
}) {
  const on = !!(enabled && round?.id && !round.finishedAt);
  const { state } = useRoundCards(on ? tournamentId : null, on ? round.id : null);
  const now = useMinuteClock();
  const course = useCourseGeometry(on ? round.courseName : null);
  const historyVersion = useSyncExternalStore(subscribePaceHistory, getPaceHistoryVersion, getPaceHistoryVersion);
  useEffect(() => { if (on) loadPaceHistory(); }, [on]);
  const mapPoint = coursePoint(course);
  const [phonePoint, setPhonePoint] = useState(null);
  useEffect(() => {
    if (!on || mapPoint || phonePoint) return undefined;
    let cancelled = false;
    lastKnownPoint().then((p) => { if (!cancelled && p) setPhonePoint(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, [on, mapPoint, phonePoint]);

  const scores = scoresIn ?? round?.scores;
  const holes = round?.holes;
  return useMemo(() => {
    if (!on) return null;
    const scored = scoredHoles(scores);
    const remaining = holesToPlay((holes ?? []).map((h) => h.number), scored);
    const span = roundSpan(state.cardsByAuthor);
    const startedAt = roundStartedAt(round);
    const startAt = span ? roundStartAt(span, createdAt, startedAt) : startedAt;

    const fix = getLiveFix()?.coords;
    const point = mapPoint ?? (fix ? [fix.latitude, fix.longitude] : phonePoint);
    const sun = point ? sunTimes(now.getTime(), point[0], point[1]) : null;

    return projectRound({
      now: now.getTime(),
      startAt,
      lastAt: span?.lastAt ?? null,
      played: scored.length,
      remaining,
      prior: priorPace(getPaceHistory(), round.courseName).minPerHole,
      dusk: sun?.dusk ?? null,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, scores, holes, state.cardsByAuthor, createdAt, mapPoint, phonePoint, now, historyVersion]);
}

export default useRoundPace;
