import { liveScorecard, currentNineKey, cardNine } from '../liveScorecard';

const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
const sc = (arr) => Object.fromEntries(arr.map((v, i) => [i + 1, v]));
const players = [
  { id: 'p1', name: 'QA Walkthrough', user_id: 'u1' },
  { id: 'p2', name: 'QA Ana', user_id: null },
  { id: 'p3', name: 'QA Ben', user_id: null },
];

function entry(scores) {
  const tournament = {
    id: 't', kind: 'game', players, settings: { scoringMode: 'stableford' },
    rounds: [{ id: 'r', holes, scores, playerHandicaps: { p1: 0, p2: 0, p3: 0 }, scoringMode: 'stableford' }],
  };
  return { tournament, round: tournament.rounds[0], roundIndex: 0 };
}

describe('currentNineKey', () => {
  it('follows my next hole', () => {
    expect(currentNineKey({ holes }, 7)).toBe('out');
    expect(currentNineKey({ holes }, 10)).toBe('in');
    expect(currentNineKey({ holes: holes.slice(0, 9) }, 4)).toBe('tot');
  });
});

describe('liveScorecard', () => {
  // Ana leads (birdies), then me, then Ben.
  const m = liveScorecard(entry({ p1: sc([4, 4, 4]), p2: sc([3, 3, 4]), p3: sc([5, 5, 5]) }), 'u1');

  it('sorts rows by the leaderboard and keeps them closed', () => {
    expect(m.card.rows.map((r) => r.id)).toEqual(['p2', 'p1', 'p3']);
    expect(m.card.rows.every((r) => r.canExpand === false)).toBe(true);
  });

  it('gives places, the gap to the leader and my next hole', () => {
    expect(m.standings.map((s) => [s.id, s.points, s.place])).toEqual([['p2', 8, 1], ['p1', 6, 2], ['p3', 3, 3]]);
    expect(m.gap).toEqual({ kind: 'behind', gap: 2, playerId: 'p2' });
    expect(m.next).toEqual({ number: 4, par: 4, strokeIndex: 4 });
    expect(m.nineKey).toBe('out');
    expect(m.nineCard.nines.map((n) => n.key)).toEqual(['out']);
    expect(m.nineCard.rows[0].nines).toHaveLength(1);
    expect(m.nineCard.par).toBe(72);
  });

  it('says when I lead, and gives my own card', () => {
    const lead = liveScorecard(entry({ p1: sc([3, 3]), p2: sc([4, 4]) }), 'u1');
    expect(lead.gap).toEqual({ kind: 'lead', gap: 2, playerId: 'p2' });
    expect(lead.myCard.solo).toBe(true);
    expect(cardNine(lead.card, 'in').nines[0].key).toBe('in');
  });
});
