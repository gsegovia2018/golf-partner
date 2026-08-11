import React from 'react';
import { render, waitFor, act } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthProvider, useAuth } from '../AuthContext';
import { supabase } from '../../lib/supabase';

// These tests run in the default (non-web) jest-expo Platform.OS, so
// AuthContext takes the native deep-link branch — matching how
// AuthScreen.test.js already exercises the native OAuth callback path.

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
      exchangeCodeForSession: jest.fn(),
      // The real client's persisted-session storage key — the offline
      // fallback reads it directly from AsyncStorage.
      storageKey: 'sb-test-auth-token',
    },
  },
}));

jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn(),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
}));

// Renders the recovery flag + a clear button so tests can observe/drive it.
function Probe() {
  const { passwordRecovery, clearPasswordRecovery } = useAuth();
  return (
    <>
      <Text>{passwordRecovery ? 'recovery' : 'no-recovery'}</Text>
      <Text onPress={clearPasswordRecovery}>clear</Text>
    </>
  );
}

describe('AuthProvider password recovery', () => {
  let authStateCallback;

  beforeEach(() => {
    jest.clearAllMocks();
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    supabase.auth.onAuthStateChange.mockImplementation((cb) => {
      authStateCallback = cb;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    });
    Linking.getInitialURL.mockResolvedValue(null);
  });

  test('detects recovery from a BARE ?code= link via the exchange redirectType (no type=recovery in URL)', async () => {
    // This is the shape of a REAL GoTrue PKCE recovery link — just a code,
    // no `type=recovery`. Detection must come from exchangeCodeForSession's
    // returned redirectType, not from the URL. Regression guard for the bug
    // where URL-`type=recovery` matching never fired on real links.
    Linking.getInitialURL.mockResolvedValue('golf://reset-password?code=abc123');
    supabase.auth.exchangeCodeForSession.mockResolvedValue({
      data: { session: { user: { id: 'u1' } }, redirectType: 'recovery' },
      error: null,
    });

    const { getByText } = render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => {
      expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('abc123');
    });
    await waitFor(() => expect(getByText('recovery')).toBeTruthy());
  });

  test('also accepts the PASSWORD_RECOVERY redirectType form from the exchange', async () => {
    Linking.getInitialURL.mockResolvedValue('golf://reset-password?code=abc123');
    supabase.auth.exchangeCodeForSession.mockResolvedValue({
      data: { session: {}, redirectType: 'PASSWORD_RECOVERY' },
      error: null,
    });

    const { getByText } = render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(getByText('recovery')).toBeTruthy());
  });

  test('does NOT flag recovery when the exchange was a normal sign-in (redirectType null)', async () => {
    // A reset-password URL whose exchange turns out non-recovery must NOT
    // hijack the user into the set-password screen — it just signs them in.
    Linking.getInitialURL.mockResolvedValue('golf://reset-password?code=abc123');
    supabase.auth.exchangeCodeForSession.mockResolvedValue({
      data: { session: {}, redirectType: null },
      error: null,
    });

    const { getByText } = render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => {
      expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('abc123');
    });
    await waitFor(() => expect(getByText('no-recovery')).toBeTruthy());
  });

  test('does not flag recovery, and does not exchange, for a plain OAuth callback deep link', async () => {
    // OAuth login links are owned by AuthScreen — AuthContext must ignore
    // them so the one-time PKCE code isn't double-consumed.
    Linking.getInitialURL.mockResolvedValue('golf://auth?code=oauth-code');

    const { getByText } = render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => expect(getByText('no-recovery')).toBeTruthy());
    expect(supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  test('flags recovery when onAuthStateChange emits PASSWORD_RECOVERY', async () => {
    const { getByText } = render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(supabase.auth.onAuthStateChange).toHaveBeenCalled());

    act(() => { authStateCallback('PASSWORD_RECOVERY', { user: { id: 'u1' } }); });

    await waitFor(() => expect(getByText('recovery')).toBeTruthy());
  });

  test('clearPasswordRecovery resets the flag', async () => {
    Linking.getInitialURL.mockResolvedValue('golf://reset-password?code=abc123');
    supabase.auth.exchangeCodeForSession.mockResolvedValue({
      data: { session: {}, redirectType: 'recovery' },
      error: null,
    });

    const { getByText } = render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(getByText('recovery')).toBeTruthy());

    act(() => { getByText('clear').props.onPress(); });

    await waitFor(() => expect(getByText('no-recovery')).toBeTruthy());
  });
});

// Renders the signed-in state so tests can observe the offline fallback.
function SessionProbe() {
  const { user, loading } = useAuth();
  return <Text>{loading ? 'loading' : (user ? `user:${user.id}` : 'signed-out')}</Text>;
}

describe('AuthProvider offline session restore', () => {
  let authStateCallback;

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    supabase.auth.onAuthStateChange.mockImplementation((cb) => {
      authStateCallback = cb;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    });
    Linking.getInitialURL.mockResolvedValue(null);
  });

  test('a retryable getSession failure falls back to the session auth-js kept on disk', async () => {
    // Offline cold start with an expired access token: getSession() resolves
    // { session: null, error: AuthRetryableFetchError } while the session —
    // with its still-valid refresh token — stays in AsyncStorage. Treating
    // that as signed-out bounced a signed-in user to the auth wall on the tee.
    supabase.auth.getSession.mockResolvedValue({
      data: { session: null }, error: new Error('network failure'),
    });
    await AsyncStorage.setItem(
      'sb-test-auth-token', JSON.stringify({ user: { id: 'u7' }, access_token: 'stale' }),
    );

    const { getByText } = render(<AuthProvider><SessionProbe /></AuthProvider>);
    await waitFor(() => expect(getByText('user:u7')).toBeTruthy());
  });

  test('a null session with NO error is a genuine signed-out — no fallback', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    // Even with a (stale) blob on disk, no-error means auth-js resolved the
    // state authoritatively; a revoked session is removed from storage by
    // auth-js itself, so trusting the verdict here is what keeps sign-out real.
    await AsyncStorage.setItem(
      'sb-test-auth-token', JSON.stringify({ user: { id: 'u7' } }),
    );

    const { getByText } = render(<AuthProvider><SessionProbe /></AuthProvider>);
    await waitFor(() => expect(getByText('signed-out')).toBeTruthy());
  });

  test('INITIAL_SESSION with a null session does not clobber the fallback', async () => {
    // _emitInitialSession runs the same failable load as getSession(), so
    // offline it reports null despite the on-disk session. Only real events
    // may drop the session.
    supabase.auth.getSession.mockResolvedValue({
      data: { session: null }, error: new Error('network failure'),
    });
    await AsyncStorage.setItem(
      'sb-test-auth-token', JSON.stringify({ user: { id: 'u7' } }),
    );

    const { getByText } = render(<AuthProvider><SessionProbe /></AuthProvider>);
    await waitFor(() => expect(getByText('user:u7')).toBeTruthy());

    act(() => { authStateCallback('INITIAL_SESSION', null); });
    await waitFor(() => expect(getByText('user:u7')).toBeTruthy());

    // A real SIGNED_OUT still signs out.
    act(() => { authStateCallback('SIGNED_OUT', null); });
    await waitFor(() => expect(getByText('signed-out')).toBeTruthy());
  });
});
