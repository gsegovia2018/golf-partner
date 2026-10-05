import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import LeagueStatsScreen from '../LeagueStatsScreen';

jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
jest.mock('../../components/PullToRefresh', () => {
  const { ScrollView } = require('react-native');
  return function PullToRefresh({ children }) { return <ScrollView>{children}</ScrollView>; };
});
jest.mock('../../store/leagueStore', () => ({
  getLeague: jest.fn(),
  getLeagueCached: jest.fn(() => Promise.resolve(null)),
}));

const store = require('../../store/leagueStore');

const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
const COURSE = { name: 'Los Arqueros', holes: PARS.map((par, i) => ({ n: i + 1, par, si: i + 1 })) };
const strokes = (over = {}) => Object.fromEntries(PARS.map((par, i) => [i + 1, over[i + 1] ?? par + 1]));

const member = (userId, displayName, extra = {}) => ({
  userId, displayName, role: 'member', feePaid: false, leftAt: null, leagueHandicap: 18, ...extra,
});
const card = (userId, points, extra = {}) => ({
  id: `c-${userId}-${points}`, userId, status: 'confirmed', points, course: COURSE, playingHandicap: 0,
  holes: strokes(), teeTime: null, playedOn: null, ...extra,
});

const cardsByMonth = {
  '2025-07': [card('me', 30), card('javi', 34), card('nacho', 28)],
  '2025-08': [card('me', 33), card('javi', 31), card('nacho', 37, { holes: strokes({ 7: 2 }) })],
  '2025-09': [card('me', 36), card('javi', 30), card('nacho', 25, { status: 'submitted' })],
};

function snapshot(extra = {}) {
  return {
    league: {
      id: 'L1', name: 'El Club', pointsTable: [500, 300, 190], handicapCap: 30, entryFeeCents: 0,
      seasonStart: '2025-01-01', seasonEnd: '2025-12-31', archivedAt: null, inviteCode: 'MULL',
    },
    members: [member('me', 'Marcos'), member('javi', 'Javi'), member('nacho', 'Nacho')],
    cards: [],
    cardsByMonth,
    votes: [],
    handicapEvents: [],
    final: null,
    ...extra,
  };
}

const navigation = { goBack: jest.fn(), navigate: jest.fn(), addListener: jest.fn(() => jest.fn()) };
const route = { params: { leagueId: 'L1' } };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

async function open(data = snapshot()) {
  store.getLeague.mockResolvedValue(data);
  const utils = render(wrap(<LeagueStatsScreen navigation={navigation} route={route} />));
  await waitFor(() => utils.getByText('El Club · Stats'));
  return utils;
}

describe('LeagueStatsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    store.getLeague.mockReset();
    store.getLeagueCached.mockResolvedValue(null);
  });

  test('honours: newest scored month first, with its summary and honours', async () => {
    const { getByText, queryByText } = await open();
    expect(getByText('September honours')).toBeTruthy();
    // September has only 2 confirmed cards (Nacho's is submitted): not enough.
    expect(getByText('2 cards · 1 course')).toBeTruthy();
    expect(getByText(/Not enough cards yet/)).toBeTruthy();
    expect(queryByText('CARD OF THE MONTH')).toBeNull();

    fireEvent.press(getByText('Aug'));
    expect(getByText('August honours')).toBeTruthy();
    expect(getByText('CARD OF THE MONTH')).toBeTruthy();
    expect(getByText('Nacho, 37 pts at Los Arqueros')).toBeTruthy();
    expect(getByText('HOLE OF THE MONTH')).toBeTruthy();
  });

  test('leaders: avg card with the needs-3-cards footnote, and other stats', async () => {
    const { getByText, getAllByText } = await open();
    fireEvent.press(getByText('Leaders'));
    expect(getByText('33.0')).toBeTruthy(); // Marcos: (30 + 33 + 36) / 3
    expect(getAllByText('needs 3 cards').length).toBeGreaterThan(0); // Nacho has 2 confirmed cards
    expect(getByText(/Averages need 3 cards/)).toBeTruthy();

    fireEvent.press(getByText('Birdies'));
    expect(getAllByText('1').length).toBe(2); // place 1 and Nacho's one birdie (a 2 on the par-3 7th)
    expect(() => getByText(/Averages need 3 cards/)).toThrow();
  });

  test('grid: a column per scored month and the confirmed points', async () => {
    const { getByText, getAllByText } = await open();
    fireEvent.press(getByText('Grid'));
    expect(getByText('Month winner')).toBeTruthy();
    expect(getAllByText('J').length).toBe(1); // Jul
    expect(getByText('37')).toBeTruthy();
    expect(getByText('36')).toBeTruthy();
    expect(getAllByText('–').length).toBe(1); // Nacho's September card is not confirmed
    fireEvent.press(getByText('37'));
    expect(navigation.navigate).toHaveBeenCalledWith('LeagueCard', expect.objectContaining({ leagueId: route.params.leagueId }));
  });

  test('rivals: record against each player, tap expands the month list', async () => {
    const { getByText, queryByText } = await open();
    fireEvent.press(getByText('Rivals'));
    expect(getByText('You vs the league')).toBeTruthy();
    // vs Javi: lost Jul, won Aug, won Sep -> 2-1 over 3 months.
    expect(getByText('2–1')).toBeTruthy();
    expect(getByText('3 months')).toBeTruthy();
    expect(queryByText('You 36')).toBeNull();
    fireEvent.press(getByText('Javi'));
    expect(getByText('You 36')).toBeTruthy();
    expect(getByText('Javi 30')).toBeTruthy();
  });

  test('no cards yet: friendly empty state', async () => {
    const { getByText } = await open(snapshot({ cardsByMonth: {} }));
    expect(getByText(/No confirmed cards yet/)).toBeTruthy();
  });

  test('error with nothing cached: offers Try again', async () => {
    store.getLeague.mockRejectedValue(new Error('boom'));
    const { getByText } = render(wrap(<LeagueStatsScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText("Couldn't load the stats"));
    fireEvent.press(getByText('Try again'));
    await waitFor(() => expect(store.getLeague).toHaveBeenCalledTimes(2));
  });

  test('stale cache: shows the offline banner', async () => {
    store.getLeagueCached.mockResolvedValue({ snapshot: snapshot() });
    store.getLeague.mockRejectedValue(new Error('offline'));
    const { getByText } = render(wrap(<LeagueStatsScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText(/Offline · showing the last saved stats/));
  });
});
