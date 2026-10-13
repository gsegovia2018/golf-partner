import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import LeagueListSection from '../LeagueListSection';
import { setLanguagePref } from '../../i18n';

const mockRows = { current: [] };
jest.mock('../../hooks/useMyLeagueRows', () => ({ useMyLeagueRows: () => mockRows.current }));

const theme = { text: { muted: '#999' } };
const s = new Proxy({}, { get: () => ({}) });

describe('LeagueListSection', () => {
  test('renders nothing when I am in no league', () => {
    mockRows.current = [];
    const { toJSON } = render(<LeagueListSection navigation={{}} meId="me" theme={theme} s={s} />);
    expect(toJSON()).toBeNull();
  });

  test('lists each league with my position and opens its board', () => {
    mockRows.current = [
      {
        id: 'L1',
        name: 'El Club',
        position: { key: 'league.play.position', params: { place: '4th', total: 18, points: '1,045' } },
        month: { key: 'league.play.monthRank', params: { monthKey: '2026-10', points: '36', place: '4th' } },
      },
      { id: 'L2', name: 'Sunday Four', position: null },
      { id: 'L3', name: 'Old Cache', position: '2nd of 7 · 2,340 pts' },
    ];
    const navigation = { navigate: jest.fn() };
    const { getByText } = render(<LeagueListSection navigation={navigation} meId="me" theme={theme} s={s} />);
    expect(getByText('LEAGUES')).toBeTruthy();
    expect(getByText('4th of 18 · 1,045 league pts')).toBeTruthy();
    expect(getByText('October: 36 pts, 4th so far')).toBeTruthy();
    expect(getByText('2nd of 7 · 2,340 pts')).toBeTruthy();
    expect(getByText('No cards confirmed yet')).toBeTruthy();
    fireEvent.press(getByText('El Club'));
    expect(navigation.navigate).toHaveBeenCalledWith('LeagueBoard', { leagueId: 'L1' });
  });

  describe('in Spanish', () => {
    afterEach(async () => { await setLanguagePref('en'); });

    test('the position and month lines are translated, the month name too', async () => {
      await setLanguagePref('es');
      mockRows.current = [{
        id: 'L1',
        name: 'El Club',
        position: { key: 'league.play.position', params: { place: '4.º', total: 18, points: '1.045' } },
        month: { key: 'league.play.monthNone', params: { monthKey: '2026-10', count: 18 } },
      }];
      const { getByText } = render(<LeagueListSection navigation={{}} meId="me" theme={theme} s={s} />);
      expect(getByText('4.º de 18 · 1.045 ptos de liga')).toBeTruthy();
      expect(getByText('octubre: aún sin tarjeta · quedan 18 días')).toBeTruthy();
    });
  });
});
