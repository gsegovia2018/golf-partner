// Feed round-card result building:
//   1. A solo round's only tile carries the player's real name — not "You",
//      which hid who played on the card, recap line, and avatar initial.
//   2. Multi-player rounds keep "You" for the current user's tile (it
//      disambiguates against the other tiles).
//   3. Scramble rounds produce one tile per TEAM (combined first-name label,
//      points off the TEAM handicap) instead of captain-only personal rows.
//   4. Non-scramble paired rounds surface a "A + B vs C + D" teams label.

const mockSupabaseState = {
  participantRows: [],
  roundActivityRows: [],
};

jest.mock('../../lib/connectivity', () => ({ isOnline: jest.fn(() => true) }));

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'me-user' } } })),
    },
    from: jest.fn((table) => {
      if (table === 'tournament_participants') {
        return {
          select: jest.fn(() => ({
            in: jest.fn(() => Promise.resolve({
              data: mockSupabaseState.participantRows, error: null,
            })),
          })),
        };
      }
      throw new Error(`unexpected supabase.from("${table}") call`);
    }),
  },
}));

jest.mock('../tournamentRepo', () => ({
  fetchTournament: jest.fn(),
  fetchRoundActivity: jest.fn(() => Promise.resolve(mockSupabaseState.roundActivityRows)),
}));

jest.mock('../tournamentStore', () => {
  const actual = jest.requireActual('../tournamentStore');
  return {
    ...actual,
    loadCachedTournamentsList: jest.fn(() => Promise.resolve([])),
    loadAllTournamentsWithFallback: jest.fn(() => Promise.resolve({
      list: mockSupabaseState.myTournaments ?? [],
      stale: false,
      openableIds: null,
    })),
  };
});

jest.mock('../friendStore', () => ({
  listFriends: jest.fn(() => Promise.resolve(mockSupabaseState.friends ?? [])),
  getCachedFriends: jest.fn(() => Promise.resolve([])),
}));

jest.mock('../mediaStore', () => ({
  loadMediaForTournaments: jest.fn(() => Promise.resolve([])),
}));

const HOLES = [
  { number: 1, par: 4, strokeIndex: 1 },
  { number: 2, par: 4, strokeIndex: 2 },
];

function tournament({ players, round }) {
  return {
    id: 'T1',
    name: 'Game T1',
    kind: 'game',
    createdAt: new Date(1000).toISOString(),
    players,
    rounds: [{ id: 'r1', courseName: 'La Moraleja', holes: HOLES, ...round }],
  };
}

async function buildItems() {
  const { buildFeed } = require('../feedStore');
  const result = await buildFeed({ userId: 'me-user', source: 'remote', includeMedia: false });
  return result.items;
}

describe('feedStore round-card results', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabaseState.participantRows = [];
    mockSupabaseState.roundActivityRows = [];
    mockSupabaseState.myTournaments = [];
    mockSupabaseState.friends = [];
    require('../tournamentRepo').fetchRoundActivity
      .mockImplementation(() => Promise.resolve(mockSupabaseState.roundActivityRows));
  });

  test('a solo round shows the player\'s real name, not "You"', async () => {
    mockSupabaseState.myTournaments = [tournament({
      players: [{ id: 'p1', name: 'Marcos', user_id: 'me-user' }],
      round: { scores: { p1: { 1: 4, 2: 5 } } },
    })];

    const [item] = await buildItems();
    expect(item.results).toHaveLength(1);
    expect(item.results[0].name).toBe('Marcos');
    expect(item.actorName).toBe('Marcos');
  });

  test('a multi-player round keeps "You" for the current user and the friend\'s display name', async () => {
    mockSupabaseState.friends = [{ userId: 'friend-user', displayName: 'Pablo G' }];
    mockSupabaseState.myTournaments = [tournament({
      players: [
        { id: 'p1', name: 'Marcos', user_id: 'me-user' },
        { id: 'p2', name: 'Pablo', user_id: 'friend-user' },
      ],
      round: { scores: { p1: { 1: 4, 2: 5 }, p2: { 1: 5, 2: 5 } } },
    })];

    const [item] = await buildItems();
    const names = item.results.map((r) => r.name).sort();
    expect(names).toEqual(['Pablo G', 'You']);
  });

  test('a scramble round yields one tile per team with combined names and team-handicap points', async () => {
    mockSupabaseState.friends = [{ userId: 'friend-user', displayName: 'Guille G' }];
    mockSupabaseState.myTournaments = [tournament({
      players: [
        { id: 'p1', name: 'Marcos Pecker', user_id: 'me-user' },
        { id: 'p2', name: 'Noé' },
        { id: 'p3', name: 'Guille', user_id: 'friend-user' },
        { id: 'p4', name: 'Alex' },
      ],
      round: {
        scoringMode: 'scramblepairs',
        pairs: [[{ id: 'p1' }, { id: 'p2' }], [{ id: 'p3' }, { id: 'p4' }]],
        playerHandicaps: { p1: 0, p2: 0, p3: 0, p4: 0 },
        // Team balls live under the captains (p1 / p3).
        scores: { p1: { 1: 4, 2: 5 }, p3: { 1: 3, 2: 4 } },
      },
    })];

    const [item] = await buildItems();
    expect(item.results).toHaveLength(2);
    // Sorted by points: Guille & Alex (5 pts) lead Marcos & Noé (3 pts).
    expect(item.results[0]).toMatchObject({
      name: 'Guille & Alex', points: 5, strokes: 7, isFriend: true, isMine: false,
    });
    expect(item.results[1]).toMatchObject({
      name: 'Marcos & Noé', points: 3, strokes: 9, isMine: true,
    });
    // 4 players covered by the two team tiles — nobody hidden.
    expect(item.playerCount).toBe(4);
    expect(item.hiddenPlayerCount).toBe(0);
    // Tiles are the teams; no separate pairings label.
    expect(item.teamsLabel).toBeNull();
  });

  test('a scramble team of guests is skipped but counted as hidden players', async () => {
    mockSupabaseState.myTournaments = [tournament({
      players: [
        { id: 'p1', name: 'Marcos', user_id: 'me-user' },
        { id: 'p2', name: 'Noé' },
        { id: 'p3', name: 'Guille' },
        { id: 'p4', name: 'Alex' },
      ],
      round: {
        scoringMode: 'scramblepairs',
        pairs: [[{ id: 'p1' }, { id: 'p2' }], [{ id: 'p3' }, { id: 'p4' }]],
        scores: { p1: { 1: 4 }, p3: { 1: 4 } },
      },
    })];

    const [item] = await buildItems();
    expect(item.results).toHaveLength(1);
    expect(item.results[0].name).toBe('Marcos & Noé');
    expect(item.playerCount).toBe(4);
    expect(item.hiddenPlayerCount).toBe(2);
  });

  test('a paired non-scramble round carries a "A + B vs C + D" teams label', async () => {
    mockSupabaseState.myTournaments = [tournament({
      players: [
        { id: 'p1', name: 'Marcos Pecker', user_id: 'me-user' },
        { id: 'p2', name: 'Noé' },
        { id: 'p3', name: 'Guille' },
        { id: 'p4', name: 'Alex' },
      ],
      round: {
        pairs: [[{ id: 'p1' }, { id: 'p2' }], [{ id: 'p3' }, { id: 'p4' }]],
        scores: {
          p1: { 1: 4 }, p2: { 1: 5 }, p3: { 1: 4 }, p4: { 1: 6 },
        },
      },
    })];

    const [item] = await buildItems();
    expect(item.teamsLabel).toBe('Marcos + Noé vs Guille + Alex');
  });

  test('an unpaired round has no teams label', async () => {
    mockSupabaseState.myTournaments = [tournament({
      players: [{ id: 'p1', name: 'Marcos', user_id: 'me-user' }],
      round: { scores: { p1: { 1: 4 } } },
    })];

    const [item] = await buildItems();
    expect(item.teamsLabel).toBeNull();
  });
});
