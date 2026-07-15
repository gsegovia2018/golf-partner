import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { supabase } from '../lib/supabase';
import { parseRecoveryUrl, isRecoveryCallback } from '../lib/passwordReset';

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
    const parsed = parseRecoveryUrl(url);
    if (!isRecoveryCallback(parsed)) return;
    if (isWeb) {
      // Supabase's `detectSessionInUrl` already exchanges the `code` for a
      // session in the background on web (same mechanism as OAuth) — we
      // only need to flag that this particular load is a recovery, so
      // App.js routes to the set-password screen once the session lands.
      setPasswordRecovery(true);
      return;
    }
    if (recoveryBusy.current || lastRecoveryCode.current === parsed.code) return;
    recoveryBusy.current = true;
    lastRecoveryCode.current = parsed.code;
    try {
      const { error } = await supabase.auth.exchangeCodeForSession(parsed.code);
      if (!error) setPasswordRecovery(true);
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
