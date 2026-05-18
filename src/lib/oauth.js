// OAuth helpers shared by the email/social sign-in screen.
//
// Two distinct flows exist:
//  - Web: a full-page redirect to the provider, then back to the app. The
//    provider appends either a `?code=` (success) or `?error=`/`#error=`
//    (failure) to the return URL. We must surface failures ourselves —
//    Supabase silently ignores error params, so without this the user just
//    sees a blank page.
//  - Native: an in-app browser session (`expo-web-browser`) that resolves
//    with the redirect URL, which we parse for the `code` to exchange.

/**
 * Extract a human-readable OAuth error from a redirect URL, if present.
 * Providers put the error in the query string and/or the hash fragment, so
 * we merge both before parsing. Returns null when the URL carries no error.
 *
 * @param {string} urlString full URL the provider redirected back to
 * @returns {string|null} decoded error description, or null
 */
export function parseOAuthError(urlString) {
  if (!urlString || typeof urlString !== 'string') return null;

  let query = '';
  const qIdx = urlString.indexOf('?');
  const hIdx = urlString.indexOf('#');
  if (qIdx !== -1) query += urlString.slice(qIdx + 1).split('#')[0];
  if (hIdx !== -1) query += `&${urlString.slice(hIdx + 1)}`;
  if (!query) return null;

  const params = new URLSearchParams(query);
  // `error_description` is the readable message; `error` is the short code.
  const description = params.get('error_description');
  const code = params.get('error');
  return description || code || null;
}

/**
 * Web-only redirect target for `signInWithOAuth`. Uses origin + pathname so
 * the callback lands back on the actual app route — `window.location.origin`
 * alone drops any sub-path the app is deployed under, which sends the user
 * to a blank/nonexistent page.
 *
 * @returns {string|undefined} redirect URL, or undefined off-web
 */
export function getWebRedirectTo() {
  if (typeof window === 'undefined' || !window.location) return undefined;
  return window.location.origin + window.location.pathname;
}
