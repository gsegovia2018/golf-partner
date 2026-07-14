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
    // Task 12: an odd Stableford-with-Partners roster forms ONE 3-player
    // team instead of the old unwinnable pair + solo singleton.
    expect(patches[0].pairs.length).toBe(1);
    expect(patches[0].pairs[0]).toHaveLength(3);
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

describe('addPlayerRoundPatches per-round mode overrides', () => {
  test('builds each future round with its own effective mode', () => {
    const D = { id: 'd', name: 'D', handicap: 4 };
    const t = makeTournament({
      players: [A, B, C],
      mode: 'individual',
      rounds: [
        makeRound({ id: 'r0' }),
        { ...makeRound({ id: 'r1' }), scoringMode: 'scramble3v1' },
      ],
    });
    const { patches } = addPlayerRoundPatches(t, D);
    const r0 = patches.find((p) => p.roundId === 'r0');
    const r1 = patches.find((p) => p.roundId === 'r1');
    // r0 has no override: falls back to nextScoringMode (individual → solo groups).
    expect(r0.pairs).toEqual([[A], [B], [C], [D]]);
    expect(r0.clearScoringMode).toBeUndefined();
    // scramble3v1 stays valid at 4 players → 3+1 shape, no clear.
    expect(r1.pairs.map((pr) => pr.length).sort()).toEqual([1, 3]);
    expect(r1.clearScoringMode).toBeUndefined();
  });

  test('clears an override that the new roster invalidates', () => {
    const D = { id: 'd', name: 'D', handicap: 4 };
    const t = makeTournament({
      players: [A, B, C],
      mode: 'individual',
      rounds: [{ ...makeRound({ id: 'r0' }), scoringMode: 'matchplay' }],
    });
    // matchplay is only valid at exactly 2 players — invalid at the new count of 4.
    const { patches } = addPlayerRoundPatches(t, D);
    const r0 = patches.find((p) => p.roundId === 'r0');
    expect(r0.clearScoringMode).toBe(true);
    // pairs rebuilt for the fallback (nextScoringMode) — individual stays valid at 4.
    expect(r0.pairs.flat()).toHaveLength(4);
  });

  test('fixedTeams caches pairs per team shape, not once overall', () => {
    const D = { id: 'd', name: 'D', handicap: 4 };
    const t = makeTournament({
      players: [A, B, C],
      mode: 'individual',
      fixedTeams: true,
      rounds: [
        { ...makeRound({ id: 'r0' }), scoringMode: 'scramble3v1' },
        { ...makeRound({ id: 'r1' }), scoringMode: 'scramble3v1' },
        makeRound({ id: 'r2' }), // no override → individual (solo shape)
      ],
    });
    const { patches } = addPlayerRoundPatches(t, D);
    const r0 = patches.find((p) => p.roundId === 'r0');
    const r1 = patches.find((p) => p.roundId === 'r1');
    const r2 = patches.find((p) => p.roundId === 'r2');
    // Same shape (3+1) → identical cached pairs across r0/r1.
    expect(r1.pairs.map((pr) => pr.map((p) => p.id).sort())).toEqual(
      r0.pairs.map((pr) => pr.map((p) => p.id).sort()),
    );
    // Different shape (solo) → not the fixed-team pairs.
    expect(r2.pairs).toEqual([[A], [B], [C], [D]]);
  });

  test('revealed round with a still-valid team override on a non-team default keeps its partnerships', () => {
    const D = { id: 'd', name: 'D', handicap: 4 };
    const t = makeTournament({
      players: [A, B, C],
      mode: 'individual', // tournament default is NOT a team mode
      rounds: [{
        ...makeRound({ id: 'r0', revealed: true, pairs: [[A, B], [C]] }),
        scoringMode: 'stableford', // round override IS a team mode, valid at 3 and 4
      }],
    });
    const { patches } = addPlayerRoundPatches(t, D);
    const r0 = patches.find((p) => p.roundId === 'r0');
    // Documented buildPairsForAddedPlayer behavior for team→team revealed:
    // existing partnerships preserved, the new player joins as a solo group —
    // NOT a fresh reshuffle. The round's pre-mutation mode is its override
    // (stableford), not the tournament default (individual).
    expect(r0.pairs).toEqual([[A, B], [C], [D]]);
    expect(r0.clearScoringMode).toBeUndefined();
  });
});
