jest.mock('../supabase', () => ({
  supabase: { auth: { getSession: jest.fn(), getUser: jest.fn() } },
}));

const { supabase } = require('../supabase');
const { setAuthUser, authUser, authUserId, __resetAuthUserForTests } = require('../authUser');

beforeEach(() => {
  __resetAuthUserForTests();
  supabase.auth.getSession.mockReset();
  supabase.auth.getUser.mockReset();
});

test('answers from what AuthContext handed over, with no auth call', async () => {
  setAuthUser({ id: 'u1', email: 'a@b.c', user_metadata: {} });

  await expect(authUser()).resolves.toEqual({ id: 'u1', email: 'a@b.c' });
  await expect(authUserId()).resolves.toBe('u1');
  expect(supabase.auth.getSession).not.toHaveBeenCalled();
  expect(supabase.auth.getUser).not.toHaveBeenCalled();
});

test('signed out once AuthContext says so', async () => {
  setAuthUser(null);

  await expect(authUser()).resolves.toBeNull();
  expect(supabase.auth.getSession).not.toHaveBeenCalled();
});

test('before AuthContext has a session, reads the one on the device (never getUser)', async () => {
  supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u2', email: null } } }, error: null });

  await expect(authUserId()).resolves.toBe('u2');
  expect(supabase.auth.getUser).not.toHaveBeenCalled();
});

// Offline with an expired token: "unknown" must not read as "signed out"
// (profileStore's onboarding gate depends on it).
test('an unreadable device session throws from authUser, null from authUserId', async () => {
  const netError = Object.assign(new Error('Network request failed'), { name: 'AuthRetryableFetchError' });
  supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: netError });

  await expect(authUser()).rejects.toThrow('Network request failed');
  await expect(authUserId()).resolves.toBeNull();
});
