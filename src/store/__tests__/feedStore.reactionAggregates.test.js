// Task 5 (fix/audit-tier4): loadReactions / loadCommentCounts must fetch
// server-side aggregate counts (RPC), not full rows, so:
//   1. only the count/mine data crosses the wire (no full-row transfer), and
//   2. the `.in('item_key', keys)` URL-length risk (HTTP 414) on an unbounded
//      key list is gone — counts are requested via RPC body params, not a
//      PostgREST query-string filter.
// The displayed shape must be byte-for-byte identical to the old full-row JS
// aggregation: loadReactions -> { [itemKey]: { counts: {emoji: n}, mine: [emoji] } }
// and loadCommentCounts -> { [itemKey]: n }.

const mockState = {
  rpcName: null,
  rpcArgs: null,
  rpcImpl: null,
};

jest.mock('../../lib/connectivity', () => ({
  isOnline: jest.fn(() => true),
}));

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } } })),
    },
    rpc: jest.fn((name, args) => {
      mockState.rpcName = name;
      mockState.rpcArgs = args;
      return mockState.rpcImpl(name, args);
    }),
    from: jest.fn(() => {
      throw new Error('loadReactions/loadCommentCounts must not hit .from() directly — use an RPC');
    }),
  },
}));

const { isOnline } = require('../../lib/connectivity');

describe('loadReactions (server-side aggregate)', () => {
  beforeEach(() => {
    isOnline.mockReturnValue(true);
    mockState.rpcName = null;
    mockState.rpcArgs = null;
    mockState.rpcImpl = () => Promise.resolve({ data: [], error: null });
  });

  test('bounds the request to a deduped, compacted key set (not the whole history)', async () => {
    const { loadReactions } = require('../feedStore');
    await loadReactions(['round:t1:r1', 'round:t2:r2', 'round:t1:r1', null, undefined, '']);

    expect(mockState.rpcName).toBe('get_feed_reaction_summary');
    expect(mockState.rpcArgs).toEqual({ p_item_keys: ['round:t1:r1', 'round:t2:r2'] });
  });

  test('never calls .from() — counts come from the RPC, not a full-row select', async () => {
    const { supabase } = require('../../lib/supabase');
    const { loadReactions } = require('../feedStore');
    await loadReactions(['round:t1:r1']);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  test('per-item aggregated counts equal the old full-row JS aggregation, for a fixture', async () => {
    // Fixture equivalent to these raw feed_reactions rows:
    //   (A, user-2, 🔥) (A, user-3, 🔥) (A, user-1, 🔥) (A, user-1, 💤) (B, user-2, 👍)
    // Old code fetched all 5 rows and counted in JS as:
    //   A: { counts: { 🔥: 3, 💤: 1 }, mine: ['🔥', '💤'] }   (me = user-1)
    //   B: { counts: { 👍: 1 }, mine: [] }
    mockState.rpcImpl = () => Promise.resolve({
      data: [
        { item_key: 'A', emoji: '🔥', reaction_count: 3, mine: true },
        { item_key: 'A', emoji: '💤', reaction_count: 1, mine: true },
        { item_key: 'B', emoji: '👍', reaction_count: 1, mine: false },
      ],
      error: null,
    });

    const { loadReactions } = require('../feedStore');
    const result = await loadReactions(['A', 'B']);

    expect(result).toEqual({
      A: { counts: { '🔥': 3, '💤': 1 }, mine: ['🔥', '💤'] },
      B: { counts: { '👍': 1 }, mine: [] },
    });
  });

  test('current user\'s own reaction is still returned even when other users also reacted', async () => {
    mockState.rpcImpl = () => Promise.resolve({
      data: [
        { item_key: 'A', emoji: '🎉', reaction_count: 5, mine: false },
        { item_key: 'A', emoji: '🙌', reaction_count: 2, mine: true },
      ],
      error: null,
    });

    const { loadReactions } = require('../feedStore');
    const result = await loadReactions(['A']);

    expect(result.A.mine).toEqual(['🙌']);
    expect(result.A.counts).toEqual({ '🎉': 5, '🙌': 2 });
  });

  test('returns {} without calling the RPC when offline', async () => {
    isOnline.mockReturnValue(false);
    const { loadReactions } = require('../feedStore');
    const result = await loadReactions(['A']);
    expect(result).toEqual({});
    expect(mockState.rpcName).toBeNull();
  });

  test('returns {} when the RPC/table is not yet provisioned (missing function or table)', async () => {
    mockState.rpcImpl = () => Promise.resolve({
      data: null,
      error: { code: '42883', message: 'function public.get_feed_reaction_summary(text[]) does not exist' },
    });
    const { loadReactions } = require('../feedStore');
    const result = await loadReactions(['A']);
    expect(result).toEqual({});
  });

  test('returns {} for an empty key set without calling the RPC', async () => {
    const { loadReactions } = require('../feedStore');
    const result = await loadReactions([]);
    expect(result).toEqual({});
    expect(mockState.rpcName).toBeNull();
  });
});

describe('loadCommentCounts (server-side aggregate)', () => {
  beforeEach(() => {
    isOnline.mockReturnValue(true);
    mockState.rpcName = null;
    mockState.rpcArgs = null;
    mockState.rpcImpl = () => Promise.resolve({ data: [], error: null });
  });

  test('bounds the request to a deduped, compacted key set (not the whole history)', async () => {
    const { loadCommentCounts } = require('../feedStore');
    await loadCommentCounts(['round:t1:r1', 'round:t2:r2', 'round:t1:r1', null]);

    expect(mockState.rpcName).toBe('get_feed_comment_counts');
    expect(mockState.rpcArgs).toEqual({ p_item_keys: ['round:t1:r1', 'round:t2:r2'] });
  });

  test('never calls .from() — counts come from the RPC, not a full-row select', async () => {
    const { supabase } = require('../../lib/supabase');
    const { loadCommentCounts } = require('../feedStore');
    await loadCommentCounts(['round:t1:r1']);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  test('per-item counts equal the old full-row JS aggregation, for a fixture', async () => {
    // Fixture equivalent to these raw feed_comments rows:
    //   (A, ...) x3, (B, ...) x1
    mockState.rpcImpl = () => Promise.resolve({
      data: [
        { item_key: 'A', comment_count: 3 },
        { item_key: 'B', comment_count: 1 },
      ],
      error: null,
    });

    const { loadCommentCounts } = require('../feedStore');
    const result = await loadCommentCounts(['A', 'B']);

    expect(result).toEqual({ A: 3, B: 1 });
  });

  test('returns {} without calling the RPC when offline', async () => {
    isOnline.mockReturnValue(false);
    const { loadCommentCounts } = require('../feedStore');
    const result = await loadCommentCounts(['A']);
    expect(result).toEqual({});
    expect(mockState.rpcName).toBeNull();
  });

  test('returns {} when the RPC/table is not yet provisioned (missing function or table)', async () => {
    mockState.rpcImpl = () => Promise.resolve({
      data: null,
      error: { code: '42P01', message: 'relation "feed_comments" does not exist' },
    });
    const { loadCommentCounts } = require('../feedStore');
    const result = await loadCommentCounts(['A']);
    expect(result).toEqual({});
  });
});
