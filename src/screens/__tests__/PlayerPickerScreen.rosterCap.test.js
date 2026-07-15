import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import PlayerPickerScreen from '../PlayerPickerScreen';

// Task 3 (audit-tier3): PlayerPickerScreen's own maxSelectable cap must
// respect the `kind` route param it now receives from SetupScreen/
// PlayersScreen, not a hardcoded 4 — otherwise a tournament roster can never
// grow past 4 even though rosterCap('tournament') is much higher.

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn((effect) => {
    const React = require('react');
    React.useEffect(effect, []);
  }),
}));

jest.mock('../../store/libraryStore', () => ({
  fetchMyPlayers: jest.fn(() => Promise.resolve([
    { id: 'p5', name: 'Player Five', handicap: 11 },
  ])),
}));

jest.mock('../../store/tournamentStore', () => {
  const actual = jest.requireActual('../../store/tournamentStore');
  return {
    ...actual,
    loadAllTournaments: jest.fn(() => Promise.resolve([])),
  };
});

const fourAlreadySelected = ['p1', 'p2', 'p3', 'p4'];
const navigation = { goBack: jest.fn(), navigate: jest.fn() };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('PlayerPickerScreen maxSelectable respects kind (Task 3)', () => {
  test("kind 'tournament' with 4 already selected still allows picking a 5th", async () => {
    const route = { params: { alreadySelectedIds: fourAlreadySelected, kind: 'tournament' } };
    const { getByText, queryByText } = render(wrap(<PlayerPickerScreen navigation={navigation} route={route} />));

    await waitFor(() => {
      expect(getByText('Player Five')).toBeTruthy();
    });
    // Not disabled/greyed by cap: tapping should surface the confirm footer.
    const { fireEvent } = require('@testing-library/react-native');
    fireEvent.press(getByText('Player Five'));
    await waitFor(() => {
      expect(queryByText(/Add 1 Player/)).toBeTruthy();
    });
  });

  test("kind 'game' with 4 already selected blocks picking a 5th", async () => {
    const route = { params: { alreadySelectedIds: fourAlreadySelected, kind: 'game' } };
    const { getByText, queryByText } = render(wrap(<PlayerPickerScreen navigation={navigation} route={route} />));

    await waitFor(() => {
      expect(getByText('Player Five')).toBeTruthy();
    });
    const { fireEvent } = require('@testing-library/react-native');
    fireEvent.press(getByText('Player Five'));
    // maxSelectable is 0 — the tap is a no-op, so no confirm footer appears.
    expect(queryByText(/Add 1 Player/)).toBeNull();
  });
});
