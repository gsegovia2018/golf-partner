import { declineRequest, sendRequest } from '../friendStore';

const mockState = {
  rpcCalls: [],
  deleteError: null,
  updateError: null,
  insertError: null,
  insertCalls: [],
  // Rows returned by the friendships existence-check `.select().or()`. One
  // array per call in order (2nd+ calls reuse the last entry once the queue
  // runs out) — lets a test simulate "no row yet" on the pre-insert check
  // and "the row that won the race" on a post-conflict re-check.
  selectResponses: [[]],
  selectCallCount: 0,
};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../lib/supabase', () => {
  function builder() {
    let mode = null;
    return {
      select() { return this; },
      or() {
        const i = Math.min(mockState.selectCallCount, mockState.selectResponses.length - 1);
        mockState.selectCallCount += 1;
        return Promise.resolve({ data: mockState.selectResponses[i], error: null });
      },
      insert(row) {
        mockState.insertCalls.push(row);
        return Promise.resolve({ error: mockState.insertError });
      },
      update() { mode = 'update'; return this; },
      delete() { mode = 'delete'; return this; },
      eq() {
        return Promise.resolve({
          error: mode === 'update' ? mockState.updateError : mockState.deleteError,
        });
      },
    };
  }
  const client = {
    from: () => builder(),
    rpc: (name, args) => { mockState.rpcCalls.push({ name, args }); return Promise.resolve({ error: null }); },
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) },
  };
  return { supabase: client };
});

describe('declineRequest', () => {
  beforeEach(() => {
    mockState.rpcCalls = [];
    mockState.deleteError = null;
  });

  test('deletes the friend_request notification for the declined friendship', async () => {
    await declineRequest('friendship-9');
    expect(mockState.rpcCalls).toContainEqual({
      name: 'delete_notification_for_entity',
      args: { p_entity_id: 'friendship-9', p_type: 'friend_request' },
    });
  });

  test('throws when the friendship delete fails, before any cleanup', async () => {
    mockState.deleteError = { message: 'boom' };
    await expect(declineRequest('friendship-9')).rejects.toBeTruthy();
    expect(mockState.rpcCalls).toHaveLength(0);
  });
});

// Task 9 (audit-tier3): two simultaneous "Add" taps used to both pass the
// check-then-insert with no DB uniqueness, inserting duplicate/mirror rows.
// A UNIQUE index on the unordered pair (migration 20260715000000) now makes
// the DB reject the loser's insert with a 23505 — sendRequest must treat
// that as "already requested", not a user-facing error.
describe('sendRequest race handling (Task 9)', () => {
  beforeEach(() => {
    mockState.updateError = null;
    mockState.insertError = null;
    mockState.insertCalls = [];
    mockState.selectResponses = [[]];
    mockState.selectCallCount = 0;
  });

  test('plain success path inserts a pending request when no row exists', async () => {
    mockState.selectResponses = [[]];
    const result = await sendRequest('target-1');
    expect(result).toEqual({ status: 'pending' });
    expect(mockState.insertCalls).toEqual([
      { requester_id: 'user-1', addressee_id: 'target-1', status: 'pending' },
    ]);
  });

  test('a 23505 on insert (mirror row: target already requested us) resolves to accepted, no throw', async () => {
    // First select (pre-insert existence check): nothing yet — we proceed to
    // insert. The insert loses a race against the target's own concurrent
    // request and gets 23505. Re-checking finds their row.
    mockState.selectResponses = [
      [],
      [{ id: 'f-mirror', requester_id: 'target-1', addressee_id: 'user-1', status: 'pending' }],
    ];
    mockState.insertError = { code: '23505', message: 'duplicate key value violates unique constraint "friendships_unordered_pair_uq"' };

    await expect(sendRequest('target-1')).resolves.toEqual({ status: 'accepted' });
    // Accepted via update, not a second insert — no duplicate row created.
    expect(mockState.insertCalls).toHaveLength(1);
  });

  test('a 23505 on insert (our own request duplicated) resolves to pending, no throw', async () => {
    mockState.selectResponses = [
      [],
      [{ id: 'f-dup', requester_id: 'user-1', addressee_id: 'target-1', status: 'pending' }],
    ];
    mockState.insertError = { code: '23505', message: 'duplicate key value violates unique constraint' };

    await expect(sendRequest('target-1')).resolves.toEqual({ status: 'pending' });
    expect(mockState.insertCalls).toHaveLength(1);
  });

  test('a 23505 on insert where the pair is already accepted resolves to accepted, no throw', async () => {
    mockState.selectResponses = [
      [],
      [{ id: 'f-acc', requester_id: 'target-1', addressee_id: 'user-1', status: 'accepted' }],
    ];
    mockState.insertError = { code: '23505', message: 'duplicate key value violates unique constraint' };

    await expect(sendRequest('target-1')).resolves.toEqual({ status: 'accepted' });
  });

  test('a non-uniqueness insert error still throws', async () => {
    mockState.selectResponses = [[]];
    mockState.insertError = { code: '42501', message: 'permission denied' };
    await expect(sendRequest('target-1')).rejects.toBeTruthy();
  });
});
