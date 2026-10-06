import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  LeagueError, createLeague, getLeagueByCode, joinLeague, setLeagueHandicap, setLeagueFeePaid,
  updateLeagueRules, leaveLeague, openHandicapVote, castHandicapBallot, announceLeagueCard,
  notifyLeagueTeeOff, submitLeagueCard, addUnannouncedLeagueCard, confirmLeagueCardByPartner,
  attachLeagueProof, createMarkerToken, voidLeagueCard, recordLeagueFinal, getMyLeagues, getMyCardsForMonth,
  getLeagueCard, setLeagueRole, archiveLeague, deleteLeague, getLeague, getLeagueCached, setLeagueCache, uploadLeagueProof, rowToCard,
} from '../leagueStore';

// mockState is read inside the jest.mock factories; the `mock` prefix is what
// lets jest's hoisted factory reference it.
const mockState = {
  rpcCalls: [],
  rpcResult: { data: null, error: null },
  rpcThrows: null,
  tables: {},
  queries: [],
  upload: { error: null },
  uploads: [],
  proofList: { data: [], error: null },
  removed: [],
  user: { id: 'me' },
};

jest.mock('../../lib/supabase', () => {
  const builder = (table) => {
    const q = { table, ops: [] };
    mockState.queries.push(q);
    const b = new Proxy({}, {
      get: (_, op) => {
        if (op === 'then') {
          const res = mockState.tables[table] ?? { data: [], error: null };
          return (ok, ko) => Promise.resolve(res).then(ok, ko);
        }
        return (...args) => { q.ops.push([op, ...args]); return b; };
      },
    });
    return b;
  };
  return {
    supabase: {
      from: builder,
      rpc: (fn, args) => {
        mockState.rpcCalls.push([fn, args]);
        if (mockState.rpcThrows) return Promise.reject(mockState.rpcThrows);
        return Promise.resolve(mockState.rpcResult);
      },
      auth: { getUser: () => Promise.resolve({ data: { user: mockState.user } }) },
      storage: {
        from: (bucket) => ({
          upload: (path, body, opts) => {
            mockState.uploads.push({ bucket, path, body, opts });
            return Promise.resolve(mockState.upload);
          },
          list: () => {
            if (mockState.proofList instanceof Error) return Promise.reject(mockState.proofList);
            return Promise.resolve(mockState.proofList);
          },
          remove: (paths) => {
            mockState.removed.push({ bucket, paths });
            return Promise.resolve({ data: [], error: null });
          },
        }),
      },
    },
  };
});

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    getItem: jest.fn((k) => Promise.resolve(store.has(k) ? store.get(k) : null)),
    setItem: jest.fn((k, v) => { store.set(k, v); return Promise.resolve(); }),
    removeItem: jest.fn((k) => { store.delete(k); return Promise.resolve(); }),
    __store: store,
  };
});

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(() => Promise.resolve({ uri: 'file:///compressed.jpg' })),
  SaveFormat: { JPEG: 'jpeg' },
}));
jest.mock('expo-file-system', () => ({
  File: class { arrayBuffer() { return Promise.resolve(new ArrayBuffer(4)); } },
}));

const ImageManipulator = require('expo-image-manipulator');

const lastRpc = () => mockState.rpcCalls[mockState.rpcCalls.length - 1];
const ok = (data) => { mockState.rpcResult = { data, error: null }; };

beforeEach(() => {
  mockState.rpcCalls = [];
  mockState.rpcThrows = null;
  mockState.rpcResult = { data: null, error: null };
  mockState.tables = {};
  mockState.queries = [];
  mockState.upload = { error: null };
  mockState.uploads = [];
  mockState.proofList = { data: [], error: null };
  mockState.removed = [];
  mockState.user = { id: 'me' };
  AsyncStorage.__store.clear();
  ImageManipulator.manipulateAsync.mockClear();
});

describe('RPC params', () => {
  test('createLeague', async () => {
    ok({ id: 'L1', invite_code: 'ABC123' });
    const res = await createLeague({
      name: 'Tour', seasonStart: '2026-01-01', seasonEnd: '2026-12-31', cap: 30, feeCents: 2000,
      members: [{ userId: 'u2', handicap: 18 }, { userId: 'u3' }],
    });
    expect(res).toEqual({ id: 'L1', inviteCode: 'ABC123' });
    expect(lastRpc()).toEqual(['create_league', {
      p_name: 'Tour', p_season_start: '2026-01-01', p_season_end: '2026-12-31',
      p_points_table: null, p_cap: 30, p_fee_cents: 2000,
      p_members: [{ user_id: 'u2', handicap: 18 }, { user_id: 'u3', handicap: null }],
    }]);
  });

  test('getLeagueByCode maps the summary, null for unknown code', async () => {
    ok({
      id: 'L1', name: 'Tour', season_start: '2026-01-01', season_end: '2026-12-31',
      points_table: [500, 300], handicap_cap: '30.0', entry_fee_cents: 0, archived: false,
      admin_name: 'Marcos', member_count: 7, proposed_handicap: '18.0', is_member: false,
    });
    expect(await getLeagueByCode('abc')).toEqual({
      id: 'L1', name: 'Tour', seasonStart: '2026-01-01', seasonEnd: '2026-12-31',
      pointsTable: [500, 300], handicapCap: 30, entryFeeCents: 0, archived: false,
      adminName: 'Marcos', memberCount: 7, proposedHandicap: 18, isMember: false,
    });
    expect(lastRpc()).toEqual(['get_league_by_code', { p_code: 'abc' }]);
    ok(null);
    expect(await getLeagueByCode('zzz')).toBeNull();
  });

  test('joinLeague', async () => {
    ok({ league_id: 'L1' });
    expect(await joinLeague('ABC', 20)).toEqual({ leagueId: 'L1' });
    expect(lastRpc()).toEqual(['join_league', { p_code: 'ABC', p_proposed_handicap: 20 }]);
  });

  test('setLeagueHandicap returns the clamped number', async () => {
    ok('30.0');
    expect(await setLeagueHandicap('L1', 'u2', 36)).toBe(30);
    expect(lastRpc()).toEqual(['set_league_handicap', { p_league: 'L1', p_user: 'u2', p_value: 36 }]);
  });

  test('setLeagueFeePaid, leaveLeague', async () => {
    await setLeagueFeePaid('L1', 'u2', true);
    expect(lastRpc()).toEqual(['set_league_fee_paid', { p_league: 'L1', p_user: 'u2', p_paid: true }]);
    await leaveLeague('L1');
    expect(lastRpc()).toEqual(['leave_league', { p_league: 'L1' }]);
  });

  test('setLeagueRole, archiveLeague', async () => {
    await setLeagueRole('L1', 'u2', 'admin');
    expect(lastRpc()).toEqual(['set_league_role', { p_league: 'L1', p_user: 'u2', p_role: 'admin' }]);
    await archiveLeague('L1');
    expect(lastRpc()).toEqual(['archive_league', { p_league: 'L1' }]);
  });

  test('deleteLeague removes the proof photos, then the league, then the cache', async () => {
    AsyncStorage.__store.set('@golf_league_cache:L1', '{}');
    mockState.proofList = { data: [{ name: 'C1.jpg' }, { name: 'C2.jpg' }], error: null };
    await deleteLeague('L1');
    expect(mockState.removed).toEqual([{ bucket: 'league-proofs', paths: ['L1/C1.jpg', 'L1/C2.jpg'] }]);
    expect(lastRpc()).toEqual(['delete_league', { p_league: 'L1' }]);
    expect(AsyncStorage.__store.has('@golf_league_cache:L1')).toBe(false);
  });

  test('deleteLeague still deletes when listing the photos fails, and keeps the cache on RPC error', async () => {
    mockState.proofList = new Error('network');
    await deleteLeague('L1');
    expect(lastRpc()).toEqual(['delete_league', { p_league: 'L1' }]);

    AsyncStorage.__store.set('@golf_league_cache:L2', '{}');
    mockState.rpcResult = { data: null, error: { code: '42501', message: 'Only the league admin can do that.' } };
    await expect(deleteLeague('L2')).rejects.toMatchObject({ message: 'Only the league admin can do that.' });
    expect(AsyncStorage.__store.has('@golf_league_cache:L2')).toBe(true);
  });

  test('updateLeagueRules sends null for omitted fields', async () => {
    await updateLeagueRules('L1', { name: 'New', cap: 28 });
    expect(lastRpc()).toEqual(['update_league_rules', {
      p_league: 'L1', p_name: 'New', p_season_start: null, p_season_end: null,
      p_points_table: null, p_cap: 28, p_fee_cents: null,
    }]);
  });

  test('handicap votes', async () => {
    ok('V1');
    expect(await openHandicapVote('L1', 'u2', 27)).toBe('V1');
    expect(lastRpc()).toEqual(['open_handicap_vote', { p_league: 'L1', p_subject: 'u2', p_proposed: 27 }]);
    ok({ status: 'passed', yes: 5, no: 1, threshold: 5 });
    expect(await castHandicapBallot('V1', true)).toEqual({ status: 'passed', yes: 5, no: 1, threshold: 5 });
    expect(lastRpc()).toEqual(['cast_handicap_ballot', { p_vote: 'V1', p_yes: true }]);
  });

  test('announceLeagueCard (app) sends game ids and maps the result', async () => {
    ok({ id: 'C1', month: '2026-10-01', announced_at: '2026-10-04T10:00:00Z', league_handicap: '18.0' });
    const res = await announceLeagueCard({
      leagueId: 'L1', source: 'app', course: { name: 'El Saler', tee: 'Yellow' },
      teeTime: '2026-10-04T11:00:00Z', tournamentId: 't1', roundId: 'r1', playerId: 'p1',
    });
    expect(res).toEqual({
      id: 'C1', month: '2026-10-01', announcedAt: '2026-10-04T10:00:00Z', leagueHandicap: 18,
    });
    expect(lastRpc()).toEqual(['announce_league_card', {
      p_league: 'L1', p_source: 'app', p_course: { name: 'El Saler', tee: 'Yellow' },
      p_tee_time: '2026-10-04T11:00:00Z', p_tournament_id: 't1', p_round_id: 'r1', p_player_id: 'p1',
    }]);
  });

  test('announceLeagueCard (offapp) defaults game ids to null', async () => {
    ok({ id: 'C1', month: '2026-10-01', announced_at: 'x', league_handicap: null });
    const res = await announceLeagueCard({ leagueId: 'L1', source: 'offapp', course: { name: 'X' } });
    expect(res.leagueHandicap).toBeNull();
    expect(lastRpc()[1]).toMatchObject({
      p_tee_time: null, p_tournament_id: null, p_round_id: null, p_player_id: null,
    });
  });

  test('notifyLeagueTeeOff', async () => {
    await notifyLeagueTeeOff('C1');
    expect(lastRpc()).toEqual(['notify_league_tee_off', { p_card: 'C1' }]);
  });

  test('submitLeagueCard', async () => {
    ok({ id: 'C1', status: 'submitted', not_announced: true, first_shot_at: '2026-10-04T09:00:00Z' });
    const res = await submitLeagueCard({
      cardId: 'C1', holes: { 1: 5 }, gross: 5, points: 1, playingHandicap: 20, playedOn: '2026-10-04',
    });
    expect(res).toEqual({
      id: 'C1', status: 'submitted', notAnnounced: true, firstShotAt: '2026-10-04T09:00:00Z',
    });
    expect(lastRpc()).toEqual(['submit_league_card', {
      p_card: 'C1', p_holes: { 1: 5 }, p_gross: 5, p_points: 1, p_playing_handicap: 20,
      p_played_on: '2026-10-04',
    }]);
  });

  test('addUnannouncedLeagueCard', async () => {
    ok({ id: 'C2', month: '2026-10-01', status: 'submitted', not_announced: true });
    const res = await addUnannouncedLeagueCard({
      leagueId: 'L1', course: { name: 'X' }, playedOn: '2026-10-03', holes: { 1: 4 },
      gross: 4, points: 2, playingHandicap: 18,
    });
    expect(res).toEqual({ id: 'C2', month: '2026-10-01', status: 'submitted', notAnnounced: true });
    expect(lastRpc()).toEqual(['add_unannounced_league_card', {
      p_league: 'L1', p_course: { name: 'X' }, p_tee_time: null, p_played_on: '2026-10-03',
      p_holes: { 1: 4 }, p_gross: 4, p_points: 2, p_playing_handicap: 18,
    }]);
  });

  test('confirmLeagueCardByPartner: success and a non-error failure', async () => {
    ok({ confirmed: true, settled: 18, matches: 18, marked: 18, partner_user_id: 'u9', partner_name: 'Javi' });
    expect(await confirmLeagueCardByPartner('C1')).toEqual({
      confirmed: true, reason: null, settled: 18, matches: 18, marked: 18,
      partnerUserId: 'u9', partnerName: 'Javi',
    });
    expect(lastRpc()).toEqual(['confirm_league_card_by_partner', { p_card: 'C1' }]);
    ok({ confirmed: false, reason: 'not_settled', settled: 17, matches: 17, marked: 17 });
    const fail = await confirmLeagueCardByPartner('C1');
    expect(fail).toMatchObject({ confirmed: false, reason: 'not_settled', settled: 17, partnerName: null });
  });

  test('attachLeagueProof, createMarkerToken, voidLeagueCard, recordLeagueFinal', async () => {
    await attachLeagueProof('C1', 'L1/C1.jpg', 'photo', 'Pepe');
    expect(lastRpc()).toEqual(['attach_league_proof', {
      p_card: 'C1', p_path: 'L1/C1.jpg', p_kind: 'photo', p_marker_name: 'Pepe',
    }]);
    ok({ token: 'tok', expires_at: '2026-10-04T12:00:00Z' });
    expect(await createMarkerToken('C1')).toEqual({ token: 'tok', expiresAt: '2026-10-04T12:00:00Z' });
    expect(lastRpc()).toEqual(['create_marker_token', { p_card: 'C1' }]);
    await voidLeagueCard('C1', 'duplicate');
    expect(lastRpc()).toEqual(['void_league_card', { p_card: 'C1', p_reason: 'duplicate' }]);
    await recordLeagueFinal('L1', 't9', { u1: 2 });
    expect(lastRpc()).toEqual(['record_league_final', {
      p_league: 'L1', p_tournament_id: 't9', p_strokes: { u1: 2 },
    }]);
  });
});

describe('errors', () => {
  test('a server refusal keeps the postgres message, code and hint', async () => {
    mockState.rpcResult = {
      data: null,
      error: { code: 'P0001', message: 'You already have your October card.', hint: 'card_exists' },
    };
    const err = await announceLeagueCard({ leagueId: 'L1', source: 'offapp', course: { name: 'X' } })
      .catch((e) => e);
    expect(err).toBeInstanceOf(LeagueError);
    expect(err.message).toBe('You already have your October card.');
    expect(err.code).toBe('P0001');
    expect(err.hint).toBe('card_exists');
    expect(err.offline).toBe(false);
  });

  test('an error without a code is a network failure: offline', async () => {
    mockState.rpcResult = { data: null, error: { message: 'TypeError: Failed to fetch' } };
    const err = await submitLeagueCard({ cardId: 'C1', holes: {}, gross: 0, points: 0, playingHandicap: 0 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(LeagueError);
    expect(err.offline).toBe(true);
  });

  test('a rejected fetch is offline too', async () => {
    mockState.rpcThrows = new TypeError('Network request failed');
    const err = await announceLeagueCard({ leagueId: 'L1', source: 'offapp', course: { name: 'X' } })
      .catch((e) => e);
    expect(err.offline).toBe(true);
  });

  test('a league that no longer exists reads as league_gone', async () => {
    mockState.tables.leagues = { data: null, error: null };
    await expect(getLeague('L1')).rejects.toMatchObject({
      name: 'LeagueError', code: 'league_gone', message: 'This league no longer exists.',
    });
  });

  test('read errors propagate as LeagueError', async () => {
    mockState.tables.leagues = { data: null, error: { code: '42501', message: 'permission denied' } };
    await expect(getLeague('L1')).rejects.toMatchObject({ name: 'LeagueError', message: 'permission denied' });
  });
});

describe('reads and cache', () => {
  const leagueRow = {
    id: 'L1', name: 'Tour', season_start: '2026-01-01', season_end: '2026-12-31', created_by: 'me',
    points_table: [500, 300], handicap_cap: '30.0', entry_fee_cents: 1000, invite_code: 'ABC',
    archived_at: null,
  };
  const cardRow = (over) => ({
    id: 'C1', league_id: 'L1', user_id: 'me', month: '2026-10-01', source: 'app', status: 'confirmed',
    announced_at: '2026-10-04T09:00:00Z', first_shot_at: '2026-10-04T10:00:00Z', not_announced: false,
    league_handicap: '18.0', playing_handicap: 20, holes: { 1: 4 }, gross: 80, points: 36,
    confirmation: 'partner', confirmed_by_name: 'Javi', ...over,
  });

  test('getMyLeagues returns active memberships with my role', async () => {
    mockState.tables.league_members = {
      data: [
        { role: 'admin', league_handicap: '18.0', leagues: leagueRow },
        { role: 'member', league_handicap: null, leagues: null },
      ],
      error: null,
    };
    const res = await getMyLeagues();
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ id: 'L1', name: 'Tour', role: 'admin', leagueHandicap: 18, handicapCap: 30 });
    const ops = mockState.queries[0].ops;
    expect(ops).toContainEqual(['eq', 'user_id', 'me']);
    expect(ops).toContainEqual(['is', 'left_at', null]);
  });

  test('getMyLeagues is empty when signed out', async () => {
    mockState.user = null;
    expect(await getMyLeagues()).toEqual([]);
  });

  test("getMyCardsForMonth reads my live cards for that month", async () => {
    mockState.tables.league_cards = {
      data: [{ id: 'c1', league_id: 'L1', user_id: 'me', month: '2026-10-01', status: 'playing' }],
      error: null,
    };
    const res = await getMyCardsForMonth('2026-10');
    expect(res).toEqual([expect.objectContaining({ id: 'c1', leagueId: 'L1', monthKey: '2026-10' })]);
    const ops = mockState.queries[0].ops;
    expect(ops).toContainEqual(['eq', 'user_id', 'me']);
    expect(ops).toContainEqual(['eq', 'month', '2026-10-01']);
    expect(ops).toContainEqual(['neq', 'status', 'void']);
  });

  test('getLeagueCard reads one card by id', async () => {
    mockState.tables.league_cards = {
      data: { id: 'c1', league_id: 'L1', user_id: 'me', month: '2026-10-01', status: 'confirmed' },
      error: null,
    };
    const res = await getLeagueCard('c1');
    expect(res).toMatchObject({ id: 'c1', status: 'confirmed', monthKey: '2026-10' });
    const ops = mockState.queries[0].ops;
    expect(ops).toContainEqual(['eq', 'id', 'c1']);
    expect(ops).toContainEqual(['maybeSingle']);
  });

  test('getLeagueCard returns null for a card the select does not return', async () => {
    mockState.tables.league_cards = { data: null, error: null };
    expect(await getLeagueCard('gone')).toBeNull();
    expect(await getLeagueCard(null)).toBeNull();
  });

  test('rowToCard matches the fields leagueRules/leagueStandings read', () => {
    const c = rowToCard(cardRow());
    expect(c).toMatchObject({
      userId: 'me', status: 'confirmed', points: 36, month: '2026-10-01', monthKey: '2026-10',
      announcedAt: '2026-10-04T09:00:00Z', firstShotAt: '2026-10-04T10:00:00Z', notAnnounced: false,
      leagueHandicap: 18, playingHandicap: 20, confirmation: 'partner', confirmedByName: 'Javi',
    });
  });

  test('rowToCard maps the server net differential (numeric comes back as a string) and keeps null', () => {
    expect(rowToCard({ ...cardRow(), differential: '11.8', net_differential: '-2.4' }))
      .toMatchObject({ differential: 11.8, netDifferential: -2.4 });
    expect(rowToCard({ ...cardRow(), net_differential: null }))
      .toMatchObject({ differential: null, netDifferential: null });
  });

  test('getLeague maps everything, groups cards by month, drops void, attaches ballots', async () => {
    mockState.tables = {
      leagues: { data: leagueRow, error: null },
      league_cards: {
        data: [cardRow(), cardRow({ id: 'C0', user_id: 'u2', status: 'void', month: '2026-09-01' })],
        error: null,
      },
      league_handicap_votes: {
        data: [{ id: 'V1', league_id: 'L1', subject_user: 'u2', proposed: '27.0', opened_by: 'me', opened_at: 'a', closes_at: 'b', status: 'open' }],
        error: null,
      },
      league_handicap_ballots: { data: [{ vote_id: 'V1', voter: 'me', yes: true, at: 't' }], error: null },
      league_handicap_events: {
        data: [{ id: 'E1', league_id: 'L1', user_id: 'u2', old: '30.0', new: '27.0', reason: 'vote', by_user: 'me', at: 't' }],
        error: null,
      },
      league_finals: { data: null, error: null },
    };
    ok([{
      user_id: 'me', display_name: 'Marcos', username: 'marcos', avatar_url: null, role: 'admin',
      league_handicap: '18.0', fee_paid: true, joined_at: 'x', left_at: null,
    }]);
    const res = await getLeague('L1');
    expect(mockState.rpcCalls).toContainEqual(['get_league_members', { p_league: 'L1' }]);
    expect(res.league).toMatchObject({ id: 'L1', inviteCode: 'ABC', entryFeeCents: 1000 });
    expect(res.members[0]).toMatchObject({
      leagueId: 'L1', userId: 'me', role: 'admin', leagueHandicap: 18, feePaid: true,
      displayName: 'Marcos', username: 'marcos',
    });
    expect(res.cards).toHaveLength(2);
    expect(Object.keys(res.cardsByMonth)).toEqual(['2026-10']);
    expect(res.votes[0]).toMatchObject({ id: 'V1', subjectUser: 'u2', proposed: 27 });
    expect(res.votes[0].ballots).toEqual([{ voteId: 'V1', voter: 'me', yes: true, at: 't' }]);
    expect(res.handicapEvents[0]).toMatchObject({ old: 30, new: 27, reason: 'vote' });
    expect(res.final).toBeNull();
  });

  test('getLeague writes the cache; getLeagueCached reads it back', async () => {
    mockState.tables = { leagues: { data: leagueRow, error: null } };
    const live = await getLeague('L1');
    const cached = await getLeagueCached('L1');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('@golf_league_cache:L1', expect.any(String));
    expect(cached.snapshot.league.name).toBe('Tour');
    expect(cached.snapshot).toEqual(JSON.parse(JSON.stringify(live)));
    expect(typeof cached.at).toBe('number');
  });

  test('getLeagueCached is null when empty or corrupt', async () => {
    expect(await getLeagueCached('nope')).toBeNull();
    AsyncStorage.__store.set('@golf_league_cache:bad', '{not json');
    expect(await getLeagueCached('bad')).toBeNull();
  });

  test('setLeagueCache swallows storage failures', async () => {
    AsyncStorage.setItem.mockImplementationOnce(() => Promise.reject(new Error('full')));
    await expect(setLeagueCache('L1', {})).resolves.toBeUndefined();
  });

  test('a failed live read does not touch the cache', async () => {
    await setLeagueCache('L1', { league: { name: 'Old' } });
    mockState.tables.leagues = { data: null, error: { message: 'TypeError: Failed to fetch' } };
    const err = await getLeague('L1').catch((e) => e);
    expect(err.offline).toBe(true);
    expect((await getLeagueCached('L1')).snapshot.league.name).toBe('Old');
  });
});

describe('uploadLeagueProof', () => {
  test('compresses, uploads to league-proofs at <league>/<card>.jpg and returns the path', async () => {
    const path = await uploadLeagueProof('L1', 'C1', 'file:///photo.heic');
    expect(path).toBe('L1/C1.jpg');
    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
      'file:///photo.heic', [{ resize: { width: 1920 } }], { compress: 0.8, format: 'jpeg' },
    );
    expect(mockState.uploads).toHaveLength(1);
    expect(mockState.uploads[0]).toMatchObject({
      bucket: 'league-proofs', path: 'L1/C1.jpg', opts: { contentType: 'image/jpeg', upsert: true },
    });
  });

  test('storage errors keep the server message', async () => {
    mockState.upload = { error: { code: '403', message: 'new row violates row-level security policy' } };
    await expect(uploadLeagueProof('L1', 'C1', 'file:///p.jpg')).rejects.toMatchObject({
      name: 'LeagueError', message: 'new row violates row-level security policy',
    });
  });
});
