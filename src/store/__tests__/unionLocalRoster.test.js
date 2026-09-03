import { unionLocalRoster } from '../mutate';

// A fetch may add or update a roster player; it may never delete one. The
// server tells the two apart with `deletedPlayerIds` (the tombstoned
// game_players rows — 20260903000000): absent AND tombstoned means removed,
// absent and NOT tombstoned means the add never landed.

const guillermo = { id: 'p2', name: 'Guillermo', handicap: 14 };
const local = { players: [{ id: 'p1', name: 'Marcos', handicap: 12 }, guillermo] };

describe('unionLocalRoster', () => {
  test('keeps a local player the server has never heard of', () => {
    const target = { players: [{ id: 'p1', name: 'Marcos', handicap: 12 }] };

    expect(unionLocalRoster(target, local).players).toEqual([
      { id: 'p1', name: 'Marcos', handicap: 12 },
      guillermo,
    ]);
  });

  test('drops a player the server reports as removed', () => {
    const target = {
      players: [{ id: 'p1', name: 'Marcos', handicap: 12 }],
      deletedPlayerIds: ['p2'],
    };

    expect(unionLocalRoster(target, local).players.map((p) => p.id)).toEqual(['p1']);
  });

  test('server fields win for a player both sides have', () => {
    // A rename that landed on another device must not be reverted by ours.
    const target = {
      players: [
        { id: 'p1', name: 'Marcos', handicap: 12 },
        { id: 'p2', name: 'Guille', handicap: 15 },
      ],
    };

    expect(unionLocalRoster(target, local).players).toEqual([
      { id: 'p1', name: 'Marcos', handicap: 12 },
      { id: 'p2', name: 'Guille', handicap: 15 },
    ]);
  });

  test('appends rather than restoring a local index — pos is frozen server-side', () => {
    const target = { players: [{ id: 'p1', name: 'Marcos', handicap: 12 }] };
    const localFirst = { players: [guillermo, { id: 'p1', name: 'Marcos', handicap: 12 }] };

    expect(unionLocalRoster(target, localFirst).players.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  test('a pre-migration server sending no deletedPlayerIds keeps the player', () => {
    // Safe direction: a stale local player lingers rather than being destroyed.
    const target = { players: [{ id: 'p1', name: 'Marcos', handicap: 12 }] };

    expect(unionLocalRoster(target, local).players.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  test('no-ops when either side has no players array', () => {
    const target = { players: [{ id: 'p1' }] };
    expect(unionLocalRoster(target, {}).players.map((p) => p.id)).toEqual(['p1']);
    expect(unionLocalRoster(target, null).players.map((p) => p.id)).toEqual(['p1']);
    expect(unionLocalRoster({ rounds: [] }, local)).toEqual({ rounds: [] });
  });

  test('ignores a local entry with no id', () => {
    const target = { players: [{ id: 'p1', name: 'Marcos' }] };
    const junk = { players: [{ name: 'nameless, idless' }] };

    expect(unionLocalRoster(target, junk).players.map((p) => p.id)).toEqual(['p1']);
  });
});
