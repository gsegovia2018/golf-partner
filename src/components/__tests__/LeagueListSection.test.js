import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import LeagueListSection from '../LeagueListSection';

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
      { id: 'L1', name: 'El Club', position: '2nd of 7 · 2,340 pts' },
      { id: 'L2', name: 'Sunday Four', position: null },
    ];
    const navigation = { navigate: jest.fn() };
    const { getByText } = render(<LeagueListSection navigation={navigation} meId="me" theme={theme} s={s} />);
    expect(getByText('LEAGUES')).toBeTruthy();
    expect(getByText('2nd of 7 · 2,340 pts')).toBeTruthy();
    expect(getByText('No cards confirmed yet')).toBeTruthy();
    fireEvent.press(getByText('El Club'));
    expect(navigation.navigate).toHaveBeenCalledWith('LeagueBoard', { leagueId: 'L1' });
  });
});
