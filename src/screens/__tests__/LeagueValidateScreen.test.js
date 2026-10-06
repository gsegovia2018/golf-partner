import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import LeagueValidateScreen, { PARTNER_REASONS } from '../LeagueValidateScreen';

// After Finish on a league round (plan §4.3 Validate, P6): my card read-only
// in the scorecard grid, Submit, then the partner check or the fallbacks.

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

jest.mock('../../store/tournamentRepo', () => ({ fetchTournament: jest.fn() }));
jest.mock('../../store/tournamentStore', () => ({
  ...jest.requireActual('../../store/tournamentStore'),
  readLocal: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('../../store/leagueStore', () => ({
  submitLeagueCard: jest.fn(() => Promise.resolve({ id: 'card-1', status: 'submitted' })),
  confirmLeagueCardByPartner: jest.fn(),
}));

const repo = require('../../store/tournamentRepo');
const store = require('../../store/leagueStore');

const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
const fives = Object.fromEntries(holes.map((h) => [h.number, 5]));

function tournament(scores = fives) {
  return {
    id: 't1',
    kind: 'game',
    league: { leagueId: 'L1', cardId: 'card-1', playerId: 'p1' },
    players: [
      { id: 'p1', name: 'Marcos', handicap: 4, user_id: 'user-1' },
      { id: 'p2', name: 'Javi', handicap: 12, user_id: 'user-2' },
    ],
    rounds: [{
      id: 't1-r0',
      courseName: 'Centro Nacional',
      holes,
      playerTees: { p1: { label: 'Yellow', slope: 125, rating: 72 } },
      playerIndexes: { p1: 18 },
      playerHandicaps: { p1: 20, p2: 13 },
      scores: { p1: scores, p2: fives },
    }],
  };
}

const unratedTournament = () => {
  const t = tournament();
  t.rounds[0].playerTees = { p1: { label: 'Red', slope: null, rating: null } };
  return t;
};

const route = { params: { leagueId: 'L1', cardId: 'card-1', tournamentId: 't1', roundId: 't1-r0' } };
const makeNav = () => ({ replace: jest.fn(), navigate: jest.fn() });
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('LeagueValidateScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repo.fetchTournament.mockResolvedValue(tournament());
  });

  test('confirmed: submits the frozen card, names the partner, Done goes to the board', async () => {
    store.confirmLeagueCardByPartner.mockResolvedValue({
      confirmed: true, settled: 18, partnerName: 'Javi', partnerUserId: 'user-2',
    });
    const navigation = makeNav();
    const { findByText, getByText, queryByText } = render(wrap(
      <LeagueValidateScreen navigation={navigation} route={route} />,
    ));
    fireEvent.press(await findByText('Submit card'));

    expect(await findByText('Javi confirmed 18 of 18 holes in the app')).toBeTruthy();
    // 18.0 on Yellow 125/72 = 20 strokes: 5s everywhere are net pars (2 pts)
    // plus net birdies on SI 1-2.
    expect(store.submitLeagueCard).toHaveBeenCalledWith({
      cardId: 'card-1',
      holes: Object.fromEntries(holes.map((h) => [String(h.number), 5])),
      gross: 90,
      points: 38,
      playingHandicap: 20,
      playedOn: null,
    });
    expect(store.confirmLeagueCardByPartner).toHaveBeenCalledWith('card-1');
    expect(queryByText('MARKER NOT IN THE APP?')).toBeNull();

    fireEvent.press(getByText('Done'));
    expect(navigation.replace).toHaveBeenCalledWith('LeagueBoard', { leagueId: 'L1' });
  });

  test('confirmed: a result card speaks the net differential and links to how it is worked out', async () => {
    store.confirmLeagueCardByPartner.mockResolvedValue({
      confirmed: true, settled: 18, partnerName: 'Javi', partnerUserId: 'user-2',
    });
    const navigation = makeNav();
    const { findByText, getByText } = render(wrap(<LeagueValidateScreen navigation={navigation} route={route} />));
    fireEvent.press(await findByText('Submit card'));
    // Yellow 125 / CR 72, league handicap 18: all 5s on par 4, playing handicap 20 -> cap 7, nothing capped.
    // differential = 113 / 125 x (90 - 72) = 16.3; net = 16.3 - 18 = -1.7.
    expect(await findByText('1.7 better')).toBeTruthy();
    expect(getByText('than your league handicap 18.0')).toBeTruthy();
    expect(getByText('Net −1.7 · differential 16.3 · 38 pts · gross 90 (adjusted 90)')).toBeTruthy();
    fireEvent.press(getByText("How it's worked out ›"));
    expect(navigation.navigate).toHaveBeenCalledWith('LeagueCard', expect.objectContaining({ leagueId: 'L1', userId: 'user-1' }));
  });

  test('an unrated tee says so and blocks Submit', async () => {
    repo.fetchTournament.mockResolvedValue(unratedTournament());
    const { findByText, getByText } = render(wrap(<LeagueValidateScreen navigation={makeNav()} route={route} />));
    expect(await findByText("This tee isn't rated")).toBeTruthy();
    expect(getByText(/can't count for the league/)).toBeTruthy();
    fireEvent.press(getByText('Submit card'));
    expect(store.submitLeagueCard).not.toHaveBeenCalled();
  });

  test('the grid totals match the submitted card', async () => {
    const { findByText, getByText } = render(wrap(
      <LeagueValidateScreen navigation={makeNav()} route={route} />,
    ));
    await findByText('Submit card');
    expect(getByText('90')).toBeTruthy();
    expect(getByText('38')).toBeTruthy();
  });

  test('no partner: the reason in plain words and the three fallbacks, each wired', async () => {
    store.confirmLeagueCardByPartner.mockResolvedValue({ confirmed: false, reason: 'no_partner', settled: 18, marked: 0 });
    const navigation = makeNav();
    const { findByText, getByText, queryByText } = render(wrap(
      <LeagueValidateScreen navigation={navigation} route={route} />,
    ));
    fireEvent.press(await findByText('Submit card'));

    expect(await findByText(PARTNER_REASONS.no_partner)).toBeTruthy();
    expect(queryByText(/coming soon/)).toBeNull();

    // LeagueMarkerQRScreen reads { cardId, leagueId }.
    fireEvent.press(getByText('Show QR to your marker'));
    expect(navigation.navigate).toHaveBeenLastCalledWith('LeagueMarkerQR', { leagueId: 'L1', cardId: 'card-1' });

    // LeagueAddProofScreen's app-card mode: upload + attach only.
    fireEvent.press(getByText('Upload signed paper card'));
    expect(navigation.navigate).toHaveBeenLastCalledWith('LeagueAddProof', {
      leagueId: 'L1', cardId: 'card-1', source: 'app', kind: 'photo',
    });
    fireEvent.press(getByText('Official tournament result'));
    expect(navigation.navigate).toHaveBeenLastCalledWith('LeagueAddProof', {
      leagueId: 'L1', cardId: 'card-1', source: 'app', kind: 'official',
    });
  });

  test('reopened for a submitted card: no resubmit, straight to the partner check and fallbacks', async () => {
    store.confirmLeagueCardByPartner.mockResolvedValue({ confirmed: false, reason: 'no_partner', settled: 18 });
    const navigation = makeNav();
    const { findByText, getByText, queryByText } = render(wrap(
      <LeagueValidateScreen navigation={navigation} route={{ params: { ...route.params, submitted: true } }} />,
    ));
    expect(await findByText(PARTNER_REASONS.no_partner)).toBeTruthy();
    expect(store.confirmLeagueCardByPartner).toHaveBeenCalledWith('card-1');
    expect(store.submitLeagueCard).not.toHaveBeenCalled();
    expect(queryByText('Submit card')).toBeNull();
    expect(getByText('Show QR to your marker')).toBeTruthy();
    expect(getByText('Back to the league')).toBeTruthy();
  });

  test('reopened for a submitted card that the partner has since marked: confirmed', async () => {
    store.confirmLeagueCardByPartner.mockResolvedValue({ confirmed: true, settled: 18, partnerName: 'Javi' });
    const { findByText } = render(wrap(
      <LeagueValidateScreen navigation={makeNav()} route={{ params: { ...route.params, submitted: true } }} />,
    ));
    expect(await findByText('Javi confirmed 18 of 18 holes in the app')).toBeTruthy();
    expect(store.submitLeagueCard).not.toHaveBeenCalled();
  });

  test('reopened offline: the check error shows and "Check with my partner" retries it', async () => {
    store.confirmLeagueCardByPartner
      .mockRejectedValueOnce(new Error('You need a connection to do this.'))
      .mockResolvedValueOnce({ confirmed: false, reason: 'no_partner', settled: 18 });
    const { findByText, getByText } = render(wrap(
      <LeagueValidateScreen navigation={makeNav()} route={{ params: { ...route.params, submitted: true } }} />,
    ));
    expect(await findByText('You need a connection to do this.')).toBeTruthy();
    fireEvent.press(getByText('Check with my partner'));
    expect(await findByText(PARTNER_REASONS.no_partner)).toBeTruthy();
    expect(store.confirmLeagueCardByPartner).toHaveBeenCalledTimes(2);
    expect(store.submitLeagueCard).not.toHaveBeenCalled();
  });

  test('reopened, then "Check again" after a changed snapshot goes back to Submit', async () => {
    store.confirmLeagueCardByPartner.mockResolvedValue({ confirmed: false, reason: 'snapshot_mismatch', settled: 18 });
    const { findByText } = render(wrap(
      <LeagueValidateScreen navigation={makeNav()} route={{ params: { ...route.params, submitted: true } }} />,
    ));
    fireEvent.press(await findByText('Check again'));
    fireEvent.press(await findByText('Submit card'));
    await waitFor(() => expect(store.submitLeagueCard).toHaveBeenCalledTimes(1));
  });

  test('a hole without a score blocks Submit', async () => {
    const { [12]: _gone, ...partial } = fives;
    repo.fetchTournament.mockResolvedValue(tournament(partial));
    const { findByText, getByText } = render(wrap(
      <LeagueValidateScreen navigation={makeNav()} route={route} />,
    ));
    expect(await findByText(/Missing: 12\./)).toBeTruthy();
    fireEvent.press(getByText('Submit card'));
    await waitFor(() => expect(store.submitLeagueCard).not.toHaveBeenCalled());
  });

  test('a submit refusal shows the server message', async () => {
    store.submitLeagueCard.mockRejectedValueOnce(new Error('This card can no longer be changed.'));
    const { findByText } = render(wrap(
      <LeagueValidateScreen navigation={makeNav()} route={route} />,
    ));
    fireEvent.press(await findByText('Submit card'));
    expect(await findByText('This card can no longer be changed.')).toBeTruthy();
    expect(store.confirmLeagueCardByPartner).not.toHaveBeenCalled();
  });
});
