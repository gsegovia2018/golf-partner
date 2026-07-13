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

describe('tournament.setScoringMode mutation', () => {
  test('updates settings.scoringMode and leaves players unchanged', () => {
    const t = baseTournament();
    applyToTournament(t, {
      type: 'tournament.setScoringMode',
      scoringMode: 'individual',
    });
    expect(t.settings.scoringMode).toBe('individual');
    expect(t.players.map((p) => p.id)).toEqual(['a', 'b']);
  });

  test('preserves other settings fields when setting scoring mode', () => {
    const t = baseTournament();
    applyToTournament(t, {
      type: 'tournament.setScoringMode',
      scoringMode: 'bestball',
    });
    expect(t.settings.scoringMode).toBe('bestball');
    expect(t.settings.bestBallValue).toBe(1);
    expect(t.settings.worstBallValue).toBe(1);
  });

  test('applies roundPatches pairs so teams match the new mode', () => {
    const t = baseTournament();
    applyToTournament(t, {
      type: 'tournament.setScoringMode',
      scoringMode: 'bestball',
      roundPatches: [{ roundId: 'r1', pairs: [[{ id: 'a' }, { id: 'b' }]] }],
    });
    expect(t.settings.scoringMode).toBe('bestball');
    expect(t.rounds[0].pairs).toEqual([[{ id: 'a' }, { id: 'b' }]]);
  });

  test('without roundPatches it changes only the mode, leaving pairs intact', () => {
    const t = baseTournament();
    applyToTournament(t, {
      type: 'tournament.setScoringMode',
      scoringMode: 'individual',
    });
    expect(t.settings.scoringMode).toBe('individual');
    expect(t.rounds[0].pairs).toEqual([[{ id: 'a' }], [{ id: 'b' }]]);
  });
});

function fourPlayerTournament() {
  return {
    id: 't2',
    players: [
      { id: 'a', name: 'A', handicap: 10 },
      { id: 'b', name: 'B', handicap: 12 },
      { id: 'c', name: 'C', handicap: 8 },
      { id: 'd', name: 'D', handicap: 4 },
    ],
    rounds: [
      {
        id: 'r1',
        holes: [],
        pairs: [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }, { id: 'd' }]],
        revealed: true,
        playerHandicaps: { a: 10, b: 12, c: 8, d: 4 },
        scores: { a: { 1: 4 }, d: { 1: 5 } },
        shotDetails: { d: { 1: { putts: 2 } } },
      },
    ],
    currentRound: 0,
    settings: { scoringMode: 'bestball', bestBallValue: 1, worstBallValue: 1 },
  };
}

describe('tournament.removePlayer mutation', () => {
  test('removes the player from players', () => {
    const t = fourPlayerTournament();
    applyToTournament(t, {
      type: 'tournament.removePlayer',
      playerId: 'd',
      roundPatches: [{ roundId: 'r1', pairs: [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }]] }],
      nextScoringMode: 'stableford',
    });
    expect(t.players.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  test('deletes the removed player scores, shotDetails, and playerHandicaps', () => {
    const t = fourPlayerTournament();
    applyToTournament(t, {
      type: 'tournament.removePlayer',
      playerId: 'd',
      roundPatches: [{ roundId: 'r1', pairs: [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }]] }],
      nextScoringMode: 'stableford',
    });
    const round = t.rounds[0];
    expect(round.scores.d).toBeUndefined();
    expect(round.scores.a).toEqual({ 1: 4 });
    expect(round.shotDetails.d).toBeUndefined();
    expect(round.playerHandicaps.d).toBeUndefined();
    expect(round.playerHandicaps.a).toBe(10);
  });

  test('sets round pairs from the patch', () => {
    const t = fourPlayerTournament();
    applyToTournament(t, {
      type: 'tournament.removePlayer',
      playerId: 'd',
      roundPatches: [{ roundId: 'r1', pairs: [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }]] }],
      nextScoringMode: 'stableford',
    });
    expect(t.rounds[0].pairs).toEqual([[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }]]);
  });

  test('applies nextScoringMode when provided', () => {
    const t = fourPlayerTournament();
    applyToTournament(t, {
      type: 'tournament.removePlayer',
      playerId: 'd',
      roundPatches: [{ roundId: 'r1', pairs: [] }],
      nextScoringMode: 'stableford',
    });
    expect(t.settings.scoringMode).toBe('stableford');
  });

  test('leaves settings unchanged when nextScoringMode is absent', () => {
    const t = fourPlayerTournament();
    applyToTournament(t, {
      type: 'tournament.removePlayer',
      playerId: 'd',
      roundPatches: [{ roundId: 'r1', pairs: [] }],
    });
    expect(t.settings.scoringMode).toBe('bestball');
  });

  test('drops the removed player from scoreResolutions', () => {
    const t = fourPlayerTournament();
    t.rounds[0].scoreResolutions = {
      d: { 1: { value: 3, by: 'a', ts: 1 } },
      a: { 2: { value: 4, by: 'a', ts: 1 } },
    };
    applyToTournament(t, {
      type: 'tournament.removePlayer',
      playerId: 'd',
      roundPatches: [{ roundId: 'r1', pairs: [] }],
    });
    expect(t.rounds[0].scoreResolutions.d).toBeUndefined();
    expect(t.rounds[0].scoreResolutions.a).toBeDefined();
  });
});
