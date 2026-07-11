import { buildThreeVsOne, swapDuelOrder, shuffleTeams } from '../teamEditing';
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

describe('shuffleTeams', () => {
  const pairs = [
    [players[0], players[1]],
    [players[2], players[3]],
  ];
  const key = (prs) => prs.map((p) => p.map((x) => x.id).join(',')).join('|');

  test('preserves each side size and the full roster (no dupes, no drops)', () => {
    const out = shuffleTeams(pairs);
    expect(out.map((p) => p.length)).toEqual([2, 2]);
    const ids = out.flat().map((p) => p.id).sort();
    expect(ids).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  test('preserves a 3v1 (uneven) shape', () => {
    const three = [[players[0], players[1], players[2]], [players[3]]];
    const out = shuffleTeams(three, () => 0.99);
    expect(out.map((p) => p.length)).toEqual([3, 1]);
    expect(out.flat().map((p) => p.id).sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  test('returns a different arrangement than the input (never a no-op)', () => {
    // A deterministic rand that always maps to index 0 in Fisher-Yates
    // reverses the array — guaranteed different from the input order.
    const out = shuffleTeams(pairs, () => 0);
    expect(key(out)).not.toEqual(key(pairs));
  });

  test('for pairsmatchplay a shuffle re-draws the duels', () => {
    const out = shuffleTeams(pairs, () => 0);
    expect(pairsMatchDuels(out)).not.toEqual(pairsMatchDuels(pairs));
  });

  test('default randomness eventually explores more than one arrangement', () => {
    const seen = new Set();
    for (let i = 0; i < 64 && seen.size < 2; i++) {
      seen.add(key(shuffleTeams(pairs)));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  test('non-2-pair input is returned unchanged', () => {
    const three = [[players[0]], [players[1]], [players[2]]];
    expect(shuffleTeams(three, () => 0)).toBe(three);
    expect(shuffleTeams(null, () => 0)).toBeNull();
  });
});
