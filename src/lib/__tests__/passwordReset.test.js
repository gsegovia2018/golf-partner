import {
  validateNewPassword,
  parseRecoveryUrl,
  isResetPasswordUrl,
  isRecoveryRedirectType,
} from '../passwordReset';

describe('validateNewPassword', () => {
  it('rejects an empty password', () => {
    expect(validateNewPassword('', '')).toEqual({
      valid: false,
      error: 'Enter a new password',
    });
  });

  it('rejects a password shorter than 8 characters', () => {
    expect(validateNewPassword('short1', 'short1')).toEqual({
      valid: false,
      error: 'Password must be at least 8 characters',
    });
  });

  it('rejects mismatched confirmation', () => {
    expect(validateNewPassword('longenough1', 'longenough2')).toEqual({
      valid: false,
      error: 'Passwords do not match',
    });
  });

  it('accepts a valid, matching password', () => {
    expect(validateNewPassword('longenough1', 'longenough1')).toEqual({
      valid: true,
      error: null,
    });
  });

  it('treats an empty confirmation as a mismatch, not a length error', () => {
    expect(validateNewPassword('longenough1', '')).toEqual({
      valid: false,
      error: 'Passwords do not match',
    });
  });
});

describe('parseRecoveryUrl', () => {
  it('returns null for empty or non-string input', () => {
    expect(parseRecoveryUrl('')).toBeNull();
    expect(parseRecoveryUrl(undefined)).toBeNull();
    expect(parseRecoveryUrl(null)).toBeNull();
  });

  it('extracts the code from a bare recovery deep link (no type param)', () => {
    // A REAL GoTrue PKCE recovery link looks like this — just a code.
    const url = 'golf://reset-password?code=abc123';
    expect(parseRecoveryUrl(url)).toEqual({ code: 'abc123', type: null });
  });

  it('extracts code and our own type marker from the web redirect', () => {
    const url = 'https://app.example.com/?type=recovery&code=abc123';
    expect(parseRecoveryUrl(url)).toEqual({ code: 'abc123', type: 'recovery' });
  });

  it('extracts code and type from the hash fragment', () => {
    const url = 'golf://reset-password#code=xyz789&type=recovery';
    expect(parseRecoveryUrl(url)).toEqual({ code: 'xyz789', type: 'recovery' });
  });

  it('returns nulls for fields that are absent', () => {
    expect(parseRecoveryUrl('https://app.example.com/')).toEqual({ code: null, type: null });
  });
});

describe('isResetPasswordUrl', () => {
  it('recognises the native reset-password deep link by path (no type needed)', () => {
    expect(isResetPasswordUrl('golf://reset-password?code=abc123')).toBe(true);
  });

  it('recognises the web redirect by our own type=recovery marker', () => {
    expect(isResetPasswordUrl('https://app.example.com/?type=recovery&code=abc')).toBe(true);
  });

  it('recognises a web reset path even after code is stripped', () => {
    expect(isResetPasswordUrl('https://app.example.com/reset-password')).toBe(true);
  });

  it('does NOT claim a plain OAuth login deep link', () => {
    expect(isResetPasswordUrl('golf://auth?code=oauth-code')).toBe(false);
  });

  it('does NOT claim a plain web OAuth callback', () => {
    expect(isResetPasswordUrl('https://app.example.com/?code=oauth-code')).toBe(false);
  });

  it('is false for empty / non-string input', () => {
    expect(isResetPasswordUrl('')).toBe(false);
    expect(isResetPasswordUrl(undefined)).toBe(false);
    expect(isResetPasswordUrl(null)).toBe(false);
  });
});

describe('isRecoveryRedirectType', () => {
  it('matches the SDK recovery marker regardless of casing/form', () => {
    expect(isRecoveryRedirectType('recovery')).toBe(true);
    expect(isRecoveryRedirectType('PASSWORD_RECOVERY')).toBe(true);
    expect(isRecoveryRedirectType('Recovery')).toBe(true);
  });

  it('is false for a normal sign-in exchange', () => {
    expect(isRecoveryRedirectType(null)).toBe(false);
    expect(isRecoveryRedirectType(undefined)).toBe(false);
    expect(isRecoveryRedirectType('')).toBe(false);
    expect(isRecoveryRedirectType('signup')).toBe(false);
  });
});
