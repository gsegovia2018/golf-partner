import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme/ThemeContext';
import ProfileScreen from '../ProfileScreen';
import { loadProfile } from '../../store/profileStore';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => React.createElement(React.Fragment, null, children),
    SafeAreaView: ({ children }) => React.createElement(React.Fragment, null, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn((effect) => {
    const React = require('react');
    React.useEffect(effect, [effect]);
  }),
}));
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  MediaTypeOptions: { Images: 'Images' },
}));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('../../store/profileStore', () => ({
  loadProfile: jest.fn(),
  loadCachedProfile: jest.fn(() => Promise.resolve(null)),
  clearCachedProfile: jest.fn(() => Promise.resolve()),
  upsertProfile: jest.fn(() => Promise.resolve()),
  uploadAvatar: jest.fn(),
  isUsernameAvailable: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../lib/supabase', () => ({ supabase: { auth: { signOut: jest.fn() } } }));

const realOS = Platform.OS;
afterEach(() => { Platform.OS = realOS; });
beforeEach(() => {
  AsyncStorage.getItem.mockReturnValue(new Promise(() => {}));
  loadProfile.mockResolvedValue({ email: 'a@b.c', username: 'marcos', displayName: 'Marcos' });
});

function renderScreen(navigate = jest.fn()) {
  return render(
    <SafeAreaProvider>
      <ThemeProvider>
        <ProfileScreen
          navigation={{ addListener: jest.fn(() => jest.fn()), goBack: jest.fn(), navigate }}
          route={{ params: { presentation: 'tab' } }}
        />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

describe('Profile "My swing" quick link', () => {
  test('Android shows the row and opens Swing home', async () => {
    Platform.OS = 'android';
    const navigate = jest.fn();
    const { findByLabelText } = renderScreen(navigate);
    fireEvent.press(await findByLabelText('My swing'));
    expect(navigate).toHaveBeenCalledWith('SwingHome');
  });

  test('web shows the row too (the browser analyzer, plan 2026-10-23)', async () => {
    Platform.OS = 'web';
    const navigate = jest.fn();
    const { findByLabelText } = renderScreen(navigate);
    fireEvent.press(await findByLabelText('My swing'));
    expect(navigate).toHaveBeenCalledWith('SwingHome');
  });

  test('iOS has no row', async () => {
    Platform.OS = 'ios';
    const { findByText, queryByLabelText } = renderScreen();
    await findByText('ACCOUNT');
    await waitFor(() => expect(queryByLabelText('Your bag')).toBeTruthy());
    expect(queryByLabelText('My swing')).toBeNull();
  });
});
