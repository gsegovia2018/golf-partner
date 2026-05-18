import { buildLeaderboard } from '../officialLeaderboard';

describe('buildLeaderboard', () => {
  const members = [
    { roster_id: 'a', display_name: 'Ann', handicap: 0 },
    { roster_id: 'b', display_name: 'Ben', handicap: 0 },
  ];
  const scores = [
    { hole: 1, subject_roster_id: 'a', source: 'self',   strokes: 4 },
    { hole: 1, subject_roster_id: 'a', source: 'marker', strokes: 4 },
    { hole: 2, subject_roster_id: 'a', source: 'self',   strokes: 5 },
    { hole: 2, subject_roster_id: 'a', source: 'marker', strokes: 5 },
    { hole: 1, subject_roster_id: 'b', source: 'self',   strokes: 6 },
    { hole: 1, subject_roster_id: 'b', source: 'marker', strokes: 6 },
  ];

  test('ranks by resolved gross strokes, lowest first, and counts holes thru', () => {
    const rows = buildLeaderboard({ members, scores, format: 'gross_net' });
    expect(rows.map((r) => r.rosterId)).toEqual(['b', 'a']);
    expect(rows.find((r) => r.rosterId === 'a').gross).toBe(9);
    expect(rows.find((r) => r.rosterId === 'a').thru).toBe(2);
    expect(rows.find((r) => r.rosterId === 'b').gross).toBe(6);
    expect(rows.find((r) => r.rosterId === 'b').thru).toBe(1);
  });

  test('omits holes still in discrepancy from the resolved total', () => {
    const withConflict = [
      ...scores,
      { hole: 3, subject_roster_id: 'a', source: 'self',   strokes: 4 },
      { hole: 3, subject_roster_id: 'a', source: 'marker', strokes: 7 },
    ];
    const rows = buildLeaderboard({ members, scores: withConflict, format: 'gross_net' });
    expect(rows.find((r) => r.rosterId === 'a').gross).toBe(9);
    expect(rows.find((r) => r.rosterId === 'a').thru).toBe(2);
  });

  test('a hole with only one entered side still counts toward gross', () => {
    const partial = [
      { hole: 1, subject_roster_id: 'a', source: 'self', strokes: 4 },
      { hole: 2, subject_roster_id: 'a', source: 'self', strokes: 5 },
    ];
    const rows = buildLeaderboard({ members, scores: partial, format: 'gross_net' });
    const a = rows.find((r) => r.rosterId === 'a');
    expect(a.gross).toBe(9);
    expect(a.thru).toBe(2);
  });
});
