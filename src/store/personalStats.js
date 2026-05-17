// Personal cross-tournament statistics.
//
// Every function here is pure. The screen (MyStatsScreen) does the async
// loading and AsyncStorage persistence; this module only transforms data.
//
// Approach: collect the logged-in user's rounds from every tournament, build
// a synthetic single-player "tournament", and reuse the per-player functions
// in statsEngine.js. See docs/superpowers/specs/2026-05-17-my-stats-personal-view-design.md
import { getPlayingHandicap, calcStablefordPoints } from './tournamentStore';
import {
  parTypeSplit, warmupVsClosing, frontBackSplit, playerScoreDistribution,
  playerRoundHistory, playerConsistency, bounceBackRate, shotStats,
  teeShotImpact,
} from './statsEngine';

// Canonical player id used inside the synthetic tournament.
export const CANON_ID = 'me';

// ── buildSyntheticTournament ──
// Produces { id, name, players: [me], rounds } where every round's scores,
// shotDetails, playerHandicaps and manualHandicaps are re-keyed from the
// round's original player id to CANON_ID. This object is the input to the
// existing per-player engine functions.
export function buildSyntheticTournament(myRounds) {
  if (!myRounds || myRounds.length === 0) {
    return { id: 'mystats', name: 'My Stats', players: [], rounds: [] };
  }
  const base = myRounds[0].player || {};
  const player = {
    id: CANON_ID,
    name: base.name || 'Me',
    handicap: base.handicap ?? 0,
    user_id: base.user_id ?? null,
  };
  const rounds = myRounds.map((mr) => {
    const { round, playerId } = mr;
    const rekey = (obj) => (obj && obj[playerId] != null
      ? { [CANON_ID]: obj[playerId] }
      : {});
    return {
      ...round,
      scores: rekey(round.scores),
      shotDetails: rekey(round.shotDetails),
      playerHandicaps: rekey(round.playerHandicaps),
      manualHandicaps: rekey(round.manualHandicaps),
    };
  });
  return { id: 'mystats', name: 'My Stats', players: [player], rounds };
}

// ── collectMyRounds ──
// Flattens every tournament's rounds into MyRound records for the user.
// `tournaments` arrive newest-first (id desc) from the loaders, so we reverse
// to get chronological (oldest-first) order.
export function collectMyRounds(tournaments, userId) {
  const result = [];
  const chrono = [...(tournaments || [])].reverse();
  chrono.forEach((t) => {
    const me = (t.players || []).find((p) => p.user_id === userId);
    if (!me) return;
    (t.rounds || []).forEach((round, roundIndex) => {
      const myScores = round?.scores?.[me.id];
      if (!myScores || Object.keys(myScores).length === 0) return;
      const holes = round.holes || [];
      const completed = holes.length > 0
        && holes.every((h) => myScores[h.number] != null);
      result.push({
        key: `${t.id}:${roundIndex}`,
        round,
        tournamentId: t.id,
        tournamentName: t.name || 'Tournament',
        courseName: round.courseName || `Round ${roundIndex + 1}`,
        roundIndex,
        playerId: me.id,
        player: me,
        completed,
      });
    });
  });
  return result;
}
