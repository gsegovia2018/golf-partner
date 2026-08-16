// Owner share-action store functions: fetchShareToken / enableBoardSharing /
// rotateBoardToken / disableBoardSharing. All four wrap the owner-guarded
// set_share_token RPC (supabase/migrations/20260816000000_shared_board.sql)
// and patch the locally cached tournament record so HomeScreen/
// RoundSummaryScreen can read tournament.shareToken back off it.
//
// jest.mock calls are hoisted above these imports by babel-jest, matching
// tournamentStore.test.js's own pattern for mocking ../../lib/supabase.

import {
  fetchShareToken, enableBoardSharing, rotateBoardToken, disableBoardSharing,
  saveLocal, readLocal,
} from '../tournamentStore';

jest.mock('uuid', () => ({ v4: jest.fn(() => 'generated-token') }));

const mockState = {
  selectResult: { data: { share_token: null }, error: null },
  rpcResult: { data: null, error: null },
};
const rpcCalls = [];

jest.mock('../../lib/supabase', () => {
  function makeBuilder() {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: () => Promise.resolve(mockState.selectResult),
    };
    return builder;
  }
  return {
    supabase: {
      from: () => makeBuilder(),
      rpc: (fn, args) => {
        rpcCalls.push({ fn, args });
        return Promise.resolve(mockState.rpcResult);
      },
    },
  };
});

beforeEach(() => {
  mockState.selectResult = { data: { share_token: null }, error: null };
  mockState.rpcResult = { data: null, error: null };
  rpcCalls.length = 0;
});

describe('fetchShareToken', () => {
  test('returns the current token', async () => {
    mockState.selectResult = { data: { share_token: 'tok-1' }, error: null };
    await expect(fetchShareToken('t1')).resolves.toBe('tok-1');
  });

  test('returns null when sharing is off / RLS returns no row', async () => {
    mockState.selectResult = { data: null, error: null };
    await expect(fetchShareToken('t1')).resolves.toBeNull();
  });

  test('propagates a select error', async () => {
    mockState.selectResult = { data: null, error: new Error('boom') };
    await expect(fetchShareToken('t1')).rejects.toThrow('boom');
  });
});

describe('enableBoardSharing', () => {
  test('generates a token, calls set_share_token, and patches local state', async () => {
    await saveLocal({ id: 't1', name: 'G', rounds: [], players: [] }, { makeActive: false });

    const token = await enableBoardSharing('t1');

    expect(token).toBe('generated-token');
    expect(rpcCalls).toEqual([
      { fn: 'set_share_token', args: { p_id: 't1', p_token: 'generated-token' } },
    ]);
    const local = await readLocal('t1');
    expect(local.shareToken).toBe('generated-token');
  });

  test('is idempotent: an existing token is returned without calling the RPC', async () => {
    mockState.selectResult = { data: { share_token: 'already-on' }, error: null };
    await saveLocal({ id: 't2', name: 'G', rounds: [], players: [] }, { makeActive: false });

    const token = await enableBoardSharing('t2');

    expect(token).toBe('already-on');
    expect(rpcCalls).toEqual([]);
  });

  test('an RPC error propagates and does not touch local state', async () => {
    await saveLocal({ id: 't3', name: 'G', rounds: [], players: [] }, { makeActive: false });
    mockState.rpcResult = { data: null, error: new Error('not authorized to share tournament t3') };

    await expect(enableBoardSharing('t3')).rejects.toThrow('not authorized');

    const local = await readLocal('t3');
    expect(local.shareToken).toBeUndefined();
  });
});

describe('rotateBoardToken', () => {
  test('generates a fresh token, calls set_share_token, and patches local state', async () => {
    await saveLocal({ id: 't4', name: 'G', rounds: [], players: [], shareToken: 'old-token' }, { makeActive: false });

    const token = await rotateBoardToken('t4');

    expect(token).toBe('generated-token');
    expect(rpcCalls).toEqual([
      { fn: 'set_share_token', args: { p_id: 't4', p_token: 'generated-token' } },
    ]);
    const local = await readLocal('t4');
    expect(local.shareToken).toBe('generated-token');
  });

  test('an RPC error propagates and does not touch local state', async () => {
    await saveLocal({ id: 't5', name: 'G', rounds: [], players: [], shareToken: 'old-token' }, { makeActive: false });
    mockState.rpcResult = { data: null, error: new Error('offline') };

    await expect(rotateBoardToken('t5')).rejects.toThrow('offline');

    const local = await readLocal('t5');
    expect(local.shareToken).toBe('old-token');
  });
});

describe('disableBoardSharing', () => {
  test('calls set_share_token with a null token and clears local state', async () => {
    await saveLocal({ id: 't6', name: 'G', rounds: [], players: [], shareToken: 'was-on' }, { makeActive: false });

    await disableBoardSharing('t6');

    expect(rpcCalls).toEqual([
      { fn: 'set_share_token', args: { p_id: 't6', p_token: null } },
    ]);
    const local = await readLocal('t6');
    expect(local.shareToken).toBeNull();
  });

  test('an RPC error propagates and does not touch local state', async () => {
    await saveLocal({ id: 't7', name: 'G', rounds: [], players: [], shareToken: 'was-on' }, { makeActive: false });
    mockState.rpcResult = { data: null, error: new Error('not authorized to share tournament t7') };

    await expect(disableBoardSharing('t7')).rejects.toThrow('not authorized');

    const local = await readLocal('t7');
    expect(local.shareToken).toBe('was-on');
  });
});
