import React from 'react';
import { render } from '@testing-library/react-native';
import PracticePlanCard from '../PracticePlanCard';

jest.mock('../../../theme/ThemeContext', () => ({
  useTheme: () => {
    const { light, semantic, typography, fonts, spacing, radius } = jest.requireActual('../../../theme/tokens');
    return {
      theme: {
        ...light,
        semantic,
        masters: semantic.masters,
        destructive: semantic.destructive.light,
        pairA: semantic.pair.a.light,
        pairB: semantic.pair.b.light,
        scoreColor: (level) => semantic.score[level].light,
        typography,
        fonts,
        spacing,
        radius,
        mode: 'light',
        isDark: false,
      },
    };
  },
}));

const plan = [
  {
    id: 'practice-first', role: 'practiceFirst', title: 'Practice first: Putting',
    instruction: 'Spend the first block on putting.', reason: 'Putting is costing 1.8 SG / round.',
    sourceInsightId: 'putting:putting',
    drill: { id: 'putt-lag-ladder', title: 'Lag ladder', instruction: 'Take 10 putts from 8 m…', passTarget: '7 of 10 finish inside 1 m of the hole', location: 'green' },
    payoffPointsPerRound: 1.8,
  },
  {
    id: 'secondary-focus', role: 'secondaryFocus', title: 'Secondary focus',
    instruction: 'Review the strongest recent form trend.', reason: 'Balance.',
  },
];

describe('PracticePlanCard drills', () => {
  test('renders drill title, pass target, location and payoff', () => {
    const r = render(<PracticePlanCard plan={plan} />);
    expect(r.getByText('Lag ladder')).toBeTruthy();
    expect(r.getByText('Pass: 7 of 10 finish inside 1 m of the hole')).toBeTruthy();
    expect(r.getByText('green')).toBeTruthy();
    expect(r.getByText('worth ≈ 1.8 pts / round')).toBeTruthy();
  });
  test('items without a drill render as before', () => {
    const r = render(<PracticePlanCard plan={plan} />);
    expect(r.getByText('Review the strongest recent form trend.')).toBeTruthy();
    expect(r.queryAllByText(/Pass:/)).toHaveLength(1);
  });
});
