import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import LeaderboardCard from '../LeaderboardCard';

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const ROWS = [
  { key: 'a', place: 1, isTie: false, name: 'Ann', points: '12 pts', sub: '30 str', mark: true },
  { key: 'b', place: 2, isTie: true, name: 'Bob', points: '10 pts', sub: null },
  { key: 'c', place: 2, isTie: true, name: 'Cy', points: '10 pts', sub: '' },
  { key: 'd', place: null, isTie: false, name: 'Di', points: '—', sub: null, isMe: true },
];

describe('LeaderboardCard', () => {
  test('renders the title, every row, tie labels and a dash for unplaced rows', () => {
    const { getByText, getAllByText } = render(wrap(<LeaderboardCard title="OVERALL" rows={ROWS} />));
    expect(getByText('OVERALL')).toBeTruthy();
    ['Ann', 'Bob', 'Cy', 'Di'].forEach((n) => expect(getByText(n)).toBeTruthy());
    expect(getAllByText('T2')).toHaveLength(2);
    expect(getByText('1')).toBeTruthy();
    expect(getByText('–')).toBeTruthy();
    expect(getAllByText('10 pts')).toHaveLength(2);
  });

  test('sub is shown for a string (even empty) and skipped for null', () => {
    const { getByText, queryByText } = render(wrap(<LeaderboardCard title="T" rows={ROWS} />));
    expect(getByText('30 str')).toBeTruthy();
    expect(queryByText('null')).toBeNull();
  });

  test('renders the header slot, subheader and footer when given', () => {
    const { getByText } = render(wrap(
      <LeaderboardCard
        title="T"
        rows={ROWS}
        headerRight={<Text>toggle</Text>}
        subheader={<Text>chips</Text>}
        footer="Final in December"
      />,
    ));
    expect(getByText('toggle')).toBeTruthy();
    expect(getByText('chips')).toBeTruthy();
    expect(getByText('Final in December')).toBeTruthy();
  });

  test('renders no footer when it is empty or null', () => {
    const { queryByText } = render(wrap(<LeaderboardCard title="T" rows={ROWS} footer={null} />));
    expect(queryByText('Final in December')).toBeNull();
  });

  test('sections render a heading over their rows or body, with the row detail and gold sub', () => {
    const { getByText } = render(wrap(
      <LeaderboardCard
        title="T"
        sections={[
          { key: 'a', label: 'Confirmed · 1', icon: 'check', gold: true, rows: [{ key: 'x', place: 1, name: 'Ann', points: '38 pts', sub: '+500', subGold: true, detail: 'Olivar · marker by QR' }] },
          { key: 'b', label: 'No card yet · 1', icon: 'user-x', body: <Text>Bob</Text> },
        ]}
      />,
    ));
    ['Confirmed · 1', 'Ann', 'Olivar · marker by QR', '+500', 'No card yet · 1', 'Bob'].forEach((x) => expect(getByText(x)).toBeTruthy());
  });
});
