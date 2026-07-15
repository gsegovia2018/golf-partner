import { validateNewPassword, parseRecoveryUrl } from '../passwordReset';

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

  it('extracts code and type from the query string', () => {
    const url = 'https://app.example.com/?code=abc123&type=recovery';
    expect(parseRecoveryUrl(url)).toEqual({ code: 'abc123', type: 'recovery' });
  });

  it('extracts code and type from the hash fragment', () => {
    const url = 'golf://reset-password#code=xyz789&type=recovery';
    expect(parseRecoveryUrl(url)).toEqual({ code: 'xyz789', type: 'recovery' });
  });

  it('returns nulls for fields that are absent', () => {
    expect(parseRecoveryUrl('https://app.example.com/')).toEqual({ code: null, type: null });
  });

  it('does not flag a plain OAuth callback as a recovery link', () => {
    const url = 'https://app.example.com/?code=oauth-code';
    expect(parseRecoveryUrl(url)).toEqual({ code: 'oauth-code', type: null });
  });
});
