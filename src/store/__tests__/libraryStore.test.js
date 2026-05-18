import { fetchMyPlayers, fetchMyGuestPlayers } from '../libraryStore';
import { listFriends, getCachedFriends } from '../friendStore';

// mockState is read inside the hoisted jest.mock factory; the `mock` prefix
// is what lets jest reference it from the factory.
const mockState = {
  user: { id: 'u1' },
  rows: [],
  calls: {},
};

jest.mock('../../lib/supabase', () => {
  const client = {
    from(table) { mockState.calls.table = table; return client; },
    select(cols) { mockState.calls.select = cols; return client; },
    or(expr) { mockState.calls.or = expr; return client; },
    eq(col, val) {
      if (!mockState.calls.eq) mockState.calls.eq = [];
      mockState.calls.eq.push([col, val]);
      return client;
    },
    is(col, val) {
      if (!mockState.calls.is) mockState.calls.is = [];
      mockState.calls.is.push([col, val]);
      return client;
    },
    order() { return Promise.resolve({ data: mockState.rows, error: null }); },
    auth: {
      getUser: () => Promise.resolve({ data: { user: mockState.user } }),
    },
  };
  return { supabase: client };
});

jest.mock('../friendStore', () => ({
  listFriends: jest.fn(),
  getCachedFriends: jest.fn(),
}));

describe('fetchMyPlayers', () => {
  beforeEach(() => {
    mockState.user = { id: 'u1' };
    mockState.rows = [{ id: 'p1', name: 'Ann' }];
    mockState.calls = {};
    listFriends.mockReset();
    getCachedFriends.mockReset();
  });

  test('scopes to created_by = me OR user_id in (me + friends)', async () => {
    listFriends.mockResolvedValue([{ userId: 'f1' }, { userId: 'f2' }]);
    const result = await fetchMyPlayers();
    expect(mockState.calls.table).toBe('players');
    expect(mockState.calls.or).toBe(
      'created_by.eq.u1,user_id.in.(u1,f1,f2)',
    );
    expect(result).toEqual([{ id: 'p1', name: 'Ann' }]);
  });

  test('falls back to cached friends when the friends read fails', async () => {
    listFriends.mockRejectedValue(new Error('offline'));
    getCachedFriends.mockResolvedValue([{ userId: 'f3' }]);
    await fetchMyPlayers();
    expect(mockState.calls.or).toBe('created_by.eq.u1,user_id.in.(u1,f3)');
  });

  test('returns [] without querying when signed out', async () => {
    mockState.user = null;
    const result = await fetchMyPlayers();
    expect(result).toEqual([]);
    expect(mockState.calls.table).toBeUndefined();
  });

  test('scopes to just the current user when they have no friends', async () => {
    listFriends.mockResolvedValue([]);
    await fetchMyPlayers();
    expect(mockState.calls.or).toBe('created_by.eq.u1,user_id.in.(u1)');
  });
});

describe('fetchMyGuestPlayers', () => {
  beforeEach(() => {
    mockState.user = { id: 'u1' };
    mockState.rows = [{ id: 'g1', name: 'Guest', user_id: null }];
    mockState.calls = {};
    listFriends.mockReset();
    getCachedFriends.mockReset();
  });

  test('scopes to created_by = me AND user_id IS NULL', async () => {
    const result = await fetchMyGuestPlayers();
    expect(mockState.calls.table).toBe('players');
    expect(mockState.calls.eq).toEqual([['created_by', 'u1']]);
    expect(mockState.calls.is).toEqual([['user_id', null]]);
    expect(result).toEqual([{ id: 'g1', name: 'Guest', user_id: null }]);
  });

  test('returns [] without querying when signed out', async () => {
    mockState.user = null;
    const result = await fetchMyGuestPlayers();
    expect(result).toEqual([]);
    expect(mockState.calls.table).toBeUndefined();
  });
});
