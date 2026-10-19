import { useEffect, useMemo, useState } from 'react';
import { homePhase, holesPlayed, cardCandidates, withCardScores } from '../store/homePhase';
import { fetchRoundActivity } from '../store/tournamentRepo';
import { loadRound, getRoundState } from '../engine/store';
import { shownScores } from '../engine/cards';
import { roundSpan } from '../store/roundDuration';
import { loadRoundMedia } from '../store/mediaStore';
import { collectMyRounds } from '../store/personalStats';
import { buildRoundReportCard } from '../store/roundReportCard';
import { isOnline } from '../lib/connectivity';

// What the card engine knows about each candidate round (homePhase.js
// cardCandidates): the scores this phone shows and the last hole published.
// Rounds with no local cards ask the server for their last activity.
// Missing activity stays unknown (isRoundLive keeps those live).
async function loadCardState(tournaments, userId) {
  const candidates = cardCandidates(tournaments, userId);
  const activity = new Map();
  const scores = new Map();
  await Promise.all(candidates.map(async ({ tournament: t, round }) => {
    const key = `${t.id}:${round.id}`;
    try {
      await loadRound(t.id, round.id);
      const state = getRoundState(t.id, round.id);
      const span = roundSpan(state.cardsByAuthor);
      if (span) activity.set(key, span.lastAt);
      const shown = shownScores(state, (t.players ?? []).map((p) => p.id), (round.holes ?? []).map((h) => h.number));
      if (Object.keys(shown).length > 0) scores.set(key, shown);
    } catch { /* unknown */ }
  }));
  const missing = candidates.filter(({ tournament: t, round }) => {
    const key = `${t.id}:${round.id}`;
    return !activity.has(key) && (scores.has(key) || holesPlayed(round, t.players ?? []) > 0);
  });
  if (missing.length > 0 && isOnline()) {
    try {
      const rows = await fetchRoundActivity(missing.map(({ tournament: t }) => t.id));
      for (const row of rows) {
        const key = `${row.tournament_id}:${row.round_id}`;
        const ms = Number(row.last_hole_ts) > 0 ? Number(row.last_hole_ts) : Date.parse(row.activity_ts);
        if (!activity.has(key) && Number.isFinite(ms)) activity.set(key, ms);
      }
    } catch { /* offline or old server: unknown */ }
  }
  return { activity, scores };
}

// The Play tab's phase plus the async extras its After card shows: photos
// of the round and the report card's verdict.
export function useHomePhase(tournaments, userId, displayName = null) {
  const [cards, setCards] = useState(null);
  useEffect(() => {
    let alive = true;
    loadCardState(tournaments, userId).then((c) => { if (alive) setCards(c); });
    return () => { alive = false; };
  }, [tournaments, userId]);

  const merged = useMemo(() => withCardScores(tournaments, cards?.scores), [tournaments, cards]);
  const phase = useMemo(
    () => homePhase(merged, { userId, now: Date.now(), lastActivityByKey: cards?.activity ?? null }),
    [merged, userId, cards],
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
      const mine = collectMyRounds(merged, userId, displayName);
      return buildRoundReportCard(mine, `${after.tournament.id}:${after.roundIndex}`)?.headline ?? null;
    } catch {
      return null;
    }
  }, [after, phase.phase, merged, userId, displayName]);

  return { ...phase, photos: photos.key === afterKey ? photos.items : [], report };
}
