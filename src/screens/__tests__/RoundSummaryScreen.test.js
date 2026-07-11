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

jest.mock('../../store/feedStore', () => ({
  loadComments: jest.fn(() => Promise.resolve([
    {
      id: 'c1',
      body: 'Great match from the feed.',
      createdAt: '2026-05-29T10:00:00Z',
      isMine: true,
      author: { name: 'Marcos', avatarUrl: null, avatarColor: '#123456' },
    },
  ])),
  addComment: jest.fn(() => Promise.resolve(null)),
  deleteComment: jest.fn(() => Promise.resolve(true)),
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

// Real ScorecardTable renders through the actual scoreModel scoring engines
// (calcStablefordPoints etc., pulled from this same module), so this mock
// keeps the real module and only overrides what the screen itself calls
// directly — same pattern as store/__tests__/profileStore.test.js.
jest.mock('../../store/tournamentStore', () => {
  const actual = jest.requireActual('../../store/tournamentStore');
  return {
    ...actual,
    getTournamentSnapshot: jest.fn(() => null),
    isTournamentFinished: jest.fn(() => true),
    readLocal: jest.fn(() => Promise.resolve(mockTournament)),
    setActiveTournament: jest.fn(() => Promise.resolve()),
    formatRoundLabel: jest.fn(({ courseName }) => courseName),
    roundTotals: jest.fn((round, players) => [
      { player: players[0], totalPoints: 38, totalStrokes: 72 },
      { player: players[1], totalPoints: 34, totalStrokes: 90 },
    ]),
    calcExtraShots: jest.fn(() => 0),
    scrambleUnits: jest.fn((round, players) => players),
  };
});

const navigation = { goBack: jest.fn(), navigate: jest.fn() };
const route = { params: { tournamentId: 't1', roundId: 'r1' } };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('RoundSummaryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('defaults to scorecard tab with the recap winner pill', async () => {
    const { findByText, getByLabelText } = render(wrap(
      <RoundSummaryScreen navigation={navigation} route={route} />,
    ));

    expect(await findByText('Winner: Marcos')).toBeTruthy();
    expect(getByLabelText('Scorecard').props.accessibilityState.selected).toBe(true);
  });

  test('recap card only shows on the scorecard tab', async () => {
    const { findByText, findByLabelText, queryByText } = render(wrap(
      <RoundSummaryScreen navigation={navigation} route={route} />,
    ));
    await findByText('Winner: Marcos');

    fireEvent.press(await findByLabelText('Photos'));
    expect(queryByText('Winner: Marcos')).toBeNull();
    expect(queryByText(/holes/)).toBeNull();

    fireEvent.press(await findByLabelText('Comments'));
    expect(queryByText('Winner: Marcos')).toBeNull();

    fireEvent.press(await findByLabelText('Scorecard'));
    expect(await findByText('Winner: Marcos')).toBeTruthy();
  });

  test('scorecard tab renders the real scorecard table and the quiet leaderboard, without the gray totals card', async () => {
    const { findByText, getAllByText, queryByText } = render(wrap(
      <RoundSummaryScreen navigation={navigation} route={route} />,
    ));
    expect(await findByText('FRONT NINE')).toBeTruthy();
    expect(await findByText('BACK NINE')).toBeTruthy();
    expect(await findByText('LEADERBOARD')).toBeTruthy();
    // Strokes / Points display toggle from the live scorecard
    expect(getAllByText('Points').length).toBeGreaterThan(0);
    expect(getAllByText('Strokes').length).toBeGreaterThan(0);
    // The gray multi-player totals card is suppressed on this screen — its
    // header label only ever renders inside that card.
    expect(queryByText('STABLEFORD')).toBeNull();
  });

  test('no longer exposes a Leaderboard tab', async () => {
    const { findByText, queryByLabelText } = render(wrap(
      <RoundSummaryScreen navigation={navigation} route={route} />,
    ));
    await findByText('LEADERBOARD');
    expect(queryByLabelText('Leaderboard')).toBeNull();
  });

  test('comments tab has a composer wired to the feed thread', async () => {
    const { findByLabelText, findByPlaceholderText } = render(wrap(
      <RoundSummaryScreen navigation={navigation} route={route} />,
    ));
    fireEvent.press(await findByLabelText('Comments'));
    expect(await findByPlaceholderText('Add a comment…')).toBeTruthy();
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

  test('shows feed comments in the round summary comments tab', async () => {
    const { loadComments } = require('../../store/feedStore');
    const { findByLabelText, findByText } = render(wrap(
      <RoundSummaryScreen navigation={navigation} route={route} />,
    ));

    fireEvent.press(await findByLabelText('Comments'));

    expect(loadComments).toHaveBeenCalledWith('round:t1:r1');
    expect(await findByText('Great match from the feed.')).toBeTruthy();
    expect(await findByText('You')).toBeTruthy();
  });
});
