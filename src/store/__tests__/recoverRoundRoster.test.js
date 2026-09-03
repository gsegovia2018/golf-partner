import { recoverRoundRoster, resolvePairs } from '../scoring';

// The scar: `players` is replaced wholesale by every remote pull, so a player
// whose add never reached the server is deleted locally on the next fetch —
// while pairs (ids only) and the id-keyed scores/playerHandicaps maps keep
// pointing at him. The pair slot and the scores stay; only the NAME goes.
// recoverRoundRoster names him back from the local player library.

const LIBRARY = [
  { id: 'p1', name: 'Marcos', handicap: 12, gender: 'male' },
  { id: 'p2', name: 'Guillermo', handicap: 14, gender: 'male', user_id: 'u-guille' },
  { id: 'p9', name: 'Someone Else', handicap: 20 },
];

const roster = [{ id: 'p1', name: 'Marcos', handicap: 12 }];

function roundWith(overrides) {
  return {
    id: 't1-r0',
    holes: [{ number: 1, par: 4, strokeIndex: 1 }],
    pairs: [[{ id: 'p1' }, { id: 'p2' }]],
    scores: {},
    playerHandicaps: { p1: 12, p2: 14 },
    ...overrides,
  };
}

describe('recoverRoundRoster', () => {
  test('names a pair member the roster lost', () => {
    const out = recoverRoundRoster(roundWith(), roster, LIBRARY);

    expect(out.map((p) => p.name)).toEqual(['Marcos', 'Guillermo']);
    const [pair] = resolvePairs(roundWith().pairs, out);
    expect(pair.map((p) => p.name)).toEqual(['Marcos', 'Guillermo']);
  });

  test('carries the library handicap, gender and account link', () => {
    const [, guille] = recoverRoundRoster(roundWith(), roster, LIBRARY);

    expect(guille).toEqual({
      id: 'p2', name: 'Guillermo', handicap: 14, gender: 'male', user_id: 'u-guille',
    });
  });

  test('recovers from scores alone when the round has no pairs', () => {
    const round = roundWith({ pairs: undefined, playerHandicaps: {}, scores: { p2: { 1: 5 } } });

    expect(recoverRoundRoster(round, roster, LIBRARY).map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  test('leaves the roster untouched — same reference — when nothing is missing', () => {
    const full = [...roster, { id: 'p2', name: 'Guillermo', handicap: 14 }];

    expect(recoverRoundRoster(roundWith(), full, LIBRARY)).toBe(full);
  });

  test('does not resurrect a player removed from this round', () => {
    // removePlayerRoundPatches clears the removed player from pairs/scores;
    // the server-side patch writes JSON null into playerHandicaps rather than
    // deleting the nested key, so a present-but-null entry must not count.
    const round = roundWith({
      pairs: [[{ id: 'p1' }]],
      scores: {},
      playerHandicaps: { p1: 12, p2: null },
    });

    expect(recoverRoundRoster(round, roster, LIBRARY)).toBe(roster);
  });

  test('still names them on an already-played round they were removed from later', () => {
    // Removal leaves played rounds intact as history — that round still
    // carries their scores, so their name belongs on it.
    const played = roundWith({ pairs: [[{ id: 'p1' }, { id: 'p2' }]], scores: { p2: { 1: 5 } } });

    expect(recoverRoundRoster(played, roster, LIBRARY).map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  test('never invents a row for an id the library cannot name', () => {
    const round = roundWith({ pairs: [[{ id: 'p1' }, { id: 'ghost' }]], playerHandicaps: {} });

    expect(recoverRoundRoster(round, roster, LIBRARY)).toBe(roster);
    expect(recoverRoundRoster(round, roster, [{ id: 'ghost' }])).toBe(roster);
  });

  test('passes the roster through with no round or no library', () => {
    expect(recoverRoundRoster(null, roster, LIBRARY)).toBe(roster);
    expect(recoverRoundRoster(roundWith(), roster, null)).toBe(roster);
    expect(recoverRoundRoster(roundWith(), roster, [])).toBe(roster);
  });
});
