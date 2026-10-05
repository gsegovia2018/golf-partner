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

// The board ranks by net differential (lower is better); fixtures derive one
// from the points so more points still means a better card.
const card = (userId, status, points, extra = {}) => ({
  id: `c-${userId}`,
  userId,
  status,
  points,
  netDifferential: points == null ? null : 40 - points,
  source: 'app',
  notAnnounced: false,
  ...extra,
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

  test('empty league: this month first, everyone in "No card yet" with You first; the season tab has the empty-state copy', async () => {
    store.getLeague.mockResolvedValue(snapshot());
    const navigation = makeNav();
    const { getByText, getAllByText, queryByText } = render(wrap(<LeagueBoardScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText(/SO FAR · (\d+ DAYS? LEFT|LAST DAY)$/));
    expect(getByText('No card yet · 3')).toBeTruthy();
    expect(getByText('You, Javi, Nacho')).toBeTruthy();
    expect(queryByText(/^Confirmed ·/)).toBeNull();
    expect(getByText(/^Gold = table points if the month ended today/)).toBeTruthy();
    fireEvent.press(getByText('Season'));
    expect(getAllByText('—')).toHaveLength(3);
    expect(getByText(/No cards yet\. .* is open: the board fills in as each card is confirmed\./)).toBeTruthy();

    fireEvent.press(getByText('Play with the app'));
    expect(navigation.navigate).toHaveBeenCalledWith('Setup', { kind: 'game', leagueId: 'L1' });
  });

  test('no card: "Playing without the app" opens LeagueAnnounce and "Add a card I played" adds an unannounced card', async () => {
    store.getLeague.mockResolvedValue(snapshot());
    const nav = makeNav();
    const { getByText } = render(wrap(<LeagueBoardScreen navigation={nav} route={route} />));
    await waitFor(() => getByText('Playing without the app'));
    fireEvent.press(getByText('Playing without the app'));
    expect(nav.navigate).toHaveBeenCalledWith('LeagueAnnounce', { leagueId: 'L1' });
    fireEvent.press(getByText('Add a card I played'));
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
    await waitFor(() => getByText('4.0 worse than your handicap · 36 pts · Golf Olivar · added after the round · photo attached'));
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
    await waitFor(() => getByText('Season'));
    fireEvent.press(getByText('Season'));
    await waitFor(() => getByText(/^SEASON · AFTER /));
    // Javi: 500 + 500, tied 2nd me/nacho share (300+190)/2 = 245 twice in September, 245 in total for me.
    expect(getAllByText('T2').length).toBe(2);
    expect(getByText('1,000')).toBeTruthy();
    expect(getAllByText(/^\+\d+ /).length).toBeGreaterThan(0);
    expect(getByText(/Final in December — extra strokes from these standings, set on the day\. Pot 60 €/)).toBeTruthy();
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
    expect(getByText('4.0 worse than your handicap · 36 pts · Golf Olivar · confirmed by Lucía')).toBeTruthy();
    expect(queryByText('Play with the app')).toBeNull();
  });

  test('flags a card that was not announced in the app', async () => {
    store.getLeague.mockResolvedValue(snapshot({
      cardsByMonth: { [THIS_MONTH]: [card('javi', 'submitted', 30, { notAnnounced: true, source: 'offapp' })] },
    }));
    const { getByText } = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => getByText('Needs the card photo · not announced in the app'));
    expect(getByText('10.0 worse')).toBeTruthy();
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
    await waitFor(() => getByText(/SO FAR/));
  });

  test('this month groups confirmed (with table points), waiting, playing or announced, and no card', async () => {
    store.getLeague.mockResolvedValue(snapshot({
      members: [
        member('me', 'Marcos'), member('javi', 'Javi'), member('nacho', 'Nacho'),
        member('lucia', 'Lucía'), member('pablo', 'Pablo'),
      ],
      cardsByMonth: {
        [THIS_MONTH]: [
          card('javi', 'confirmed', 38, { confirmation: 'qr', course: { name: 'Olivar' } }),
          card('me', 'submitted', 35, { course: { name: 'Olivar' } }),
          card('nacho', 'playing', null, { course: { name: 'Centro' } }),
          card('lucia', 'announced', null, { source: 'offapp', teeTime: new Date(2025, 9, 4, 9, 30).toISOString() }),
        ],
      },
    }));
    const { getByText, getAllByText, queryByText } = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => getByText('Confirmed · 1'));
    expect(getByText('Olivar · marker by QR')).toBeTruthy();
    expect(getByText('2.0 worse')).toBeTruthy();
    expect(getAllByText('5.0 worse')).toHaveLength(2); // my card block + the waiting row
    expect(getByText('+500')).toBeTruthy();
    expect(getByText('Waiting for confirmation · 1')).toBeTruthy();
    expect(getByText("Olivar · marker hasn't scanned the QR yet")).toBeTruthy();
    expect(getByText('pending')).toBeTruthy();
    expect(getByText('Playing or announced · 2')).toBeTruthy();
    expect(getByText('Playing now · Centro')).toBeTruthy();
    expect(getByText('Announced · Sat 4 Oct 09:30')).toBeTruthy();
    expect(getByText('No card yet · 1')).toBeTruthy();
    expect(getByText('Pablo')).toBeTruthy();
    // The old status list, the Final row and the members row are gone from the board.
    expect(queryByText('Members and handicaps')).toBeNull();
    expect(queryByText('Set up the Final')).toBeNull();
  });

  test('this month: an unrated confirmed card is listed with the confirmed, not ranked', async () => {
    store.getLeague.mockResolvedValue(snapshot({
      cardsByMonth: {
        [THIS_MONTH]: [
          card('javi', 'confirmed', 38, { netDifferential: -2.4 }),
          card('nacho', 'confirmed', 33, { netDifferential: null }),
        ],
      },
    }));
    const { getByText } = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => getByText('Confirmed · 2'));
    expect(getByText('2.4 better')).toBeTruthy();
    expect(getByText('unrated')).toBeTruthy();
    expect(getByText('not ranked')).toBeTruthy();
    expect(getByText(/Nacho's card has no slope or rating · shown, not ranked$/)).toBeTruthy();
  });

  test('"Your <Month> card" sits above the leaderboard', async () => {
    store.getLeague.mockResolvedValue(snapshot());
    const { getByText, toJSON } = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => getByText(/^Your .* card$/));
    const json = JSON.stringify(toJSON());
    expect(json.indexOf('Play with the app')).toBeLessThan(json.indexOf('SO FAR'));
  });

  test('header: Stats and Settings, no Members icon', async () => {
    store.getLeague.mockResolvedValue(snapshot());
    const navigation = makeNav();
    const { getByLabelText, queryByLabelText, getByText } = render(wrap(<LeagueBoardScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText(/SO FAR/));
    expect(queryByLabelText('Members and handicaps')).toBeNull();
    fireEvent.press(getByLabelText('Stats'));
    expect(navigation.navigate).toHaveBeenCalledWith('LeagueStats', { leagueId: 'L1' });
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
  test('a long season table shows the top 8, my neighbourhood and "Show all"', async () => {
    const members = Array.from({ length: 18 }, (_, i) => member(i === 13 ? 'me' : `p${i + 1}`, `Player ${i + 1}`));
    // Points fall with the index, so table order = member order and I'm 14th.
    const cards = members.map((m, i) => card(m.userId, 'confirmed', 40 - i, { id: `c${i}` }));
    store.getLeague.mockResolvedValue(snapshot({ members, cardsByMonth: { [PAST_MONTH]: cards } }));
    const { getByText, queryByText } = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => getByText('Season'));
    fireEvent.press(getByText('Season'));
    expect(getByText('Player 8')).toBeTruthy();
    expect(queryByText('Player 9')).toBeNull();
    expect(getByText('Player 13')).toBeTruthy();
    expect(getByText('You')).toBeTruthy();
    expect(getByText('Player 15')).toBeTruthy();
    expect(queryByText('Player 18')).toBeNull();
    fireEvent.press(getByText('Show all 18'));
    expect(getByText('Player 9')).toBeTruthy();
    expect(getByText('Player 18')).toBeTruthy();
    fireEvent.press(getByText('Show top 8'));
    expect(queryByText('Player 9')).toBeNull();
  });


  test("a month's results speak the net differential; an unrated card is listed, not ranked", async () => {
    store.getLeague.mockResolvedValue(snapshot({
      cardsByMonth: {
        [PAST_MONTH]: [
          card('javi', 'confirmed', 38, { netDifferential: -2.4 }),
          card('nacho', 'confirmed', 30, { netDifferential: 3.1 }),
          card('me', 'confirmed', 33, { netDifferential: null }),
        ],
      },
    }));
    const { getByText } = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => getByText('Sep'));
    fireEvent.press(getByText('Sep'));
    expect(getByText('2.4 better')).toBeTruthy();
    expect(getByText('3.1 worse')).toBeTruthy();
    expect(getByText('unrated')).toBeTruthy();
    expect(getByText('not ranked')).toBeTruthy();
    expect(getByText('Your card has no slope or rating · shown, not ranked')).toBeTruthy();
  });
});
