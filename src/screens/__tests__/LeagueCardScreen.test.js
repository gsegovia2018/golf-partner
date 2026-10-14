import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { setLanguagePref } from '../../i18n';
import { ThemeProvider } from '../../theme/ThemeContext';
import LeagueCardScreen from '../LeagueCardScreen';

let mockMe = 'me';
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: mockMe } }) }));
jest.mock('../../store/leagueStore', () => ({
  getLeague: jest.fn(),
  getLeagueCached: jest.fn(() => Promise.resolve(null)),
  getLeagueProofUrl: jest.fn(),
  rescheduleLeagueCard: jest.fn(),
  reopenLeagueCard: jest.fn(),
  approveLeagueCard: jest.fn(),
  withdrawLeagueCard: jest.fn(),
  voidLeagueCard: jest.fn(),
  getLeagueCardEvents: jest.fn(),
  getLeagueShareLink: jest.fn(() => Promise.resolve(null)),
}));

const store = require('../../store/leagueStore');

const MONTH = '2025-10';
// The DB snapshot shape ({ n, par, si }), not the scorecard's.
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const strokes = Object.fromEntries(holes.map((h) => [String(h.n), 5]));
const member = (userId, displayName, role = 'member') => ({ userId, displayName, role, leftAt: null, leagueHandicap: 18 });
const card = (userId, status, points, extra = {}) => ({
  id: `c-${userId}`, userId, status, points, source: 'app', monthKey: MONTH, month: `${MONTH}-01`, notAnnounced: false, holes: strokes,
  playingHandicap: 18, gross: 90, leagueHandicap: 18.0, differential: 15.6, netDifferential: -2.4,
  course: { name: 'Golf Olivar', tee: 'Yellow', slope: 125, rating: 72, holes }, ...extra,
});

function snapshot(cards) {
  return {
    league: { id: 'L1', name: 'El Club' },
    members: [member('me', 'Marcos', 'admin'), member('javi', 'Javi'), member('nacho', 'Nacho')],
    cardsByMonth: { [MONTH]: cards },
  };
}

const makeNav = () => ({ navigate: jest.fn(), goBack: jest.fn(), addListener: jest.fn(() => jest.fn()) });
const route = (userId) => ({ params: { leagueId: 'L1', month: MONTH, userId } });
const lastOf = (list) => list[list.length - 1];
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

// Only the clock is faked, so October 2025 is the open month (its cards can
// still change) and the real timers keep waitFor working.
const REAL_TIMERS = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
  'nextTick', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'performance'];
const openMonth = () => jest.useFakeTimers({ now: new Date('2025-10-15T10:00:00Z'), doNotFake: REAL_TIMERS });

describe('LeagueCardScreen', () => {
  afterEach(() => jest.useRealTimers());
  beforeEach(() => {
    jest.clearAllMocks();
    mockMe = 'me';
    setLanguagePref('en');
    store.getLeagueCached.mockResolvedValue(null);
    store.getLeagueCardEvents.mockResolvedValue([]);
  });

  test("the pager counts the cards you can flick to, not other members' withdrawn or former cards", async () => {
    const snap = snapshot([card('javi', 'confirmed', 38)]);
    snap.members.push({ ...member('ex', 'Old'), leftAt: '2025-09-01' });
    snap.cards = [
      card('javi', 'confirmed', 38),
      card('nacho', 'void', 20, { id: 'vn', voidKind: 'withdrawn' }),
      card('ex', 'void', 20, { id: 'vx', voidKind: 'admin' }),
    ];
    store.getLeague.mockResolvedValue(snap);
    const { getByText, getByLabelText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
    await waitFor(() => getByText('Javi · October card'));
    expect(getByText('1 of 1 October league card')).toBeTruthy();
    expect(getByLabelText('Next card').props.accessibilityState.disabled).toBe(true);
  });

  test('shows the summary and the read-only grid, and flicks between cards', async () => {
    store.getLeague.mockResolvedValue(snapshot([
      card('javi', 'confirmed', 38, { confirmedByName: 'Nacho' }),
      card('nacho', 'submitted', 30),
    ]));
    const { getByText, getAllByText, getByLabelText, queryByText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
    await waitFor(() => getByText('Javi · October card'));
    expect(getByText('1 of 2 October league cards')).toBeTruthy();
    expect(getByText('Confirmed')).toBeTruthy();
    expect(getByText('Golf Olivar · Yellow tees, slope 125 · CR 72')).toBeTruthy();
    expect(getByText('Playing handicap 18 · Gross 90')).toBeTruthy();
    expect(getByText('Confirmed by Nacho')).toBeTruthy();
    // Stableford points are the headline; place and league points sit in the strip.
    expect(getByText('38')).toBeTruthy();
    expect(getByText('Stableford pts')).toBeTruthy();
    expect(getByText('1st')).toBeTruthy();
    expect(getByText('of 1 card')).toBeTruthy();
    expect(getByText('+500')).toBeTruthy();
    expect(getByText('league pts')).toBeTruthy();
    // The differential lives in its own card, marked as secondary.
    expect(getByText('Net differential')).toBeTruthy();
    expect(getByText('2.4 better than league handicap 18.0. Stored for reference; the ranking uses points.')).toBeTruthy();
    // The grid reads the real DB hole shape: numbers and strokes render.
    expect(getAllByText('18').length).toBeGreaterThan(0);
    expect(getAllByText('5').length).toBeGreaterThan(0);
    expect(queryByText('You')).toBeNull();
    expect(getByLabelText('Previous card').props.accessibilityState.disabled).toBe(true);

    fireEvent.press(getByLabelText('Next card'));
    expect(getByText('Nacho · October card')).toBeTruthy();
    expect(getByText('2 of 2 October league cards')).toBeTruthy();
    expect(getByText('Submitted')).toBeTruthy();
    expect(queryByText('Confirmed by Nacho')).toBeNull();
    expect(getByLabelText('Next card').props.accessibilityState.disabled).toBe(true);

    fireEvent.press(getByLabelText('Previous card'));
    expect(getByText('Javi · October card')).toBeTruthy();
  });

  test('my own card is titled "You"', async () => {
    store.getLeague.mockResolvedValue(snapshot([card('me', 'confirmed', 36)]));
    const { getByText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('me')} />));
    await waitFor(() => getByText('You · October card'));
  });

  test('the differential card sits below the hole grid and the capped hole is still marked', async () => {
    // 18 par-4 holes, playing handicap 18 (1 extra shot each): the cap is 7. Hole 12 is a 9.
    const cappedHoles = { ...strokes, 12: 9 };
    store.getLeague.mockResolvedValue(snapshot([
      card('javi', 'confirmed', 36, { holes: cappedHoles, gross: 94, differential: 11.8, netDifferential: -6.2 }),
    ]));
    const { getByText, getAllByLabelText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
    await waitFor(() => getByText('Net differential'));
    expect(getByText('6.2 better than league handicap 18.0. Stored for reference; the ranking uses points.')).toBeTruthy();
    expect(getAllByLabelText(/^Hole 12, 9 strokes, \d points, counts as 7$/).length).toBe(1);
  });

  test('an unrated card says so and is not ranked', async () => {
    store.getLeague.mockResolvedValue(snapshot([
      card('javi', 'confirmed', null, {
        differential: null, netDifferential: null, course: { name: 'Golf Olivar', tee: 'Red', holes },
      }),
    ]));
    const { getByText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
    await waitFor(() => getByText('Unrated'));
    expect(getByText('not ranked')).toBeTruthy();
    expect(getByText('No differential: this tee has no slope and rating. Stored for reference; the ranking uses points.')).toBeTruthy();
  });

  test('a card that got the participation floor says "points for playing"', async () => {
    const snap = snapshot([
      card('javi', 'confirmed', 40), card('me', 'confirmed', 38), card('nacho', 'confirmed', 36),
      card('x', 'confirmed', 20),
    ]);
    snap.league = { id: 'L1', name: 'El Club', pointsTable: [500, 300, 190], participationPoints: 10 };
    snap.members.push(member('x', 'Xavi'));
    store.getLeague.mockResolvedValue(snap);
    const { getByText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('x')} />));
    await waitFor(() => getByText('4th'));
    expect(getByText('+10')).toBeTruthy();
    expect(getByText('points for playing')).toBeTruthy();
  });

  test('the open month words the strip as "so far" and "if it ended today"', async () => {
    const d = new Date();
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    store.getLeague.mockResolvedValue({
      league: { id: 'L1', name: 'El Club' },
      members: [member('me', 'Marcos', 'admin'), member('javi', 'Javi')],
      cardsByMonth: { [month]: [card('javi', 'confirmed', 38)] },
    });
    const { getByText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={{ params: { leagueId: 'L1', month, userId: 'javi' } }} />));
    await waitFor(() => getByText('league pts if it ended today'));
    expect(getByText(/^so far in /)).toBeTruthy();
  });

  test('a hand-entered tee is badged and explained', async () => {
    store.getLeague.mockResolvedValue(snapshot([card('javi', 'confirmed', 34, { teeVerified: false })]));
    const { getByText, queryByText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
    await waitFor(() => getByText('Tee entered by hand'));
    expect(getByText('Slope and rating were typed in, not taken from the course library.')).toBeTruthy();
    expect(queryByText('Confirmed')).toBeNull();
  });

  test('off-app card: added-after-the-round badge, not announced, and the signed photo', async () => {
    store.getLeague.mockResolvedValue(snapshot([
      card('javi', 'submitted', 33, { source: 'offapp', notAnnounced: true, proofPath: 'L1/c-javi.jpg', confirmation: 'photo', playedOn: '2025-10-04' }),
    ]));
    store.getLeagueProofUrl.mockResolvedValue('https://example.test/proof.jpg');
    const { getByText, getByLabelText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
    await waitFor(() => getByText('Awaiting approval'));
    expect(getByText('Not announced in the app')).toBeTruthy();
    expect(getByText('Golf Olivar · Yellow tees, slope 125 · CR 72 · Sat 4 Oct')).toBeTruthy();
    await waitFor(() => expect(getByLabelText('Signed card photo').props.source).toEqual({ uri: 'https://example.test/proof.jpg' }));
    expect(store.getLeagueProofUrl).toHaveBeenCalledWith('L1/c-javi.jpg');
  });

  test('an app card with a proof photo shows it too', async () => {
    store.getLeague.mockResolvedValue(snapshot([
      card('javi', 'confirmed', 33, { source: 'app', proofPath: 'L1/c-javi.jpg', confirmation: 'photo' }),
    ]));
    store.getLeagueProofUrl.mockResolvedValue('https://example.test/proof.jpg');
    const { getByLabelText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
    await waitFor(() => expect(getByLabelText('Signed card photo').props.source).toEqual({ uri: 'https://example.test/proof.jpg' }));
  });

  test('photo failure offers Try again', async () => {
    store.getLeague.mockResolvedValue(snapshot([
      card('javi', 'confirmed', 33, { source: 'offapp', proofPath: 'L1/c-javi.jpg', confirmation: 'official' }),
    ]));
    store.getLeagueProofUrl.mockRejectedValueOnce(new Error('nope')).mockResolvedValue('https://example.test/p.jpg');
    const { getByText, getByLabelText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
    await waitFor(() => getByText("Couldn't load the photo"));
    expect(getByText('Official result')).toBeTruthy();
    fireEvent.press(getByText('Try again'));
    await waitFor(() => getByLabelText('Official result'));
  });

  test('an announced card opens status-only, with the deadline', async () => {
    const postBy = new Date(Date.now() + 5 * 3600000 + 30000).toISOString();
    store.getLeague.mockResolvedValue(snapshot([
      card('javi', 'announced', null, { holes: null, postBy, announcedAt: new Date().toISOString(), teeTime: new Date().toISOString() }),
    ]));
    const { getByText, getByLabelText, queryByText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
    await waitFor(() => getByText('Javi · October card'));
    expect(getByText('Golf Olivar · Yellow tees, slope 125 · CR 72')).toBeTruthy();
    expect(getByLabelText(/^Post your score by .* left$/)).toBeTruthy();
    expect(queryByText('Reopen card')).toBeNull();
    expect(queryByText('Change tee time')).toBeNull();
  });

  test('a missed card says the month card is used; an admin (not the owner) can reopen it', async () => {
    openMonth();
    store.getLeague.mockResolvedValue(snapshot([card('javi', 'missed', null, { holes: null })]));
    store.reopenLeagueCard.mockResolvedValue({ id: 'c-javi', status: 'announced', postBy: null });
    const { getByText, getAllByText, getByLabelText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
    await waitFor(() => getByText("Not posted — this month's card is used."));
    fireEvent.press(getByLabelText('Card actions'));
    fireEvent.press(getByText('Reopen card'));
    expect(getByText('Reopen Javi’s card?')).toBeTruthy();
    expect(getByText(/^Javi gets 8 more hours, until \d\d:\d\d (today|tomorrow)\.$/)).toBeTruthy();
    fireEvent.press(lastOf(getAllByText('Reopen card')));
    await waitFor(() => expect(store.reopenLeagueCard).toHaveBeenCalledWith('c-javi'));
    await waitFor(() => expect(store.getLeague).toHaveBeenCalledTimes(2));
  });

  test('a server refusal shows inside the sheet and the sheet stays open', async () => {
    openMonth();
    store.getLeague.mockResolvedValue(snapshot([card('javi', 'missed', null, { holes: null })]));
    store.reopenLeagueCard.mockRejectedValue(new Error('Only an admin can reopen a card.'));
    const { getByText, getAllByText, getByLabelText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
    await waitFor(() => getByLabelText('Card actions'));
    fireEvent.press(getByLabelText('Card actions'));
    fireEvent.press(getByText('Reopen card'));
    fireEvent.press(lastOf(getAllByText('Reopen card')));
    await waitFor(() => getByText('Only an admin can reopen a card.'));
    expect(getByText('Reopen Javi’s card?')).toBeTruthy();
  });

  test('a member has no card actions; an admin has none on their own card while another admin exists', async () => {
    openMonth();
    const snap = snapshot([
      card('javi', 'missed', null, { holes: null }),
      card('nacho', 'submitted', 30, { source: 'offapp', notAnnounced: true }),
      card('me', 'missed', null, { holes: null }),
    ]);
    snap.members = [member('me', 'Marcos', 'admin'), member('javi', 'Javi', 'admin'), member('nacho', 'Nacho')];
    store.getLeague.mockResolvedValue(snap);
    mockMe = 'nacho';
    const asMember = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
    await waitFor(() => asMember.getByText('Javi · October card'));
    expect(asMember.queryByLabelText('Card actions')).toBeNull();
    asMember.unmount();

    mockMe = 'me';
    const own = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('me')} />));
    await waitFor(() => own.getByText('You · October card'));
    expect(own.queryByLabelText('Card actions')).toBeNull();
    own.unmount();

    const other = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('nacho')} />));
    await waitFor(() => other.getByLabelText('Card actions'));
    fireEvent.press(other.getByLabelText('Card actions'));
    expect(other.getByText('Approve card')).toBeTruthy();
    expect(other.getByText('Void card')).toBeTruthy();
  });

  test('"Share card" in Card actions opens the share sheet on my card', async () => {
    openMonth();
    store.getLeague.mockResolvedValue(snapshot([
      card('me', 'confirmed', 38, { confirmedByName: 'Javi Ortega' }), card('javi', 'confirmed', 30),
    ]));
    const { getByLabelText, getByText, findByText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('me')} />));
    await waitFor(() => getByLabelText('Card actions'));
    fireEvent.press(getByLabelText('Card actions'));
    expect(getByText('Send your card to the group chat')).toBeTruthy();
    fireEvent.press(getByText('Share card'));
    expect(await findByText('Share to the group')).toBeTruthy();
    // The admin switched the public board off: no link, and the sheet says why.
    expect(await findByText('An admin has switched the public board off.')).toBeTruthy();
    expect(getByLabelText('Message preview').props.children)
      .toBe('My October card for El Club: 38 pts at Golf Olivar, confirmed by Javi. 1st so far.');
  });

  test("no Share card on someone else's card", async () => {
    openMonth();
    mockMe = 'nacho';
    store.getLeague.mockResolvedValue(snapshot([card('javi', 'confirmed', 38)]));
    const { getByText, queryByLabelText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
    await waitFor(() => getByText('Javi · October card'));
    expect(queryByLabelText('Card actions')).toBeNull();
  });

  test('the only admin can void their own card', async () => {
    openMonth();
    store.getLeague.mockResolvedValue(snapshot([card('me', 'confirmed', 38)]));
    const { getByLabelText, getByText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('me')} />));
    await waitFor(() => getByLabelText('Card actions'));
    fireEvent.press(getByLabelText('Card actions'));
    fireEvent.press(getByText('Void card'));
    expect(getByText('Void your own card?')).toBeTruthy();
    expect(getByText('Your 38 pts at Golf Olivar stop counting for October.')).toBeTruthy();
  });

  test('an admin approves an unannounced card after the sheet states what counts', async () => {
    openMonth();
    store.getLeague.mockResolvedValue(snapshot([
      card('javi', 'submitted', 30, { source: 'offapp', notAnnounced: true, gross: 71, course: { name: 'La Moraleja', tee: 'Yellow', slope: 125, rating: 72, holes } }),
    ]));
    store.approveLeagueCard.mockResolvedValue({ id: 'c-javi', approvedAt: 'x' });
    const { getByText, getAllByText, getByLabelText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
    await waitFor(() => getByText('Awaiting an admin\'s approval · not counted yet'));
    fireEvent.press(getByLabelText('Card actions'));
    fireEvent.press(getByText('Approve card'));
    expect(getByText('Javi’s 30 pts at La Moraleja will count for October.')).toBeTruthy();
    fireEvent.press(lastOf(getAllByText('Approve card')));
    await waitFor(() => expect(store.approveLeagueCard).toHaveBeenCalledWith('c-javi'));
  });

  test('the owner of an off-app announced card changes the tee time; not once it has passed', async () => {
    openMonth();
    const future = new Date(Date.now() + 5 * 3600000).toISOString();
    store.getLeague.mockResolvedValue(snapshot([
      card('me', 'announced', null, { holes: null, source: 'offapp', teeTime: future, postBy: new Date(Date.now() + 10 * 3600000).toISOString() }),
    ]));
    store.rescheduleLeagueCard.mockResolvedValue({ id: 'c-me', teeTime: future, postBy: future });
    const { getByText, getAllByText, getByLabelText, unmount } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('me')} />));
    await waitFor(() => getByLabelText('Card actions'));
    fireEvent.press(getByLabelText('Card actions'));
    // The item states its deadline and what is left.
    expect(getByText(/^Until .*, to a time at least 2 h away · 2 changes left$/)).toBeTruthy();
    fireEvent.press(getByText('Change tee time'));
    expect(getByText(/^New post-by \d\d:\d\d (today|tomorrow)$/)).toBeTruthy();
    fireEvent.press(lastOf(getAllByText('Change tee time')));
    await waitFor(() => expect(store.rescheduleLeagueCard).toHaveBeenCalledWith('c-me', expect.any(String)));
    unmount();

    store.getLeague.mockResolvedValue(snapshot([
      card('me', 'announced', null, { holes: null, source: 'offapp', teeTime: new Date(Date.now() - 3600000).toISOString(), postBy: new Date(Date.now() + 5 * 3600000).toISOString() }),
    ]));
    const past = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('me')} />));
    await waitFor(() => past.getByLabelText('Card actions'));
    fireEvent.press(past.getByLabelText('Card actions'));
    // Disabled, and it says why.
    expect(past.getByText('Not after the tee time has passed')).toBeTruthy();
    expect(past.getByLabelText(/^Change tee time\. Not after/).props.accessibilityState.disabled).toBe(true);
    expect(past.getByText(/^Your tee time passed at \d\d:\d\d\. Ask an admin to void it\.$/)).toBeTruthy();
  });

  describe('withdraw', () => {
    const future = () => new Date(Date.now() + 5 * 3600000).toISOString();
    const mine = (extra = {}) => card('me', 'announced', null, {
      holes: null, source: 'offapp', teeTime: future(), postBy: new Date(Date.now() + 14 * 3600000).toISOString(), monthKey: MONTH, ...extra,
    });

    test('states the consequence, withdraws, and the card then shows Withdrawn with Announce another', async () => {
      openMonth();
      const c = mine();
      store.getLeague.mockResolvedValueOnce(snapshot([c]));
      store.withdrawLeagueCard.mockResolvedValue({ id: c.id, status: 'void', voidKind: 'withdrawn' });
      const after = snapshot([]);
      after.cards = [{ ...c, status: 'void', voidKind: 'withdrawn' }];
      store.getLeague.mockResolvedValue(after);
      const nav = makeNav();
      const { getByText, getAllByText, getByLabelText, queryByLabelText } = render(wrap(<LeagueCardScreen navigation={nav} route={route('me')} />));
      await waitFor(() => getByLabelText('Card actions'));
      fireEvent.press(getByLabelText('Card actions'));
      fireEvent.press(getByText('Withdraw card'));
      expect(getByText('Withdraw your October card?')).toBeTruthy();
      expect(getByText('October is free again.')).toBeTruthy();
      expect(getByText(/^Every member is told you withdrew\./)).toBeTruthy();
      fireEvent.press(lastOf(getAllByText('Withdraw card')));
      await waitFor(() => expect(store.withdrawLeagueCard).toHaveBeenCalledWith(c.id));
      await waitFor(() => getByText('Announce another card'));
      expect(getByText('Card withdrawn. Members told.')).toBeTruthy();
      expect(getByText('You withdrew this card. October is free again.')).toBeTruthy();
      expect(queryByLabelText('Card actions')).toBeNull();
      fireEvent.press(getByText('Announce another card'));
      expect(nav.navigate).toHaveBeenCalledWith('LeagueBoard', { leagueId: 'L1' });
    });

    test('an app card says when it is withdrawn on its own; round_started explains itself', async () => {
      openMonth();
      const c = mine({
        source: 'app', teeTime: null, postBy: null, firstShotAt: null, announcedAt: new Date().toISOString(), status: 'playing',
      });
      store.getLeague.mockResolvedValue(snapshot([c]));
      const err = Object.assign(new Error('raw server text'), { hint: 'round_started' });
      store.withdrawLeagueCard.mockRejectedValue(err);
      const { getByText, getAllByText, getByLabelText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('me')} />));
      await waitFor(() => getByLabelText('Card actions'));
      fireEvent.press(getByLabelText('Card actions'));
      fireEvent.press(getByText('Withdraw card'));
      expect(getByText(/^Left alone, an unplayed card is withdrawn automatically at /)).toBeTruthy();
      expect(getByText(/^You can withdraw until your first shot\./)).toBeTruthy();
      fireEvent.press(lastOf(getAllByText('Withdraw card')));
      await waitFor(() => getByText("You've already scored holes in this round, so it can't be withdrawn. Ask an admin to void it."));
    });

    test('is disabled with its reason once the first shot is in', async () => {
      openMonth();
      const c = mine({
        source: 'app', teeTime: null, firstShotAt: new Date().toISOString(), status: 'playing',
      });
      store.getLeague.mockResolvedValue(snapshot([c]));
      const { getByText, getByLabelText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('me')} />));
      await waitFor(() => getByLabelText('Card actions'));
      fireEvent.press(getByLabelText('Card actions'));
      expect(getByText("You've already started this round. Ask an admin to void it.")).toBeTruthy();
    });
  });

  describe('void (admin)', () => {
    test('reason chips, an optional note, the consequence, and the reason text sent', async () => {
      openMonth();
      store.getLeague.mockResolvedValueOnce(snapshot([card('javi', 'confirmed', 41, { gross: 87 })]));
      store.voidLeagueCard.mockResolvedValue(undefined);
      const after = snapshot([]);
      after.cards = [{ ...card('javi', 'void', 41, { holes: null }), monthKey: MONTH, voidKind: 'admin', voidedReason: 'Wrong tee: sheet says yellow' }];
      store.getLeague.mockResolvedValue(after);
      const { getByText, getAllByText, getByLabelText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
      await waitFor(() => getByLabelText('Card actions'));
      fireEvent.press(getByLabelText('Card actions'));
      expect(getByText('With a reason every member sees')).toBeTruthy();
      expect(getByText('Only for a card that wasn’t posted in time')).toBeTruthy();
      fireEvent.press(getByText('Void card'));
      expect(getByText('Void Javi’s card?')).toBeTruthy();
      expect(getByText('Javi’s 41 pts at Golf Olivar stop counting for October.')).toBeTruthy();
      expect(getByText('The board and the season table update straight away. Javi can’t play another October card.')).toBeTruthy();
      ['Wrong tee', "Score doesn't match", 'Not 18 holes', 'Not confirmed properly', 'Other'].forEach((r) => expect(getByText(r)).toBeTruthy());
      fireEvent.press(getByText("Score doesn't match"));
      fireEvent.changeText(getByLabelText('Note for the members (optional)'), 'Hole 13 is a 6');
      fireEvent.press(lastOf(getAllByText('Void card')));
      await waitFor(() => expect(store.voidLeagueCard).toHaveBeenCalledWith('c-javi', "Score doesn't match: Hole 13 is a 6"));
      // The voided card stays on screen, marked, with the reason.
      await waitFor(() => getByText('Voided by an admin: Wrong tee. October stays used.'));
      expect(getByText('Card voided. Members told.')).toBeTruthy();
      expect(getByText('not counted')).toBeTruthy();
    });

    test('the server refusal shows in the sheet', async () => {
      openMonth();
      store.getLeague.mockResolvedValue(snapshot([card('javi', 'confirmed', 41)]));
      store.voidLeagueCard.mockRejectedValue(Object.assign(new Error('x'), { hint: 'already_void' }));
      const { getByText, getAllByText, getByLabelText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
      await waitFor(() => getByLabelText('Card actions'));
      fireEvent.press(getByLabelText('Card actions'));
      fireEvent.press(getByText('Void card'));
      fireEvent.press(lastOf(getAllByText('Void card')));
      await waitFor(() => getByText('This card was already voided. Open it again to see it as it is now.'));
    });
  });

  describe('timeline', () => {
    const e = (id, kind, extra = {}) => ({
      id, cardId: 'c-javi', kind, actorUserId: null, actorName: null, how: null, note: null, data: {}, at: `2026-10-1${id}T10:00:00Z`, ...extra,
    });

    test('shows the last three events with the who-and-how chip, and Show all reveals the rest', async () => {
      store.getLeague.mockResolvedValue(snapshot([card('javi', 'confirmed', 38)]));
      store.getLeagueCardEvents.mockResolvedValue([
        e(1, 'announced', { data: { source: 'app', course_name: 'Golf Olivar' } }),
        e(2, 'first_shot'),
        e(3, 'submitted', { data: { points: 38 } }),
        e(4, 'returned', { actorName: 'Borja Arrieta', how: 'marker_request', note: 'Hole 13 was a 6.' }),
        e(5, 'confirmed', { actorName: 'Borja Arrieta', how: 'qr', data: { marker_account: false } }),
      ]);
      const { getByText, queryByText, getByLabelText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
      await waitFor(() => getByText('Confirmed by Borja Arrieta via QR (no account)'));
      expect(getByText('QR')).toBeTruthy();
      expect(getByText('Returned by Borja Arrieta')).toBeTruthy();
      expect(getByText('“Hole 13 was a 6.”')).toBeTruthy();
      expect(getByText('Submitted · 38 pts')).toBeTruthy();
      expect(queryByText('Announced with the app')).toBeNull();
      fireEvent.press(getByText('Show all 5 events'));
      expect(getByText('Announced with the app')).toBeTruthy();
      expect(getByText('First shot')).toBeTruthy();
      expect(getByLabelText(/^Confirmed by Borja Arrieta via QR \(no account\), QR,/)).toBeTruthy();
      fireEvent.press(getByText('Show fewer'));
      expect(queryByText('Announced with the app')).toBeNull();
    });

    test('has a loading skeleton and an error with Try again', async () => {
      store.getLeague.mockResolvedValue(snapshot([card('javi', 'confirmed', 38)]));
      let reject;
      store.getLeagueCardEvents.mockReturnValueOnce(new Promise((_, rej) => { reject = rej; }));
      const { getByText, getByTestId, queryByTestId } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
      await waitFor(() => getByText('Javi · October card'));
      expect(getByTestId('timeline-skeleton')).toBeTruthy();
      store.getLeagueCardEvents.mockResolvedValueOnce([e(1, 'submitted', { data: { points: 38 } })]);
      await act(async () => { reject(new Error('offline')); });
      await waitFor(() => getByText("Couldn't load the timeline"));
      expect(queryByTestId('timeline-skeleton')).toBeNull();
      fireEvent.press(getByText('Try again'));
      await waitFor(() => getByText('Submitted · 38 pts'));
    });
  });

  test('the card screen reads in Spanish', async () => {
    await setLanguagePref('es');
    store.getLeague.mockResolvedValue(snapshot([card('javi', 'confirmed', 41)]));
    store.getLeagueCardEvents.mockResolvedValue([
      { id: 1, cardId: 'c-javi', kind: 'withdrawn', actorUserId: 'me', actorName: 'Marcos', how: null, note: null, data: {}, at: '2026-10-13T10:00:00Z' },
    ]);
    const { getByText, getByLabelText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
    await waitFor(() => getByLabelText('Acciones de la tarjeta'));
    expect(getByText('Cronología')).toBeTruthy();
    await waitFor(() => getByText('Retirada por ti'));
    fireEvent.press(getByLabelText('Acciones de la tarjeta'));
    expect(getByText('Anular la tarjeta')).toBeTruthy();
  });

  test('a card that is not found shows a friendly empty state', async () => {
    store.getLeague.mockResolvedValue(snapshot([card('javi', 'void', null, { holes: null })]));
    const { getByText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
    await waitFor(() => getByText('No card to show'));
  });
});

describe('LeagueCardScreen in Spanish', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockMe = 'me';
    store.getLeagueCached.mockResolvedValue(null);
    store.getLeagueCardEvents.mockResolvedValue([]);
    await act(async () => { await setLanguagePref('es'); });
  });
  afterEach(async () => { await act(async () => { await setLanguagePref('en'); }); });

  test('title, pager, strip and differential read in Spanish, with comma decimals', async () => {
    store.getLeague.mockResolvedValue(snapshot([card('javi', 'confirmed', 38), card('nacho', 'submitted', 30)]));
    const { getByText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
    await waitFor(() => getByText('Javi · tarjeta de octubre'));
    expect(getByText('1 de 2 tarjetas de liga de octubre')).toBeTruthy();
    expect(getByText('Hándicap de juego 18 · Bruto 90')).toBeTruthy();
    expect(getByText('1.º')).toBeTruthy();
    expect(getByText('de 1 tarjeta')).toBeTruthy();
    expect(getByText('2,4 mejor que el hándicap de liga 18,0. Se guarda como referencia; la clasificación usa puntos.')).toBeTruthy();
  });

  test('my own card is titled "Tú", and the floor reads "puntos por jugar"', async () => {
    const snap = snapshot([
      card('javi', 'confirmed', 40), card('nacho', 'confirmed', 38), card('x', 'confirmed', 36),
      card('me', 'confirmed', 20),
    ]);
    snap.league = { id: 'L1', name: 'El Club', pointsTable: [500, 300, 190], participationPoints: 10 };
    snap.members.push(member('x', 'Xavi'));
    store.getLeague.mockResolvedValue(snap);
    const { getByText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('me')} />));
    await waitFor(() => getByText('Tú · tarjeta de octubre'));
    expect(getByText('4.º')).toBeTruthy();
    expect(getByText('+10')).toBeTruthy();
    expect(getByText('puntos por jugar')).toBeTruthy();
  });
});
