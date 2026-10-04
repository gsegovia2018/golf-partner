import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import MarkerCardScreen, { buildMarkerTable, formatPlayedOn } from '../MarkerCardScreen';

jest.mock('../../store/markerCardStore', () => {
  class MarkerCardError extends Error {
    constructor(message, { reason = null, offline = false } = {}) {
      super(message);
      this.reason = reason;
      this.offline = offline;
    }
  }
  return {
    MarkerCardError,
    MARKER_REASONS: ['expired', 'used', 'invalid', 'changed'],
    getMarkerCard: jest.fn(),
    confirmMarkerCard: jest.fn(),
  };
});

const store = require('../../store/markerCardStore');

const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 5, 4, 4, 4, 3, 5, 4];
const CARD = {
  playerFirstName: 'Marcos',
  course: 'Centro Nacional de Golf',
  tee: 'Yellow',
  date: '2026-10-04',
  playingHandicap: 20,
  gross: 92,
  points: 36,
  expiresAt: '2026-10-04T14:00:00Z',
  holes: PARS.map((par, i) => ({ n: i + 1, par, si: i + 1, strokes: par + 1 })),
};

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
const reasonError = (reason) => new store.MarkerCardError(reason, { reason });

async function renderReady(props = { token: 'tok-1' }) {
  const utils = render(wrap(<MarkerCardScreen {...props} />));
  await waitFor(() => utils.getByText("Confirm Marcos's card"));
  return utils;
}

describe('MarkerCardScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    store.getMarkerCard.mockResolvedValue(CARD);
    store.confirmMarkerCard.mockResolvedValue({ status: 'confirmed' });
  });

  test('shows the card read-only with the player row label, meta line and footnote', async () => {
    const { getByText, getAllByText, queryByText, queryByLabelText } = await renderReady();
    expect(store.getMarkerCard).toHaveBeenCalledWith('tok-1');
    expect(getByText('Golf Partner')).toBeTruthy();
    expect(getByText('Marker confirmation')).toBeTruthy();
    expect(getByText('Centro Nacional de Golf · Sun 4 Oct · Yellow tees · Playing handicap 20')).toBeTruthy();
    expect(getAllByText('MAR').length).toBe(2); // front and back nine
    expect(queryByText('You')).toBeNull();
    // Read-only: no stroke inputs.
    expect(queryByLabelText(/Strokes for/)).toBeNull();
    expect(getByText("You're confirming the strokes shown. No account needed. This code works once.")).toBeTruthy();
  });

  test('takes the token from route params when routed', async () => {
    await renderReady({ route: { params: { token: 'tok-route' } } });
    expect(store.getMarkerCard).toHaveBeenCalledWith('tok-route');
  });

  test('Confirm needs a name, then confirms with ok=true and thanks the marker', async () => {
    const { getByText, getByLabelText } = await renderReady();
    fireEvent.press(getByText('Confirm card'));
    expect(store.confirmMarkerCard).not.toHaveBeenCalled();

    fireEvent.changeText(getByLabelText('Your name'), '  Javi Ruiz ');
    fireEvent.press(getByText('Confirm card'));
    await waitFor(() => getByText('Thank you'));
    expect(store.confirmMarkerCard).toHaveBeenCalledWith('tok-1', 'Javi Ruiz', true, null);
  });

  test("Something's wrong opens a note and sends the card back with ok=false", async () => {
    store.confirmMarkerCard.mockResolvedValue({ status: 'returned' });
    const { getByText, getByLabelText } = await renderReady();
    fireEvent.press(getByText("Something's wrong"));
    fireEvent.changeText(getByLabelText('Your name'), 'Javi');
    fireEvent.changeText(getByLabelText("What's wrong?"), 'Hole 7 was a 6');
    fireEvent.press(getByText('Send back to Marcos'));
    await waitFor(() => getByText('Note sent'));
    expect(store.confirmMarkerCard).toHaveBeenCalledWith('tok-1', 'Javi', false, 'Hole 7 was a 6');
  });

  test('a double tap confirms once', async () => {
    let release;
    store.confirmMarkerCard.mockReturnValue(new Promise((r) => { release = r; }));
    const { getByText, getByLabelText, getByTestId } = await renderReady();
    fireEvent.changeText(getByLabelText('Your name'), 'Javi');
    fireEvent.press(getByTestId('marker-confirm'));
    fireEvent.press(getByTestId('marker-confirm'));
    await act(async () => { release({ status: 'confirmed' }); });
    await waitFor(() => getByText('Thank you'));
    expect(store.confirmMarkerCard).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['expired', 'This code has expired'],
    ['used', 'This code was already used.'],
    ['invalid', "This code isn't valid"],
    ['changed', 'The card changed — ask for a new code'],
  ])('load error %s shows its state', async (reason, title) => {
    store.getMarkerCard.mockRejectedValue(reasonError(reason));
    const { getByText, queryByText } = render(wrap(<MarkerCardScreen token="tok-1" />));
    await waitFor(() => getByText(title));
    expect(queryByText('Confirm card')).toBeNull();
  });

  test('no token at all is invalid without calling the server', async () => {
    const { getByText } = render(wrap(<MarkerCardScreen />));
    await waitFor(() => getByText("This code isn't valid"));
    expect(store.getMarkerCard).not.toHaveBeenCalled();
  });

  test('a confirm that finds the card changed switches to the changed state', async () => {
    store.confirmMarkerCard.mockRejectedValue(reasonError('changed'));
    const { getByText, getByLabelText } = await renderReady();
    fireEvent.changeText(getByLabelText('Your name'), 'Javi');
    fireEvent.press(getByText('Confirm card'));
    await waitFor(() => getByText('The card changed — ask for a new code'));
  });

  test('a confirm that fails offline keeps the form and shows the message', async () => {
    store.confirmMarkerCard.mockRejectedValue(
      new store.MarkerCardError('You need a connection to do this.', { offline: true }),
    );
    const { getByText, getByLabelText } = await renderReady();
    fireEvent.changeText(getByLabelText('Your name'), 'Javi');
    fireEvent.press(getByText('Confirm card'));
    await waitFor(() => getByText('You need a connection to do this.'));
    expect(getByText('Confirm card')).toBeTruthy();
  });

  test('a network error on load offers a retry that reloads the card', async () => {
    store.getMarkerCard.mockRejectedValueOnce(
      new store.MarkerCardError('You need a connection to do this.', { offline: true }),
    );
    const { getByText } = render(wrap(<MarkerCardScreen token="tok-1" />));
    await waitFor(() => getByText("Couldn't load this card"));
    fireEvent.press(getByText('Try again'));
    await waitFor(() => getByText("Confirm Marcos's card"));
    expect(store.getMarkerCard).toHaveBeenCalledTimes(2);
  });
});

describe('buildMarkerTable / formatPlayedOn', () => {
  test('drops holes with no par (a nine-hole card) and keys strokes by hole number', () => {
    const holes = Array.from({ length: 18 }, (_, i) => (i < 9
      ? { n: i + 1, par: 4, si: i + 1, strokes: i === 2 ? null : 5 }
      : { n: i + 1, par: null, si: null, strokes: null }));
    const t = buildMarkerTable({ ...CARD, holes, playingHandicap: 9 });
    expect(t.round.holes).toHaveLength(9);
    expect(t.round.holes[0]).toEqual({ number: 1, par: 4, strokeIndex: 1 });
    const [p] = t.players;
    expect(p.handicap).toBe(9);
    expect(t.round.playerHandicaps[p.id]).toBe(9);
    expect(t.scores[p.id][1]).toBe(5);
    expect(t.scores[p.id][3]).toBeUndefined();
  });

  test('formats the played date without a time-zone shift', () => {
    expect(formatPlayedOn('2026-10-04')).toBe('Sun 4 Oct');
    expect(formatPlayedOn(null)).toBeNull();
    expect(formatPlayedOn('nope')).toBeNull();
  });
});
