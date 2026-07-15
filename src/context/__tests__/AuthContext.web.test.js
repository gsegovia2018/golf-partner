import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

// Force the web code path — AuthContext reads `Platform.OS` at module load.
jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  RN.Platform.OS = 'web';
  return RN;
});

jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn(() => Promise.resolve(null)),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
      exchangeCodeForSession: jest.fn(),
    },
  },
}));

// eslint-disable-next-line import/first
import { AuthProvider, useAuth } from '../AuthContext';
// eslint-disable-next-line import/first
import { supabase } from '../../lib/supabase';

function Probe() {
  const { passwordRecovery } = useAuth();
  return <Text>{passwordRecovery ? 'recovery' : 'no-recovery'}</Text>;
}

describe('AuthProvider password recovery — web path', () => {
  const originalWindow = global.window;
  let replaceState;

  beforeEach(() => {
    jest.clearAllMocks();
    replaceState = jest.fn();
    global.window = {
      location: {
        href: 'https://app.example.com/?type=recovery',
        origin: 'https://app.example.com',
        pathname: '/',
      },
      history: { state: null, replaceState },
    };
    supabase.auth.onAuthStateChange.mockImplementation(() => ({
      data: { subscription: { unsubscribe: jest.fn() } },
    }));
  });

  afterEach(() => {
    global.window = originalWindow;
  });

  test('does NOT enter recovery for a marker URL with no established session (expired/invalid link)', async () => {
    // An expired/invalid recovery link establishes no session via
    // detectSessionInUrl — the user must NOT be trapped on the set-password
    // screen with no way to complete updateUser.
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });

    const { getByText } = render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => expect(supabase.auth.getSession).toHaveBeenCalled());
    await waitFor(() => expect(getByText('no-recovery')).toBeTruthy());
    // Web never manually exchanges — detectSessionInUrl owns that.
    expect(supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    // Marker is stripped regardless so a reload can't re-trigger recovery.
    await waitFor(() => expect(replaceState).toHaveBeenCalled());
    expect(replaceState.mock.calls[0][2]).toBe('https://app.example.com/');
  });

  test('enters recovery when the marker URL DID establish a session', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });

    const { getByText } = render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => expect(getByText('recovery')).toBeTruthy());
    expect(supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  test('cleans the type=recovery marker from the URL after a successful recovery too', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });

    render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => expect(replaceState).toHaveBeenCalled());
    expect(replaceState.mock.calls[0][2]).toBe('https://app.example.com/');
  });

  test('ignores a non-recovery web load entirely (no marker)', async () => {
    global.window.location.href = 'https://app.example.com/?code=oauth-code';
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });

    const { getByText } = render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => expect(getByText('no-recovery')).toBeTruthy());
    expect(replaceState).not.toHaveBeenCalled();
  });
});
