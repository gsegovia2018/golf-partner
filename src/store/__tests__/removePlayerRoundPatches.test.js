import { removePlayerRoundPatches } from '../tournamentStore';

function makeTournament({ players, mode, rounds, currentRound = 0 }) {
  return {
    id: 't1',
    players,
    rounds,
    currentRound,
    settings: { scoringMode: mode, bestBallValue: 1, worstBallValue: 1 },
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

  test('team→team revealed: removed player dropped from their pair, others preserved', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'stableford',
      rounds: [makeRound({ revealed: true, pairs: [[A, B], [C, D]] })],
    });
    const { patches } = removePlayerRoundPatches(t, 'd');
    expect(patches[0].pairs).toEqual([[A, B], [C]]);
  });

  test('team→team revealed: a pair emptied by removal is discarded', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'stableford',
      rounds: [makeRound({ revealed: true, pairs: [[A, B], [C], [D]] })],
    });
    const { patches } = removePlayerRoundPatches(t, 'c');
    expect(patches[0].pairs).toEqual([[A, B], [D]]);
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

  test('bestball 4→3 fallback to stableford: existing pairs kept minus removed player', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'bestball',
      rounds: [makeRound({ revealed: true, pairs: [[A, B], [C, D]] })],
    });
    const { patches } = removePlayerRoundPatches(t, 'd');
    expect(patches[0].pairs).toEqual([[A, B], [C]]);
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
