// Pure helpers for the set-new-password flow (see AuthContext's recovery
// handling and SetNewPasswordScreen). Kept dependency-free so they're
// trivially unit-testable without mocking Supabase or RN.

const MIN_LENGTH = 8;

// The path segment of the redirect we hand to `resetPasswordForEmail`
// (native: `golf://reset-password`; web: same root + a `type=recovery`
// marker we append ourselves). We OWN this marker — it's how we route a
// recovery URL to the recovery handler without depending on GoTrue
// populating anything in the URL. See `getPasswordResetRedirectTo`.
export const RESET_PASSWORD_PATH = 'reset-password';

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
 * Extract the `code` and `type` params from a Supabase auth redirect URL.
 * Merges query string + hash fragment (same strategy as `parseOAuthError`)
 * so it reads a `code` whichever side it lands on. Returns null only when
 * there's no URL at all.
 *
 * NOTE: with this app's PKCE config, GoTrue does NOT put `type=recovery` in
 * a real recovery redirect — a genuine reset link is just `?code=...`. The
 * `type` field here only reflects the marker WE append to the web
 * redirectTo. Recovery is authoritatively confirmed by the `redirectType`
 * that `exchangeCodeForSession` returns (see `isRecoveryRedirectType`), not
 * by this field.
 *
 * @param {string} urlString
 * @returns {{ code: string|null, type: string|null }|null}
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
 * Whether a URL is one of OUR password-reset redirect targets, and therefore
 * should be owned by the recovery handler (AuthContext) rather than the
 * OAuth deep-link handler (AuthScreen). Recognised by the `reset-password`
 * path segment we put in the deep link, or the `type=recovery` marker we
 * append to the web redirect — both are markers we control, so this does not
 * depend on GoTrue populating anything.
 *
 * This is a *routing* signal (who consumes the URL), deliberately independent
 * of whether the code exchange ultimately confirms recovery.
 *
 * @param {string} urlString
 * @returns {boolean}
 */
export function isResetPasswordUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') return false;
  if (urlString.includes(RESET_PASSWORD_PATH)) return true;
  const parsed = parseRecoveryUrl(urlString);
  return parsed?.type === 'recovery';
}

/**
 * The authoritative recovery signal: the `redirectType` that
 * `supabase.auth.exchangeCodeForSession(code)` returns for a PKCE code that
 * was issued by `resetPasswordForEmail`. Depending on SDK version this is
 * either `'recovery'` or `'PASSWORD_RECOVERY'`, so match case-insensitively
 * on the substring rather than an exact string.
 *
 * @param {unknown} redirectType
 * @returns {boolean}
 */
export function isRecoveryRedirectType(redirectType) {
  return typeof redirectType === 'string' && redirectType.toLowerCase().includes('recovery');
}
