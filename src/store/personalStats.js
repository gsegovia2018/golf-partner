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
