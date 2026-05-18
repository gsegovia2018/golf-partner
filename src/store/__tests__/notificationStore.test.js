import { unreadCount, listNotifications, markAllRead } from '../notificationStore';

// mockState is read inside the jest.mock factory; the `mock` prefix is what
// lets jest's hoisted factory reference it.
const mockState = { user: { id: 'user-1' }, rows: [], error: null, updatePayload: undefined };

jest.mock('../../lib/supabase', () => {
  // A minimal supabase query-builder stub. Every chain method returns the
  // builder; awaiting it resolves to {data}/{count}/{error} depending on the
  // operation that was started by select()/update().
  function builder() {
    return {
      _op: 'select',
      _head: false,
      select(_cols, opts) { this._op = 'select'; this._head = !!(opts && opts.head); return this; },
      update(payload) { this._op = 'update'; mockState.updatePayload = payload; return this; },
      eq() { return this; },
      is() { return this; },
      order() { return this; },
      limit() { return this; },
      then(resolve) {
        if (mockState.error) return resolve({ data: null, count: null, error: mockState.error });
        if (this._op === 'update') return resolve({ error: null });
        if (this._head) return resolve({ count: mockState.rows.length, error: null });
        return resolve({ data: mockState.rows, error: null });
      },
    };
  }
  const client = {
    from: () => builder(),
    auth: { getUser: () => Promise.resolve({ data: { user: mockState.user } }) },
  };
  return { supabase: client };
});

describe('notificationStore', () => {
  beforeEach(() => {
    mockState.user = { id: 'user-1' };
    mockState.rows = [];
    mockState.error = null;
    mockState.updatePayload = undefined;
  });

  test('unreadCount returns the number of unread rows', async () => {
    mockState.rows = [{ id: 'n1' }, { id: 'n2' }];
    expect(await unreadCount()).toBe(2);
  });

  test('unreadCount returns 0 when no user is signed in', async () => {
    mockState.user = null;
    expect(await unreadCount()).toBe(0);
  });

  test('listNotifications maps DB rows to camelCase notification objects', async () => {
    mockState.rows = [{
      id: 'n1', type: 'friend_request', actor_id: 'user-2', entity_id: 'f1',
      data: { actor_name: 'Sam' }, read_at: null, created_at: '2026-05-18T10:00:00Z',
    }];
    const [n] = await listNotifications();
    expect(n).toEqual({
      id: 'n1', type: 'friend_request', actorId: 'user-2', entityId: 'f1',
      data: { actor_name: 'Sam' }, readAt: null, createdAt: '2026-05-18T10:00:00Z',
    });
  });

  test('listNotifications returns [] when no user is signed in', async () => {
    mockState.user = null;
    expect(await listNotifications()).toEqual([]);
  });

  test('markAllRead writes a read_at timestamp', async () => {
    await markAllRead();
    expect(typeof mockState.updatePayload.read_at).toBe('string');
  });

  test('markAllRead is a no-op when no user is signed in', async () => {
    mockState.user = null;
    await markAllRead();
    expect(mockState.updatePayload).toBeUndefined();
  });
});
