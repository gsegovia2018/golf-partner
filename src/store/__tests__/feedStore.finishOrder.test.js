// Feed ordering is keyed on WHEN a round was finished, not on when its rows
// were last touched. A later edit (someone opening a played round and fixing
// a score) bumps the round's activity timestamp — it must not move the card.

const mockSupabaseState = {
  participantRows: [],
  roundActivityRows: [],
  myTournaments: [],
  friends: [],
};

jest.mock('../../lib/connectivity', () => ({ isOnline: jest.fn(() => true) }));

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'me-user' } } })),
    },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        in: jest.fn(() => Promise.resolve({ data: mockSupabaseState.participantRows, error: null })),
      })),
    })),
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
      list: mockSupabaseState.myTournaments, stale: false, openableIds: null,
    })),
  };
});

jest.mock('../friendStore', () => ({
  listFriends: jest.fn(() => Promise.resolve(mockSupabaseState.friends)),
  getCachedFriends: jest.fn(() => Promise.resolve([])),
}));

jest.mock('../mediaStore', () => ({ loadMediaForTournaments: jest.fn(() => Promise.resolve([])) }));

const HOLES = [
  { number: 1, par: 4, strokeIndex: 1 },
  { number: 2, par: 4, strokeIndex: 2 },
];

const PLAYERS = [{ id: 'p1', name: 'Marcos', user_id: 'me-user' }];

function tournament(id, { finishedAt = null, rounds }) {
  return {
    id,
    name: `Game ${id}`,
    kind: 'game',
    createdAt: new Date(1000).toISOString(),
    finishedAt,
    players: PLAYERS,
    rounds: rounds.map((r) => ({
      courseName: 'La Moraleja',
      holes: HOLES,
      scores: { p1: { 1: 4, 2: 5 } },
      ...r,
    })),
  };
}

async function buildItems() {
  const { buildFeed } = require('../feedStore');
  const { items } = await buildFeed({ userId: 'me-user', source: 'remote', includeMedia: false });
  return items;
}

const ts = (iso) => new Date(iso).getTime();

describe('feed ordering by round finish time', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabaseState.participantRows = [];
    mockSupabaseState.roundActivityRows = [];
    mockSupabaseState.myTournaments = [];
    mockSupabaseState.friends = [];
    require('../tournamentRepo').fetchRoundActivity
      .mockImplementation(() => Promise.resolve(mockSupabaseState.roundActivityRows));
  });

  test('a round edited later keeps its finish-time position', async () => {
    mockSupabaseState.myTournaments = [
      tournament('T-old', { rounds: [{ id: 'r1', finishedAt: '2026-01-01T10:00:00.000Z' }] }),
      tournament('T-new', { rounds: [{ id: 'r1', finishedAt: '2026-02-01T10:00:00.000Z' }] }),
    ];
    // The OLD round was just edited — freshest activity of the two.
    mockSupabaseState.roundActivityRows = [
      { tournament_id: 'T-old', round_id: 'r1', activity_ts: '2026-03-01T10:00:00.000Z' },
      { tournament_id: 'T-new', round_id: 'r1', activity_ts: '2026-02-01T10:00:00.000Z' },
    ];

    const items = await buildItems();
    expect(items.map((i) => i.tournamentId)).toEqual(['T-new', 'T-old']);
    expect(items[1].ts).toBe(ts('2026-01-01T10:00:00.000Z'));
  });

  test('a round with no finish stamp falls back to the tournament archive stamp, offset by round index', async () => {
    mockSupabaseState.myTournaments = [
      tournament('T1', {
        finishedAt: '2026-01-01T10:00:00.000Z',
        rounds: [{ id: 'r1' }, { id: 'r2' }],
      }),
    ];
    mockSupabaseState.roundActivityRows = [
      { tournament_id: 'T1', round_id: 'r1', activity_ts: '2026-05-01T10:00:00.000Z' },
    ];

    const items = await buildItems();
    expect(items.map((i) => i.roundId)).toEqual(['r2', 'r1']);
    expect(items[1].ts).toBe(ts('2026-01-01T10:00:00.000Z'));
  });

  test('an unfinished round still orders by live activity', async () => {
    mockSupabaseState.myTournaments = [
      tournament('T-done', { rounds: [{ id: 'r1', finishedAt: '2026-01-01T10:00:00.000Z' }] }),
      tournament('T-live', { rounds: [{ id: 'r1' }] }),
    ];
    mockSupabaseState.roundActivityRows = [
      { tournament_id: 'T-live', round_id: 'r1', activity_ts: '2026-01-02T10:00:00.000Z' },
    ];

    const items = await buildItems();
    expect(items.map((i) => i.tournamentId)).toEqual(['T-live', 'T-done']);
  });
});
