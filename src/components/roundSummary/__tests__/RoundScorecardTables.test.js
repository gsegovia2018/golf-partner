import React from 'react';
import { render } from '@testing-library/react-native';
import RoundScorecardTables from '../RoundScorecardTables';

jest.mock('../../../theme/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      bg: { card: '#fff', secondary: '#f4f4f4' },
      border: { default: '#ddd' },
      text: { primary: '#111', secondary: '#555', muted: '#777' },
    },
  }),
}));

const sections = [
  {
    label: 'Front',
    holes: [
      { number: 1, par: 4 },
      { number: 2, par: 5 },
      { number: 3, par: 3 },
    ],
    parTotal: 12,
    playerRows: [
      { playerId: 'p1', name: 'Marcos', scores: [4, null, 3], total: 7 },
      { playerId: 'p2', name: 'Pablo', scores: [5, 6, 4], total: 15 },
    ],
  },
  {
    label: 'Back',
    holes: [
      { number: 10, par: 4 },
      { number: 11, par: 4 },
      { number: 12, par: 5 },
    ],
    parTotal: 13,
    playerRows: [
      { playerId: 'p1', name: 'Marcos', scores: [4, 4, 5], total: 13 },
      { playerId: 'p2', name: 'Pablo', scores: [null, 5, 6], total: 11 },
    ],
  },
];

describe('RoundScorecardTables', () => {
  test('renders front and back scorecard sections with totals and empty scores', () => {
    const { getByText, getAllByText } = render(
      <RoundScorecardTables sections={sections} />
    );

    expect(getByText('Front nine')).toBeTruthy();
    expect(getByText('Back nine')).toBeTruthy();
    expect(getAllByText('Hole')).toHaveLength(2);
    expect(getAllByText('Par')).toHaveLength(2);
    expect(getByText('Out')).toBeTruthy();
    expect(getByText('In')).toBeTruthy();
    expect(getAllByText('Marcos')).toHaveLength(2);
    expect(getAllByText('Pablo')).toHaveLength(2);
    expect(getAllByText('12').length).toBeGreaterThan(0);
    expect(getAllByText('13').length).toBeGreaterThan(0);
    expect(getByText('15')).toBeTruthy();
    expect(getAllByText('11').length).toBeGreaterThan(0);
    expect(getAllByText('·')).toHaveLength(2);
  });

  test('renders an empty state when sections are absent', () => {
    const { getByText } = render(
      <RoundScorecardTables sections={[]} />
    );

    expect(getByText('No scorecard data for this round')).toBeTruthy();
  });
});
