import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import SetupScreen from '../SetupScreen';

// Task 13: SetupScreen.createTournament is a discrete user action (not a
// keystroke autosave like EditTournamentScreen's), so — mirroring Task 5's
// course-editing save-guard — it blocks creation outright with an alert when
// any round's stroke-index/tee-label data is invalid, instead of silently
// persisting corrupt SI through tournament.create.

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn((effect) => {
    const React = require('react');
    React.useEffect(effect, [effect]);
  }),
  CommonActions: { reset: jest.fn((x) => x) },
}));

jest.mock('../../components/PostCreateInviteModal', () => {
  return function MockPostCreateInviteModal() {
    return null;
  };
});

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

jest.mock('../../store/mutate', () => ({
  mutate: jest.fn((current) => Promise.resolve(current)),
}));

function validHoles() {
  return Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
}

// Only 1 of 18 holes carries an SI — computeSiIssues flags this as an
// incomplete/invalid set (see src/lib/courseLibrary.js).
function invalidHoles() {
  return [{ number: 1, par: 4, strokeIndex: 1 }];
}

function baseParams(holes) {
  return {
    kind: 'tournament',
    initialStep: 'review',
    prefill: {
      players: [{ id: 'p1', name: 'Alice', handicap: 10 }],
      rounds: [{
        id: 'r1', courseName: 'Pine Valley', holes, tees: [], playerHandicaps: null, playerTees: null,
      }],
    },
  };
}

const navigation = {
  goBack: jest.fn(), navigate: jest.fn(), replace: jest.fn(), dispatch: jest.fn(),
};
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('SetupScreen create-blocking on invalid stroke index (Task 13)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    Alert.alert.mockRestore();
  });

  test('a round with invalid SI blocks creation with an alert and never calls mutate(tournament.create)', async () => {
    const { mutate } = require('../../store/mutate');
    const route = { params: baseParams(invalidHoles()) };
    const { getByText } = render(wrap(<SetupScreen navigation={navigation} route={route} />));

    fireEvent.press(getByText('Start Tournament'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalled();
    });

    expect(Alert.alert.mock.calls[0][0]).toBe('Fix course data before creating');
    expect(mutate).not.toHaveBeenCalled();
  });

  test('a round with valid SI creates normally (regression: valid rounds are unaffected)', async () => {
    const { mutate } = require('../../store/mutate');
    const route = { params: baseParams(validHoles()) };
    const { getByText } = render(wrap(<SetupScreen navigation={navigation} route={route} />));

    fireEvent.press(getByText('Start Tournament'));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalled();
    });

    const createCall = mutate.mock.calls.find(([, m]) => m.type === 'tournament.create');
    expect(createCall).toBeTruthy();
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});
