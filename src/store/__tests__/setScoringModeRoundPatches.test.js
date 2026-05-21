import { setScoringModeRoundPatches } from '../tournamentStore';

function makeTournament({ players, mode, rounds, currentRound = 0 }) {
  return {
    id: 't1',
    players,
    rounds,
    currentRound,
    settings: { scoringMode: mode, bestBallValue: 1, worstBallValue: 1 },
  };
}

function makeRound({ id = 'r1', revealed = true, pairs = [] } = {}) {
  return {
    id,
    holes: [],
    pairs,
    revealed,
    playerHandicaps: {},
    manualHandicaps: {},
    scores: {},
  };
}

const A = { id: 'a', name: 'A', handicap: 10 };
const B = { id: 'b', name: 'B', handicap: 12 };
const C = { id: 'c', name: 'C', handicap: 8 };
const D = { id: 'd', name: 'D', handicap: 4 };

describe('setScoringModeRoundPatches', () => {
  test('switching INTO Best Ball from individual builds two pairs of two', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'individual',
      rounds: [makeRound({ pairs: [[A], [B], [C], [D]] })],
    });
    const { patches } = setScoringModeRoundPatches(t, 'bestball');
    expect(patches).toHaveLength(1);
    expect(patches[0].roundId).toBe('r1');
    const pairs = patches[0].pairs;
    expect(pairs).toHaveLength(2);
    expect(pairs.every((pr) => pr.length === 2)).toBe(true);
    // Every player appears exactly once across the two pairs.
    expect(pairs.flat().map((p) => p.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  test('switching OUT of Best Ball to individual collapses pairs to singletons', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'bestball',
      rounds: [makeRound({ pairs: [[A, B], [C, D]] })],
    });
    const { patches } = setScoringModeRoundPatches(t, 'individual');
    expect(patches[0].pairs).toEqual([[A], [B], [C], [D]]);
  });

  test('team-to-team change with revealed pairs keeps the existing partnerships', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'stableford',
      rounds: [makeRound({ revealed: true, pairs: [[A, B], [C, D]] })],
    });
    const { patches } = setScoringModeRoundPatches(t, 'bestball');
    expect(patches[0].pairs).toEqual([[A, B], [C, D]]);
  });

  test('already-played earlier rounds are left untouched', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'individual',
      rounds: [
        makeRound({ id: 'r1', pairs: [[A], [B], [C], [D]] }),
        makeRound({ id: 'r2', pairs: [[A], [B], [C], [D]] }),
      ],
      currentRound: 1,
    });
    const { patches } = setScoringModeRoundPatches(t, 'bestball');
    expect(patches).toHaveLength(1);
    expect(patches[0].roundId).toBe('r2');
  });
});
