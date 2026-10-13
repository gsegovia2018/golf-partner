import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
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
}));

const store = require('../../store/leagueStore');

const MONTH = '2025-10';
// The DB snapshot shape ({ n, par, si }), not the scorecard's.
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const strokes = Object.fromEntries(holes.map((h) => [String(h.n), 5]));
const member = (userId, displayName, role = 'member') => ({ userId, displayName, role, leftAt: null, leagueHandicap: 18 });
const card = (userId, status, points, extra = {}) => ({
  id: `c-${userId}`, userId, status, points, source: 'app', notAnnounced: false, holes: strokes,
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
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('LeagueCardScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMe = 'me';
    store.getLeagueCached.mockResolvedValue(null);
  });

  test('shows the summary and the read-only grid, and flicks between cards', async () => {
    store.getLeague.mockResolvedValue(snapshot([
      card('javi', 'confirmed', 38, { confirmedByName: 'Nacho' }),
      card('nacho', 'submitted', 30),
    ]));
    const { getByText, getAllByText, getByLabelText, queryByText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
    await waitFor(() => getByText('Javi · October card'));
    expect(getByText('1 of 2 October cards')).toBeTruthy();
    expect(getByText('Confirmed')).toBeTruthy();
    expect(getByText('Golf Olivar · Yellow tees, slope 125 · CR 72')).toBeTruthy();
    expect(getByText('Playing handicap 18 · Gross 90 · 38 pts')).toBeTruthy();
    expect(getByText('Confirmed by Nacho')).toBeTruthy();
    // The value is spoken, with the handicap it is measured against.
    expect(getByText('2.4 better')).toBeTruthy();
    expect(getByText('than league handicap 18.0')).toBeTruthy();
    // The grid reads the real DB hole shape: numbers and strokes render.
    expect(getAllByText('18').length).toBeGreaterThan(0);
    expect(getAllByText('5').length).toBeGreaterThan(0);
    expect(queryByText('You')).toBeNull();
    expect(getByLabelText('Previous card').props.accessibilityState.disabled).toBe(true);

    fireEvent.press(getByLabelText('Next card'));
    expect(getByText('Nacho · October card')).toBeTruthy();
    expect(getByText('2 of 2 October cards')).toBeTruthy();
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

  test('"How it\'s worked out" shows the arithmetic and names the capped hole', async () => {
    // 18 par-4 holes, playing handicap 18 (1 extra shot each): the cap is 7. Hole 12 is a 9.
    const cappedHoles = { ...strokes, 12: 9 };
    store.getLeague.mockResolvedValue(snapshot([
      card('javi', 'confirmed', 36, { holes: cappedHoles, gross: 94, differential: 11.8, netDifferential: -6.2 }),
    ]));
    const { getByText, getAllByLabelText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
    await waitFor(() => getByText('HOW IT’S WORKED OUT'));
    expect(getByText('Hole 12: 9 counts as 7 (net double bogey)')).toBeTruthy();
    expect(getByText('113 ÷ slope 125 × (92 − rating 72)')).toBeTruthy();
    expect(getByText('11.8 − 18.0 · lower is better')).toBeTruthy();
    expect(getByText('−6.2')).toBeTruthy();
    expect(getAllByLabelText(/^Hole 12, 9 strokes, \d points, counts as 7$/).length).toBe(1);
  });

  test('an unrated card says so and is not ranked', async () => {
    store.getLeague.mockResolvedValue(snapshot([
      card('javi', 'confirmed', 30, {
        differential: null, netDifferential: null, course: { name: 'Golf Olivar', tee: 'Red', holes },
      }),
    ]));
    const { getByText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
    await waitFor(() => getByText('Unrated'));
    expect(getByText('not ranked')).toBeTruthy();
    expect(getByText("This tee has no slope and course rating, so there's no differential.")).toBeTruthy();
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
    store.getLeague.mockResolvedValue(snapshot([card('javi', 'missed', null, { holes: null })]));
    store.reopenLeagueCard.mockResolvedValue({ id: 'c-javi', status: 'announced', postBy: null });
    const { getByText, getAllByText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
    await waitFor(() => getByText("Not posted — this month's card is used."));
    fireEvent.press(getByText('Reopen card'));
    expect(getByText("Reopen Javi's card?")).toBeTruthy();
    expect(getByText(/^Javi gets 8 more hours, until \d\d:\d\d (today|tomorrow)\.$/)).toBeTruthy();
    fireEvent.press(getAllByText('Reopen card')[1]);
    await waitFor(() => expect(store.reopenLeagueCard).toHaveBeenCalledWith('c-javi'));
    await waitFor(() => expect(store.getLeague).toHaveBeenCalledTimes(2));
  });

  test('a server refusal shows inside the sheet and the sheet stays open', async () => {
    store.getLeague.mockResolvedValue(snapshot([card('javi', 'missed', null, { holes: null })]));
    store.reopenLeagueCard.mockRejectedValue(new Error('Only an admin can reopen a card.'));
    const { getByText, getAllByText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
    await waitFor(() => getByText('Reopen card'));
    fireEvent.press(getByText('Reopen card'));
    fireEvent.press(getAllByText('Reopen card')[1]);
    await waitFor(() => getByText('Only an admin can reopen a card.'));
    expect(getByText("Reopen Javi's card?")).toBeTruthy();
  });

  test('a member sees no reopen or approve; an admin sees none on their own card', async () => {
    store.getLeague.mockResolvedValue(snapshot([
      card('javi', 'missed', null, { holes: null }),
      card('nacho', 'submitted', 30, { source: 'offapp', notAnnounced: true }),
      card('me', 'missed', null, { holes: null }),
    ]));
    mockMe = 'nacho';
    const asMember = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
    await waitFor(() => asMember.getByText('Javi · October card'));
    expect(asMember.queryByText('Reopen card')).toBeNull();
    asMember.unmount();

    mockMe = 'me';
    const own = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('me')} />));
    await waitFor(() => own.getByText('You · October card'));
    expect(own.queryByText('Reopen card')).toBeNull();
    own.unmount();

    const other = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('nacho')} />));
    await waitFor(() => other.getByText('Approve card'));
  });

  test('an admin approves an unannounced card after the sheet states what counts', async () => {
    store.getLeague.mockResolvedValue(snapshot([
      card('javi', 'submitted', 30, { source: 'offapp', notAnnounced: true, gross: 71, course: { name: 'La Moraleja', tee: 'Yellow', slope: 125, rating: 72, holes } }),
    ]));
    store.approveLeagueCard.mockResolvedValue({ id: 'c-javi', approvedAt: 'x' });
    const { getByText, getAllByText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
    await waitFor(() => getByText('Awaiting an admin\'s approval · not counted yet'));
    fireEvent.press(getByText('Approve card'));
    expect(getByText("Javi's 71 at La Moraleja will count for October.")).toBeTruthy();
    fireEvent.press(getAllByText('Approve card')[1]);
    await waitFor(() => expect(store.approveLeagueCard).toHaveBeenCalledWith('c-javi'));
  });

  test('the owner of an off-app announced card changes the tee time; not once it has passed', async () => {
    const future = new Date(Date.now() + 2 * 3600000).toISOString();
    store.getLeague.mockResolvedValue(snapshot([
      card('me', 'announced', null, { holes: null, source: 'offapp', teeTime: future, postBy: new Date(Date.now() + 10 * 3600000).toISOString() }),
    ]));
    store.rescheduleLeagueCard.mockResolvedValue({ id: 'c-me', teeTime: future, postBy: future });
    const { getByText, getAllByText, unmount } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('me')} />));
    await waitFor(() => getByText('Change tee time'));
    fireEvent.press(getByText('Change tee time'));
    expect(getByText(/^New post-by \d\d:\d\d (today|tomorrow)$/)).toBeTruthy();
    const confirmBtns = getAllByText('Change tee time');
    fireEvent.press(confirmBtns[confirmBtns.length - 1]);
    await waitFor(() => expect(store.rescheduleLeagueCard).toHaveBeenCalledWith('c-me', expect.any(String)));
    unmount();

    store.getLeague.mockResolvedValue(snapshot([
      card('me', 'announced', null, { holes: null, source: 'offapp', teeTime: new Date(Date.now() - 3600000).toISOString(), postBy: new Date(Date.now() + 5 * 3600000).toISOString() }),
    ]));
    const past = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('me')} />));
    await waitFor(() => past.getByText('You · October card'));
    expect(past.queryByText('Change tee time')).toBeNull();
  });

  test('a card that is not found shows a friendly empty state', async () => {
    store.getLeague.mockResolvedValue(snapshot([card('javi', 'void', null, { holes: null })]));
    const { getByText } = render(wrap(<LeagueCardScreen navigation={makeNav()} route={route('javi')} />));
    await waitFor(() => getByText('No card to show'));
  });
});
