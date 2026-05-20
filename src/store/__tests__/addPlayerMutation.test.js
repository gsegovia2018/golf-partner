import { applyToTournament } from '../mutate';

function baseTournament() {
  return {
    id: 't1',
    players: [
      { id: 'a', name: 'A', handicap: 10 },
      { id: 'b', name: 'B', handicap: 12 },
    ],
    rounds: [
      {
        id: 'r1',
        holes: [],
        pairs: [[{ id: 'a' }], [{ id: 'b' }]],
        revealed: true,
        playerHandicaps: {},
        scores: {},
      },
    ],
    currentRound: 0,
    settings: { scoringMode: 'matchplay', bestBallValue: 1, worstBallValue: 1 },
  };
}

describe('tournament.addPlayer mutation', () => {
  test('applies nextScoringMode to settings.scoringMode when provided', () => {
    const t = baseTournament();
    const player = { id: 'c', name: 'C', handicap: 8 };
    applyToTournament(t, {
      type: 'tournament.addPlayer',
      player,
      roundPatches: [{
        roundId: 'r1',
        playerHandicap: 8,
        pairs: [[{ id: 'a' }], [{ id: 'b' }], [{ id: 'c' }]],
      }],
      nextScoringMode: 'stableford',
    });
    expect(t.settings.scoringMode).toBe('stableford');
    expect(t.players.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  test('leaves settings unchanged when nextScoringMode is absent', () => {
    const t = baseTournament();
    const player = { id: 'c', name: 'C', handicap: 8 };
    applyToTournament(t, {
      type: 'tournament.addPlayer',
      player,
      roundPatches: [{
        roundId: 'r1',
        playerHandicap: 8,
        pairs: [[{ id: 'a' }], [{ id: 'b' }], [{ id: 'c' }]],
      }],
    });
    expect(t.settings.scoringMode).toBe('matchplay');
    expect(t.players.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  test('preserves other settings fields when nextScoringMode is applied', () => {
    const t = baseTournament();
    const player = { id: 'c', name: 'C', handicap: 8 };
    applyToTournament(t, {
      type: 'tournament.addPlayer',
      player,
      roundPatches: [],
      nextScoringMode: 'stableford',
    });
    expect(t.settings.scoringMode).toBe('stableford');
    expect(t.settings.bestBallValue).toBe(1);
    expect(t.settings.worstBallValue).toBe(1);
  });
});
