// Task 13.2 regression coverage for feedStore's last two legacy-blob-reader
// fixes, plus the fix/finish-and-feed-order follow-up:
//   1. fetchFriendTournaments used to bulk-select the frozen tournaments.data
//      blob column directly; it must now go through tournamentRepo's
//      get_game_tournament-backed fetchTournament, one call per id.
//   2. roundActivityTs used to read the deleted t._meta LWW-stamp heuristic
//      (always falling through since Task 11 removed the writer that stamped
//      it); it must now order by a REAL server timestamp.
//   3. (fix/finish-and-feed-order) That real timestamp used to come from two
//      unpaginated .from('game_scores') / .from('game_rounds') selects —
//      PostgREST caps unpaginated responses at 1000 rows, and prod's
//      game_scores table (~1398 rows) silently truncated past that cap,
//      leaving some tournaments' rounds with no activity timestamp at all.
//      It must now come from the bounded get_round_activity RPC (one row per
//      round, never per score cell) via tournamentRepo.fetchRoundActivity.

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
      // Neither game_scores nor game_rounds should ever be queried directly
      // by feedStore any more (that's the bug this fix removes — see the
      // comment above), nor the legacy blob column ('tournaments'). Surface
      // any regression loudly instead of silently swallowing it inside
      // feedStore's try/catch.
      throw new Error(`unexpected supabase.from("${table}") call — legacy blob/unpaginated read?`);
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
    mockSupabaseState.roundActivityRows = [];
    mockSupabaseState.myTournaments = [];
    mockSupabaseState.friends = [];
    require('../tournamentRepo').fetchRoundActivity
      .mockImplementation(() => Promise.resolve(mockSupabaseState.roundActivityRows));
  });

  describe('round ordering uses the get_round_activity RPC, not the deleted _meta heuristic', () => {
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
      mockSupabaseState.roundActivityRows = [
        { tournament_id: 'A', round_id: 'rA', activity_ts: '2026-07-11T12:00:00.000Z' },
        { tournament_id: 'B', round_id: 'rB', activity_ts: '2020-01-01T00:00:00.000Z' },
      ];

      const result = await buildFeed({
        userId: 'me-user', source: 'remote', includeMedia: false,
      });

      expect(result.items.map((i) => i.tournamentId)).toEqual(['A', 'B']);
    });

    test('the RPC row already folds in score recency (set_game_score never bumps game_rounds), so a round scored more recently than another round\'s config-edit still sorts first', async () => {
      const { buildFeed } = require('../feedStore');
      const players = [{ id: 'p1', name: 'Marcos', user_id: 'me-user' }];

      // LIVE is the tournament being actively scored right now — the RPC's
      // GREATEST(max(game_scores.updated_at), game_rounds.updated_at) means
      // its returned activity_ts reflects the score write, not the older
      // game_rounds row. STALE was config-edited more recently than LIVE's
      // *round row* but has seen no scoring since, so its activity_ts is
      // older than LIVE's. Ordering must key off the RPC's activity_ts
      // (LIVE first).
      mockSupabaseState.myTournaments = [
        baseTournament('STALE', { createdAt: new Date(1000).toISOString(), roundId: 'rStale', players }),
        baseTournament('LIVE', { createdAt: new Date(2000).toISOString(), roundId: 'rLive', players }),
      ];
      mockSupabaseState.roundActivityRows = [
        { tournament_id: 'LIVE', round_id: 'rLive', activity_ts: '2026-07-12T18:00:00.000Z' },
        { tournament_id: 'STALE', round_id: 'rStale', activity_ts: '2026-07-11T09:00:00.000Z' },
      ];

      const result = await buildFeed({
        userId: 'me-user', source: 'remote', includeMedia: false,
      });

      expect(result.items.map((i) => i.tournamentId)).toEqual(['LIVE', 'STALE']);
    });

    test('falls back to a deterministic (not recency-based) order when the RPC returns no rows, instead of silently degrading', async () => {
      const { buildFeed } = require('../feedStore');
      const players = [{ id: 'p1', name: 'Marcos', user_id: 'me-user' }];
      mockSupabaseState.myTournaments = [
        baseTournament('old', { createdAt: new Date(1000).toISOString(), roundId: 'r-old', players }),
        baseTournament('new', { createdAt: new Date(5000).toISOString(), roundId: 'r-new', players }),
      ];
      // No matching rows for either round id — simulates the RPC returning
      // nothing (e.g. RLS denial) rather than throwing.
      mockSupabaseState.roundActivityRows = [];

      const result = await buildFeed({
        userId: 'me-user', source: 'remote', includeMedia: false,
      });

      // Deterministic fallback: newest-created tournament's round still
      // sorts first, rather than an arbitrary/undefined order.
      expect(result.items.map((i) => i.tournamentId)).toEqual(['new', 'old']);
    });

    test('falls back to the deterministic order when the RPC throws (offline / query failure), never surfacing the error', async () => {
      const { buildFeed } = require('../feedStore');
      const { fetchRoundActivity } = require('../tournamentRepo');
      const players = [{ id: 'p1', name: 'Marcos', user_id: 'me-user' }];
      mockSupabaseState.myTournaments = [
        baseTournament('old', { createdAt: new Date(1000).toISOString(), roundId: 'r-old', players }),
        baseTournament('new', { createdAt: new Date(5000).toISOString(), roundId: 'r-new', players }),
      ];
      fetchRoundActivity.mockImplementation(() => Promise.reject(new Error('network down')));

      const result = await buildFeed({
        userId: 'me-user', source: 'remote', includeMedia: false,
      });

      expect(result.items.map((i) => i.tournamentId)).toEqual(['new', 'old']);
    });

    // The Claudia's-game repro (fix/finish-and-feed-order): a weekend
    // tournament created 2026-07-09T08:09 with three rounds actually played
    // on 07-10 / 07-11 / 07-12, alongside a second tournament ("Claudia's
    // game") created LATER the same day (2026-07-09T15:38) but played
    // EARLIER, at ~2026-07-09T17:38 — before the weekend tournament's first
    // round was even played. Before this fix, prod's unpaginated
    // .from('game_scores') query silently truncated past PostgREST's
    // 1000-row cap and could drop this tournament's score rows entirely,
    // making it fall back to createdAt ordering and jump to the top. The RPC
    // path must order purely by activity_ts: Round3 > Round2 > Round1 >
    // Claudia.
    test('orders a later-created-but-earlier-played tournament by activity ts, not createdAt', async () => {
      const { buildFeed } = require('../feedStore');
      const players = [{ id: 'p1', name: 'Marcos', user_id: 'me-user' }];

      mockSupabaseState.myTournaments = [
        baseTournament('weekend', {
          createdAt: '2026-07-09T08:09:00.000Z', roundId: 'r0', players,
        }),
        baseTournament('claudia', {
          createdAt: '2026-07-09T15:38:00.000Z', roundId: 'r0', players,
        }),
      ];
      // weekend has three rounds; baseTournament only wires up one round
      // object, so extend it with r1/r2 sharing the same holes/scores shape.
      mockSupabaseState.myTournaments[0].rounds.push(
        { ...mockSupabaseState.myTournaments[0].rounds[0], id: 'r1' },
        { ...mockSupabaseState.myTournaments[0].rounds[0], id: 'r2' },
      );

      mockSupabaseState.roundActivityRows = [
        { tournament_id: 'weekend', round_id: 'r0', activity_ts: '2026-07-10T18:00:00.000Z' },
        { tournament_id: 'weekend', round_id: 'r1', activity_ts: '2026-07-11T18:00:00.000Z' },
        { tournament_id: 'weekend', round_id: 'r2', activity_ts: '2026-07-12T18:00:00.000Z' },
        { tournament_id: 'claudia', round_id: 'r0', activity_ts: '2026-07-09T17:38:00.000Z' },
      ];

      const result = await buildFeed({
        userId: 'me-user', source: 'remote', includeMedia: false,
      });

      expect(result.items.map((i) => `${i.tournamentId}:${i.roundId}`)).toEqual([
        'weekend:r2', 'weekend:r1', 'weekend:r0', 'claudia:r0',
      ]);
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
      mockSupabaseState.roundActivityRows = [
        { tournament_id: 'F1', round_id: 'rF1', activity_ts: '2026-07-11T12:00:00.000Z' },
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
