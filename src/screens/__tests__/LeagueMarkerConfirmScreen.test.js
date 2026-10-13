import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import LeagueMarkerConfirmScreen from '../LeagueMarkerConfirmScreen';

jest.mock('../../store/markerCardStore', () => {
  class MarkerCardError extends Error {
    constructor(message, { reason = null, offline = false } = {}) {
      super(message);
      this.reason = reason;
      this.offline = offline;
    }
  }
  return { MarkerCardError, getMarkerCard: jest.fn(), confirmMarkerCard: jest.fn() };
});

const store = require('../../store/markerCardStore');

const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 5, 4, 4, 4, 3, 5, 4];
const CARD = {
  playerFirstName: 'Marcos',
  course: 'El Saler',
  tee: 'Yellow',
  date: '2026-10-04',
  month: '2026-10-01',
  leagueName: 'Tour',
  gross: 87,
  bound: true,
  signedInName: 'Javi Ortega',
  holes: PARS.map((par, i) => ({ n: i + 1, par, si: i + 1, strokes: i === 11 ? 4 : par })),
};

const makeNav = () => ({ goBack: jest.fn(), canGoBack: () => true, navigate: jest.fn() });
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
const reasonError = (reason) => new store.MarkerCardError(reason, { reason });

async function ready(navigation = makeNav()) {
  const utils = render(wrap(<LeagueMarkerConfirmScreen navigation={navigation} route={{ params: { token: 'tok-1' } }} />));
  await utils.findByText("Confirm Marcos's October card");
  return { ...utils, navigation };
}

describe('LeagueMarkerConfirmScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    store.getMarkerCard.mockResolvedValue(CARD);
    store.confirmMarkerCard.mockResolvedValue({ status: 'confirmed' });
  });

  test('shows the card and confirms as the signed-in account', async () => {
    const { getByText, findByText, navigation } = await ready();
    expect(store.getMarkerCard).toHaveBeenCalledWith('tok-1');
    expect(getByText('Tour · El Saler · Yellow · Sun 4 Oct')).toBeTruthy();
    expect(getByText("Gross 87. Tap a hole if it's wrong.")).toBeTruthy();
    fireEvent.press(getByText('Confirm as Javi Ortega'));
    expect(await findByText("Confirmed. Marcos's card counts now.")).toBeTruthy();
    expect(store.confirmMarkerCard).toHaveBeenCalledWith('tok-1', 'Javi Ortega', true, null);
    fireEvent.press(getByText('Done'));
    expect(navigation.goBack).toHaveBeenCalled();
  });

  test('tapping a hole opens the flag step and sends the correction note', async () => {
    store.confirmMarkerCard.mockResolvedValue({ status: 'returned' });
    const { getByText, getByLabelText, findByText } = await ready();
    fireEvent.press(getByLabelText(/^Hole 12, par 5, 4\./));
    expect(getByText('Hole 12 · par 5')).toBeTruthy();
    expect(getByText('Marcos wrote 4. It should be')).toBeTruthy();
    fireEvent.press(getByLabelText('One stroke more'));
    fireEvent.press(getByText('Send back to Marcos'));
    expect(await findByText('Sent back to Marcos.')).toBeTruthy();
    expect(store.confirmMarkerCard).toHaveBeenCalledWith('tok-1', 'Javi Ortega', false, 'Hole 12: should be 5 (card says 4)');
  });

  test('Send back is off until the number changes; Cancel returns to the card', async () => {
    const { getByText, getByLabelText } = await ready();
    fireEvent.press(getByLabelText(/^Hole 12/));
    fireEvent.press(getByText('Send back to Marcos'));
    expect(store.confirmMarkerCard).not.toHaveBeenCalled();
    fireEvent.press(getByText('Cancel'));
    expect(getByText('Confirm as Javi Ortega')).toBeTruthy();
  });

  test.each([
    ['invalid', 'This request was cancelled or the card changed. Nothing to do.'],
    ['changed', 'This request was cancelled or the card changed. Nothing to do.'],
    ['expired', 'This request expired.'],
    ['used', 'Already answered.'],
  ])('a "%s" token on load says it in plain words', async (reason, copy) => {
    store.getMarkerCard.mockRejectedValue(reasonError(reason));
    const { findByText } = render(wrap(<LeagueMarkerConfirmScreen navigation={makeNav()} route={{ params: { token: 't' } }} />));
    expect(await findByText(copy)).toBeTruthy();
  });

  test('answered by someone else between load and confirm: Already answered.', async () => {
    store.confirmMarkerCard.mockRejectedValue(reasonError('used'));
    const { getByText, findByText } = await ready();
    fireEvent.press(getByText('Confirm as Javi Ortega'));
    expect(await findByText('Already answered.')).toBeTruthy();
  });

  test('offline on load: retry loads again; offline on confirm keeps the card and shows the error', async () => {
    store.getMarkerCard.mockRejectedValueOnce(new store.MarkerCardError('You need a connection to do this.', { offline: true }));
    const { findByText, getByText } = render(wrap(<LeagueMarkerConfirmScreen navigation={makeNav()} route={{ params: { token: 't' } }} />));
    fireEvent.press(await findByText('Try again'));
    await findByText("Confirm Marcos's October card");
    store.confirmMarkerCard.mockRejectedValueOnce(new Error('You need a connection to do this.'));
    fireEvent.press(getByText('Confirm as Javi Ortega'));
    expect(await findByText('You need a connection to do this.')).toBeTruthy();
    await waitFor(() => expect(getByText('Confirm as Javi Ortega')).toBeTruthy());
  });
});
