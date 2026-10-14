import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
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
  getLeagueShareLink: jest.fn(() => Promise.resolve('tok12345678901234567890')),
}));

jest.mock('../../store/tournamentStore', () => ({ getTournamentSnapshot: jest.fn(() => null) }));

const store = require('../../store/leagueStore');
const tournaments = require('../../store/tournamentStore');

const THIS_MONTH = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
})();
const PAST_MONTH = '2025-09';

const member = (userId, displayName, extra = {}) => ({
  userId, displayName, publicName: displayName, role: 'member', feePaid: false, leftAt: null, leagueHandicap: 18, ...extra,
});

// The season spans "now" (the tests run on the real clock), ending in a December.
function snapshot({ cardsByMonth = {}, members, league = {} } = {}) {
  return {
    league: {
      id: 'L1', name: 'El Club', pointsTable: [500, 300, 190], handicapCap: 30, entryFeeCents: 3000,
      seasonStart: '2025-01-01', seasonEnd: '2099-12-31', archivedAt: null, inviteCode: 'MULL',
      ...league,
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
    expect(getByText(/^PTS = Stableford\. LEAGUE = league points if \w+ ended today\./)).toBeTruthy();
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

  test('an admin-voided card takes the month: the board shows it, not the announce buttons', async () => {
    const snap = snapshot();
    snap.cards = [card('me', 'void', 41, { voidKind: 'admin', voidedReason: 'Wrong tee: sheet says yellow', monthKey: THIS_MONTH, month: `${THIS_MONTH}-01` })];
    store.getLeague.mockResolvedValue(snap);
    const nav = makeNav();
    const { getByText, queryByText } = render(wrap(<LeagueBoardScreen navigation={nav} route={route} />));
    await waitFor(() => getByText(/^Voided by an admin: Wrong tee\. .* stays used\.$/));
    expect(queryByText('Playing without the app')).toBeNull();
    expect(queryByText('Play with the app')).toBeNull();
    fireEvent.press(getByText('Open the card'));
    expect(nav.navigate).toHaveBeenCalledWith('LeagueCard', { leagueId: 'L1', month: THIS_MONTH, userId: 'me' });
  });

  test("a member's admin-voided card is its own group on the month table, not under No card yet", async () => {
    const snap = snapshot();
    snap.cards = [card('javi', 'void', 41, { voidKind: 'admin', voidedReason: 'Wrong tee: sheet says yellow', monthKey: THIS_MONTH, month: `${THIS_MONTH}-01` })];
    store.getLeague.mockResolvedValue(snap);
    const nav = makeNav();
    const { getByText, queryByText } = render(wrap(<LeagueBoardScreen navigation={nav} route={route} />));
    await waitFor(() => getByText('Voided · 1'));
    expect(getByText('Voided · Wrong tee')).toBeTruthy();
    expect(getByText('Javi')).toBeTruthy();
    expect(getByText('No card yet · 2')).toBeTruthy();
    expect(queryByText('No card yet · 3')).toBeNull();
    fireEvent.press(getByText('Javi'));
    expect(nav.navigate).toHaveBeenCalledWith('LeagueCard', { leagueId: 'L1', month: THIS_MONTH, userId: 'javi' });
  });

  test('a withdrawn card frees the month: the announce buttons are back', async () => {
    const snap = snapshot();
    snap.cards = [card('me', 'void', null, { voidKind: 'withdrawn', monthKey: THIS_MONTH, month: `${THIS_MONTH}-01` })];
    store.getLeague.mockResolvedValue(snap);
    const { getByText } = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => getByText('Playing without the app'));
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

  test('announced off-app before tee time + 3 h: "Post from" instead of "Add your score" (R8)', async () => {
    const teeTime = new Date(Date.now() - 3600000).toISOString();
    store.getLeague.mockResolvedValue(snapshot({
      cardsByMonth: {
        [THIS_MONTH]: [card('me', 'announced', null, {
          id: 'c1', source: 'offapp', course: { name: 'Golf Olivar' }, announcedAt: teeTime, teeTime,
        })],
      },
    }));
    const nav = makeNav();
    const { getByText, queryByText } = render(wrap(<LeagueBoardScreen navigation={nav} route={route} />));
    await waitFor(() => getByText(/^Post from /));
    expect(queryByText('Add your score')).toBeNull();
    fireEvent.press(getByText(/^Post from /));
    expect(nav.navigate).not.toHaveBeenCalledWith('LeagueAddScore', expect.anything());
  });

  test('outside the season the play buttons give way to "starts on" / "is over"', async () => {
    store.getLeague.mockResolvedValue(snapshot({ league: { seasonStart: '2099-01-01', seasonEnd: '2099-12-31' } }));
    const first = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => first.getByText('The season starts on 1 Jan.'));
    expect(first.queryByText('Play with the app')).toBeNull();
    expect(first.queryByText('Playing without the app')).toBeNull();
    first.unmount();

    store.getLeague.mockResolvedValue(snapshot({ league: { seasonStart: '2025-01-01', seasonEnd: '2025-12-31' } }));
    const over = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => over.getByText('The season is over.'));
    expect(over.queryByText('Play with the app')).toBeNull();
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
    await waitFor(() => getByText('36 pts · 1st so far · +500 league pts · Golf Olivar · added after the round · photo attached'));
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

  test('a playing app card with holes still unscored shows no Finish button, only the scorecard link', async () => {
    tournaments.getTournamentSnapshot.mockReturnValueOnce({
      players: [{ id: 'p1', user_id: 'me' }],
      rounds: [{ id: 't1-r0', holes: [{ number: 1 }, { number: 2 }], scores: { p1: { 1: 4 } } }],
    });
    store.getLeague.mockResolvedValue(snapshot({
      cardsByMonth: {
        [THIS_MONTH]: [card('me', 'playing', null, {
          id: 'c5', course: { name: 'Centro Nacional' }, tournamentId: 't1', roundId: 't1-r0',
        })],
      },
    }));
    const { getByText, queryByText } = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => getByText(/Playing with the app/));
    expect(queryByText('Finish validating your card')).toBeNull();
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

  test('"Playing with the app" opens the game scorecard', async () => {
    store.getLeague.mockResolvedValue(snapshot({
      cardsByMonth: {
        [THIS_MONTH]: [card('me', 'playing', null, {
          id: 'c5', course: { name: 'Centro Nacional' }, tournamentId: 't1', roundId: 't1-r0',
        })],
      },
    }));
    const nav = makeNav();
    const { getByText } = render(wrap(<LeagueBoardScreen navigation={nav} route={route} />));
    await waitFor(() => getByText(/Playing with the app/));
    fireEvent.press(getByText(/Playing with the app/));
    expect(nav.navigate).toHaveBeenCalledWith('Scorecard', { tournamentId: 't1', roundIndex: 0 });
  });

  test('a card the marker sent back shows the marker note', async () => {
    store.getLeague.mockResolvedValue(snapshot({
      cardsByMonth: {
        [THIS_MONTH]: [card('me', 'submitted', 36, {
          id: 'c5', tournamentId: 't1', roundId: 't1-r0', markerNote: 'Hole 7 was a 6',
        })],
      },
    }));
    const { getByText } = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => getByText(/Hole 7 was a 6/));
  });

  test('a submitted card with a marker asked reads "Waiting for <first>"', async () => {
    store.getLeague.mockResolvedValue(snapshot({
      cardsByMonth: {
        [THIS_MONTH]: [card('me', 'submitted', 36, { id: 'c5', tournamentId: 't1', roundId: 't1-r0', markerName: 'Javi Ortega' })],
      },
    }));
    const { getByText, queryByText } = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => getByText('Waiting for Javi'));
    expect(queryByText('Submitted')).toBeNull();
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
    const { getByText, getAllByText, queryByText } = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => getByText('Season'));
    fireEvent.press(getByText('Season'));
    await waitFor(() => getByText(/^SEASON · AFTER /));
    // Javi: 500 + 500, tied 2nd me/nacho share (300+190)/2 = 245 twice in September, 245 in total for me.
    expect(getAllByText('T2').length).toBe(2);
    expect(getByText('1,000')).toBeTruthy();
    expect(getAllByText(/^\+\d+ /).length).toBeGreaterThan(0);
    // The Final is hidden for now: the footer keeps only the pot.
    expect(getByText('Pot 60 €')).toBeTruthy();
    expect(queryByText(/Final in/)).toBeNull();
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
    expect(getByText('36 pts · 1st so far · +500 league pts · Golf Olivar · confirmed by Lucía')).toBeTruthy();
    expect(queryByText('Play with the app')).toBeNull();
  });

  test('an unapproved not-announced card waits under "Awaiting approval" and does not rank', async () => {
    store.getLeague.mockResolvedValue(snapshot({
      cardsByMonth: { [THIS_MONTH]: [card('javi', 'submitted', 30, { notAnnounced: true, source: 'offapp' })] },
    }));
    const { getByText, queryByText } = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => getByText('Awaiting approval · 1'));
    expect(getByText("Needs an admin's approval · not announced in the app")).toBeTruthy();
    expect(getByText('30')).toBeTruthy();
    expect(queryByText(/worse|better/)).toBeNull();
    expect(getByText('not counted')).toBeTruthy();
    expect(queryByText(/^Confirmed ·/)).toBeNull();
  });

  test('an approved not-announced card ranks, flagged as not announced', async () => {
    store.getLeague.mockResolvedValue(snapshot({
      cardsByMonth: {
        [THIS_MONTH]: [card('javi', 'confirmed', 30, { notAnnounced: true, approvedAt: '2025-10-05T10:00:00Z', course: { name: 'Olivar' } })],
      },
    }));
    const { getByText, queryByText } = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => getByText('Confirmed · 1'));
    expect(getByText('Olivar · not announced in the app')).toBeTruthy();
    expect(queryByText(/^Awaiting approval/)).toBeNull();
  });

  test('live cards show a countdown to post, amber wording under 2 hours; missed cards list under "Not posted"', async () => {
    const inMs = (h) => new Date(Date.now() + h * 3600000 + 30000).toISOString();
    store.getLeague.mockResolvedValue(snapshot({
      cardsByMonth: {
        [THIS_MONTH]: [
          card('javi', 'announced', null, { source: 'offapp', announcedAt: new Date().toISOString(), teeTime: new Date().toISOString(), postBy: inMs(5) }),
          card('nacho', 'playing', null, { postBy: inMs(1.5) }),
          card('me', 'announced', null, { source: 'offapp', postBy: new Date(Date.now() - 60000).toISOString() }),
        ],
      },
    }));
    const { getByText, getAllByText } = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => getByText('Not posted · 1'));
    expect(getByText('5 h 0 m')).toBeTruthy();
    expect(getByText('to post')).toBeTruthy();
    expect(getByText('1 h 30 m')).toBeTruthy();
    expect(getByText('left')).toBeTruthy();
    // My own missed card says so in the "Your card" block too.
    expect(getAllByText('Not posted').length).toBeGreaterThan(0);
  });

  test('missed and live rows open the card', async () => {
    store.getLeague.mockResolvedValue(snapshot({
      cardsByMonth: { [THIS_MONTH]: [card('javi', 'missed', null, { source: 'offapp' })] },
    }));
    const nav = makeNav();
    const { getByLabelText } = render(wrap(<LeagueBoardScreen navigation={nav} route={route} />));
    await waitFor(() => getByLabelText("Javi's card"));
    fireEvent.press(getByLabelText("Javi's card"));
    expect(nav.navigate).toHaveBeenCalledWith('LeagueCard', { leagueId: 'L1', month: THIS_MONTH, userId: 'javi' });
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
    expect(getByText('38')).toBeTruthy(); // Stableford points under PTS
    expect(getByText('PTS', { includeHiddenElements: true })).toBeTruthy();
    expect(getByText('LEAGUE', { includeHiddenElements: true })).toBeTruthy();
    expect(getAllByText(/35/).length).toBeGreaterThan(0); // my card block + the waiting row
    expect(queryByText(/worse|better/)).toBeNull();
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

  test('this month: an unscored confirmed card is listed with the confirmed, not ranked', async () => {
    store.getLeague.mockResolvedValue(snapshot({
      cardsByMonth: {
        [THIS_MONTH]: [
          card('javi', 'confirmed', 38, { netDifferential: -2.4 }),
          card('nacho', 'confirmed', null, { netDifferential: null }),
        ],
      },
    }));
    const { getByText, queryByText } = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => getByText('Confirmed · 2'));
    expect(getByText('38')).toBeTruthy();
    expect(queryByText(/worse|better/)).toBeNull();
    expect(getByText('unrated')).toBeTruthy();
    expect(getByText('not ranked')).toBeTruthy();
    expect(getByText(/Nacho's card has no slope or rating\. Shown, not ranked\.$/)).toBeTruthy();
  });

  test('"Your <Month> card" sits above the leaderboard', async () => {
    store.getLeague.mockResolvedValue(snapshot());
    const { getByText, toJSON } = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => getByText(/^Your .* card$/));
    const json = JSON.stringify(toJSON());
    expect(json.indexOf('Play with the app')).toBeLessThan(json.indexOf('SO FAR'));
  });

  test('header: "Share standings" opens the share sheet on the month so far, with the live board link', async () => {
    store.getLeague.mockResolvedValue(snapshot({
      cardsByMonth: { [THIS_MONTH]: [card('javi', 'confirmed', 36, { course: { name: 'Golf Olivar' } })] },
    }));
    const { getByLabelText, findByText, getAllByText } = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    fireEvent.press(await waitFor(() => getByLabelText('Share standings')));
    expect(await findByText('Share to the group')).toBeTruthy();
    await waitFor(() => expect(store.getLeagueShareLink).toHaveBeenCalledWith('L1'));
    await waitFor(() => {
      const text = getByLabelText('Message preview').props.children;
      expect(text).toMatch(/^\*El Club\*\n\w+ so far · (\d+ days? left|last day)\n\n1\. Javi · 36 pts · Golf Olivar\n2 still to post\.\n\nLive board: https:\/\/golf-partner\.vercel\.app\/league-board\/tok12345678901234567890$/);
    });
    // Without the link: the same text, no URL.
    fireEvent(getByLabelText('Add the live board link'), 'valueChange', false);
    expect(getByLabelText('Message preview').props.children).not.toMatch(/league-board/);
    // The sheet's Season chip is the last "Season" on screen (the board has one too).
    const seasons = getAllByText('Season');
    fireEvent.press(seasons[seasons.length - 1]);
    expect(getByLabelText('Message preview').props.children).toMatch(/^\*El Club\*\nSeason after /);
  });

  test('a month that is final: the banner shares the results with places and league points', async () => {
    store.getLeague.mockResolvedValue(snapshot({
      cardsByMonth: { [PAST_MONTH]: [card('javi', 'confirmed', 38), card('me', 'confirmed', 34)] },
    }));
    const { getByText, getByLabelText, findByText } = render(wrap(
      <LeagueBoardScreen navigation={makeNav()} route={{ params: { leagueId: 'L1', finalMonth: PAST_MONTH } }} />,
    ));
    expect(await findByText('September is final')).toBeTruthy();
    fireEvent.press(getByText('Share the results'));
    await waitFor(() => expect(getByLabelText('Message preview').props.children).toMatch(
      /^\*El Club\*\nSeptember results\n\n1\. Javi · 38 pts · \+500\n2\. Marcos · 34 pts · \+300\n\nSeason: 1\. Javi 500 · 2\. Marcos 300/,
    ));
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

  test('a scored row and a playing row in this month open their cards', async () => {
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
    const { getByLabelText } = render(wrap(<LeagueBoardScreen navigation={nav} route={route} />));
    await waitFor(() => getByLabelText("Javi's card"));
    fireEvent.press(getByLabelText("Javi's card"));
    expect(nav.navigate).toHaveBeenCalledWith('LeagueCard', { leagueId: 'L1', month: THIS_MONTH, userId: 'javi' });
    fireEvent.press(getByLabelText("Nacho's card"));
    expect(nav.navigate).toHaveBeenCalledWith('LeagueCard', { leagueId: 'L1', month: THIS_MONTH, userId: 'nacho' });
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


  test("a month's results rank by points with PTS and LEAGUE columns; an unscored card is listed, not ranked", async () => {
    store.getLeague.mockResolvedValue(snapshot({
      cardsByMonth: {
        [PAST_MONTH]: [
          card('javi', 'confirmed', 38, { netDifferential: -2.4 }),
          card('nacho', 'confirmed', 30, { netDifferential: 3.1 }),
          card('me', 'confirmed', null, { netDifferential: null }),
        ],
      },
    }));
    const { getByText, queryByText } = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => getByText('Sep'));
    fireEvent.press(getByText('Sep'));
    expect(getByText('38')).toBeTruthy();
    expect(getByText('30')).toBeTruthy();
    expect(getByText('PTS', { includeHiddenElements: true })).toBeTruthy();
    expect(getByText('LEAGUE', { includeHiddenElements: true })).toBeTruthy();
    expect(queryByText(/worse|better/)).toBeNull();
    expect(getByText('unrated')).toBeTruthy();
    expect(getByText('not ranked')).toBeTruthy();
    expect(getByText('Your card has no slope or rating. Shown, not ranked.')).toBeTruthy();
  });
});

describe('LeagueBoardScreen in Spanish', () => {
  const { setLanguagePref, formatDate } = require('../../i18n');
  const mes = formatDate(`${THIS_MONTH}-01`, 'monthName', 'es');
  beforeEach(async () => {
    jest.clearAllMocks();
    store.getLeagueCached.mockResolvedValue(null);
    await act(async () => { await setLanguagePref('es'); });
  });
  afterEach(async () => { await act(async () => { await setLanguagePref('en'); }); });

  test('groups, reasons, my card and the month in Spanish', async () => {
    store.getLeague.mockResolvedValue(snapshot({
      members: [
        member('me', 'Marcos'), member('javi', 'Javi'), member('nacho', 'Nacho'), member('pablo', 'Pablo'),
      ],
      cardsByMonth: {
        [THIS_MONTH]: [
          card('javi', 'confirmed', 38, { confirmation: 'qr', course: { name: 'Olivar' } }),
          card('nacho', 'submitted', 35, { course: { name: 'Olivar' } }),
        ],
      },
    }));
    const { getByText } = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => getByText('Confirmadas · 1'));
    expect(getByText(new RegExp(`^${mes.toUpperCase()} HASTA AHORA · `))).toBeTruthy();
    expect(getByText('Olivar · marcador por QR')).toBeTruthy();
    expect(getByText('Pendientes de confirmación · 1')).toBeTruthy();
    expect(getByText('Olivar · el marcador aún no ha escaneado el QR')).toBeTruthy();
    expect(getByText('Sin tarjeta · 2')).toBeTruthy();
    expect(getByText('Tú, Pablo')).toBeTruthy();
    // Mid-sentence the month is lower case.
    expect(getByText(`Tu tarjeta de ${mes}`)).toBeTruthy();
  });

  test('a shared place shows decimal league points with a comma, and the floor reads "puntos por jugar"', async () => {
    const snap = snapshot({
      members: [
        member('me', 'Marcos'), member('javi', 'Javi'), member('nacho', 'Nacho'),
        member('lucia', 'Lucía'), member('pablo', 'Pablo'),
      ],
      cardsByMonth: {
        [THIS_MONTH]: [
          card('javi', 'confirmed', 38), card('me', 'confirmed', 34, { course: { name: 'Olivar' } }),
          card('nacho', 'confirmed', 34), card('lucia', 'confirmed', 34), card('pablo', 'confirmed', 30),
        ],
      },
    });
    snap.league.participationPoints = 100;
    store.getLeague.mockResolvedValue(snap);
    const { getByText, getAllByText } = render(wrap(<LeagueBoardScreen navigation={makeNav()} route={route} />));
    await waitFor(() => getByText('Confirmadas · 5'));
    // 2nd-4th share (300 + 190 + 0) / 3 = 163.3 each.
    expect(getAllByText('+163,3')).toHaveLength(3);
    expect(getAllByText('Comparte 2.º–4.º')).toHaveLength(2);
    expect(getByText('+100')).toBeTruthy();
    expect(getByText('Puntos por jugar')).toBeTruthy();
    expect(getByText('34 ptos · T2.º de momento · +163,3 ptos de liga · Olivar')).toBeTruthy();
  });
});
