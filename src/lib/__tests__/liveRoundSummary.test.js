import { liveRoundSummary } from '../liveRoundSummary';

// Mirrors the real tournamentStore shapes: hole objects need `number` (used
// by roundTotals/roundLeaderboard to look up round.scores[playerId][number]),
// not just `par`/`strokeIndex`. See src/store/scoring.js:151-166.
const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));

function makeTournament(overrides = {}) {
  return {
    name: 'Weekend Golf',
    kind: 'tournament',
    meId: 'p1',
    currentRound: 1,
    players: [{ id: 'p1', name: 'Marcos' }, { id: 'p2', name: 'Noé' }],
    rounds: [
      { courseName: 'CCVM Amarillo', holes, scores: {} },
      {
        courseName: 'CCVM Negro',
        holes,
        scores: { p1: { 1: 4, 2: 5, 3: 4 }, p2: { 1: 5, 2: 5 } },
      },
    ],
    ...overrides,
  };
}

describe('liveRoundSummary', () => {
  it('returns null without a tournament or when finished', () => {
    expect(liveRoundSummary(null)).toBeNull();
    expect(liveRoundSummary(makeTournament({ finishedAt: 123 }))).toBeNull();
  });

  it('summarizes the live round', () => {
    const s = liveRoundSummary(makeTournament());
    expect(s).not.toBeNull();
    expect(s.name).toBe('Weekend Golf');
    expect(s.roundLabel).toBe('Round 2');
    expect(s.courseName).toBe('CCVM Negro');
    expect(s.thru).toBe(3);            // my entered holes
    expect(s.holeCount).toBe(18);
    expect(typeof s.myPoints).toBe('number');
  });

  it('returns null when the round is fully scored', () => {
    const full = {};
    for (let h = 1; h <= 18; h++) full[h] = 4;
    const t = makeTournament();
    t.rounds[1].scores = { p1: { ...full }, p2: { ...full } };
    expect(liveRoundSummary(t)).toBeNull();
  });
});
