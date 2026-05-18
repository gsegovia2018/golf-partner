import { declineRequest } from '../friendStore';

const mockState = { rpcCalls: [], deleteError: null };

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../lib/supabase', () => {
  function builder() {
    return {
      delete() { return this; },
      eq() { return Promise.resolve({ error: mockState.deleteError }); },
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
