// Two-pair games on the Home cards (Best Ball / Worst Ball, Stableford with
// Partners): each pair's points per hole and in total. Same numbers as the
// scorecard's match panel: best/worst-ball holes won times their values
// (scoreModel holeTeamPts / roundTeamPts, a halved ball scores nothing), or
// the partners' Stableford points added up (roundPairLeaderboard).
// Pure: no React, no language.
import { calcBestWorstBall } from './tournamentStore';
import {
  resolvePairs, roundScoringMode, roundBestBallValues, getPlayingHandicap, calcStablefordPoints, holeCountOf,
} from './scoring';
import { holeTeamPts, roundTeamPts } from '../components/scorecard/scoreModel';

const PAIR_MODES = new Set(['bestball', 'stableford']);

// pairBoard(tournament, round, meId) → null for any other game, else {
//   mode:  'bestball' | 'stableford'
//   sides: [{ side, ids, mine, points, holes: { [number]: points | null } }]  my pair and me first;
//          `side` is the round's own pair index (0 = Pair A, 1 = Pair B)
//   balls: [{ number, best, worst }]  bestball only; each the winning side,
//          'halved', or null while the hole is not fully scored
//   leader: the leading side, null when level
//   lead:   points between the two
//   holesLeft: holes not yet scored by all four
// }
export function pairBoard(tournament, round, meId) {
  if (!round) return null;
  const mode = roundScoringMode(tournament, round);
  if (!PAIR_MODES.has(mode)) return null;
  const players = tournament?.players ?? [];
  const pairs = resolvePairs(round.pairs, players);
  if (!Array.isArray(pairs) || pairs.length !== 2 || pairs.some((pr) => !Array.isArray(pr) || pr.length === 0)) return null;
  const holes = round.holes ?? [];
  const scored = (id, n) => round.scores?.[id]?.[n] != null;

  let points;
  let holePoints;
  let balls = null;
  if (mode === 'bestball') {
    const bb = calcBestWorstBall(round, players);
    if (!bb) return null;
    const { bestBallValue, worstBallValue } = roundBestBallValues(tournament, round);
    points = [1, 2].map((team) => roundTeamPts(bb, team, bestBallValue, worstBallValue));
    holePoints = (side) => Object.fromEntries(bb.holes.map((h) => [h.number, holeTeamPts(h, side + 1, bestBallValue, worstBallValue)]));
    const winner = (w) => (w == null ? null : w === 0 ? 'halved' : w - 1);
    balls = bb.holes.map((h) => ({ number: h.number, best: winner(h.bestWinner), worst: winner(h.worstWinner) }));
  } else {
    const holeCount = holeCountOf(round);
    const memberPts = (p, h) => (scored(p.id, h.number)
      ? calcStablefordPoints(h.par, round.scores[p.id][h.number], getPlayingHandicap(round, p), h.strokeIndex, holeCount)
      : null);
    holePoints = (side) => Object.fromEntries(holes.map((h) => {
      const each = pairs[side].map((p) => memberPts(p, h));
      return [h.number, each.some((v) => v == null) ? null : each.reduce((a, b) => a + b, 0)];
    }));
    // Every scored hole counts, as in roundPairLeaderboard's combined points.
    points = [0, 1].map((side) => pairs[side].reduce((sum, p) => sum + holes.reduce((s, h) => s + (memberPts(p, h) ?? 0), 0), 0));
  }

  const sides = [0, 1].map((side) => ({
    side,
    // Me first in my own pair.
    ids: pairs[side].map((p) => p.id).sort((x, y) => (y === meId) - (x === meId)),
    mine: pairs[side].some((p) => p.id === meId),
    points: points[side],
    holes: holePoints(side),
  }));
  const everyone = sides.flatMap((s) => s.ids);
  const leader = points[0] === points[1] ? null : points[0] > points[1] ? 0 : 1;
  return {
    mode,
    sides: sides[1].mine && !sides[0].mine ? [sides[1], sides[0]] : sides,
    balls,
    leader,
    lead: Math.abs(points[0] - points[1]),
    holesLeft: holes.filter((h) => !everyone.every((id) => scored(id, h.number))).length,
  };
}
