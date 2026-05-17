import { assignRoundRobinMarkers, autoBalanceParties, pairAverageHandicap, balancePartiesFromPairs, scoreCellState, cardDiscrepancyHoles, activeMarkerChain } from '../officialScoring';

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

describe('discrepancy state', () => {
  test('scoreCellState classifies the four cases', () => {
    expect(scoreCellState(null, null)).toBe('empty');
    expect(scoreCellState(4, null)).toBe('waiting');
    expect(scoreCellState(null, 4)).toBe('waiting');
    expect(scoreCellState(4, 4)).toBe('agreed');
    expect(scoreCellState(4, 5)).toBe('discrepancy');
  });

  test('cardDiscrepancyHoles lists only holes in discrepancy for a subject', () => {
    const scores = [
      { hole: 1, subject_roster_id: 'a', source: 'self',   strokes: 4 },
      { hole: 1, subject_roster_id: 'a', source: 'marker', strokes: 4 },
      { hole: 2, subject_roster_id: 'a', source: 'self',   strokes: 5 },
      { hole: 2, subject_roster_id: 'a', source: 'marker', strokes: 6 },
      { hole: 3, subject_roster_id: 'a', source: 'self',   strokes: 3 },
      { hole: 4, subject_roster_id: 'b', source: 'self',   strokes: 9 },
      { hole: 4, subject_roster_id: 'b', source: 'marker', strokes: 2 },
    ];
    expect(cardDiscrepancyHoles(scores, 'a')).toEqual([2]);
    expect(cardDiscrepancyHoles(scores, 'b')).toEqual([4]);
  });
});

describe('activeMarkerChain', () => {
  const members = [
    { rosterId: 'a', seat: 1 }, { rosterId: 'b', seat: 2 },
    { rosterId: 'c', seat: 3 }, { rosterId: 'd', seat: 4 },
  ];

  test('with no withdrawals it equals the full round-robin', () => {
    expect(activeMarkerChain(members, []).map((m) => m.marksRosterId))
      .toEqual(['b', 'c', 'd', 'a']);
  });

  test('a withdrawn player is skipped on both sides of the chain', () => {
    const chain = activeMarkerChain(members, ['c']);
    expect(chain.map((m) => m.rosterId)).toEqual(['a', 'b', 'd']);
    expect(chain.find((m) => m.rosterId === 'b').marksRosterId).toBe('d');
    expect(chain.find((m) => m.rosterId === 'd').marksRosterId).toBe('a');
  });
});
