import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme/ThemeContext';
import ProfileScreen from '../ProfileScreen';
import { loadProfile, loadCachedProfile, upsertProfile } from '../../store/profileStore';

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

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

jest.mock('../../store/profileStore', () => ({
  loadProfile: jest.fn(() => new Promise(() => {})),
  loadCachedProfile: jest.fn(() => Promise.resolve(null)),
  clearCachedProfile: jest.fn(() => Promise.resolve()),
  upsertProfile: jest.fn(() => Promise.resolve()),
  uploadAvatar: jest.fn(() => Promise.resolve('https://example.com/avatar.jpg')),
  isUsernameAvailable: jest.fn(() => Promise.resolve(true)),
}));

jest.mock('../../lib/supabase', () => ({
  supabase: { auth: { signOut: jest.fn(() => Promise.resolve()) } },
}));

beforeEach(() => {
  AsyncStorage.getItem.mockReturnValue(new Promise(() => {}));
  loadProfile.mockImplementation(() => new Promise(() => {}));
  upsertProfile.mockResolvedValue();
});

function renderScreen(route = {}) {
  return render(
    <SafeAreaProvider>
      <ThemeProvider>
        <ProfileScreen
          navigation={{
            addListener: jest.fn(() => jest.fn()),
            goBack: jest.fn(),
            navigate: jest.fn(),
          }}
          route={route}
        />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

describe('ProfileScreen navigation chrome', () => {
  test('shows Back when presented from the root stack', () => {
    const { getByLabelText } = renderScreen();

    expect(getByLabelText('Back')).toBeTruthy();
  });

  test('hides Back when mounted as a primary tab', () => {
    const { queryByLabelText } = renderScreen({ params: { presentation: 'tab' } });

    expect(queryByLabelText('Back')).toBeNull();
  });
});

describe('ProfileScreen loading', () => {
  test('nothing cached: real links over blocks, fields disabled', async () => {
    const { findByTestId, getByLabelText, getByText, queryByPlaceholderText } = renderScreen();
    expect(await findByTestId('profile-skeleton')).toBeTruthy();
    expect(getByLabelText('Loading…')).toBeTruthy();
    expect(getByText('Friends')).toBeTruthy();
    // No editable inputs until the profile is in: typing can't be overwritten.
    expect(queryByPlaceholderText('—')).toBeNull();
  });

  test('a cached profile paints at once while the network is still out', async () => {
    loadCachedProfile.mockResolvedValueOnce({
      userId: 'u1', email: 'marcos@example.com', username: 'marcos', displayName: 'Marcos Cached',
    });
    const { findByText, queryByTestId } = renderScreen();
    expect(await findByText('Marcos Cached')).toBeTruthy();
    expect(queryByTestId('profile-skeleton')).toBeNull();
  });

  test('a failed first load is an inline error with Retry, not an alert', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    loadProfile.mockRejectedValueOnce(new Error('Network request failed'));
    const { findByText, getByText } = renderScreen();
    expect(await findByText('Could not load profile')).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();

    loadProfile.mockResolvedValueOnce({ email: 'marcos@example.com', displayName: 'Marcos' });
    fireEvent.press(getByText('Try again'));
    expect(await findByText('Marcos')).toBeTruthy();
    alertSpy.mockRestore();
  });
});

describe('ProfileScreen form', () => {
  test('removes avatar color and personal stats from the profile page', async () => {
    loadProfile.mockResolvedValue({
      email: 'marcos@example.com',
      username: 'marcos',
      displayName: 'Marcos',
      handicap: 12.5,
      targetHandicap: 8.5,
      avatarUrl: null,
    });

    const { findByText, queryByText } = renderScreen({ params: { presentation: 'tab' } });

    await findByText('ACCOUNT');

    expect(queryByText('Avatar color')).toBeNull();
    expect(queryByText('PERSONAL STATS')).toBeNull();
    expect(queryByText('Tournaments')).toBeNull();
    expect(queryByText('Best round')).toBeNull();
  });

  test('saves a decimal handicap value', async () => {
    loadProfile.mockResolvedValue({
      email: 'marcos@example.com',
      username: 'marcos',
      displayName: 'Marcos',
      handicap: 12.5,
      targetHandicap: 8.5,
      avatarUrl: null,
      gender: 'male',
    });

    const { findByDisplayValue, getByLabelText } = renderScreen({ params: { presentation: 'tab' } });

    const handicapInput = await findByDisplayValue('12.5');
    fireEvent.changeText(handicapInput, '13,4');
    fireEvent.press(getByLabelText('Save profile'));

    await waitFor(() => {
      expect(upsertProfile).toHaveBeenCalledWith(expect.objectContaining({
        handicap: '13.4',
        targetHandicap: '8.5',
      }));
    });
  });
});

describe('ProfileScreen gender', () => {
  test('blocks save with an alert when no gender is set, then saves once Female is picked', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    loadProfile.mockResolvedValue({
      email: 'marcos@example.com',
      username: 'marcos',
      displayName: 'Marcos',
      handicap: 12.5,
      targetHandicap: 8.5,
      avatarUrl: null,
      gender: null,
    });

    const { findByDisplayValue, getByLabelText } = renderScreen({ params: { presentation: 'tab' } });

    const handicapInput = await findByDisplayValue('12.5');
    fireEvent.changeText(handicapInput, '13.4');
    upsertProfile.mockClear();
    fireEvent.press(getByLabelText('Save profile'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Select gender', expect.any(String));
    });
    expect(upsertProfile).not.toHaveBeenCalled();

    fireEvent.press(getByLabelText('Female'));
    fireEvent.press(getByLabelText('Save profile'));

    await waitFor(() => {
      expect(upsertProfile).toHaveBeenCalledWith(expect.objectContaining({ gender: 'female' }));
    });

    alertSpy.mockRestore();
  });
});
