import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import LeagueBoardScreen from '../LeagueBoardScreen';

// Fri 2 Oct 2026, 14:20 in Madrid: September is still open (R12).
const mockNow = { value: new Date('2026-10-02T12:20:00Z') };
jest.mock('../../hooks/useMinuteClock', () => ({ useMinuteClock: () => mockNow.value }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
jest.mock('../../components/PullToRefresh', () => {
  const { ScrollView } = require('react-native');
  return function PullToRefresh({ children }) { return <ScrollView>{children}</ScrollView>; };
});
jest.mock('../../store/leagueStore', () => ({
  getLeague: jest.fn(),
  getLeagueCached: jest.fn(() => Promise.resolve(null)),
  getLeagueShareLink: jest.fn(() => Promise.resolve('tok12345678901234567890')),
}));
jest.mock('../../store/tournamentStore', () => ({ getTournamentSnapshot: jest.fn(() => null) }));

const store = require('../../store/leagueStore');

const member = (userId, displayName, extra = {}) => ({
  userId, displayName, publicName: displayName, role: 'member', feePaid: false, leftAt: null, leagueHandicap: 18, ...extra,
});
const card = (userId, status, points, extra = {}) => ({
  id: `c-${userId}`, userId, status, points, netDifferential: 40 - points, source: 'app', notAnnounced: false, ...extra,
});

function snapshot(sep, oct = []) {
  return {
    league: {
      id: 'L1', name: 'El Club', pointsTable: [500, 300, 190], handicapCap: 30, entryFeeCents: 3000,
      seasonStart: '2026-01-01', seasonEnd: '2026-12-31', archivedAt: null, inviteCode: 'MULL',
    },
    members: [
      member('me', 'Marcos'),
      member('adm', 'Ana', { role: 'admin' }),
      member('javi', 'Javi'),
      member('pab', 'Pablo'),
    ],
    cards: [],
    cardsByMonth: { '2026-09': sep, '2026-10': oct },
    votes: [],
    handicapEvents: [],
    final: null,
  };
}

const makeNav = () => ({
  navigate: jest.fn(), goBack: jest.fn(), addListener: jest.fn(() => jest.fn()), getState: () => ({ routeNames: [] }),
});
const route = { params: { leagueId: 'L1' } };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const SEP = [
  card('javi', 'confirmed', 36),
  card('me', 'submitted', 29, { markerName: 'Javi Ortega' }),
  card('pab', 'confirmed', 31, { notAnnounced: true }),
];

describe('LeagueBoardScreen grace window', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNow.value = new Date('2026-10-02T12:20:00Z');
    store.getLeagueCached.mockResolvedValue(null);
  });

  test('the banner, the "closing" chip and the not-counted rows of the closing month', async () => {
    store.getLeague.mockResolvedValue(snapshot(SEP));
    const nav = makeNav();
    const { findByText, getByText, getAllByText, queryByText } = render(wrap(<LeagueBoardScreen navigation={nav} route={route} />));
    expect(await findByText('September closes Saturday')).toBeTruthy();
    expect(getByText('Show QR to Javi')).toBeTruthy();
    expect(queryByText('September is final')).toBeNull();
    // The month board is the current one until the chip is pressed.
    expect(getByText(/^October/i)).toBeTruthy();
    fireEvent.press(getByText('Sep · closing'));
    expect(getByText(/September · provisional · closes Sat 23:59/i)).toBeTruthy();
    expect(getByText('Not counted yet · 2')).toBeTruthy();
    expect(getByText('Waiting for Javi Ortega to confirm')).toBeTruthy();
    expect(getByText('Waiting for an admin · not announced')).toBeTruthy();
    expect(getByText(/League points move once these are confirmed. After Saturday/)).toBeTruthy();
    // Ranked: only the confirmed, approved card.
    expect(getAllByText('Javi').length).toBeGreaterThan(0);
  });

  test('"See September" in the footer switches the board to the closing month', async () => {
    store.getLeague.mockResolvedValue(snapshot(SEP));
    const { findByText, getByText } = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    fireEvent.press(await findByText('See September'));
    await waitFor(() => expect(getByText('Not counted yet · 2')).toBeTruthy());
  });

  test('the QR action opens the marker QR for my card; my October card block is untouched', async () => {
    store.getLeague.mockResolvedValue(snapshot(SEP));
    const nav = makeNav();
    const { findByText, getByText } = render(wrap(<LeagueBoardScreen navigation={nav} route={route} />));
    fireEvent.press(await findByText('Show QR to Javi'));
    expect(nav.navigate).toHaveBeenCalledWith('LeagueMarkerQR', { leagueId: 'L1', cardId: 'c-me' });
    expect(getByText('Your October card')).toBeTruthy();
    expect(getByText('Play with the app')).toBeTruthy();
  });

  test('no banner and no extra chip when nothing waits, or once the month closes', async () => {
    store.getLeague.mockResolvedValue(snapshot([card('javi', 'confirmed', 36)]));
    const first = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => first.getByText('Your October card'));
    expect(first.queryByText(/closes/i)).toBeNull();
    first.unmount();

    mockNow.value = new Date('2026-10-03T22:00:00Z');   // 4 Oct 00:00 Madrid
    store.getLeague.mockResolvedValue(snapshot(SEP));
    const closed = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => closed.getByText('Your October card'));
    expect(closed.queryByText('September closes Saturday')).toBeNull();
    expect(closed.queryByText('Sep · closing')).toBeNull();
  });
});
