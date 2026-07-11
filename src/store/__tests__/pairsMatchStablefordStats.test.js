// Regression guard: player statistics for a pairsmatchplay round must be the
// Stableford points each player scored — NOT the match-play duel points
// (1 / 0.5 / 0 per hole). The two are very different numbers, so if a future
// change ever routed duel points into the stats pipeline this test would fail.
import { roundTotals, pairsMatchRoundTally } from '../scoring';
import { playerRoundHistory } from '../statsEngine';

const player = (id) => ({ id, name: id, handicap: 0 });
const players = [player('p1'), player('p2'), player('p3'), player('p4')];

// 3 par-4 holes. Scratch handicaps → Stableford = 2 + (par - strokes), min 0.
const holes = [
  { number: 1, par: 4, strokeIndex: 1 },
  { number: 2, par: 4, strokeIndex: 2 },
  { number: 3, par: 4, strokeIndex: 3 },
];
const scores = {
  p1: { 1: 3, 2: 4, 3: 5 }, // 3 + 2 + 1 = 6 Stableford
  p2: { 1: 4, 2: 4, 3: 4 }, // 2 + 2 + 2 = 6
  p3: { 1: 5, 2: 5, 3: 5 }, // 1 + 1 + 1 = 3
  p4: { 1: 6, 2: 6, 3: 6 }, // 0 + 0 + 0 = 0
};
const round = {
  id: 'r1',
  holes,
  scores,
  pairs: [[players[0], players[1]], [players[2], players[3]]],
  scoringMode: 'pairsmatchplay',
  revealed: true,
};
const tournament = {
  id: 't1',
  players,
  settings: { scoringMode: 'pairsmatchplay' },
  rounds: [round],
};

describe('pairsmatchplay → stats use Stableford, not match points', () => {
  const stablefordByPlayer = { p1: 6, p2: 6, p3: 3, p4: 0 };

  test('roundTotals reports Stableford totals for a pairsmatchplay round', () => {
    const totals = roundTotals(round, players);
    for (const { player: p, totalPoints } of totals) {
      expect(totalPoints).toBe(stablefordByPlayer[p.id]);
    }
  });

  test('statsEngine per-round history uses Stableford', () => {
    expect(playerRoundHistory(tournament, 'p1')[0].points).toBe(6);
    expect(playerRoundHistory(tournament, 'p3')[0].points).toBe(3);
  });

  test('the Stableford stat is distinct from the duel (match) points', () => {
    // p1 dominates their duel vs p3 (wins 2 holes, halves the third → 2.5 duel
    // points) yet scored 6 Stableford — different scales entirely.
    const tally = pairsMatchRoundTally(round, players);
    const p1Duel = tally.duels.find((d) => d.aId === 'p1' || d.bId === 'p1');
    const p1DuelPts = p1Duel.aId === 'p1' ? p1Duel.aPts : p1Duel.bPts;
    expect(p1DuelPts).toBe(2.5);
    expect(p1DuelPts).toBeLessThanOrEqual(holes.length); // duel pts ≤ holes played
    expect(roundTotals(round, players).find((t) => t.player.id === 'p1').totalPoints).toBe(6);
    expect(p1DuelPts).not.toBe(stablefordByPlayer.p1);
  });
});
