import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import LeagueBoardScreen from '../LeagueBoardScreen';

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

const THIS_MONTH = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
})();
const PAST_MONTH = '2025-09';

const member = (userId, displayName, extra = {}) => ({
  userId, displayName, role: 'member', feePaid: false, leftAt: null, leagueHandicap: 18, ...extra,
});

function snapshot({ cardsByMonth = {}, members } = {}) {
  return {
    league: {
      id: 'L1', name: 'El Club', pointsTable: [500, 300, 190], handicapCap: 30, entryFeeCents: 3000,
      seasonStart: '2025-01-01', seasonEnd: '2025-12-31', archivedAt: null, inviteCode: 'MULL',
    },
    members: members ?? [
      member('me', 'Marcos', { role: 'admin', feePaid: true }),
      member('javi', 'Javi', { feePaid: true }),
      member('nacho', 'Nacho'),
    ],
    cards: [],
    cardsByMonth,
    votes: [],
    handicapEvents: [],
    final: null,
  };
}

const card = (userId, status, points, extra = {}) => ({
  id: `c-${userId}`, userId, status, points, source: 'app', notAnnounced: false, ...extra,
});

const makeNav = (routeNames = []) => ({
  navigate: jest.fn(), goBack: jest.fn(), addListener: jest.fn(() => jest.fn()),
  getState: () => ({ routeNames }),
});
const route = { params: { leagueId: 'L1' } };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('LeagueBoardScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    store.getLeagueCached.mockResolvedValue(null);
  });

  test('empty league: dashes for everyone, the empty-state copy and the play button', async () => {
    store.getLeague.mockResolvedValue(snapshot());
    const navigation = makeNav();
    const { getByText, getAllByText } = render(wrap(<LeagueBoardScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('SEASON'));
    expect(getAllByText('—')).toHaveLength(3);
    expect(getByText(/No cards yet\. .* is open: the board fills in as each card is confirmed\./)).toBeTruthy();

    fireEvent.press(getByText('Play with the app'));
    expect(navigation.navigate).toHaveBeenCalledWith('Setup', { kind: 'game', leagueId: 'L1' });
  });

  test('no card: "Playing without the app?" opens LeagueAnnounce and the link adds an unannounced card', async () => {
    store.getLeague.mockResolvedValue(snapshot());
    const nav = makeNav();
    const { getByText } = render(wrap(<LeagueBoardScreen navigation={nav} route={route} />));
    await waitFor(() => getByText('Playing without the app?'));
    fireEvent.press(getByText('Playing without the app?'));
    expect(nav.navigate).toHaveBeenCalledWith('LeagueAnnounce', { leagueId: 'L1' });
    fireEvent.press(getByText(/Already played and announced it somewhere else\? Add the card/));
    expect(nav.navigate).toHaveBeenCalledWith('LeagueAddScore', { leagueId: 'L1' });
  });

  test('announced off-app: shows the announcement and "Add your score" opens LeagueAddScore', async () => {
    const teeTime = new Date(2025, 9, 4, 9, 30).toISOString();
    const announcedAt = new Date(2025, 9, 4, 9, 12).toISOString();
    store.getLeague.mockResolvedValue(snapshot({
      cardsByMonth: {
        [THIS_MONTH]: [card('me', 'announced', null, {
          id: 'c1', source: 'offapp', course: { name: 'Golf Olivar' }, announcedAt, teeTime,
        })],
      },
    }));
    const nav = makeNav();
    const { getByText } = render(wrap(<LeagueBoardScreen navigation={nav} route={route} />));
    await waitFor(() => getByText('Add your score'));
    expect(getByText('Announced 09:12 · Golf Olivar · Sat 4 Oct 09:30 — playing without the app')).toBeTruthy();
    fireEvent.press(getByText('Add your score'));
    expect(nav.navigate).toHaveBeenCalledWith('LeagueAddScore', { leagueId: 'L1', cardId: 'c1' });
  });

  test('off-app card with its proof attached reads "added after the round · photo attached"', async () => {
    store.getLeague.mockResolvedValue(snapshot({
      cardsByMonth: {
        [THIS_MONTH]: [card('me', 'confirmed', 36, {
          source: 'offapp', course: { name: 'Golf Olivar' }, proofPath: 'L1/c-me.jpg', confirmation: 'photo',
        })],
      },
    }));
    const { getByText } = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => getByText('36 pts · Golf Olivar · added after the round · photo attached'));
  });

  test('a submitted off-app card without proof offers "Add proof" (resume)', async () => {
    store.getLeague.mockResolvedValue(snapshot({
      cardsByMonth: {
        [THIS_MONTH]: [card('me', 'submitted', 36, { id: 'c9', source: 'offapp', course: { name: 'Golf Olivar' } })],
      },
    }));
    const nav = makeNav();
    const { getByText } = render(wrap(<LeagueBoardScreen navigation={nav} route={route} />));
    await waitFor(() => getByText('Add proof'));
    fireEvent.press(getByText('Add proof'));
    expect(nav.navigate).toHaveBeenCalledWith('LeagueAddProof', { leagueId: 'L1', cardId: 'c9', resume: true });
  });

  test('a playing app card offers "Finish validating your card" → LeagueValidate on its round', async () => {
    store.getLeague.mockResolvedValue(snapshot({
      cardsByMonth: {
        [THIS_MONTH]: [card('me', 'playing', null, {
          id: 'c5', course: { name: 'Centro Nacional' }, tournamentId: 't1', roundId: 't1-r0',
        })],
      },
    }));
    const nav = makeNav();
    const { getByText } = render(wrap(<LeagueBoardScreen navigation={nav} route={route} />));
    await waitFor(() => getByText('Finish validating your card'));
    fireEvent.press(getByText('Finish validating your card'));
    expect(nav.navigate).toHaveBeenCalledWith('LeagueValidate', {
      leagueId: 'L1', cardId: 'c5', tournamentId: 't1', roundId: 't1-r0', submitted: false,
    });
  });

  test('a submitted app card reopens Validate straight at the partner check', async () => {
    store.getLeague.mockResolvedValue(snapshot({
      cardsByMonth: {
        [THIS_MONTH]: [card('me', 'submitted', 36, { id: 'c5', tournamentId: 't1', roundId: 't1-r0' })],
      },
    }));
    const nav = makeNav();
    const { getByText, queryByText } = render(wrap(<LeagueBoardScreen navigation={nav} route={route} />));
    await waitFor(() => getByText('Finish validating your card'));
    expect(queryByText('Add proof')).toBeNull();
    fireEvent.press(getByText('Finish validating your card'));
    expect(nav.navigate).toHaveBeenCalledWith('LeagueValidate', {
      leagueId: 'L1', cardId: 'c5', tournamentId: 't1', roundId: 't1-r0', submitted: true,
    });
  });

  test('"Finish validating" is only for unconfirmed app cards', async () => {
    store.getLeague.mockResolvedValue(snapshot({
      cardsByMonth: { [THIS_MONTH]: [card('me', 'confirmed', 36, { tournamentId: 't1', roundId: 't1-r0' })] },
    }));
    const confirmed = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => confirmed.getByText('Confirmed'));
    expect(confirmed.queryByText('Finish validating your card')).toBeNull();
    confirmed.unmount();

    store.getLeague.mockResolvedValue(snapshot({
      cardsByMonth: { [THIS_MONTH]: [card('me', 'submitted', 36, { source: 'offapp' })] },
    }));
    const offApp = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => offApp.getByText('Add proof'));
    expect(offApp.queryByText('Finish validating your card')).toBeNull();
  });

  test('season standings with the last-month delta, my row, pot footer and this month statuses', async () => {
    store.getLeague.mockResolvedValue(snapshot({
      cardsByMonth: {
        [PAST_MONTH]: [card('javi', 'confirmed', 38), card('me', 'confirmed', 34), card('nacho', 'confirmed', 34)],
        [THIS_MONTH]: [card('javi', 'confirmed', 36), card('nacho', 'playing', null)],
      },
    }));
    const { getByText, getAllByText } = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => getByText(/^SEASON · AFTER /));
    // Javi: 500 + 500, tied 2nd me/nacho share (300+190)/2 = 245 twice in September, 245 in total for me.
    expect(getAllByText('T2').length).toBe(2);
    expect(getByText('1,000')).toBeTruthy();
    expect(getAllByText(/^\+\d+ /).length).toBeGreaterThan(0);
    expect(getByText(/Final in December — extra strokes from these standings, set on the day\. Pot 60 €/)).toBeTruthy();
    expect(getByText('36 pts · confirmed')).toBeTruthy();
    expect(getByText('Playing now')).toBeTruthy();
    expect(getByText('No card yet')).toBeTruthy();
  });

  test('my own card block reflects a confirmed card', async () => {
    store.getLeague.mockResolvedValue(snapshot({
      cardsByMonth: {
        [THIS_MONTH]: [card('me', 'confirmed', 36, {
          confirmedByName: 'Lucía', course: { name: 'Golf Olivar' },
        })],
      },
    }));
    const { getByText, queryByText } = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => getByText('Confirmed'));
    expect(getByText('36 pts · Golf Olivar · confirmed by Lucía')).toBeTruthy();
    expect(queryByText('Play with the app')).toBeNull();
  });

  test('flags a card that was not announced in the app', async () => {
    store.getLeague.mockResolvedValue(snapshot({
      cardsByMonth: { [THIS_MONTH]: [card('javi', 'submitted', 30, { notAnnounced: true, source: 'offapp' })] },
    }));
    const { getByText } = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => getByText('Not announced in the app'));
    expect(getByText('30 pts · added after the round')).toBeTruthy();
  });

  test('shows the cached board first and an offline banner when the live read fails', async () => {
    store.getLeagueCached.mockResolvedValue({ at: 1, snapshot: snapshot() });
    store.getLeague.mockRejectedValue(new Error('You need a connection to do this.'));
    const { getByText, queryByText } = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => getByText('Offline · showing the last saved board'));
    expect(getByText('El Club')).toBeTruthy();
    expect(queryByText("Couldn't load the league")).toBeNull();
  });

  test('with nothing cached and no connection it shows the error and retries on demand', async () => {
    store.getLeague.mockRejectedValueOnce(new Error('You need a connection to do this.'));
    store.getLeague.mockResolvedValueOnce(snapshot());
    const { getByText } = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => getByText("Couldn't load the league"));
    fireEvent.press(getByText('Try again'));
    await waitFor(() => getByText('SEASON'));
  });

  test('the admin sees "Set up the Final"; once recorded it is an "open" link to the tournament', async () => {
    store.getLeague.mockResolvedValueOnce(snapshot());
    const nav = makeNav();
    const first = render(wrap(<LeagueBoardScreen navigation={nav} route={route} />));
    await waitFor(() => first.getByText('Set up the Final'));
    fireEvent.press(first.getByText('Set up the Final'));
    expect(nav.navigate).toHaveBeenCalledWith('LeagueFinal', { leagueId: 'L1' });
    first.unmount();

    store.getLeague.mockResolvedValueOnce({
      ...snapshot(), final: { tournamentId: 't9', strokes: {}, createdAt: '2025-12-13T10:00:00Z' },
    });
    const second = render(wrap(<LeagueBoardScreen navigation={nav} route={route} />));
    await waitFor(() => second.getByText(/^Final · .* · open$/));
    expect(second.queryByText('Set up the Final')).toBeNull();
    fireEvent.press(second.getByText(/^Final · .* · open$/));
    expect(nav.navigate).toHaveBeenCalledWith('Tournament', { tournamentId: 't9', viewMode: 'tournament' });
  });

  test('a plain member has no "Set up the Final"', async () => {
    store.getLeague.mockResolvedValue(snapshot({
      members: [member('me', 'Marcos'), member('javi', 'Javi', { role: 'admin' })],
    }));
    const { getByText, queryByText } = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => getByText('SEASON'));
    expect(queryByText('Set up the Final')).toBeNull();
  });

  test('header buttons open Members and Settings', async () => {
    store.getLeague.mockResolvedValue(snapshot());
    const navigation = makeNav();
    const { getByLabelText, getByText } = render(wrap(<LeagueBoardScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('SEASON'));
    fireEvent.press(getByLabelText('Members and handicaps'));
    expect(navigation.navigate).toHaveBeenCalledWith('LeagueMembers', { leagueId: 'L1' });
    fireEvent.press(getByLabelText('League settings'));
    expect(navigation.navigate).toHaveBeenCalledWith('LeagueSettings', { leagueId: 'L1' });
  });

  test('a scored row in this month opens its card; a playing row is not tappable', async () => {
    const holes = { 1: 4 };
    store.getLeague.mockResolvedValue(snapshot({
      cardsByMonth: {
        [THIS_MONTH]: [
          card('javi', 'confirmed', 36, { holes }),
          card('nacho', 'playing', null),
        ],
      },
    }));
    const nav = makeNav();
    const { getAllByText, getByLabelText, queryByLabelText } = render(wrap(<LeagueBoardScreen navigation={nav} route={route} />));
    await waitFor(() => getByLabelText("Javi's card"));
    expect(queryByLabelText("Nacho's card")).toBeNull();
    fireEvent.press(getByLabelText("Javi's card"));
    expect(nav.navigate).toHaveBeenCalledWith('LeagueCard', { leagueId: 'L1', month: THIS_MONTH, userId: 'javi' });
    getAllByText('Nacho').forEach((n) => fireEvent.press(n));
    expect(nav.navigate).toHaveBeenCalledTimes(1);
  });

  test("a past month's results rows open that month's card", async () => {
    store.getLeague.mockResolvedValue(snapshot({
      cardsByMonth: { [PAST_MONTH]: [card('javi', 'confirmed', 36, { holes: { 1: 4 } })] },
    }));
    const nav = makeNav();
    const { getByText, getByLabelText } = render(wrap(<LeagueBoardScreen navigation={nav} route={route} />));
    await waitFor(() => getByText('Sep'));
    fireEvent.press(getByText('Sep'));
    fireEvent.press(getByLabelText("Javi's card"));
    expect(nav.navigate).toHaveBeenCalledWith('LeagueCard', { leagueId: 'L1', month: PAST_MONTH, userId: 'javi' });
  });
});
