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

import { supabase } from './supabase';

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

/**
 * Redirect target for `resetPasswordForEmail`. Web needs a URL Supabase can
 * send the browser back to (reuses the same origin+pathname OAuth already
 * redirects to); native needs an app deep link so the OS routes the
 * recovery email link into the app instead of opening a bare browser tab
 * with nothing listening for the `code`.
 *
 * On web we append a `type=recovery` marker that WE control. It survives
 * Supabase's `detectSessionInUrl` auto-exchange (which strips only `code`),
 * and it's needed because that PKCE auto-exchange never emits a
 * `PASSWORD_RECOVERY` event — so without our own marker there's no way to
 * tell a recovery load apart from a normal OAuth `?code=` load on web. This
 * is our marker, not something GoTrue populates.
 *
 * Takes `platformOS`/`nativeDeepLink` as params (rather than reading
 * `Platform.OS` / calling `Linking.createURL` itself) so this stays a pure,
 * dependency-free function — see callers in AuthScreen.
 *
 * @param {string} platformOS `Platform.OS` — 'web' | 'ios' | 'android'
 * @param {string} nativeDeepLink app deep link to use off-web, e.g.
 *   `Linking.createURL('reset-password')`
 * @returns {string|undefined} redirect URL
 */
export function getPasswordResetRedirectTo(platformOS, nativeDeepLink) {
  if (platformOS === 'web') {
    const base = getWebRedirectTo();
    if (!base) return undefined;
    return `${base}${base.includes('?') ? '&' : '?'}type=recovery`;
  }
  return nativeDeepLink;
}

/**
 * Remove our `type=recovery` marker (see `getPasswordResetRedirectTo`) from a
 * web URL so a reload doesn't re-trigger the recovery flow. Supabase's
 * `detectSessionInUrl` already strips `code`; this strips the marker we added.
 * Pure and string-based so it's unit-testable without a live `window`.
 *
 * @param {string} href full URL, e.g. `window.location.href`
 * @returns {string} the URL with `type=recovery` removed (other params kept)
 */
export function stripRecoveryMarker(href) {
  if (!href || typeof href !== 'string') return href;
  try {
    const url = new URL(href);
    if (url.searchParams.get('type') === 'recovery') {
      url.searchParams.delete('type');
    }
    // URL#toString() re-serialises; drop a now-dangling `?` for a clean URL.
    return url.toString().replace(/\?(?=#|$)/, '');
  } catch {
    return href;
  }
}

/**
 * Start an anonymous Supabase session. Used by the "Continue without an
 * account" path on the join screen: the guest gets a real (but anonymous)
 * auth.uid(), so every RLS-gated casual feature works for them unchanged.
 *
 * Requires "Anonymous sign-ins" to be enabled in the Supabase dashboard
 * (Auth → Providers). Throws the Supabase AuthError on failure.
 *
 * @returns {Promise<import('@supabase/supabase-js').Session>} the new session
 */
export async function signInAnonymously() {
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data.session;
}
