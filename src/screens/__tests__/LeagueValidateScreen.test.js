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

const route = { params: { leagueId: 'L1', cardId: 'card-1', tournamentId: 't1', roundId: 't1-r0' } };
const makeNav = (routeNames = ['LeagueBoard']) => ({
  replace: jest.fn(), navigate: jest.fn(), getState: () => ({ routeNames }),
});
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

  test('the grid totals match the submitted card', async () => {
    const { findByText, getByText } = render(wrap(
      <LeagueValidateScreen navigation={makeNav()} route={route} />,
    ));
    await findByText('Submit card');
    expect(getByText('90')).toBeTruthy();
    expect(getByText('38')).toBeTruthy();
  });

  test('no partner: the reason in plain words and the fallbacks', async () => {
    store.confirmLeagueCardByPartner.mockResolvedValue({ confirmed: false, reason: 'no_partner', settled: 18, marked: 0 });
    const navigation = makeNav(['LeagueBoard', 'LeagueMarkerQR']);
    const { findByText, getByText } = render(wrap(
      <LeagueValidateScreen navigation={navigation} route={route} />,
    ));
    fireEvent.press(await findByText('Submit card'));

    expect(await findByText(PARTNER_REASONS.no_partner)).toBeTruthy();
    expect(getByText('Upload signed paper card')).toBeTruthy();
    expect(getByText('Official tournament result')).toBeTruthy();

    fireEvent.press(getByText('Show QR to your marker'));
    expect(navigation.navigate).toHaveBeenCalledWith('LeagueMarkerQR', { leagueId: 'L1', cardId: 'card-1' });

    // P8's proof route is not registered yet: the row is there but inert.
    fireEvent.press(getByText('Upload signed paper card'));
    expect(navigation.navigate).toHaveBeenCalledTimes(1);
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
