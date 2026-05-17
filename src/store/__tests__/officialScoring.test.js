import { assignRoundRobinMarkers, autoBalanceParties, pairAverageHandicap, balancePartiesFromPairs } from '../officialScoring';

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

describe('autoBalanceParties', () => {
  const roster = [
    { rosterId: '1', handicap: 2 },  { rosterId: '2', handicap: 6 },
    { rosterId: '3', handicap: 10 }, { rosterId: '4', handicap: 14 },
    { rosterId: '5', handicap: 18 }, { rosterId: '6', handicap: 22 },
    { rosterId: '7', handicap: 26 }, { rosterId: '8', handicap: 30 },
  ];

  test('handicap mode snake-deals into balanced parties', () => {
    const parties = autoBalanceParties(roster, { partySize: 4, mode: 'handicap' });
    expect(parties).toHaveLength(2);
    const avg = (p) => p.reduce((s, x) => s + x.handicap, 0) / p.length;
    // Snake deal of 2..30 -> both parties average 16.
    expect(avg(parties[0])).toBe(16);
    expect(avg(parties[1])).toBe(16);
  });

  test('random mode is deterministic given an rng and partitions everyone', () => {
    const seq = [0.1, 0.9, 0.3, 0.7, 0.2, 0.8, 0.4];
    let i = 0;
    const rng = () => seq[i++ % seq.length];
    const parties = autoBalanceParties(roster, { partySize: 4, mode: 'random', rng });
    expect(parties.flat()).toHaveLength(8);
    expect(new Set(parties.flat().map((p) => p.rosterId)).size).toBe(8);
  });

  test('non-multiple roster sizes still place everyone', () => {
    const parties = autoBalanceParties(roster.slice(0, 6), { partySize: 4, mode: 'handicap' });
    expect(parties.flat()).toHaveLength(6);
    expect(parties).toHaveLength(2);
  });
});

describe('pair-format balancing', () => {
  test('pairAverageHandicap averages the two players', () => {
    expect(pairAverageHandicap({ players: [{ handicap: 4 }, { handicap: 12 }] })).toBe(8);
  });

  test('balancePartiesFromPairs snake-deals pairs by average handicap', () => {
    const pairs = [
      { pairId: 'p1', players: [{ handicap: 2 }, { handicap: 2 }] },
      { pairId: 'p2', players: [{ handicap: 10 }, { handicap: 10 }] },
      { pairId: 'p3', players: [{ handicap: 18 }, { handicap: 18 }] },
      { pairId: 'p4', players: [{ handicap: 26 }, { handicap: 26 }] },
    ];
    const parties = balancePartiesFromPairs(pairs, { pairsPerParty: 2 });
    expect(parties).toHaveLength(2);
    const partyAvg = (p) => p.reduce((s, x) => s + pairAverageHandicap(x), 0) / p.length;
    expect(partyAvg(parties[0])).toBe(14);
    expect(partyAvg(parties[1])).toBe(14);
  });
});
