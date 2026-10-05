import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Platform, Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import * as Linking from 'expo-linking';
import { supabase } from '../lib/supabase';
import { parseOAuthError, getWebRedirectTo, getPasswordResetRedirectTo } from '../lib/oauth';
import { isResetPasswordUrl } from '../lib/passwordReset';
import { EMAIL_RE } from '../lib/email';

const isWeb = Platform.OS === 'web';


// Email/password + Google sign-in state and handlers, shared by AuthScreen and
// the league invite screen's "I have an account" tab (via AuthForm). On
// success nothing navigates: AuthContext's onAuthStateChange swaps in the app.
// `mode` is 'signin' | 'signup'; `onSignedUp` runs after a successful sign-up
// (the account still needs its email confirmed).
export default function useAuthSignIn({ mode = 'signin', onSignedUp } = {}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  // Which social provider is mid-flow: null | 'google'.
  const [oauthLoading, setOauthLoading] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  // `touched` gates inline errors so the form doesn't shout at the user
  // before they've had a chance to type anything.
  const [touched, setTouched] = useState({ email: false, password: false });

  const emailValid = EMAIL_RE.test(email.trim());
  const passwordValid = password.length >= 6;
  const formValid = emailValid && passwordValid;

  const emailError = useMemo(
    () => (touched.email && email.trim().length > 0 && !emailValid
      ? 'Enter a valid email address' : null),
    [touched.email, email, emailValid],
  );
  const passwordError = useMemo(
    () => (touched.password && password.length > 0 && !passwordValid
      ? 'Password must be at least 6 characters' : null),
    [touched.password, password, passwordValid],
  );

  // On web, a failed OAuth round-trip redirects back here with the error in
  // the URL's query/hash. Supabase ignores those params, so without this the
  // user just lands on a blank-looking screen. Surface it, then scrub the URL.
  useEffect(() => {
    if (!isWeb) return;
    const message = parseOAuthError(window.location.href);
    if (message) {
      Alert.alert('Sign-in failed', message);
      window.history.replaceState({}, '', getWebRedirectTo());
    }
  }, []);

  // Guards so the OAuth `code` is exchanged exactly once — the in-app browser
  // result and the deep-link listener can both deliver the same callback URL.
  const oauthBusy = useRef(false);
  const lastOAuthCode = useRef(null);

  // Parse an OAuth callback URL and exchange its `code` for a session.
  // Fed from two sources: `openAuthSessionAsync`'s result (works on iOS) and
  // the deep-link listener (Android routes the `golf://` redirect to the app).
  const completeOAuth = useCallback(async (url) => {
    if (!url) return;
    // Password-recovery links (`golf://reset-password?code=...`) are owned by
    // AuthContext, which exchanges the one-time PKCE code and routes to the
    // set-new-password screen. Ignore them here so both handlers don't race
    // to consume the same code — a race the OAuth path would win by silently
    // signing the user in, skipping the reset screen (or by showing a bogus
    // error when it loses).
    if (isResetPasswordUrl(url)) return;
    const { params, errorCode } = QueryParams.getQueryParams(url);
    if (errorCode || params.error) {
      Alert.alert('Sign-in failed', params.error_description || errorCode || params.error);
      return;
    }
    const { code } = params;
    if (!code) return;
    if (oauthBusy.current || lastOAuthCode.current === code) return;
    oauthBusy.current = true;
    lastOAuthCode.current = code;
    try {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) Alert.alert('Error', error.message);
      // On success `onAuthStateChange` swaps in the app.
    } finally {
      oauthBusy.current = false;
    }
  }, []);

  // Native OAuth callback: the provider redirects to `golf://...?code=`, which
  // Android delivers to the app as a deep link because the in-app browser
  // usually can't capture a custom-scheme redirect. Handle both a cold start
  // (`getInitialURL`) and the app already running (the `url` event).
  useEffect(() => {
    if (isWeb) return undefined;
    let active = true;
    Linking.getInitialURL().then((url) => {
      if (!active || !url) return;
      completeOAuth(url);
    });
    const sub = Linking.addEventListener('url', ({ url }) => {
      completeOAuth(url);
    });
    return () => { active = false; sub.remove(); };
  }, [completeOAuth]);

  async function submit() {
    setTouched({ email: true, password: true });
    if (!formValid) return;
    setLoading(true);
    try {
      let error;
      if (mode === 'signin') {
        ({ error } = await supabase.auth.signInWithPassword({ email: email.trim(), password }));
      } else {
        ({ error } = await supabase.auth.signUp({ email: email.trim(), password }));
        if (!error) {
          Alert.alert('Check your email', 'Confirm your account then sign in.');
          onSignedUp?.();
          return;
        }
      }
      if (error) Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    if (!emailValid) {
      setTouched((t) => ({ ...t, email: true }));
      Alert.alert('Email needed', 'Enter your account email above, then tap "Forgot password?" again.');
      return;
    }
    setLoading(true);
    try {
      const redirectTo = getPasswordResetRedirectTo(Platform.OS, Linking.createURL('reset-password'));
      const options = redirectTo ? { redirectTo } : undefined;
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), options);
      if (error) Alert.alert('Error', error.message);
      else Alert.alert('Check your email', 'We sent a password reset link to your email.');
    } finally {
      setLoading(false);
    }
  }

  // OAuth handler for Google sign-in.
  // Web uses a full-page redirect; native opens an in-app browser and
  // exchanges the returned `code` for a session.
  async function signInWithProvider(provider) {
    setOauthLoading(provider);
    try {
      if (isWeb) {
        const { error } = await supabase.auth.signInWithOAuth({
          provider,
          options: { redirectTo: getWebRedirectTo() },
        });
        if (error) Alert.alert('Error', error.message);
        // On success the browser redirects away — nothing else to do here.
        return;
      }

      const redirectTo = makeRedirectUri();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) { Alert.alert('Error', error.message); return; }

      // Opens an in-app browser. On iOS the redirect returns as `result.url`;
      // on Android it usually arrives via the deep-link listener instead.
      // Both funnel into `completeOAuth`, which exchanges the code once.
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type === 'success' && result.url) {
        await completeOAuth(result.url);
      }
      // Otherwise the deep-link listener handles the callback.
    } catch (e) {
      Alert.alert('Error', e?.message ?? 'Could not sign in. Please try again.');
    } finally {
      setOauthLoading(null);
    }
  }

  return {
    email, setEmail, password, setPassword,
    loading, oauthLoading, showPassword, setShowPassword,
    setTouched, formValid, emailError, passwordError,
    submit, handleForgotPassword, signInWithProvider,
  };
}
