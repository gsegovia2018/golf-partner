import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme/ThemeContext';
import ProfileScreen from '../ProfileScreen';
import { loadProfile, upsertProfile } from '../../store/profileStore';

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
  upsertProfile: jest.fn(() => Promise.resolve()),
  uploadAvatar: jest.fn(() => Promise.resolve('https://example.com/avatar.jpg')),
}));

jest.mock('../../lib/prefs', () => ({
  getShowRunningScore: jest.fn(() => Promise.resolve(true)),
  setShowRunningScore: jest.fn(() => Promise.resolve()),
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

    const { findByDisplayValue, getByText } = renderScreen({ params: { presentation: 'tab' } });

    const handicapInput = await findByDisplayValue('12.5');
    fireEvent.changeText(handicapInput, '13,4');
    fireEvent.press(getByText('Save changes'));

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

    const { findByDisplayValue, getByLabelText, getByText } = renderScreen({ params: { presentation: 'tab' } });

    const handicapInput = await findByDisplayValue('12.5');
    fireEvent.changeText(handicapInput, '13.4');
    upsertProfile.mockClear();
    fireEvent.press(getByText('Save changes'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Select gender', expect.any(String));
    });
    expect(upsertProfile).not.toHaveBeenCalled();

    fireEvent.press(getByLabelText('Female'));
    fireEvent.press(getByText('Save changes'));

    await waitFor(() => {
      expect(upsertProfile).toHaveBeenCalledWith(expect.objectContaining({ gender: 'female' }));
    });

    alertSpy.mockRestore();
  });
});
