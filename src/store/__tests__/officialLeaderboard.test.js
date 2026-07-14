import { buildLeaderboard } from '../officialLeaderboard';
import { defaultOfficialHoles } from '../officialScoring';

// Flat par-4, ascending-stroke-index 18 layout — same shape real course
// holes take ({ number, par, strokeIndex }), used unless a test needs a
// specific par/SI to isolate the handicap math.
const holes = defaultOfficialHoles();

function scoreRow(hole, subjectRosterId, strokes, { agreed = true } = {}) {
  const rows = [{ hole, subject_roster_id: subjectRosterId, source: 'self', strokes }];
  if (agreed) rows.push({ hole, subject_roster_id: subjectRosterId, source: 'marker', strokes });
  return rows;
}

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

  test('still reports resolved gross strokes and holes-thru per player', () => {
    const rows = buildLeaderboard({ members, scores, holes, format: 'net_stableford' });
    expect(rows.find((r) => r.rosterId === 'a').gross).toBe(9);
    expect(rows.find((r) => r.rosterId === 'a').thru).toBe(2);
    expect(rows.find((r) => r.rosterId === 'b').gross).toBe(6);
    expect(rows.find((r) => r.rosterId === 'b').thru).toBe(1);
  });

  test('a full-18 player outranks a fewer-holes player with lower gross (net Stableford, not gross)', () => {
    // a: 18 bogeys (par 4 -> 5 strokes), scratch handicap: 1 pt/hole = 18 pts, gross 90.
    const aScores = holes.flatMap((h) => scoreRow(h.number, 'a', h.par + 1));
    // b: 3 birdies (par 4 -> 3 strokes): 3 pts/hole = 9 pts, gross 12 (much lower gross).
    const bScores = [1, 2, 3].flatMap((n) => scoreRow(n, 'b', holes[n - 1].par - 1));
    const rows = buildLeaderboard({
      members, scores: [...aScores, ...bScores], holes, format: 'net_stableford',
    });
    expect(rows.map((r) => r.rosterId)).toEqual(['a', 'b']);
    expect(rows.find((r) => r.rosterId === 'a').gross).toBeGreaterThan(
      rows.find((r) => r.rosterId === 'b').gross,
    );
  });

  test('net Stableford ordering accounts for differing handicaps on equal gross', () => {
    const twoMembers = [
      { roster_id: 'scratch', display_name: 'Scratch', handicap: 0 },
      { roster_id: 'bogey18', display_name: 'Bogey18', handicap: 18 },
    ];
    // Hole 1: par 4, SI 1. Both post a 5 (bogey gross). The +18 player gets
    // one extra shot on every hole, so their net is better here.
    const rows = buildLeaderboard({
      members: twoMembers,
      scores: [...scoreRow(1, 'scratch', 5), ...scoreRow(1, 'bogey18', 5)],
      holes,
      format: 'net_stableford',
    });
    expect(rows.find((r) => r.rosterId === 'scratch').gross)
      .toBe(rows.find((r) => r.rosterId === 'bogey18').gross);
    expect(rows.map((r) => r.rosterId)).toEqual(['bogey18', 'scratch']);
    expect(rows.find((r) => r.rosterId === 'bogey18').points).toBeGreaterThan(
      rows.find((r) => r.rosterId === 'scratch').points,
    );
  });

  test('a discrepancy hole does not improve rank, and flags the player', () => {
    // b's hole-3 self entry (a birdie) disagrees with the marker's entry —
    // if it leaked into the total it would inflate b's points/rank.
    const withConflict = [
      ...scores,
      { hole: 3, subject_roster_id: 'b', source: 'self',   strokes: 3 },
      { hole: 3, subject_roster_id: 'b', source: 'marker', strokes: 8 },
    ];
    const rows = buildLeaderboard({ members, scores: withConflict, holes, format: 'net_stableford' });
    const b = rows.find((r) => r.rosterId === 'b');
    const bClean = buildLeaderboard({ members, scores, holes, format: 'net_stableford' })
      .find((r) => r.rosterId === 'b');
    expect(b.gross).toBe(bClean.gross);
    expect(b.thru).toBe(bClean.thru);
    expect(b.points).toBe(bClean.points);
    expect(b.discrepancy).toBe(true);
    expect(rows.find((r) => r.rosterId === 'a').discrepancy).toBe(false);
  });

  test('tiebreaks equal net Stableford points by fewer strokes over resolved holes', () => {
    const twoMembers = [
      { roster_id: 'x', display_name: 'X', handicap: 0 },
      { roster_id: 'y', display_name: 'Y', handicap: 0 },
    ];
    // x: hole 1 only, par 4, strokes 4 -> 2 pts, gross 4.
    // y: hole 1 (par 4, strokes 4 -> 2 pts) + hole 2 (par 4, strokes 6 -> 0
    //    pts) = 2 pts total too, but gross 10 — more strokes for the same points.
    const rows = buildLeaderboard({
      members: twoMembers,
      scores: [...scoreRow(1, 'x', 4), ...scoreRow(1, 'y', 4), ...scoreRow(2, 'y', 6)],
      holes,
      format: 'net_stableford',
    });
    expect(rows.find((r) => r.rosterId === 'x').points)
      .toBe(rows.find((r) => r.rosterId === 'y').points);
    expect(rows.map((r) => r.rosterId)).toEqual(['x', 'y']);
  });

  test('a player with no resolved holes yet ranks last, never floated by a zero gross', () => {
    const twoMembers = [
      { roster_id: 'started', display_name: 'Started', handicap: 0 },
      { roster_id: 'untouched', display_name: 'Untouched', handicap: 0 },
    ];
    // 'started' shoots so badly the net points are 0 too — must still beat
    // 'untouched', who hasn't posted anything.
    const rows = buildLeaderboard({
      members: twoMembers,
      scores: scoreRow(1, 'started', 9),
      holes,
      format: 'net_stableford',
    });
    expect(rows.map((r) => r.rosterId)).toEqual(['started', 'untouched']);
  });

  test('a hole with only one entered side still counts toward gross and points', () => {
    const partial = [
      { hole: 1, subject_roster_id: 'a', source: 'self', strokes: 4 },
      { hole: 2, subject_roster_id: 'a', source: 'self', strokes: 5 },
    ];
    const rows = buildLeaderboard({ members, scores: partial, holes, format: 'net_stableford' });
    const a = rows.find((r) => r.rosterId === 'a');
    expect(a.gross).toBe(9);
    expect(a.thru).toBe(2);
    expect(a.points).toBe(2 + 4 - 4 + (2 + 4 - 5));
  });
});
