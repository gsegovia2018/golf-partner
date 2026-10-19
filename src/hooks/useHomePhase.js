import { useEffect, useMemo, useState } from 'react';
import { homePhase, myPlayerIn, holesPlayed } from '../store/homePhase';
import { isTournamentFinished } from '../store/tournamentStore';
import { fetchRoundActivity } from '../store/tournamentRepo';
import { loadRound, getRoundState } from '../engine/store';
import { roundSpan } from '../store/roundDuration';
import { loadRoundMedia } from '../store/mediaStore';
import { collectMyRounds } from '../store/personalStats';
import { buildRoundReportCard } from '../store/roundReportCard';
import { isOnline } from '../lib/connectivity';

// Last hole published on each started, unfinished current round I'm in:
// this device's cards first, then the server for rounds scored elsewhere.
// Missing entries stay unknown (isRoundLive keeps those live).
async function loadLastActivity(tournaments, userId) {
  const started = (tournaments ?? []).filter((t) => {
    const round = t?.rounds?.[t.currentRound ?? 0];
    return round && t.kind !== 'official' && !isTournamentFinished(t) && myPlayerIn(t, userId)
      && holesPlayed(round, t.players ?? []) > 0;
  });
  const map = new Map();
  await Promise.all(started.map(async (t) => {
    const round = t.rounds[t.currentRound ?? 0];
    try {
      await loadRound(t.id, round.id);
      const span = roundSpan(getRoundState(t.id, round.id).cardsByAuthor);
      if (span) map.set(`${t.id}:${round.id}`, span.lastAt);
    } catch { /* unknown */ }
  }));
  const missing = started.filter((t) => !map.has(`${t.id}:${t.rounds[t.currentRound ?? 0].id}`));
  if (missing.length > 0 && isOnline()) {
    try {
      const rows = await fetchRoundActivity(missing.map((t) => t.id));
      for (const row of rows) {
        const key = `${row.tournament_id}:${row.round_id}`;
        const ms = Number(row.last_hole_ts) > 0 ? Number(row.last_hole_ts) : Date.parse(row.activity_ts);
        if (!map.has(key) && Number.isFinite(ms)) map.set(key, ms);
      }
    } catch { /* offline or old server: unknown */ }
  }
  return map;
}

// The Play tab's phase plus the async extras its After card shows: photos
// of the round and the report card's verdict.
export function useHomePhase(tournaments, userId, displayName = null) {
  const [activity, setActivity] = useState(null);
  useEffect(() => {
    let alive = true;
    loadLastActivity(tournaments, userId).then((m) => { if (alive) setActivity(m); });
    return () => { alive = false; };
  }, [tournaments, userId]);

  const phase = useMemo(
    () => homePhase(tournaments, { userId, now: Date.now(), lastActivityByKey: activity }),
    [tournaments, userId, activity],
  );

  const after = phase.after;
  const afterKey = after ? `${after.tournament.id}:${after.round.id}` : null;
  const [photos, setPhotos] = useState({ key: null, items: [] });
  useEffect(() => {
    if (!afterKey || phase.phase !== 'after') return undefined;
    let alive = true;
    loadRoundMedia(after.tournament.id, after.round.id)
      .then((items) => { if (alive) setPhotos({ key: afterKey, items: items.filter((m) => m.kind !== 'video') }); })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [afterKey, phase.phase]);

  const report = useMemo(() => {
    if (!after || phase.phase !== 'after') return null;
    try {
      const mine = collectMyRounds(tournaments, userId, displayName);
      return buildRoundReportCard(mine, `${after.tournament.id}:${after.roundIndex}`)?.headline ?? null;
    } catch {
      return null;
    }
  }, [after, phase.phase, tournaments, userId, displayName]);

  return { ...phase, photos: photos.key === afterKey ? photos.items : [], report };
}
