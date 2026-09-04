import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import SetupScreen from '../SetupScreen';

// Quick start → Edit details hands the wizard a prefilled game. The wizard
// must keep the quick-start name (it only names a game after a course picked
// inside the wizard) and default a casual game to solo Stableford rather than
// the tournament default (random partners).

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

function fourPlayers() {
  return Array.from({ length: 4 }, (_, i) => ({
    id: `p${i + 1}`, name: `Player ${i + 1}`, handicap: 10,
  }));
}

function gameParams(overrides = {}) {
  return {
    kind: 'game',
    initialStep: 'review',
    prefill: {
      name: 'Pine Valley · 1 Jun',
      players: fourPlayers(),
      rounds: [{
        id: 'r1', courseName: 'Pine Valley', holes: [], tees: [], playerHandicaps: null, playerTees: null,
      }],
      ...overrides,
    },
  };
}

const navigation = {
  goBack: jest.fn(), navigate: jest.fn(), replace: jest.fn(), dispatch: jest.fn(),
};
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('SetupScreen prefilled game defaults', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('keeps the prefilled name and defaults a four-ball game to solo Stableford', async () => {
    const { getByDisplayValue, getAllByText, queryByText } = render(wrap(
      <SetupScreen navigation={navigation} route={{ params: gameParams() }} />,
    ));
    await waitFor(() => expect(getByDisplayValue('Pine Valley · 1 Jun')).toBeTruthy());
    // Hero chip + "Scoring" row both show the solo label.
    expect(getAllByText('Stableford').length).toBeGreaterThan(0);
    expect(queryByText('Stableford with Partners')).toBeNull();
  });

  test('a partners game hides the same-teams switch but keeps the draw choice', async () => {
    const params = gameParams({ settings: { scoringMode: 'stableford' } });
    params.initialStep = 'scoring';
    const { getByText, queryByText } = render(wrap(
      <SetupScreen navigation={navigation} route={{ params }} />,
    ));
    await waitFor(() => expect(getByText('Random draw')).toBeTruthy());
    expect(getByText('Choose myself')).toBeTruthy();
    expect(queryByText('Same teams every round')).toBeNull();
  });
});
