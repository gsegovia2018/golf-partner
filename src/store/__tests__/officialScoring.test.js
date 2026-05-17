import { assignRoundRobinMarkers } from '../officialScoring';

describe('assignRoundRobinMarkers', () => {
  test('each seat marks the next, last wraps to first', () => {
    const members = [
      { rosterId: 'd', seat: 4 }, { rosterId: 'a', seat: 1 },
      { rosterId: 'c', seat: 3 }, { rosterId: 'b', seat: 2 },
    ];
    expect(assignRoundRobinMarkers(members)).toEqual([
      { rosterId: 'a', marksRosterId: 'b' },
      { rosterId: 'b', marksRosterId: 'c' },
      { rosterId: 'c', marksRosterId: 'd' },
      { rosterId: 'd', marksRosterId: 'a' },
    ]);
  });

  test('three-player party still closes the loop', () => {
    const members = [
      { rosterId: 'a', seat: 1 }, { rosterId: 'b', seat: 2 }, { rosterId: 'c', seat: 3 },
    ];
    expect(assignRoundRobinMarkers(members).map((m) => m.marksRosterId))
      .toEqual(['b', 'c', 'a']);
  });

  test('empty party returns empty', () => {
    expect(assignRoundRobinMarkers([])).toEqual([]);
  });
});
