import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import LeagueValidateScreen, { PARTNER_REASONS } from '../LeagueValidateScreen';
import { t as translate } from '../../i18n';

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
  getLeagueMarkerCandidates: jest.fn(),
  requestLeagueMarker: jest.fn(),
  remindLeagueMarker: jest.fn(),
  cancelLeagueMarkerRequest: jest.fn(),
  getLeagueCard: jest.fn(() => Promise.resolve(null)),
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
    store.getLeagueMarkerCandidates.mockResolvedValue({ pending: null, candidates: [] });
    store.requestLeagueMarker.mockResolvedValue({ markerUserId: 'user-2', markerName: 'Javi Ortega', expiresAt: '2026-10-19T10:00:00Z' });
    store.remindLeagueMarker.mockResolvedValue({ remindedAt: '2026-10-13T10:00:00Z' });
    store.cancelLeagueMarkerRequest.mockResolvedValue(undefined);
    store.getLeagueCard.mockResolvedValue(null);
    store.submitLeagueCard.mockResolvedValue({ id: 'card-1', status: 'submitted' });
  });

  test('confirmed: submits the frozen card, names the partner, Done goes to the board', async () => {
    store.confirmLeagueCardByPartner.mockResolvedValue({
      confirmed: true, settled: 18, partnerName: 'Javi', partnerUserId: 'user-2',
    });
    const navigation = makeNav();
    const { findByText, getByText, queryByText } = render(wrap(
      <LeagueValidateScreen navigation={navigation} route={route} />,
    ));
    fireEvent.press(await findByText('Submit'));

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

  test('confirmed: a result card leads with the Stableford points and links to the card', async () => {
    store.confirmLeagueCardByPartner.mockResolvedValue({
      confirmed: true, settled: 18, partnerName: 'Javi', partnerUserId: 'user-2',
    });
    const navigation = makeNav();
    const { findByText, getByText, queryByText } = render(wrap(<LeagueValidateScreen navigation={navigation} route={route} />));
    fireEvent.press(await findByText('Submit'));
    // Yellow 125 / CR 72, league handicap 18: all 5s on par 4, playing handicap 20 -> cap 7, nothing capped.
    // differential = 113 / 125 x (90 - 72) = 16.3; net = 16.3 - 18 = -1.7.
    expect(await findByText('38')).toBeTruthy();
    expect(getByText('Stableford pts')).toBeTruthy();
    expect(getByText('Gross 90 (adjusted 90) · net differential −1.7, for reference')).toBeTruthy();
    expect(queryByText(/better|worse/)).toBeNull();
    fireEvent.press(getByText("How it's worked out ›"));
    expect(navigation.navigate).toHaveBeenCalledWith('LeagueCard', expect.objectContaining({ leagueId: 'L1', userId: 'user-1' }));
  });

  test('an unrated tee says so and blocks Submit', async () => {
    repo.fetchTournament.mockResolvedValue(unratedTournament());
    const { findByText, getByText } = render(wrap(<LeagueValidateScreen navigation={makeNav()} route={route} />));
    expect(await findByText("This tee isn't rated")).toBeTruthy();
    expect(getByText(/can't count for the league/)).toBeTruthy();
    fireEvent.press(getByText('Submit'));
    expect(store.submitLeagueCard).not.toHaveBeenCalled();
  });

  test('the grid totals match the submitted card', async () => {
    const { findByText, getByText } = render(wrap(
      <LeagueValidateScreen navigation={makeNav()} route={route} />,
    ));
    await findByText('Submit');
    expect(getByText('90')).toBeTruthy();
    expect(getByText('38')).toBeTruthy();
  });

  test('no partner: the reason in plain words and the three fallbacks, each wired', async () => {
    store.confirmLeagueCardByPartner.mockResolvedValue({ confirmed: false, reason: 'no_partner', settled: 18, marked: 0 });
    const navigation = makeNav();
    const { findByText, getByText, queryByText } = render(wrap(
      <LeagueValidateScreen navigation={navigation} route={route} />,
    ));
    fireEvent.press(await findByText('Submit'));

    expect(await findByText(translate(PARTNER_REASONS.no_partner))).toBeTruthy();
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
    expect(await findByText(translate(PARTNER_REASONS.no_partner))).toBeTruthy();
    expect(store.confirmLeagueCardByPartner).toHaveBeenCalledWith('card-1');
    expect(store.submitLeagueCard).not.toHaveBeenCalled();
    expect(queryByText('Submit')).toBeNull();
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
    expect(await findByText(translate(PARTNER_REASONS.no_partner))).toBeTruthy();
    expect(store.confirmLeagueCardByPartner).toHaveBeenCalledTimes(2);
    expect(store.submitLeagueCard).not.toHaveBeenCalled();
  });

  test('reopened, then "Check again" after a changed snapshot goes back to Submit', async () => {
    store.confirmLeagueCardByPartner.mockResolvedValue({ confirmed: false, reason: 'snapshot_mismatch', settled: 18 });
    const { findByText } = render(wrap(
      <LeagueValidateScreen navigation={makeNav()} route={{ params: { ...route.params, submitted: true } }} />,
    ));
    fireEvent.press(await findByText('Check again'));
    fireEvent.press(await findByText('Submit'));
    await waitFor(() => expect(store.submitLeagueCard).toHaveBeenCalledTimes(1));
  });

  test('a hole without a score blocks Submit', async () => {
    const { [12]: _gone, ...partial } = fives;
    repo.fetchTournament.mockResolvedValue(tournament(partial));
    const { findByText, getByText } = render(wrap(
      <LeagueValidateScreen navigation={makeNav()} route={route} />,
    ));
    expect(await findByText(/Missing: 12\./)).toBeTruthy();
    fireEvent.press(getByText('Submit'));
    await waitFor(() => expect(store.submitLeagueCard).not.toHaveBeenCalled());
  });

  test('a submit refusal shows the server message', async () => {
    store.submitLeagueCard.mockRejectedValueOnce(new Error('This card can no longer be changed.'));
    const { findByText } = render(wrap(
      <LeagueValidateScreen navigation={makeNav()} route={route} />,
    ));
    fireEvent.press(await findByText('Submit'));
    expect(await findByText('This card can no longer be changed.')).toBeTruthy();
    expect(store.confirmLeagueCardByPartner).not.toHaveBeenCalled();
  });
});

describe('LeagueValidateScreen: pick your marker', () => {
  const javi = { userId: 'user-2', name: 'Javi Ortega', inLeague: true, marked: 0 };
  const ana = { userId: 'user-3', name: 'Ana Ruiz', inLeague: true, marked: 7 };
  const notConfirmed = { confirmed: false, reason: 'no_partner', settled: 18, marked: 0 };

  beforeEach(() => {
    jest.clearAllMocks();
    repo.fetchTournament.mockResolvedValue(tournament());
    store.getLeagueMarkerCandidates.mockResolvedValue({ pending: null, candidates: [javi] });
    store.confirmLeagueCardByPartner.mockResolvedValue(notConfirmed);
    store.requestLeagueMarker.mockResolvedValue({ markerUserId: 'user-2', markerName: 'Javi Ortega', expiresAt: '2026-10-19T10:00:00Z' });
    store.remindLeagueMarker.mockResolvedValue({ remindedAt: '2026-10-13T10:00:00Z' });
    store.cancelLeagueMarkerRequest.mockResolvedValue(undefined);
    store.getLeagueCard.mockResolvedValue(null);
    store.submitLeagueCard.mockResolvedValue({ id: 'card-1', status: 'submitted' });
  });

  const mount = (params = {}, navigation = makeNav()) => render(wrap(
    <LeagueValidateScreen navigation={navigation} route={{ params: { ...route.params, ...params } }} />,
  ));

  test('a single candidate is preselected and named on the button', async () => {
    const { findByText, getByText, getByLabelText } = mount();
    expect(await findByText('Submit and ask Javi')).toBeTruthy();
    expect(getByText('If Javi scored your holes too, it counts straight away.')).toBeTruthy();
    expect(getByLabelText('Who marked you?')).toBeTruthy();
    expect(getByLabelText('Javi Ortega').props.accessibilityState).toEqual({ checked: true });
    expect(getByText('Someone else')).toBeTruthy();
  });

  test('with several candidates the one who marked the most holes is preselected', async () => {
    store.getLeagueMarkerCandidates.mockResolvedValue({ pending: null, candidates: [javi, ana] });
    const { findByText } = mount();
    expect(await findByText('Submit and ask Ana')).toBeTruthy();
  });

  test('no candidates: Someone else, plain Submit', async () => {
    store.getLeagueMarkerCandidates.mockResolvedValue({ pending: null, candidates: [] });
    const { findByText, getByText } = mount();
    expect(await findByText('Submit')).toBeTruthy();
    expect(getByText('Someone else')).toBeTruthy();
  });

  test('not confirmed with a person selected: asks them and shows the waiting card', async () => {
    const { findByText, getByText, queryByText } = mount();
    fireEvent.press(await findByText('Submit and ask Javi'));
    expect(await findByText('Waiting for Javi to confirm')).toBeTruthy();
    expect(store.requestLeagueMarker).toHaveBeenCalledWith('card-1', 'user-2');
    expect(getByText(/^Asked just now · until 19 Oct$/)).toBeTruthy();
    expect(getByText(/38 pts.*Stableford · counts once confirmed/)).toBeTruthy();
    expect(queryByText(/better|worse/)).toBeNull();
    expect(getByText('Remind Javi')).toBeTruthy();
    expect(getByText('MARKER NOT IN THE APP?')).toBeTruthy();
    expect(getByText('Back to the league')).toBeTruthy();
    expect(queryByText('Submitted · not confirmed yet')).toBeNull();
  });

  test('confirmed by the partner check: nobody is asked', async () => {
    store.confirmLeagueCardByPartner.mockResolvedValue({ confirmed: true, settled: 18, partnerName: 'Javi' });
    const { findByText } = mount();
    fireEvent.press(await findByText('Submit and ask Javi'));
    expect(await findByText('Javi confirmed 18 of 18 holes in the app')).toBeTruthy();
    expect(store.requestLeagueMarker).not.toHaveBeenCalled();
  });

  test('Someone else: no request, the usual fallbacks', async () => {
    const { findByText, getByText } = mount();
    await findByText('Submit and ask Javi');
    fireEvent.press(getByText('Someone else'));
    fireEvent.press(await findByText('Submit'));
    expect(await findByText(translate(PARTNER_REASONS.no_partner))).toBeTruthy();
    expect(store.requestLeagueMarker).not.toHaveBeenCalled();
    expect(getByText('Show QR to your marker')).toBeTruthy();
  });

  test('a failed request says the person was not asked, and Remind asks again', async () => {
    store.requestLeagueMarker.mockRejectedValueOnce(new Error('offline'));
    const { findByText, getByText, queryByText } = mount();
    fireEvent.press(await findByText('Submit and ask Javi'));
    expect(await findByText('Card submitted, but Javi wasn\'t asked. Tap “Remind Javi” to try again.')).toBeTruthy();
    fireEvent.press(getByText('Remind Javi'));
    expect(await findByText('Waiting for Javi to confirm')).toBeTruthy();
    expect(store.requestLeagueMarker).toHaveBeenCalledTimes(2);
    expect(store.remindLeagueMarker).not.toHaveBeenCalled();
    expect(queryByText(/wasn't asked/)).toBeNull();
  });

  test('reopened with a pending request: the waiting card, no partner check', async () => {
    store.getLeagueMarkerCandidates.mockResolvedValue({
      pending: { userId: 'user-2', name: 'Javi Ortega', requestedAt: new Date(Date.now() - 2 * 60000).toISOString(), remindedAt: null, expiresAt: '2026-10-19T10:00:00Z' },
      candidates: [javi],
    });
    const { findByText, getByText, queryByText } = mount({ submitted: true });
    expect(await findByText('Waiting for Javi to confirm')).toBeTruthy();
    expect(getByText('Asked 2 min ago · until 19 Oct')).toBeTruthy();
    expect(store.confirmLeagueCardByPartner).not.toHaveBeenCalled();
    expect(getByText('Back to the league')).toBeTruthy();
    expect(queryByText('Check with my partner')).toBeNull();
  });

  test('Remind: success note, and the server refusal shown inline', async () => {
    store.getLeagueMarkerCandidates.mockResolvedValue({
      pending: { userId: 'user-2', name: 'Javi Ortega', requestedAt: new Date().toISOString(), remindedAt: null, expiresAt: '2026-10-19T10:00:00Z' },
      candidates: [javi],
    });
    const { findByText, getByText } = mount({ submitted: true });
    fireEvent.press(await findByText('Remind Javi'));
    expect(await findByText('Reminded Javi.')).toBeTruthy();
    expect(store.remindLeagueMarker).toHaveBeenCalledWith('card-1');
    store.remindLeagueMarker.mockRejectedValueOnce(new Error('You can remind once a day.'));
    fireEvent.press(getByText('Remind Javi'));
    expect(await findByText('You can remind once a day.')).toBeTruthy();
  });

  test('reopened after a send-back (no pending request): the chips and Ask come back', async () => {
    store.getLeagueMarkerCandidates.mockResolvedValue({ pending: null, candidates: [javi] });
    const { findByText, getByText } = mount({ submitted: true });
    expect(await findByText(translate(PARTNER_REASONS.no_partner))).toBeTruthy();
    expect(getByText('WHO MARKED YOU?')).toBeTruthy();
    fireEvent.press(getByText('Ask Javi'));
    await waitFor(() => expect(store.requestLeagueMarker).toHaveBeenCalledWith('card-1', 'user-2'));
    expect(await findByText('Waiting for Javi to confirm')).toBeTruthy();
  });

  test('Ask someone else: cancels, then the chips come back above the fallbacks', async () => {
    store.getLeagueMarkerCandidates.mockResolvedValue({
      pending: { userId: 'user-2', name: 'Javi Ortega', requestedAt: new Date().toISOString(), remindedAt: null, expiresAt: '2026-10-19T10:00:00Z' },
      candidates: [javi, ana],
    });
    const { findByText, getByText, queryByText } = mount({ submitted: true });
    fireEvent.press(await findByText('Ask someone else'));
    expect(await findByText('WHO MARKED YOU?')).toBeTruthy();
    expect(store.cancelLeagueMarkerRequest).toHaveBeenCalledWith('card-1');
    expect(queryByText('Waiting for Javi to confirm')).toBeNull();
    // Javi is skipped in the preselection.
    store.requestLeagueMarker.mockResolvedValueOnce({ markerUserId: 'user-3', markerName: 'Ana Ruiz', expiresAt: '2026-10-19T10:00:00Z' });
    fireEvent.press(getByText('Ask Ana'));
    await waitFor(() => expect(store.requestLeagueMarker).toHaveBeenCalledWith('card-1', 'user-3'));
    expect(await findByText('Waiting for Ana to confirm')).toBeTruthy();
  });
});

describe('LeagueValidateScreen copy, marker note and scorecard route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repo.fetchTournament.mockResolvedValue(tournament());
    store.getLeagueMarkerCandidates.mockResolvedValue({ pending: null, candidates: [] });
    store.getLeagueCard.mockResolvedValue(null);
  });

  test('with no marker picked the footnote says the card is not confirmed until a marker does', async () => {
    const { findByText, queryByText } = render(wrap(<LeagueValidateScreen navigation={makeNav()} route={route} />));
    expect(await findByText(/submitted but not confirmed until a marker confirms it/)).toBeTruthy();
    expect(queryByText(/counts straight away/)).toBeNull();
  });

  test('a returned card shows the marker note and Edit in scorecard opens that round', async () => {
    store.getLeagueCard.mockResolvedValue({ id: 'card-1', status: 'submitted', markerNote: 'Hole 7 was a 6' });
    const navigation = makeNav();
    const { findByText, getByText } = render(wrap(<LeagueValidateScreen navigation={navigation} route={route} />));
    expect(await findByText('Hole 7 was a 6')).toBeTruthy();
    fireEvent.press(getByText('Edit in scorecard'));
    expect(navigation.navigate).toHaveBeenCalledWith('Scorecard', { tournamentId: 't1', roundIndex: 0 });
  });

  test('once submitted, the result shows the server-scored points, gross and differential', async () => {
    store.submitLeagueCard.mockResolvedValue({
      id: 'card-1', status: 'submitted', points: 35, gross: 90, netDifferential: -0.4, playingHandicap: 17, teeVerified: true,
    });
    store.confirmLeagueCardByPartner.mockResolvedValue({ confirmed: true, settled: 18, partnerName: 'Javi' });
    const {
      findByText, getByText, getAllByText, queryByText,
    } = render(wrap(<LeagueValidateScreen navigation={makeNav()} route={route} />));
    fireEvent.press(await findByText('Submit'));
    expect(await findByText('Gross 90 · net differential −0.4, for reference')).toBeTruthy();
    // The result card and the grid (re-scored off the server's playing handicap 17).
    expect(getAllByText('35').length).toBeGreaterThanOrEqual(2);
    expect(queryByText('38')).toBeNull();
    expect(queryByText(/adjusted/)).toBeNull();
    expect(getByText('Your card counts. The league has been told.')).toBeTruthy();
  });

  test('a confirmed card that needs an admin says so instead of "Your card counts"', async () => {
    store.submitLeagueCard.mockResolvedValue({ id: 'card-1', status: 'submitted', points: 38, teeVerified: false });
    store.confirmLeagueCardByPartner.mockResolvedValue({ confirmed: true, settled: 18, partnerName: 'Javi' });
    const { findByText, queryByText } = render(wrap(<LeagueValidateScreen navigation={makeNav()} route={route} />));
    fireEvent.press(await findByText('Submit'));
    expect(await findByText("Confirmed · waiting for an admin's approval.")).toBeTruthy();
    expect(queryByText(/Your card counts/)).toBeNull();
  });

  test("the header and the card link use the card's month, not today's", async () => {
    store.getLeagueCard.mockResolvedValue({
      id: 'card-1', status: 'submitted', month: '2026-09-01', monthKey: '2026-09', points: 38, gross: 90, netDifferential: -1.7, leagueHandicap: 18,
    });
    store.confirmLeagueCardByPartner.mockResolvedValue({ confirmed: true, settled: 18, partnerName: 'Javi' });
    const navigation = makeNav();
    const { findByText } = render(wrap(
      <LeagueValidateScreen navigation={navigation} route={{ params: { ...route.params, submitted: true } }} />,
    ));
    expect(await findByText('September card')).toBeTruthy();
    fireEvent.press(await findByText("How it's worked out ›"));
    expect(navigation.navigate).toHaveBeenCalledWith('LeagueCard', { leagueId: 'L1', month: '2026-09', userId: 'user-1' });
  });

  test('without a league handicap the preview is labelled an estimate', async () => {
    const t = tournament();
    delete t.rounds[0].playerIndexes;
    repo.fetchTournament.mockResolvedValue(t);
    const { findByText } = render(wrap(<LeagueValidateScreen navigation={makeNav()} route={route} />));
    expect(await findByText(/Points are an estimate/)).toBeTruthy();
  });

  test('the frozen league handicap of the card drives the preview, with no estimate note', async () => {
    const t = tournament();
    delete t.rounds[0].playerIndexes;
    repo.fetchTournament.mockResolvedValue(t);
    store.getLeagueCard.mockResolvedValue({ id: 'card-1', status: 'playing', monthKey: '2026-10', leagueHandicap: 18 });
    const { findByText, queryByText } = render(wrap(<LeagueValidateScreen navigation={makeNav()} route={route} />));
    // League handicap 18 on Yellow 125/72: 38 points (game handicap 4 would give far fewer).
    expect(await findByText('38')).toBeTruthy();
    expect(queryByText(/Points are an estimate/)).toBeNull();
  });

  test('a missing hole offers Edit in scorecard too', async () => {
    const partial = { ...fives };
    delete partial[4];
    repo.fetchTournament.mockResolvedValue(tournament(partial));
    const navigation = makeNav();
    const { findByText, getByText } = render(wrap(<LeagueValidateScreen navigation={navigation} route={route} />));
    expect(await findByText(/Every hole needs a score/)).toBeTruthy();
    fireEvent.press(getByText('Edit in scorecard'));
    expect(navigation.navigate).toHaveBeenCalledWith('Scorecard', { tournamentId: 't1', roundIndex: 0 });
  });
});
