import { removePlayerRoundPatches } from '../tournamentStore';

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

function makeRound({ id = 'r1', revealed = false, pairs = [] } = {}) {
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

describe('removePlayerRoundPatches mode resolution', () => {
  test('individual 4→3 keeps individual', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'individual',
      rounds: [makeRound({ pairs: [[A], [B], [C], [D]] })],
    });
    const { nextScoringMode } = removePlayerRoundPatches(t, 'd');
    expect(nextScoringMode).toBe('individual');
  });

  test('bestball 4→3 with no override falls back to stableford', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'bestball',
      rounds: [makeRound({ revealed: true, pairs: [[A, B], [C, D]] })],
    });
    const { nextScoringMode } = removePlayerRoundPatches(t, 'd');
    expect(nextScoringMode).toBe('stableford');
  });

  test('bestball 4→3 honors a valid { mode } override', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'bestball',
      rounds: [makeRound({ revealed: true, pairs: [[A, B], [C, D]] })],
    });
    const { nextScoringMode } = removePlayerRoundPatches(t, 'd', { mode: 'sindicato' });
    expect(nextScoringMode).toBe('sindicato');
  });

  test('invalid override is ignored and auto-fallback applies', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'bestball',
      rounds: [makeRound({ revealed: true, pairs: [[A, B], [C, D]] })],
    });
    // bestball needs exactly 4 — invalid at 3 even as an override
    const { nextScoringMode } = removePlayerRoundPatches(t, 'd', { mode: 'bestball' });
    expect(nextScoringMode).toBe('stableford');
  });

  test('sindicato 3→2 falls back to individual (stableford needs 3+)', () => {
    const t = makeTournament({
      players: [A, B, C],
      mode: 'sindicato',
      rounds: [makeRound({ pairs: [[A], [B], [C]] })],
    });
    const { nextScoringMode } = removePlayerRoundPatches(t, 'c');
    expect(nextScoringMode).toBe('individual');
  });

  test('stableford 4→3 keeps stableford', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'stableford',
      rounds: [makeRound({ revealed: true, pairs: [[A, B], [C, D]] })],
    });
    const { nextScoringMode } = removePlayerRoundPatches(t, 'd');
    expect(nextScoringMode).toBe('stableford');
  });
});

describe('removePlayerRoundPatches pair construction', () => {
  test('non-team new mode: survivors each become their own group', () => {
    const t = makeTournament({
      players: [A, B, C],
      mode: 'sindicato',
      rounds: [makeRound({ revealed: true, pairs: [[A], [B], [C]] })],
    });
    const { patches } = removePlayerRoundPatches(t, 'c');
    expect(patches[0].pairs).toEqual([[A], [B]]);
  });

  test('team→team revealed: removed player dropped from their pair, the emptied-to-singleton survivor merges into the other pair (no singleton)', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'stableford',
      rounds: [makeRound({ revealed: true, pairs: [[A, B], [C, D]] })],
    });
    const { patches } = removePlayerRoundPatches(t, 'd');
    // Task 14: [A,B],[C] would leave C as an unwinnable singleton — C
    // merges into the other pair instead, forming one 3-team.
    expect(patches[0].pairs).toEqual([[A, B, C]]);
  });

  test('team→team revealed: a pair emptied by removal is discarded, and the pre-existing singleton merges into the survivor pair', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'stableford',
      rounds: [makeRound({ revealed: true, pairs: [[A, B], [C], [D]] })],
    });
    const { patches } = removePlayerRoundPatches(t, 'c');
    // Task 14: [A,B],[D] would leave D as a singleton — D merges into the
    // surviving pair instead.
    expect(patches[0].pairs).toEqual([[A, B, D]]);
  });

  test('team→team revealed (5 -> 4 survivors): removing from the pair borrows from the 3-team so both end up pairs', () => {
    const E = { id: 'e', name: 'E', handicap: 6 };
    const t = makeTournament({
      players: [A, B, C, D, E],
      mode: 'stableford',
      rounds: [makeRound({ revealed: true, pairs: [[A, B], [C, D, E]] })],
    });
    const { patches } = removePlayerRoundPatches(t, 'b');
    expect(patches[0].pairs.map((pr) => pr.length).sort()).toEqual([2, 2]);
    expect(patches[0].pairs.some((pr) => pr.length === 1)).toBe(false);
    expect(patches[0].pairs.flat().map((p) => p.id).sort()).toEqual(['a', 'c', 'd', 'e']);
  });

  test('team→team revealed (6 -> 5 survivors): a pair emptied to a singleton merges into another pair ([2,3]-style, no singleton)', () => {
    const E = { id: 'e', name: 'E', handicap: 6 };
    const F = { id: 'f', name: 'F', handicap: 9 };
    const t = makeTournament({
      players: [A, B, C, D, E, F],
      mode: 'stableford',
      rounds: [makeRound({ revealed: true, pairs: [[A, B], [C, D], [E, F]] })],
    });
    const { patches } = removePlayerRoundPatches(t, 'f');
    expect(patches[0].pairs.map((pr) => pr.length).sort()).toEqual([2, 3]);
    expect(patches[0].pairs.some((pr) => pr.length === 1)).toBe(false);
    expect(patches[0].pairs.every((pr) => pr.length <= 3)).toBe(true);
    expect(patches[0].pairs.flat().map((p) => p.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  test('non-partners team mode (bestball) is unaffected: legacy filter/discard behavior, singletons not repaired', () => {
    // stableford is the only team mode without a fixed player-count
    // requirement, so it's the only mode buildPairsForRemovedPlayer can
    // reach the continuity branch for after a roster-size change UNLESS an
    // explicit { mode } override forces a fixed-count mode — here bestball
    // becomes valid again once the roster lands back on exactly 4.
    const E = { id: 'e', name: 'E', handicap: 6 };
    const t = makeTournament({
      players: [A, B, C, D, E],
      mode: 'stableford',
      rounds: [makeRound({ revealed: true, pairs: [[A, B], [C, D, E]] })],
    });
    const { patches, nextScoringMode } = removePlayerRoundPatches(t, 'a', { mode: 'bestball' });
    expect(nextScoringMode).toBe('bestball');
    // Task 14's no-singleton repair is scoped to newMode === 'stableford' —
    // bestball keeps the legacy behavior: B is left as a half-emptied
    // singleton, unrepaired.
    expect(patches[0].pairs).toEqual([[B], [C, D, E]]);
  });

  test('team new mode but not-yet-revealed round: randomizes fresh', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'stableford',
      rounds: [makeRound({ revealed: false, pairs: [] })],
    });
    const { patches } = removePlayerRoundPatches(t, 'd');
    const flat = patches[0].pairs.flat();
    expect(flat).toHaveLength(3);
    expect(flat.map((p) => p.id).sort()).toEqual(['a', 'b', 'c']);
  });

  test('bestball 4→3 fallback to stableford: existing pairs kept minus removed player, singleton merged (no singleton)', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'bestball',
      rounds: [makeRound({ revealed: true, pairs: [[A, B], [C, D]] })],
    });
    const { patches } = removePlayerRoundPatches(t, 'd');
    // The round ends up in stableford (bestball fallback) — Task 14's
    // no-singleton rule applies since the round is now stableford-shaped,
    // regardless of the pre-mutation mode having been bestball.
    expect(patches[0].pairs).toEqual([[A, B, C]]);
  });
});

describe('removePlayerRoundPatches multi-round behavior', () => {
  test('rounds before currentRound are not patched', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'stableford',
      currentRound: 1,
      rounds: [
        makeRound({ id: 'r0', revealed: true, pairs: [[A, B], [C, D]] }),
        makeRound({ id: 'r1', revealed: true, pairs: [[A, C], [B, D]] }),
        makeRound({ id: 'r2', revealed: false, pairs: [] }),
      ],
    });
    const { patches } = removePlayerRoundPatches(t, 'd');
    expect(patches.map((p) => p.roundId)).toEqual(['r1', 'r2']);
  });

  test('each patch carries a pairs array', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'stableford',
      rounds: [makeRound({ revealed: true, pairs: [[A, B], [C, D]] })],
    });
    const { patches } = removePlayerRoundPatches(t, 'd');
    expect(Array.isArray(patches[0].pairs)).toBe(true);
    expect(patches[0].roundId).toBe('r1');
  });
});

describe('removePlayerRoundPatches fixedTeams', () => {
  function pairIds(pairs) {
    return pairs.map((pr) => pr.map((p) => p.id).sort());
  }

  test('with fixedTeams, all future-round patches carry identical pairs', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'stableford',
      fixedTeams: true,
      currentRound: 0,
      rounds: [
        makeRound({ id: 'r0', revealed: false, pairs: [] }),
        makeRound({ id: 'r1', revealed: false, pairs: [] }),
        makeRound({ id: 'r2', revealed: false, pairs: [] }),
      ],
    });
    const { patches } = removePlayerRoundPatches(t, 'd');
    expect(patches).toHaveLength(3);
    const [p0, p1, p2] = patches.map((p) => pairIds(p.pairs));
    expect(p0).toEqual(p1);
    expect(p1).toEqual(p2);
  });

  test('without fixedTeams, existing per-round behavior is unchanged', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'stableford',
      fixedTeams: false,
      currentRound: 0,
      rounds: [makeRound({ id: 'r0', revealed: true, pairs: [[A, B], [C, D]] })],
    });
    const { patches } = removePlayerRoundPatches(t, 'd');
    expect(patches[0].pairs).toEqual([[A, B, C]]);
  });
});

describe('removePlayerRoundPatches per-round mode overrides', () => {
  test('builds each future round with its own effective mode', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'stableford',
      rounds: [
        makeRound({ id: 'r0' }),
        { ...makeRound({ id: 'r1', revealed: true, pairs: [[A], [B, C], [D]] }), scoringMode: 'sindicato' },
      ],
    });
    const { patches } = removePlayerRoundPatches(t, 'd'); // 3 survivors
    const r0 = patches.find((p) => p.roundId === 'r0');
    const r1 = patches.find((p) => p.roundId === 'r1');
    // r0 has no override: falls back to nextScoringMode (stableford stays valid at 3).
    expect(r0.pairs.flat().map((p) => p.id).sort()).toEqual(['a', 'b', 'c']);
    expect(r0.clearScoringMode).toBeUndefined();
    // sindicato stays valid at 3 survivors → solo groups, no clear.
    expect(r1.pairs).toEqual([[A], [B], [C]]);
    expect(r1.clearScoringMode).toBeUndefined();
  });

  test('clears an override that the new roster invalidates', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'individual',
      rounds: [{ ...makeRound({ id: 'r0' }), scoringMode: 'scramblepairs' }],
    });
    const { patches } = removePlayerRoundPatches(t, 'd'); // 3 survivors
    const r0 = patches.find((p) => p.roundId === 'r0');
    // scramblepairs needs exactly 4 — invalid at 3 survivors.
    expect(r0.clearScoringMode).toBe(true);
    // pairs rebuilt for the fallback (nextScoringMode → individual, stays valid).
    expect(r0.pairs.flat()).toHaveLength(3);
  });

  test('fixedTeams caches pairs per team shape, not once overall', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'individual',
      fixedTeams: true,
      rounds: [
        { ...makeRound({ id: 'r0' }), scoringMode: 'stableford' },
        { ...makeRound({ id: 'r1' }), scoringMode: 'stableford' },
        makeRound({ id: 'r2' }), // no override → individual (solo shape)
      ],
    });
    const { patches } = removePlayerRoundPatches(t, 'd'); // 3 survivors
    const r0 = patches.find((p) => p.roundId === 'r0');
    const r1 = patches.find((p) => p.roundId === 'r1');
    const r2 = patches.find((p) => p.roundId === 'r2');
    // Same shape (2x2) → identical cached pairs across r0/r1.
    expect(r1.pairs.map((pr) => pr.map((p) => p.id).sort())).toEqual(
      r0.pairs.map((pr) => pr.map((p) => p.id).sort()),
    );
    // Different shape (solo) → not the fixed-team pairs.
    expect(r2.pairs).toEqual([[A], [B], [C]]);
  });

  test('revealed round with a still-valid team override on a non-team default keeps its partnerships', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'individual', // tournament default is NOT a team mode
      rounds: [{
        ...makeRound({ id: 'r0', revealed: true, pairs: [[A, B], [C, D]] }),
        scoringMode: 'stableford', // round override IS a team mode, valid at 4 and 3
      }],
    });
    const { patches } = removePlayerRoundPatches(t, 'd'); // 3 survivors
    const r0 = patches.find((p) => p.roundId === 'r0');
    // Documented buildPairsForRemovedPlayer behavior for team→team revealed:
    // existing partnerships kept minus the removed player, with a
    // half-emptied pair merged into another team instead of left as a
    // singleton (Task 14) — NOT a fresh reshuffle. The round's
    // pre-mutation mode is its override (stableford), not the tournament
    // default (individual).
    expect(r0.pairs).toEqual([[A, B, C]]);
    expect(r0.clearScoringMode).toBeUndefined();
  });
});
