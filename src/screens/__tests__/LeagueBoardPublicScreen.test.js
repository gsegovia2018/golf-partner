import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { setLanguagePref } from '../../i18n';
import { ThemeProvider } from '../../theme/ThemeContext';
import LeagueBoardPublicScreen from '../LeagueBoardPublicScreen';

jest.mock('../../store/publicLeagueBoardStore', () => ({ getPublicLeagueBoard: jest.fn() }));
const store = require('../../store/publicLeagueBoardStore');

const TOKEN = 'tok12345678901234567890';
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
const REAL_TIMERS = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
  'nextTick', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'performance'];

const payload = {
  league: { name: 'El Club', season_start: '2026-01-01', season_end: '2026-12-31', points_table: [500, 300, 190], participation_points: 10 },
  members: [
    { key: 'k1', name: 'Íñigo E.', active: true },
    { key: 'k2', name: 'Javier O.', active: true },
    { key: 'k3', name: 'Ana P.', active: true },
  ],
  cards: [
    { month: '2026-09-01', member: 'k2', status: 'confirmed', points: 40, course: 'Golf Santander' },
    { month: '2026-10-01', member: 'k1', status: 'confirmed', points: 41, course: 'RCG Sotogrande' },
    { month: '2026-10-01', member: 'k3', status: 'confirmed', points: 38, course: 'La Moraleja' },
  ],
};

describe('LeagueBoardPublicScreen', () => {
  let view;
  beforeEach(() => {
    jest.clearAllMocks();
    setLanguagePref('en');
    // Tue 13 Oct 2026: 18 days left in October.
    jest.useFakeTimers({ now: new Date(2026, 9, 13, 10, 0), doNotFake: REAL_TIMERS });
  });
  afterEach(() => {
    view?.unmount();
    view = null;
    jest.useRealTimers();
  });

  test('the month so far: hero, leader, rows with course, Stableford and gold league points', async () => {
    store.getPublicLeagueBoard.mockResolvedValue(payload);
    view = render(wrap(<LeagueBoardPublicScreen token={TOKEN} />));
    const { getByText, findByText, getByLabelText } = view;
    expect(await findByText('El Club')).toBeTruthy();
    expect(store.getPublicLeagueBoard).toHaveBeenCalledWith(TOKEN);
    expect(getByText('October so far · 18 days left · 2 of 3 cards in')).toBeTruthy();
    expect(getByText('Íñigo E. leads · 41 pts')).toBeTruthy();
    expect(getByText('RCG Sotogrande')).toBeTruthy();
    expect(getByText('+500')).toBeTruthy();
    expect(getByLabelText('1, Íñigo E.: 41 Stableford points, 500 league points')).toBeTruthy();
    expect(getByText('Read-only. Names show as first name and initial.')).toBeTruthy();
  });

  test('chips: Season and the previous month', async () => {
    store.getPublicLeagueBoard.mockResolvedValue(payload);
    view = render(wrap(<LeagueBoardPublicScreen token={TOKEN} />));
    const { getByText, findByText, getAllByText } = view;
    await findByText('El Club');
    fireEvent.press(getByText('Season'));
    expect(getByText('Season after October')).toBeTruthy();
    expect(getByText('Íñigo E. leads · 500 league pts')).toBeTruthy();
    fireEvent.press(getAllByText('September')[0]);
    expect(getByText('September · 1 of 3 cards in')).toBeTruthy();
    expect(getByText('Javier O. leads · 40 pts')).toBeTruthy();
  });

  test('a month with no cards yet', async () => {
    store.getPublicLeagueBoard.mockResolvedValue({ ...payload, cards: [] });
    view = render(wrap(<LeagueBoardPublicScreen token={TOKEN} />));
    expect(await view.findByText('No cards confirmed in October yet.')).toBeTruthy();
    expect(view.getByText('October so far · 18 days left · 0 of 3 cards in')).toBeTruthy();
  });

  test('a link that is off or unknown', async () => {
    store.getPublicLeagueBoard.mockResolvedValue(null);
    view = render(wrap(<LeagueBoardPublicScreen token={TOKEN} />));
    expect(await view.findByText("This board link isn't active")).toBeTruthy();
    expect(view.getByText("It may have been replaced or switched off. Ask the league's admin for a fresh link.")).toBeTruthy();
  });

  test('an error, then Retry loads the board', async () => {
    store.getPublicLeagueBoard.mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue(payload);
    view = render(wrap(<LeagueBoardPublicScreen token={TOKEN} />));
    expect(await view.findByText("Couldn't load this board")).toBeTruthy();
    fireEvent.press(view.getByText('Try again'));
    expect(await view.findByText('El Club')).toBeTruthy();
  });

  test('Spanish', async () => {
    await setLanguagePref('es');
    store.getPublicLeagueBoard.mockResolvedValue(payload);
    view = render(wrap(<LeagueBoardPublicScreen token={TOKEN} />));
    expect(await view.findByText('Octubre hasta hoy · quedan 18 días · 2 de 3 tarjetas')).toBeTruthy();
    expect(view.getByText('Solo lectura. Los nombres aparecen como nombre e inicial.')).toBeTruthy();
    await waitFor(() => view.getByText('Íñigo E. lidera · 41 ptos'));
  });
});
