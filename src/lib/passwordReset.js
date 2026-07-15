// Pure helpers for the set-new-password flow (see AuthContext's
// PASSWORD_RECOVERY handling and SetNewPasswordScreen). Kept dependency-free
// so they're trivially unit-testable without mocking Supabase or RN.

const MIN_LENGTH = 8;

/**
 * Validate a new password + confirmation pair before calling
 * `supabase.auth.updateUser({ password })`.
 *
 * @param {string} password
 * @param {string} confirm
 * @returns {{ valid: boolean, error: string|null }}
 */
export function validateNewPassword(password, confirm) {
  if (!password) {
    return { valid: false, error: 'Enter a new password' };
  }
  if (password.length < MIN_LENGTH) {
    return { valid: false, error: `Password must be at least ${MIN_LENGTH} characters` };
  }
  if (password !== confirm) {
    return { valid: false, error: 'Passwords do not match' };
  }
  return { valid: true, error: null };
}

/**
 * Extract the `code` and `type` params from a Supabase auth redirect URL
 * (recovery links look like `<redirectTo>?code=...&type=recovery`, and the
 * same shape shows up in the hash fragment on some native deep links). A
 * `type` of `'recovery'` is what distinguishes a password-reset callback
 * from a plain OAuth sign-in callback, which carries a `code` but no `type`.
 *
 * @param {string} urlString
 * @returns {{ code: string|null, type: string|null }|null} null when there's no URL to parse
 */
export function parseRecoveryUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') return null;

  let query = '';
  const qIdx = urlString.indexOf('?');
  const hIdx = urlString.indexOf('#');
  if (qIdx !== -1) query += urlString.slice(qIdx + 1).split('#')[0];
  if (hIdx !== -1) query += `&${urlString.slice(hIdx + 1)}`;

  const params = new URLSearchParams(query);
  return {
    code: params.get('code'),
    type: params.get('type'),
  };
}

/**
 * Whether a parsed recovery URL (see `parseRecoveryUrl`) represents a
 * password-recovery callback specifically, as opposed to a plain OAuth
 * sign-in callback or an unrelated URL.
 *
 * @param {{ code: string|null, type: string|null }|null} parsed
 * @returns {boolean}
 */
export function isRecoveryCallback(parsed) {
  return !!parsed && parsed.type === 'recovery' && !!parsed.code;
}
