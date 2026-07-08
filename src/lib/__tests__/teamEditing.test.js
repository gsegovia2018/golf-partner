import { buildThreeVsOne, swapDuelOrder } from '../teamEditing';
import { pairsMatchDuels } from '../../store/scoring';

const players = [
  { id: 'p1', name: 'Marcos' },
  { id: 'p2', name: 'Guille' },
  { id: 'p3', name: 'Noé' },
  { id: 'p4', name: 'Alex' },
];

describe('buildThreeVsOne', () => {
  test('puts the tapped player alone on the solo side', () => {
    const [, solo] = buildThreeVsOne(players, 'p3');
    expect(solo).toEqual([players[2]]);
  });

  test('keeps roster order for the three-player side, regardless of solo pick', () => {
    for (const soloPlayer of players) {
      const [three] = buildThreeVsOne(players, soloPlayer.id);
      const expected = players.filter((p) => p.id !== soloPlayer.id);
      expect(three).toEqual(expected);
    }
  });

  test('covers all four players between the two sides, with no duplicates', () => {
    const [three, solo] = buildThreeVsOne(players, 'p1');
    expect(three).toHaveLength(3);
    expect(solo).toHaveLength(1);
    const ids = [...three, ...solo].map((p) => p.id).sort();
    expect(ids).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  test('unknown soloId leaves the roster intact on the three side and an empty solo side', () => {
    const [three, solo] = buildThreeVsOne(players, 'not-a-real-id');
    expect(three).toEqual(players);
    expect(solo).toEqual([]);
  });
});

describe('swapDuelOrder', () => {
  const pairs = [
    [players[0], players[1]],
    [players[2], players[3]],
  ];

  test('reverses the second pair, leaving the first untouched', () => {
    const swapped = swapDuelOrder(pairs);
    expect(swapped[0]).toEqual(pairs[0]);
    expect(swapped[1]).toEqual([players[3], players[2]]);
  });

  test('double swap returns to the original assignment', () => {
    const twice = swapDuelOrder(swapDuelOrder(pairs));
    expect(twice).toEqual(pairs);
  });

  test('produces the other set of duel matchups (pairsMatchDuels changes)', () => {
    const before = pairsMatchDuels(pairs);
    const after = pairsMatchDuels(swapDuelOrder(pairs));
    expect(before).toEqual([[players[0], players[2]], [players[1], players[3]]]);
    expect(after).toEqual([[players[0], players[3]], [players[1], players[2]]]);
    expect(after).not.toEqual(before);
  });

  test('non-2-pair input is returned unchanged', () => {
    const solo = [[players[0]], [players[1]], [players[2]]];
    expect(swapDuelOrder(solo)).toBe(solo);
    expect(swapDuelOrder(null)).toBeNull();
  });
});
