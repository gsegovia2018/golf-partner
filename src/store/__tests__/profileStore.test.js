import { loadProfile, upsertProfile } from '../profileStore';
import { supabase } from '../../lib/supabase';

jest.mock('../../lib/supabase', () => {
  const chain = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(),
    upsert: jest.fn().mockReturnThis(),
  };
  return {
    supabase: {
      ...chain,
      auth: { getUser: jest.fn() },
    },
  };
});

describe('profileStore — target_handicap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b' } } });
  });

  test('loadProfile exposes target_handicap as targetHandicap', async () => {
    supabase.maybeSingle.mockResolvedValueOnce({
      data: { user_id: 'u1', target_handicap: 12.5, handicap: 18 },
      error: null,
    });
    const profile = await loadProfile();
    expect(profile.targetHandicap).toBe(12.5);
  });

  test('loadProfile returns targetHandicap=null when not set', async () => {
    supabase.maybeSingle.mockResolvedValueOnce({
      data: { user_id: 'u1', target_handicap: null, handicap: 18 },
      error: null,
    });
    const profile = await loadProfile();
    expect(profile.targetHandicap).toBeNull();
  });

  test('upsertProfile writes target_handicap when provided', async () => {
    supabase.upsert.mockResolvedValueOnce({ error: null });
    await upsertProfile({ targetHandicap: 14 });
    const call = supabase.upsert.mock.calls[0][0];
    expect(call.target_handicap).toBe(14);
  });

  test('upsertProfile writes null to clear target_handicap', async () => {
    supabase.upsert.mockResolvedValueOnce({ error: null });
    await upsertProfile({ targetHandicap: null });
    const call = supabase.upsert.mock.calls[0][0];
    expect(call.target_handicap).toBeNull();
  });

  test('upsertProfile does not touch target_handicap when key omitted', async () => {
    supabase.upsert.mockResolvedValueOnce({ error: null });
    await upsertProfile({ displayName: 'Marcos' });
    const call = supabase.upsert.mock.calls[0][0];
    expect(call).not.toHaveProperty('target_handicap');
  });
});
