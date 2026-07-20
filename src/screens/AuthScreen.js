import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import * as Linking from 'expo-linking';
import { supabase } from '../lib/supabase';
import { parseOAuthError, getWebRedirectTo, getPasswordResetRedirectTo } from '../lib/oauth';
import { isResetPasswordUrl } from '../lib/passwordReset';
import { useTheme } from '../theme/ThemeContext';
import { semantic } from '../theme/tokens';

const isWeb = Platform.OS === 'web';

// Basic email shape check — good enough to gate the submit button and show
// inline feedback without being overly strict about valid TLDs.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AuthScreen() {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const [mode, setMode] = useState('signin');
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
          setMode('signin');
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

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.inner}>
        <Text style={s.logo}>Golf Partner</Text>
        <Text style={s.tagline}>Track your round</Text>

        <View style={s.card}>
          <View style={s.modeRow}>
            <TouchableOpacity
              style={[s.modeBtn, mode === 'signin' && s.modeBtnActive]}
              onPress={() => setMode('signin')}
              activeOpacity={0.7}
            >
              <Text style={[s.modeBtnText, mode === 'signin' && s.modeBtnTextActive]}>Sign In</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.modeBtn, mode === 'signup' && s.modeBtnActive]}
              onPress={() => setMode('signup')}
              activeOpacity={0.7}
            >
              <Text style={[s.modeBtnText, mode === 'signup' && s.modeBtnTextActive]}>Sign Up</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={[s.input, emailError && s.inputError]}
            placeholder="Email"
            placeholderTextColor={theme.text.muted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={email}
            onChangeText={setEmail}
            onBlur={() => setTouched((t) => ({ ...t, email: true }))}
          />
          {emailError && <Text style={s.fieldError}>{emailError}</Text>}

          <View style={[s.passwordRow, passwordError && s.inputError]}>
            <TextInput
              style={s.passwordInput}
              placeholder="Password"
              placeholderTextColor={theme.text.muted}
              secureTextEntry={!showPassword}
              keyboardAppearance={theme.isDark ? 'dark' : 'light'}
              selectionColor={theme.accent.primary}
              value={password}
              onChangeText={setPassword}
              onBlur={() => setTouched((t) => ({ ...t, password: true }))}
              onSubmitEditing={submit}
            />
            <TouchableOpacity
              style={s.eyeBtn}
              onPress={() => setShowPassword((v) => !v)}
              activeOpacity={0.7}
              accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Feather
                name={showPassword ? 'eye-off' : 'eye'}
                size={18}
                color={theme.text.muted}
              />
            </TouchableOpacity>
          </View>
          {passwordError && <Text style={s.fieldError}>{passwordError}</Text>}

          {mode === 'signin' && (
            <TouchableOpacity
              style={s.forgotBtn}
              onPress={handleForgotPassword}
              activeOpacity={0.7}
              disabled={loading}
            >
              <Text style={s.forgotText}>Forgot password?</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[s.btn, (loading || !formValid) && { opacity: 0.5 }]}
            onPress={submit}
            disabled={loading || !formValid}
            activeOpacity={0.8}
          >
            {loading
              ? <ActivityIndicator color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
              : <Text style={s.btnText}>{mode === 'signin' ? 'Sign In' : 'Create Account'}</Text>}
          </TouchableOpacity>

          <View style={s.divider}>
            <View style={s.dividerLine} />
            <Text style={s.dividerText}>OR</Text>
            <View style={s.dividerLine} />
          </View>

          <TouchableOpacity
            style={[s.googleBtn, oauthLoading && { opacity: 0.6 }]}
            onPress={() => signInWithProvider('google')}
            disabled={!!oauthLoading}
            activeOpacity={0.8}
          >
            {oauthLoading === 'google'
              ? <ActivityIndicator color={theme.text.primary} />
              : (
                <>
                  <Text style={s.googleG}>G</Text>
                  <Text style={s.googleBtnText}>Continue with Google</Text>
                </>
              )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  screen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#006747',
    justifyContent: 'center',
  },
  inner: { paddingHorizontal: 24, width: '100%', maxWidth: 460, alignSelf: 'center' },
  logo: {
    fontFamily: 'PlayfairDisplay-Black',
    fontSize: 42, color: semantic.winner.dark,
    letterSpacing: -1, textAlign: 'center', marginBottom: 4,
  },
  tagline: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 14, color: 'rgba(255,255,255,0.6)',
    textAlign: 'center', marginBottom: 36,
  },
  card: {
    backgroundColor: theme.bg.card,
    borderRadius: 24, padding: 20,
    borderWidth: 1, borderColor: theme.border.default,
  },
  modeRow: { flexDirection: 'row', marginBottom: 20, gap: 8 },
  modeBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1, borderColor: theme.border.default,
    alignItems: 'center',
    backgroundColor: theme.bg.secondary,
  },
  modeBtnActive: {
    backgroundColor: theme.accent.primary,
    borderColor: theme.accent.primary,
  },
  modeBtnText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 14, color: theme.text.muted,
  },
  modeBtnTextActive: { color: theme.text.inverse },
  input: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.primary,
    color: theme.text.primary, borderRadius: 12, borderWidth: 1,
    borderColor: theme.border.default, padding: 14, fontSize: 15,
    fontFamily: 'PlusJakartaSans-Medium', marginBottom: 12,
  },
  inputError: { borderColor: theme.destructive },
  fieldError: {
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 12, color: theme.destructive,
    marginTop: -6, marginBottom: 10, marginLeft: 2,
  },
  passwordRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.primary,
    borderRadius: 12, borderWidth: 1,
    borderColor: theme.border.default, marginBottom: 12,
    paddingRight: 12,
  },
  passwordInput: {
    flex: 1, color: theme.text.primary, padding: 14, fontSize: 15,
    fontFamily: 'PlusJakartaSans-Medium',
  },
  eyeBtn: { padding: 4 },
  forgotBtn: { alignSelf: 'flex-end', marginBottom: 4, paddingVertical: 2 },
  forgotText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 12, color: theme.accent.primary,
  },
  btn: {
    backgroundColor: theme.isDark ? theme.accent.light : theme.accent.primary,
    borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 8,
    borderWidth: theme.isDark ? 1 : 0,
    borderColor: theme.isDark ? theme.accent.primary + '33' : 'transparent',
  },
  btnText: {
    fontFamily: 'PlusJakartaSans-ExtraBold',
    color: theme.isDark ? theme.accent.primary : theme.text.inverse,
    fontSize: 16,
  },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 16, gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: theme.border.default },
  dividerText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 10, color: theme.text.muted, letterSpacing: 1.2,
  },
  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#ffffff', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: theme.border.default,
    marginBottom: 10,
  },
  googleG: {
    fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 18, color: '#4285F4',
    width: 20, textAlign: 'center',
  },
  googleBtnText: {
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 15, color: '#1f1f1f',
  },
});
