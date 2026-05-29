import React from 'react';
import { render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme/ThemeContext';
import ProfileScreen from '../ProfileScreen';

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
  computePersonalStats: jest.fn(() => Promise.resolve(null)),
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
