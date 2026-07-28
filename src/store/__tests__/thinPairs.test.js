// round.pairs used to embed whole player objects, which drift: measured on
// prod 2026-07-28, 14 of 143 embedded copies carried a user_id that disagreed
// with game_players. No consumer reads those fields -- all 19 files that touch
// pairs use p.id or resolve through the roster with the embedded copy as a
// dead fallback -- so pairs now persist ids only.
import { thinPairs } from '../scoring';

describe('thinPairs', () => {
  test('reduces each member to its id', () => {
    const pairs = [
      [{ id: 'a', name: 'Ann', handicap: 12, user_id: 'u1' }, { id: 'b', name: 'Bo' }],
      [{ id: 'c', name: 'Cy', avatar_url: null }],
    ];
    expect(thinPairs(pairs)).toEqual([[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }]]);
  });

  test('is idempotent', () => {
    const thin = [[{ id: 'a' }, { id: 'b' }]];
    expect(thinPairs(thinPairs(thin))).toEqual(thin);
  });

  test('passes through non-array input untouched', () => {
    expect(thinPairs(undefined)).toBeUndefined();
    expect(thinPairs(null)).toBeNull();
  });

  test('does not mutate its input', () => {
    const pairs = [[{ id: 'a', name: 'Ann' }]];
    thinPairs(pairs);
    expect(pairs[0][0].name).toBe('Ann');
  });

  test('tolerates an empty pairs array and empty teams', () => {
    expect(thinPairs([])).toEqual([]);
    expect(thinPairs([[]])).toEqual([[]]);
  });
});
