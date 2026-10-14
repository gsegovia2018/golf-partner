import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { setLanguagePref } from '../../../i18n';
import { graceMonth } from '../../../store/leagueGrace';
import MonthClosingBanner from '../MonthClosingBanner';
import { closeInfo, ghostSection, deadlineLabel } from '../graceText';

jest.mock('../../../store/tournamentStore', () => ({ getTournamentSnapshot: () => null }));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
const members = [
  { userId: 'me', role: 'member', displayName: 'Marcos' },
  { userId: 'adm', role: 'admin', displayName: 'Ana' },
  { userId: 'pab', role: 'member', displayName: 'Pablo Santamaría' },
  { userId: 'mat', role: 'member', displayName: 'Mateo' },
];
const NOW = new Date('2026-10-02T12:20:00Z');   // Fri 2 Oct 14:20 Madrid
const cards = [
  {
    id: 'c1', userId: 'me', status: 'submitted', source: 'app', points: 29, markerName: 'Álvaro Beltrán',
    markerRequestedAt: '2026-09-30T08:00:00Z', course: { name: 'Golf Lomas-Bosque' },
  },
  { id: 'c2', userId: 'pab', status: 'confirmed', source: 'app', points: 31, notAnnounced: true },
  { id: 'c3', userId: 'adm', status: 'submitted', source: 'app', points: 27, teeVerified: false },
  { id: 'c4', userId: 'mat', status: 'submitted', source: 'app', points: 30, returnedAt: '2026-10-02T12:20:00Z' },
];
const snapshot = { league: {}, members, cardsByMonth: { '2026-09': cards } };
const nameOf = (id) => members.find((m) => m.userId === id).displayName;
const navigation = { navigate: jest.fn() };

afterEach(async () => { navigation.navigate.mockClear(); await setLanguagePref('system'); });

const renderBanner = (meId, extra = {}) => render(wrap(
  <MonthClosingBanner
    grace={graceMonth(snapshot, NOW, meId)}
    navigation={navigation}
    leagueId="L1"
    nameOf={nameOf}
    now={NOW}
    {...extra}
  />,
));

describe('graceText', () => {
  test('close info is the last minute of day 3 in Madrid', () => {
    const closesAt = new Date('2026-10-03T22:00:00Z');
    expect(closeInfo(closesAt, NOW)).toMatchObject({
      weekday: 'Saturday', weekdayShort: 'Sat', short: 'Sat 3 Oct', clock: '23:59', tonight: false,
    });
    expect(closeInfo(closesAt, new Date('2026-10-03T18:00:00Z')).tonight).toBe(true);
  });

  test('a deadline never runs past the close', () => {
    const closesAt = new Date('2026-10-03T22:00:00Z');
    expect(deadlineLabel(new Date('2026-10-03T12:20:00Z'), closesAt)).toBe('Sat 14:20');
    expect(deadlineLabel(new Date('2026-10-04T12:20:00Z'), closesAt)).toBe('Sat 23:59');
  });

  test('ghost rows: dashed, dimmed, one status line each', () => {
    const grace = graceMonth(snapshot, NOW, 'me');
    const t = (k, p) => `${k}${p ? JSON.stringify(p) : ''}`;
    const sec = ghostSection(grace, t, { nameOf, now: NOW, onOpen: () => {} });
    expect(sec.rows.map((r) => r.name)).toEqual(['Marcos', 'Pablo Santamaría', 'Mateo', 'Ana']);
    expect(sec.rows.every((r) => r.unranked && r.muted && r.place === null)).toBe(true);
    expect(sec.rows[0].detail).toContain('league.grace.line.marker');
    expect(sec.rows[2].detail).toContain('league.grace.line.returned');
    expect(sec.label).toContain('"count":4');
  });
});

describe('MonthClosingBanner', () => {
  test('member: title, my card waiting for a marker and the QR action', () => {
    const { getByText, queryByText } = renderBanner('me');
    expect(getByText('September closes Saturday')).toBeTruthy();
    expect(getByText('Sat 3 Oct, 23:59 · then the ranking is final')).toBeTruthy();
    expect(getByText('29 pts · Golf Lomas-Bosque')).toBeTruthy();
    expect(getByText(/Waiting for Álvaro Beltrán since Wed 30 Sep/)).toBeTruthy();
    expect(queryByText(/Needs your approval/)).toBeNull();
    fireEvent.press(getByText('Show QR to Álvaro'));
    expect(navigation.navigate).toHaveBeenCalledWith('LeagueMarkerQR', { leagueId: 'L1', cardId: 'c1' });
  });

  test('member: the footer counts the others and switches to the month', () => {
    const onSeeMonth = jest.fn();
    const { getByText } = renderBanner('me', { onSeeMonth });
    expect(getByText(/3 more September cards are still waiting/)).toBeTruthy();
    fireEvent.press(getByText('See September'));
    expect(onSeeMonth).toHaveBeenCalled();
  });

  test('admin: approvals listed with Review opening the card', () => {
    const { getByText, getAllByText, queryByText } = renderBanner('adm');
    expect(getByText('Needs your approval · 2')).toBeTruthy();
    expect(getByText('31 pts · Not announced in the app')).toBeTruthy();
    expect(getByText('27 pts · Tee entered by hand')).toBeTruthy();
    expect(queryByText('Your card')).toBeNull();
    fireEvent.press(getAllByText('Review')[1]);   // [0] is the admin's own card (sole admin, R10)
    expect(navigation.navigate).toHaveBeenCalledWith('LeagueCard', { leagueId: 'L1', month: '2026-09', userId: 'pab' });
  });

  test('a sent-back off-app card offers Add your score; with the time gone, nothing', () => {
    const mine = {
      id: 'c9', userId: 'me', status: 'submitted', source: 'offapp', points: 28, returnedAt: '2026-10-02T12:00:00Z', markerNote: 'hole 7?',
    };
    const g = graceMonth({ ...snapshot, cardsByMonth: { '2026-09': [mine] } }, NOW, 'me');
    const { getByText, queryByText, rerender } = render(wrap(
      <MonthClosingBanner grace={g} navigation={navigation} leagueId="L1" nameOf={nameOf} now={NOW} />,
    ));
    expect(getByText(/hole 7\?.*Resubmit by Sat 14:00/)).toBeTruthy();
    fireEvent.press(getByText('Add your score'));
    expect(navigation.navigate).toHaveBeenCalledWith('LeagueAddScore', { leagueId: 'L1', cardId: 'c9' });
    const late = new Date('2026-10-03T13:00:00Z');
    rerender(wrap(
      <MonthClosingBanner grace={graceMonth({ ...snapshot, cardsByMonth: { '2026-09': [mine] } }, late, 'me')} navigation={navigation} leagueId="L1" nameOf={nameOf} now={late} />,
    ));
    expect(queryByText('Add your score')).toBeNull();
  });

  test('closing day says tonight; Spanish writes the weekday in Spanish', async () => {
    const eve = new Date('2026-10-03T18:00:00Z');
    const view = render(wrap(
      <MonthClosingBanner grace={graceMonth(snapshot, eve, 'me')} navigation={navigation} leagueId="L1" nameOf={nameOf} now={eve} />,
    ));
    expect(view.getByText('September closes tonight')).toBeTruthy();
    await setLanguagePref('es');
    const es = renderBanner('me');
    expect(es.getByText('Septiembre cierra el sábado')).toBeTruthy();
  });
});
