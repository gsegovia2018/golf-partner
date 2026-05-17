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

// ── holeDifficultySplit ──
// Buckets a player's holes by printed stroke index: hard 1-6, mid 7-12,
// easy 13-18. avgPoints is net Stableford points per hole in each band.
export function holeDifficultySplit(tournament, playerId) {
  const bands = { hard: [], mid: [], easy: [] };
  const player = (tournament.players || []).find((p) => p.id === playerId);
  if (player) {
    (tournament.rounds || []).forEach((round, roundIndex) => {
      if (!round.scores?.[playerId]) return;
      const handicap = getPlayingHandicap(round, player);
      (round.holes || []).forEach((hole) => {
        const sc = round.scores[playerId]?.[hole.number];
        if (!sc) return;
        const points = calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex);
        const band = hole.strokeIndex <= 6 ? 'hard'
          : hole.strokeIndex <= 12 ? 'mid' : 'easy';
        bands[band].push({
          roundIndex, courseName: round.courseName,
          holeNumber: hole.number, par: hole.par, si: hole.strokeIndex,
          strokes: sc, points,
        });
      });
    });
  }
  const summarize = (arr) => ({
    holes: arr.length,
    avgPoints: arr.length
      ? +(arr.reduce((s, e) => s + e.points, 0) / arr.length).toFixed(2)
      : 0,
    breakdown: arr,
  });
  return {
    hard: summarize(bands.hard),
    mid: summarize(bands.mid),
    easy: summarize(bands.easy),
  };
}

// ── computeMetrics ──
// Round-level aggregates over a synthetic tournament. Used for the Snapshot
// card and for both sides of the recent-vs-history comparison.
export function computeMetrics(synthetic) {
  const history = playerRoundHistory(synthetic, CANON_ID);
  const rounds = history.length;
  let vsParSum = 0;
  let vsParRounds = 0;
  (synthetic.rounds || []).forEach((round, ri) => {
    const h = history.find((x) => x.roundIndex === ri);
    if (!h) return;
    let parPlayed = 0;
    (round.holes || []).forEach((hole) => {
      if (round.scores?.[CANON_ID]?.[hole.number] != null) parPlayed += hole.par;
    });
    vsParSum += h.strokes - parPlayed;
    vsParRounds += 1;
  });
  const shots = shotStats(synthetic, CANON_ID);
  const div = (a, b) => (b > 0 ? +(a / b).toFixed(2) : 0);
  const totalPoints = history.reduce((s, h) => s + h.points, 0);
  return {
    rounds,
    avgPoints: div(totalPoints, rounds),
    avgVsPar: div(vsParSum, vsParRounds),
    bestRoundPoints: history.reduce((m, h) => Math.max(m, h.points), 0),
    hasShotData: shots.hasData,
    fairwayPct: shots.drives.fairwayPct,
    puttsPerRound: shots.putts.perRound,
    girPct: shots.gir.pct,
    threePuttsPerRound: div(shots.putts.threePuttPlus, shots.roundsWithData),
  };
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
