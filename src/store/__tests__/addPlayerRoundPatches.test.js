import { addPlayerRoundPatches } from '../tournamentStore';

function makeTournament({ players, mode, rounds, currentRound = 0, fixedTeams = false }) {
  return {
    id: 't1',
    players,
    rounds,
    currentRound,
    settings: {
      scoringMode: mode, bestBallValue: 1, worstBallValue: 1, fixedTeams,
    },
  };
}

function makeRound({ id = 'r1', revealed = false, pairs = [], playerTees = {} } = {}) {
  return {
    id,
    holes: [],
    pairs,
    revealed,
    playerTees,
    playerHandicaps: {},
    manualHandicaps: {},
    scores: {},
  };
}

const A = { id: 'a', name: 'A', handicap: 10 };
const B = { id: 'b', name: 'B', handicap: 12 };
const C = { id: 'c', name: 'C', handicap: 8 };

describe('addPlayerRoundPatches mode resolution', () => {
  test('matchplay 2→3 with no override falls back to stableford', () => {
    const t = makeTournament({
      players: [A, B],
      mode: 'matchplay',
      rounds: [makeRound({ pairs: [[A], [B]] })],
    });
    const { nextScoringMode } = addPlayerRoundPatches(t, C);
    expect(nextScoringMode).toBe('stableford');
  });

  test('sindicato 3→4 with no override falls back to stableford', () => {
    const D = { id: 'd', name: 'D', handicap: 4 };
    const t = makeTournament({
      players: [A, B, C],
      mode: 'sindicato',
      rounds: [makeRound({ pairs: [[A], [B], [C]] })],
    });
    const { nextScoringMode } = addPlayerRoundPatches(t, D);
    expect(nextScoringMode).toBe('stableford');
  });

  test('matchplay 2→3 honors a valid { mode } override', () => {
    const t = makeTournament({
      players: [A, B],
      mode: 'matchplay',
      rounds: [makeRound({ pairs: [[A], [B]] })],
    });
    const { nextScoringMode } = addPlayerRoundPatches(t, C, { mode: 'sindicato' });
    expect(nextScoringMode).toBe('sindicato');
  });

  test('invalid override falls back when the override is not allowed for the new count', () => {
    const t = makeTournament({
      players: [A, B],
      mode: 'matchplay',
      rounds: [makeRound({ pairs: [[A], [B]] })],
    });
    // matchplay needs exactly 2 — at count 3 it is invalid even as an override
    const { nextScoringMode } = addPlayerRoundPatches(t, C, { mode: 'matchplay' });
    expect(nextScoringMode).toBe('stableford');
  });

  test('current mode is kept when still valid for new count', () => {
    const D = { id: 'd', name: 'D', handicap: 4 };
    const t = makeTournament({
      players: [A, B, C],
      mode: 'stableford', // valid at 3 and at 4
      rounds: [makeRound({ pairs: [[A, B], [C]] })],
    });
    const { nextScoringMode } = addPlayerRoundPatches(t, D);
    expect(nextScoringMode).toBe('stableford');
  });
});

describe('addPlayerRoundPatches return shape', () => {
  test('returns { patches, nextScoringMode }', () => {
    const t = makeTournament({
      players: [A, B],
      mode: 'individual',
      rounds: [makeRound({ pairs: [[A], [B]] })],
    });
    const result = addPlayerRoundPatches(t, C);
    expect(result).toEqual(expect.objectContaining({
      patches: expect.any(Array),
      nextScoringMode: expect.any(String),
    }));
  });
});

describe('addPlayerRoundPatches pair construction', () => {
  test('non-team new mode: every player becomes their own group', () => {
    const t = makeTournament({
      players: [A, B],
      mode: 'matchplay',
      rounds: [makeRound({ revealed: true, pairs: [[A], [B]] })],
    });
    const { patches } = addPlayerRoundPatches(t, C, { mode: 'individual' });
    expect(patches[0].pairs).toEqual([[A], [B], [C]]);
  });

  test('matchplay 2→3 with sindicato override produces solo pairs', () => {
    const t = makeTournament({
      players: [A, B],
      mode: 'matchplay',
      rounds: [makeRound({ revealed: true, pairs: [[A], [B]] })],
    });
    const { patches } = addPlayerRoundPatches(t, C, { mode: 'sindicato' });
    expect(patches[0].pairs).toEqual([[A], [B], [C]]);
  });

  test('team→team with revealed pairs: preserves existing pairs, new player joins as solo group', () => {
    const D = { id: 'd', name: 'D', handicap: 4 };
    const t = makeTournament({
      players: [A, B, C],
      mode: 'stableford',
      rounds: [makeRound({ revealed: true, pairs: [[A, B], [C]] })],
    });
    const { patches } = addPlayerRoundPatches(t, D);
    expect(patches[0].pairs).toEqual([[A, B], [C], [D]]);
  });

  test('team mode but not-yet-revealed round: randomizes fresh', () => {
    const D = { id: 'd', name: 'D', handicap: 4 };
    const t = makeTournament({
      players: [A, B, C],
      mode: 'stableford',
      rounds: [makeRound({ revealed: false, pairs: [] })],
    });
    const { patches } = addPlayerRoundPatches(t, D);
    const flat = patches[0].pairs.flat();
    expect(flat).toHaveLength(4);
    expect(flat.map((p) => p.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  test('non-team old + team new: randomizes fresh (matchplay 2→3 fallback to stableford)', () => {
    const t = makeTournament({
      players: [A, B],
      mode: 'matchplay',
      rounds: [makeRound({ revealed: true, pairs: [[A], [B]] })],
    });
    const { patches } = addPlayerRoundPatches(t, C);
    const flat = patches[0].pairs.flat();
    expect(flat).toHaveLength(3);
    expect(flat.map((p) => p.id).sort()).toEqual(['a', 'b', 'c']);
    // randomPairs(3) → [[x, y], [z]] (one pair + one solo)
    expect(patches[0].pairs.length).toBe(2);
  });

  test('non-team old + team new (sindicato 3→4 fallback to stableford): randomizes fresh', () => {
    const D = { id: 'd', name: 'D', handicap: 4 };
    const t = makeTournament({
      players: [A, B, C],
      mode: 'sindicato',
      rounds: [makeRound({ revealed: true, pairs: [[A], [B], [C]] })],
    });
    const { patches } = addPlayerRoundPatches(t, D);
    const flat = patches[0].pairs.flat();
    expect(flat).toHaveLength(4);
    expect(flat.map((p) => p.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    // randomPairs(4) → [[x, y], [z, w]]
    expect(patches[0].pairs.length).toBe(2);
  });
});

describe('addPlayerRoundPatches multi-round behavior', () => {
  test('rounds before currentRound are not patched', () => {
    const D = { id: 'd', name: 'D', handicap: 4 };
    const t = makeTournament({
      players: [A, B, C],
      mode: 'stableford',
      currentRound: 1,
      rounds: [
        makeRound({ id: 'r0', revealed: true, pairs: [[A, B], [C]] }),
        makeRound({ id: 'r1', revealed: true, pairs: [[A, C], [B]] }),
        makeRound({ id: 'r2', revealed: false, pairs: [] }),
      ],
    });
    const { patches } = addPlayerRoundPatches(t, D);
    const ids = patches.map((p) => p.roundId);
    expect(ids).toEqual(['r1', 'r2']);
  });

  test('each patch carries a derived playerHandicap', () => {
    const D = { id: 'd', name: 'D', handicap: 7 };
    const t = makeTournament({
      players: [A, B, C],
      mode: 'stableford',
      rounds: [makeRound({ revealed: true, pairs: [[A, B], [C]] })],
    });
    const { patches } = addPlayerRoundPatches(t, D);
    expect(patches[0].playerHandicap).toEqual(expect.any(Number));
  });
});

describe('addPlayerRoundPatches fixedTeams', () => {
  function pairIds(pairs) {
    return pairs.map((pr) => pr.map((p) => p.id).sort());
  }

  test('with fixedTeams, all future-round patches carry identical pairs', () => {
    const D = { id: 'd', name: 'D', handicap: 4 };
    const t = makeTournament({
      players: [A, B, C],
      mode: 'stableford',
      fixedTeams: true,
      currentRound: 0,
      rounds: [
        makeRound({ id: 'r0', revealed: false, pairs: [] }),
        makeRound({ id: 'r1', revealed: false, pairs: [] }),
        makeRound({ id: 'r2', revealed: false, pairs: [] }),
      ],
    });
    const { patches } = addPlayerRoundPatches(t, D);
    expect(patches).toHaveLength(3);
    const [p0, p1, p2] = patches.map((p) => pairIds(p.pairs));
    expect(p0).toEqual(p1);
    expect(p1).toEqual(p2);
    // Each patch still carries its own per-round derived handicap.
    patches.forEach((patch) => expect(patch.playerHandicap).toEqual(expect.any(Number)));
  });

  test('without fixedTeams, existing per-round behavior is unchanged', () => {
    const D = { id: 'd', name: 'D', handicap: 4 };
    const t = makeTournament({
      players: [A, B, C],
      mode: 'stableford',
      fixedTeams: false,
      currentRound: 0,
      rounds: [makeRound({ id: 'r0', revealed: true, pairs: [[A, B], [C]] })],
    });
    const { patches } = addPlayerRoundPatches(t, D);
    expect(patches[0].pairs).toEqual([[A, B], [C], [D]]);
  });
});
