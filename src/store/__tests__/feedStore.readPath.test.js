// Task 13.2 regression coverage for feedStore's last two legacy-blob-reader
// fixes:
//   1. fetchFriendTournaments used to bulk-select the frozen tournaments.data
//      blob column directly; it must now go through tournamentRepo's
//      get_game_tournament-backed fetchTournament, one call per id.
//   2. roundActivityTs used to read the deleted t._meta LWW-stamp heuristic
//      (always falling through since Task 11 removed the writer that stamped
//      it); it must now order by a REAL server timestamp — game_rounds.
//      updated_at, fetched via a lightweight direct query — so recently
//      active rounds actually sort first in the feed.

const mockSupabaseState = {
  participantRows: [],
  roundRows: [],
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
      if (table === 'game_rounds') {
        return {
          select: jest.fn(() => ({
            in: jest.fn(() => Promise.resolve({
              data: mockSupabaseState.roundRows, error: null,
            })),
          })),
        };
      }
      // The legacy blob column ('tournaments') must never be queried by
      // either fixed code path — surface any regression loudly instead of
      // silently swallowing it inside feedStore's try/catch.
      throw new Error(`unexpected supabase.from("${table}") call — legacy blob read?`);
    }),
  },
}));

jest.mock('../tournamentRepo', () => ({
  fetchTournament: jest.fn(),
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

function baseTournament(id, { createdAt, roundId, players }) {
  return {
    id,
    name: `Game ${id}`,
    kind: 'game',
    createdAt,
    players,
    rounds: [{
      id: roundId,
      courseName: 'La Moraleja',
      holes: [
        { number: 1, par: 4, strokeIndex: 1 },
        { number: 2, par: 4, strokeIndex: 2 },
      ],
      scores: { p1: { 1: 4, 2: 5 } },
    }],
  };
}

describe('feedStore read-path conversions (Task 13.2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabaseState.participantRows = [];
    mockSupabaseState.roundRows = [];
    mockSupabaseState.myTournaments = [];
    mockSupabaseState.friends = [];
  });

  describe('round ordering uses real game_rounds.updated_at, not the deleted _meta heuristic', () => {
    test('a round with more recent server activity sorts first even if its tournament is older', async () => {
      const { buildFeed } = require('../feedStore');
      const players = [{ id: 'p1', name: 'Marcos', user_id: 'me-user' }];

      // Tournament A is OLDER by createdAt/id, but its round was just
      // touched server-side. Tournament B is NEWER by createdAt, but its
      // round hasn't been touched since ages ago. Listed B-then-A here
      // (deliberately not sorted) so a naive fallback that ties on both
      // and preserves insertion order would produce [B, A] — a different,
      // wrong answer that this test would catch.
      mockSupabaseState.myTournaments = [
        baseTournament('B', { createdAt: new Date(5000).toISOString(), roundId: 'rB', players }),
        baseTournament('A', { createdAt: new Date(1000).toISOString(), roundId: 'rA', players }),
      ];
      mockSupabaseState.roundRows = [
        { tournament_id: 'A', id: 'rA', updated_at: '2026-07-11T12:00:00.000Z' },
        { tournament_id: 'B', id: 'rB', updated_at: '2020-01-01T00:00:00.000Z' },
      ];

      const result = await buildFeed({
        userId: 'me-user', source: 'remote', includeMedia: false,
      });

      expect(result.items.map((i) => i.tournamentId)).toEqual(['A', 'B']);
    });

    test('falls back to a deterministic (not recency-based) order when the timestamp query fails, instead of silently degrading', async () => {
      const { buildFeed } = require('../feedStore');
      const players = [{ id: 'p1', name: 'Marcos', user_id: 'me-user' }];
      mockSupabaseState.myTournaments = [
        baseTournament('old', { createdAt: new Date(1000).toISOString(), roundId: 'r-old', players }),
        baseTournament('new', { createdAt: new Date(5000).toISOString(), roundId: 'r-new', players }),
      ];
      // No matching rows for either round id — simulates the query
      // returning nothing (e.g. RLS denial) rather than throwing.
      mockSupabaseState.roundRows = [];

      const result = await buildFeed({
        userId: 'me-user', source: 'remote', includeMedia: false,
      });

      // Deterministic fallback: newest-created tournament's round still
      // sorts first, rather than an arbitrary/undefined order.
      expect(result.items.map((i) => i.tournamentId)).toEqual(['new', 'old']);
    });
  });

  describe('friend tournaments are fetched via tournamentRepo.fetchTournament, not the frozen tournaments.data blob', () => {
    test('one repo.fetchTournament call per friend tournament id not already in my list', async () => {
      const { fetchTournament } = require('../tournamentRepo');
      const { buildFeed } = require('../feedStore');

      mockSupabaseState.friends = [{
        userId: 'friend-user', displayName: 'Pablo', avatarUrl: null, avatarColor: '#abcdef',
      }];
      mockSupabaseState.participantRows = [{ tournament_id: 'F1' }];
      mockSupabaseState.myTournaments = [];

      const friendPlayers = [{ id: 'p1', name: 'Pablo', user_id: 'friend-user' }];
      fetchTournament.mockImplementation((id) => {
        if (id === 'F1') {
          return Promise.resolve(baseTournament('F1', {
            createdAt: new Date(2000).toISOString(), roundId: 'rF1', players: friendPlayers,
          }));
        }
        return Promise.resolve(null);
      });
      mockSupabaseState.roundRows = [
        { tournament_id: 'F1', id: 'rF1', updated_at: '2026-07-11T12:00:00.000Z' },
      ];

      const result = await buildFeed({
        userId: 'me-user', source: 'remote', includeMedia: false,
      });

      expect(fetchTournament).toHaveBeenCalledWith('F1');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].tournamentId).toBe('F1');
      expect(result.items[0].withMe).toBe(false);
    });

    test('a friend tournament already in my own list is not re-fetched', async () => {
      const { fetchTournament } = require('../tournamentRepo');
      const { buildFeed } = require('../feedStore');
      const players = [{ id: 'p1', name: 'Marcos', user_id: 'me-user' }];

      mockSupabaseState.friends = [{
        userId: 'friend-user', displayName: 'Pablo', avatarUrl: null, avatarColor: '#abcdef',
      }];
      mockSupabaseState.participantRows = [{ tournament_id: 'A' }];
      mockSupabaseState.myTournaments = [
        baseTournament('A', { createdAt: new Date(1000).toISOString(), roundId: 'rA', players }),
      ];

      await buildFeed({ userId: 'me-user', source: 'remote', includeMedia: false });

      expect(fetchTournament).not.toHaveBeenCalled();
    });
  });
});
