import {
  buildQuickStartGameName,
  courseToQuickStartRound,
  resolveQuickStartPlayerTees,
  buildQuickStartTournamentDraft,
} from '../quickStartGame';

const tees = [
  { label: 'Black', slope: 140, rating: 73.2 },
  { label: 'White', slope: 128, rating: 70.4 },
  { label: 'Yellow', slope: 118, rating: 68.6 },
  { label: 'Red', slope: 110, rating: 66.1 },
];

const holes = Array.from({ length: 18 }, (_, i) => ({
  number: i + 1,
  par: i % 6 === 0 ? 5 : i % 3 === 0 ? 3 : 4,
  strokeIndex: i + 1,
}));

const course = {
  id: 'course-1',
  name: 'Sant Cugat',
  holes,
  tees,
};

const players = [
  { id: 'p1', name: 'Marcos', handicap: 12.4, user_id: 'u-me' },
  { id: 'p2', name: 'Alex', handicap: 8.7, user_id: 'u-alex' },
  { id: 'p3', name: 'Dani', handicap: 17.2, user_id: null },
];

describe('buildQuickStartGameName', () => {
  test('uses course name and short date stamp', () => {
    const date = new Date('2026-06-01T10:00:00Z');
    expect(buildQuickStartGameName('Sant Cugat', date)).toBe('Sant Cugat · 1 Jun');
  });

  test('truncates long course names consistently with setup games', () => {
    const date = new Date('2026-06-01T10:00:00Z');
    expect(buildQuickStartGameName('Very Long Golf Course Name Here', date))
      .toBe('Very Long Golf Course… · 1 Jun');
  });
});

describe('courseToQuickStartRound', () => {
  test('copies a complete course without sharing hole or tee references', () => {
    const round = courseToQuickStartRound(course);
    expect(round).toMatchObject({
      courseId: 'course-1',
      courseName: 'Sant Cugat',
      tees,
    });
    expect(round.holes).toEqual(holes);
    expect(round.holes).not.toBe(holes);
    expect(round.holes[0]).not.toBe(holes[0]);
    expect(round.tees).not.toBe(tees);
    expect(round.tees[0]).not.toBe(tees[0]);
  });

  test('falls back to default 18 holes when course hole data is incomplete', () => {
    const round = courseToQuickStartRound({ ...course, holes: holes.slice(0, 9) });
    expect(round.holes).toHaveLength(18);
    expect(round.holes[0]).toEqual({ number: 1, par: 4, strokeIndex: 1 });
  });

  test('falls back to default 18 holes when any hole entry is incomplete', () => {
    const incompleteHoles = holes.map((hole, index) => (
      index === 8 ? { number: 9, strokeIndex: 9 } : hole
    ));
    const round = courseToQuickStartRound({ ...course, holes: incompleteHoles });
    expect(round.holes).toHaveLength(18);
    expect(round.holes[8]).toEqual({ number: 9, par: 4, strokeIndex: 9 });
  });

  test('falls back to default 18 holes when any hole value is unusable', () => {
    const invalidHoles = holes.map((hole, index) => (
      index === 8 ? { ...hole, strokeIndex: 'bad' } : hole
    ));
    const round = courseToQuickStartRound({ ...course, holes: invalidHoles });
    expect(round.holes).toHaveLength(18);
    expect(round.holes[8]).toEqual({ number: 9, par: 4, strokeIndex: 9 });
  });

  test('falls back to default 18 holes when hole values are non-numeric types', () => {
    const invalidHoles = holes.map((hole, index) => (
      index === 8 ? { number: [9], par: true, strokeIndex: 9 } : hole
    ));
    const round = courseToQuickStartRound({ ...course, holes: invalidHoles });
    expect(round.holes).toHaveLength(18);
    expect(round.holes[8]).toEqual({ number: 9, par: 4, strokeIndex: 9 });
  });
});

describe('resolveQuickStartPlayerTees', () => {
  test('keeps a player own last-used tee', () => {
    const out = resolveQuickStartPlayerTees({
      course,
      players: players.slice(0, 1),
      currentUserId: 'u-me',
      lastTeeByPlayer: { p1: { label: 'White', slope: 125, rating: 70 } },
    });
    expect(out).toEqual({ p1: { label: 'White', slope: 128, rating: 70.4 } });
  });

  test('gives players without history the group tee when one player has history', () => {
    const out = resolveQuickStartPlayerTees({
      course,
      players: players.slice(0, 2),
      currentUserId: 'u-me',
      lastTeeByPlayer: { p1: { label: 'Yellow', slope: 117, rating: 68 } },
    });
    expect(out).toEqual({
      p1: { label: 'Yellow', slope: 118, rating: 68.6 },
      p2: { label: 'Yellow', slope: 118, rating: 68.6 },
    });
  });

  test('uses the most common history tee for players without history', () => {
    const out = resolveQuickStartPlayerTees({
      course,
      players: [
        ...players,
        { id: 'p4', name: 'Sam', handicap: 20, user_id: null },
      ],
      currentUserId: 'u-me',
      lastTeeByPlayer: {
        p1: { label: 'White' },
        p2: { label: 'Yellow' },
        p3: { label: 'Yellow' },
      },
    });
    expect(out.p4).toEqual({ label: 'Yellow', slope: 118, rating: 68.6 });
  });

  test('breaks tied group tees with the signed-in user tee', () => {
    const out = resolveQuickStartPlayerTees({
      course,
      players,
      currentUserId: 'u-me',
      lastTeeByPlayer: {
        p1: { label: 'White' },
        p2: { label: 'Yellow' },
      },
    });
    expect(out.p3).toEqual({ label: 'White', slope: 128, rating: 70.4 });
  });

  test('breaks tied group tees by course tee order when current user has no tied history', () => {
    const out = resolveQuickStartPlayerTees({
      course,
      players,
      currentUserId: 'u-missing',
      lastTeeByPlayer: {
        p1: { label: 'White' },
        p2: { label: 'Yellow' },
      },
    });
    expect(out.p3).toEqual({ label: 'White', slope: 128, rating: 70.4 });
  });

  test('does not treat guest histories as signed-in user history when no user is signed in', () => {
    const guests = [
      { id: 'g1', name: 'Guest 1', handicap: 12, user_id: null },
      { id: 'g2', name: 'Guest 2', handicap: 14, user_id: null },
      { id: 'g3', name: 'Guest 3', handicap: 16, user_id: null },
    ];
    const out = resolveQuickStartPlayerTees({
      course,
      players: guests,
      currentUserId: null,
      lastTeeByPlayer: {
        g1: { label: 'Yellow' },
        g2: { label: 'White' },
      },
    });
    expect(out.g3).toEqual({ label: 'White', slope: 128, rating: 70.4 });
  });

  test('falls back to the middle named tee when nobody has history', () => {
    const out = resolveQuickStartPlayerTees({
      course,
      players: players.slice(0, 2),
      currentUserId: 'u-me',
      lastTeeByPlayer: {},
    });
    expect(out).toEqual({
      p1: { label: 'Yellow', slope: 118, rating: 68.6 },
      p2: { label: 'Yellow', slope: 118, rating: 68.6 },
    });
  });

  test('returns an empty map when the course has no named tees', () => {
    const out = resolveQuickStartPlayerTees({
      course: { ...course, tees: [{ label: '', slope: 113, rating: 72 }] },
      players,
      currentUserId: 'u-me',
      lastTeeByPlayer: { p1: { label: '' } },
    });
    expect(out).toEqual({});
  });
});

describe('buildQuickStartTournamentDraft', () => {
  test('builds a single-round game with resolved tees and playing handicaps', () => {
    const draft = buildQuickStartTournamentDraft({
      course,
      players: players.slice(0, 2),
      playerTees: {
        p1: { label: 'Black', slope: 140, rating: 73.2 },
        p2: { label: 'White', slope: 128, rating: 70.4 },
      },
      settings: { scoringMode: 'stableford', bestBallValue: 1, worstBallValue: 1 },
      userId: 'u-me',
      now: new Date('2026-06-01T10:00:00Z'),
    });
    expect(draft.kind).toBe('game');
    expect(draft.name).toBe('Sant Cugat · 1 Jun');
    expect(draft.meId).toBe('p1');
    expect(draft.players).toEqual(players.slice(0, 2));
    expect(draft.rounds).toHaveLength(1);
    expect(draft.rounds[0]).toMatchObject({
      id: 'r0',
      courseId: 'course-1',
      courseName: 'Sant Cugat',
      playerTees: {
        p1: { label: 'Black', slope: 140, rating: 73.2 },
        p2: { label: 'White', slope: 128, rating: 70.4 },
      },
      manualHandicaps: {},
      scores: {},
      notes: '',
      pairs: [[players[0]], [players[1]]],
    });
    expect(draft.rounds[0].playerHandicaps.p1).toBe(17);
    expect(draft.rounds[0].playerHandicaps.p2).toEqual(expect.any(Number));
  });

  test('uses team pairs when the scoring mode supports partners for the roster', () => {
    const four = [
      ...players,
      { id: 'p4', name: 'Sam', handicap: 20, user_id: null },
    ];
    const draft = buildQuickStartTournamentDraft({
      course,
      players: four,
      playerTees: {},
      settings: { scoringMode: 'stableford', bestBallValue: 1, worstBallValue: 1 },
      userId: 'u-me',
      now: new Date('2026-06-01T10:00:00Z'),
    });
    expect(draft.rounds[0].pairs).toHaveLength(2);
    expect(draft.rounds[0].pairs.flat()).toHaveLength(4);
  });
});
