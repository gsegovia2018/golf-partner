import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import AuthScreen from '../AuthScreen';
import { supabase } from '../../lib/supabase';
import * as Linking from 'expo-linking';

jest.mock('@expo/vector-icons', () => ({
  Feather: 'Feather',
}));

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      exchangeCodeForSession: jest.fn(),
      signInWithOAuth: jest.fn(),
      signInWithPassword: jest.fn(),
      signUp: jest.fn(),
      resetPasswordForEmail: jest.fn(),
    },
  },
}));

jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn(),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('expo-auth-session', () => ({
  makeRedirectUri: jest.fn(() => 'golf://auth'),
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
}));

jest.mock('../../theme/ThemeContext', () => ({
  ThemeProvider: ({ children }) => children,
  useTheme: () => ({
    theme: {
      bg: { card: '#ffffff', primary: '#ffffff', secondary: '#f3f4f6' },
      border: { default: '#d1d5db' },
      text: {
        primary: '#111827',
        muted: '#6b7280',
        inverse: '#ffffff',
      },
      accent: {
        primary: '#006747',
        light: '#e6f4ee',
      },
      destructive: '#dc2626',
      isDark: false,
    },
  }),
}));

describe('AuthScreen OAuth callbacks', () => {
  const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    Linking.getInitialURL.mockResolvedValue('golf://auth?code=google-code');
    supabase.auth.exchangeCodeForSession.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    Alert.alert.mockRestore();
  });

  test('exchanges native OAuth callback codes without showing debug alerts', async () => {
    render(wrap(<AuthScreen />));

    await waitFor(() => {
      expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('google-code');
    });

    expect(Alert.alert).not.toHaveBeenCalledWith(
      'OAuth debug',
      expect.any(String),
    );
  });

  test('ignores password-recovery deep links so it does not double-consume the PKCE code', async () => {
    // AuthContext owns `golf://reset-password?code=` links. If AuthScreen's
    // OAuth handler also tried to exchange the one-time code, whichever lost
    // the race would either sign the user in (skipping the reset screen) or
    // show a bogus error. It must leave recovery URLs alone.
    Linking.getInitialURL.mockResolvedValue('golf://reset-password?code=recovery-code');

    render(wrap(<AuthScreen />));

    // Give the getInitialURL promise + effects a tick to settle.
    await waitFor(() => expect(Linking.getInitialURL).toHaveBeenCalled());
    expect(supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  test('shows Google sign-in without Apple sign-in', () => {
    const { getByText, queryByText } = render(wrap(<AuthScreen />));

    expect(getByText('Continue with Google')).toBeTruthy();
    expect(queryByText('Continue with Apple')).toBeNull();
  });
});
