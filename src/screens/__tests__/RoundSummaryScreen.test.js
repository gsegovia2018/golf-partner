import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import RoundSummaryScreen from '../RoundSummaryScreen';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb) => {
    const ReactActual = jest.requireActual('react');
    ReactActual.useEffect(() => cb(), [cb]);
  },
}));

jest.mock('@expo/vector-icons', () => ({
  Feather: 'Feather',
}));

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'u1' } } })),
    },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn(() => Promise.resolve({ data: null })),
        })),
      })),
    })),
  },
}));

jest.mock('../../store/mediaStore', () => ({
  loadRoundMedia: jest.fn(() => Promise.resolve([])),
}));

const mockTournament = {
  id: 't1',
  name: 'Weekend Match',
  kind: 'game',
  players: [
    { id: 'p1', name: 'Marcos', user_id: 'u1' },
    { id: 'p2', name: 'Pablo', user_id: 'u2' },
  ],
  rounds: [{
    id: 'r1',
    courseName: 'La Moraleja',
    holes: Array.from({ length: 18 }, (_, i) => ({
      number: i + 1,
      par: 4,
      strokeIndex: i + 1,
    })),
    scores: {
      p1: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, 4])),
      p2: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, 5])),
    },
    notes: {
      round: 'Pablo holed a long putt on the back nine.',
      hole: {
        7: 'Marcos found the fairway bunker.',
      },
    },
  }],
};

jest.mock('../../store/tournamentStore', () => ({
  readLocal: jest.fn(() => Promise.resolve(mockTournament)),
  setActiveTournament: jest.fn(() => Promise.resolve()),
  formatRoundLabel: jest.fn(({ courseName }) => courseName),
  roundTotals: jest.fn((round, players) => [
    { player: players[0], totalPoints: 38, totalStrokes: 72 },
    { player: players[1], totalPoints: 34, totalStrokes: 90 },
  ]),
}));

const navigation = { goBack: jest.fn(), navigate: jest.fn() };
const route = { params: { tournamentId: 't1', roundId: 'r1' } };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('RoundSummaryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('defaults to scorecard tab with recap and front/back scorecards', async () => {
    const { findByText, getByLabelText, getByText } = render(wrap(
      <RoundSummaryScreen navigation={navigation} route={route} />,
    ));

    expect(await findByText('Marcos led with 38 points.')).toBeTruthy();
    expect(getByLabelText('Scorecard').props.accessibilityState.selected).toBe(true);
    expect(getByText('Front nine')).toBeTruthy();
    expect(getByText('Back nine')).toBeTruthy();
  });

  test('switches to leaderboard tab', async () => {
    const { findAllByText, findByLabelText, findByText } = render(wrap(
      <RoundSummaryScreen navigation={navigation} route={route} />,
    ));

    fireEvent.press(await findByLabelText('Leaderboard'));

    expect(await findByText('Marcos  (you)')).toBeTruthy();
    expect((await findAllByText('38')).length).toBeGreaterThan(0);
  });

  test('preserves existing round and hole notes in comments tab', async () => {
    const { findByLabelText, findByText } = render(wrap(
      <RoundSummaryScreen navigation={navigation} route={route} />,
    ));

    fireEvent.press(await findByLabelText('Comments'));

    expect(await findByText('Pablo holed a long putt on the back nine.')).toBeTruthy();
    expect(await findByText('Hole 7')).toBeTruthy();
    expect(await findByText('Marcos found the fairway bunker.')).toBeTruthy();
  });
});
