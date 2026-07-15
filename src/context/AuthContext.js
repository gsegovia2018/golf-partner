import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { supabase } from '../lib/supabase';
import { parseRecoveryUrl, isResetPasswordUrl, isRecoveryRedirectType } from '../lib/passwordReset';
import { stripRecoveryMarker } from '../lib/oauth';

const isWeb = Platform.OS === 'web';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined);
  // Set once a password-recovery link has been opened (web query params or a
  // native `golf://reset-password?code=...&type=recovery` deep link) —
  // App.js reads this to show SetNewPasswordScreen instead of the normal
  // signed-in/signed-out screens, regardless of whether a session already
  // existed on this device.
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s ?? null);
      // Documented Supabase event for a completed recovery-link exchange.
      // Kept as a defensive/secondary signal alongside the URL-based
      // detection below — see the deep-link effect for why the URL check is
      // the reliable path with the PKCE flow this app uses.
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Guards so a recovery `code` is exchanged at most once — `getInitialURL`
  // and the `url` event can both deliver the same cold-start deep link.
  const recoveryBusy = useRef(false);
  const lastRecoveryCode = useRef(null);

  const handleRecoveryUrl = useCallback(async (url) => {
    // Ownership gate: only act on OUR reset-password redirect targets, so
    // this never fights AuthScreen's OAuth handler over a normal login
    // `?code=` link. AuthScreen mirrors this by ignoring reset-password URLs.
    if (!isResetPasswordUrl(url)) return;

    if (isWeb) {
      // Supabase's `detectSessionInUrl` exchanges a VALID recovery link's
      // `code` for a session during client init; `getSession()` awaits that
      // init, so if it still returns no session the link was expired/invalid.
      // Only enter recovery mode with an actually-established session —
      // otherwise `updateUser` could never succeed and, since the set-password
      // screen's only auto-exit is on success, we'd strand the user with no
      // escape. On a bad link we fall through to the normal auth screen.
      const { data: { session: s } } = await supabase.auth.getSession();
      if (s) setPasswordRecovery(true);
      // Strip our `type=recovery` marker either way so a reload (e.g. after a
      // successful reset) doesn't re-trigger recovery. detectSessionInUrl
      // already removed `code`.
      if (typeof window !== 'undefined' && window.history && window.location) {
        window.history.replaceState(
          window.history.state, '', stripRecoveryMarker(window.location.href),
        );
      }
      return;
    }

    const parsed = parseRecoveryUrl(url);
    const code = parsed?.code;
    if (!code) return;
    if (recoveryBusy.current || lastRecoveryCode.current === code) return;
    recoveryBusy.current = true;
    lastRecoveryCode.current = code;
    try {
      // Native has `detectSessionInUrl: false`, so we own the exchange. Its
      // `redirectType` is the authoritative recovery signal — a real reset
      // link is just `?code=...` with no `type=recovery` in the URL, so we
      // must NOT rely on the URL to confirm recovery. Only route to the
      // set-password screen when the exchange itself says it was a recovery;
      // otherwise this was a normal sign-in and we leave the user signed in.
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error && isRecoveryRedirectType(data?.redirectType)) {
        setPasswordRecovery(true);
      }
    } finally {
      recoveryBusy.current = false;
    }
  }, []);

  useEffect(() => {
    if (isWeb) {
      if (typeof window !== 'undefined' && window.location) {
        handleRecoveryUrl(window.location.href);
      }
      return undefined;
    }
    let active = true;
    Linking.getInitialURL().then((url) => {
      if (active && url) handleRecoveryUrl(url);
    });
    const sub = Linking.addEventListener('url', ({ url }) => {
      handleRecoveryUrl(url);
    });
    return () => { active = false; sub.remove(); };
  }, [handleRecoveryUrl]);

  // Called once `updateUser({ password })` succeeds — the recovery exchange
  // already left a real session in place, so clearing this just returns the
  // user to the normal signed-in app.
  const clearPasswordRecovery = useCallback(() => setPasswordRecovery(false), []);

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading: session === undefined,
        passwordRecovery,
        clearPasswordRecovery,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
