import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import SetNewPasswordScreen from '../SetNewPasswordScreen';
import { supabase } from '../../lib/supabase';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      updateUser: jest.fn(),
    },
  },
}));

const mockClearPasswordRecovery = jest.fn();
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ clearPasswordRecovery: mockClearPasswordRecovery }),
}));

jest.mock('../../theme/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      bg: { card: '#ffffff', primary: '#ffffff', secondary: '#f3f4f6' },
      border: { default: '#d1d5db' },
      text: { primary: '#111827', muted: '#6b7280', inverse: '#ffffff' },
      accent: { primary: '#006747', light: '#e6f4ee' },
      destructive: '#dc2626',
      isDark: false,
    },
  }),
}));

describe('SetNewPasswordScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    Alert.alert.mockRestore();
  });

  test('blocks submit and shows an inline error for a too-short password', () => {
    const { getByText, getByPlaceholderText } = render(<SetNewPasswordScreen />);

    fireEvent.changeText(getByPlaceholderText('New password'), 'short');
    fireEvent.changeText(getByPlaceholderText('Confirm new password'), 'short');
    fireEvent.press(getByText('Set new password'));

    expect(getByText('Password must be at least 8 characters')).toBeTruthy();
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  test('blocks submit and shows an inline error on mismatched confirmation', () => {
    const { getByText, getByPlaceholderText } = render(<SetNewPasswordScreen />);

    fireEvent.changeText(getByPlaceholderText('New password'), 'longenough1');
    fireEvent.changeText(getByPlaceholderText('Confirm new password'), 'longenough2');
    fireEvent.press(getByText('Set new password'));

    expect(getByText('Passwords do not match')).toBeTruthy();
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  test('calls updateUser and clears recovery state on a valid, matching password', async () => {
    supabase.auth.updateUser.mockResolvedValue({ error: null });
    const { getByText, getByPlaceholderText } = render(<SetNewPasswordScreen />);

    fireEvent.changeText(getByPlaceholderText('New password'), 'longenough1');
    fireEvent.changeText(getByPlaceholderText('Confirm new password'), 'longenough1');
    fireEvent.press(getByText('Set new password'));

    await waitFor(() => {
      expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'longenough1' });
    });
    expect(mockClearPasswordRecovery).toHaveBeenCalled();
  });

  test('shows an alert and does not clear recovery state when updateUser fails', async () => {
    supabase.auth.updateUser.mockResolvedValue({ error: { message: 'Session expired' } });
    const { getByText, getByPlaceholderText } = render(<SetNewPasswordScreen />);

    fireEvent.changeText(getByPlaceholderText('New password'), 'longenough1');
    fireEvent.changeText(getByPlaceholderText('Confirm new password'), 'longenough1');
    fireEvent.press(getByText('Set new password'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', 'Session expired');
    });
    expect(mockClearPasswordRecovery).not.toHaveBeenCalled();
  });
});
