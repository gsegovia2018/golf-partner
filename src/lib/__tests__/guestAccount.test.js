import { attachEmailToGuest, isEmailTakenError, isEmailThrottledError } from '../guestAccount';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({ supabase: { auth: { updateUser: jest.fn() } } }));

describe('guestAccount', () => {
  beforeEach(() => jest.clearAllMocks());

  test('attaches the trimmed email and the name as metadata', async () => {
    supabase.auth.updateUser.mockResolvedValue({ data: {}, error: null });
    await expect(attachEmailToGuest({ email: ' lucia@example.com ', name: ' Lucía ' })).resolves.toBe('sent');
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({
      email: 'lucia@example.com', data: { full_name: 'Lucía', display_name: 'Lucía' },
    });
  });

  test('a rate-limited confirmation email resolves "throttled" instead of failing', async () => {
    supabase.auth.updateUser.mockResolvedValue({
      error: { code: 'over_email_send_rate_limit', status: 429, message: 'email rate limit exceeded' },
    });
    await expect(attachEmailToGuest({ email: 'a@b.co', name: 'A' })).resolves.toBe('throttled');
  });

  test('any other error is thrown, and an existing email is recognisable', async () => {
    const err = { code: 'email_exists', status: 422, message: 'A user with this email address has already been registered' };
    supabase.auth.updateUser.mockResolvedValue({ error: err });
    await expect(attachEmailToGuest({ email: 'a@b.co', name: 'A' })).rejects.toBe(err);
    expect(isEmailTakenError(err)).toBe(true);
    expect(isEmailTakenError({ message: 'A user with this email address has already been registered' })).toBe(true);
    expect(isEmailTakenError({ code: 'validation_failed', message: 'bad email' })).toBe(false);
    expect(isEmailThrottledError(err)).toBe(false);
  });
});
