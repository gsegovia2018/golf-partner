import { useEffect, useMemo, useState } from 'react';
import { homePhase, holesPlayed, cardCandidates, withCardScores, cardShotDetails } from '../store/homePhase';
import { fetchRoundActivity } from '../store/tournamentRepo';
import { loadRound, getRoundState } from '../engine/store';
import { shownScores } from '../engine/cards';
import { roundSpan } from '../store/roundDuration';
import { isOnline } from '../lib/connectivity';

// What the card engine knows about each candidate round (homePhase.js
// cardCandidates): the scores this phone shows and the last hole published.
// Rounds with no local cards ask the server for their last activity.
// Missing activity stays unknown (isRoundLive keeps those live).
async function loadCardState(tournaments, userId) {
  const candidates = cardCandidates(tournaments, userId);
  const activity = new Map();
  const scores = new Map();
  const shots = new Map();
  await Promise.all(candidates.map(async ({ tournament: t, round }) => {
    const key = `${t.id}:${round.id}`;
    try {
      await loadRound(t.id, round.id);
      const state = getRoundState(t.id, round.id);
      const span = roundSpan(state.cardsByAuthor);
      if (span) activity.set(key, span.lastAt);
      const shown = shownScores(state, (t.players ?? []).map((p) => p.id), (round.holes ?? []).map((h) => h.number));
      if (Object.keys(shown).length > 0) scores.set(key, shown);
      const mine = cardShotDetails(state);
      if (Object.keys(mine).length > 0) shots.set(key, mine);
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
  return { activity, scores, shots };
}

// The Play tab's phase, read with the card engine's scores and activity.
export function useHomePhase(tournaments, userId) {
  const [cards, setCards] = useState(null);
  useEffect(() => {
    let alive = true;
    loadCardState(tournaments, userId).then((c) => { if (alive) setCards(c); });
    return () => { alive = false; };
  }, [tournaments, userId]);

  const merged = useMemo(() => withCardScores(tournaments, cards?.scores, cards?.shots), [tournaments, cards]);
  const phase = useMemo(
    () => homePhase(merged, { userId, now: Date.now(), lastActivityByKey: cards?.activity ?? null }),
    [merged, userId, cards],
  );


  return phase;
}
