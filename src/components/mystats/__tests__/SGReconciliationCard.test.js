import React from 'react';
import { render } from '@testing-library/react-native';
import SGReconciliationCard from '../SGReconciliationCard';

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

const reconciliation = {
  rounds: 6,
  expectedAvg: 90,
  actualAvg: 94.3,
  gapAvg: -4.3,
  byCategoryAvg: { offTheTee: -0.8, approach: -1.4, aroundGreen: 0.3, putting: -2.1, penalties: -1.2 },
  residualAvg: 0.9,
  perRound: [],
};

describe('SGReconciliationCard', () => {
  test('shows expected vs actual and every category plus the residual', () => {
    const r = render(<SGReconciliationCard reconciliation={reconciliation} targetHandicap={18} />);
    expect(r.getByText(/Expected for an 18-handicap: 90.0/)).toBeTruthy();
    expect(r.getByText(/You: 94.3/)).toBeTruthy();
    expect(r.getByText('Putting')).toBeTruthy();
    expect(r.getByText('-2.10')).toBeTruthy();
    expect(r.getByText('In-between & untracked')).toBeTruthy();
    expect(r.getByText('+0.90')).toBeTruthy();
    expect(r.getByText(/6 rounds/)).toBeTruthy();
  });
  test('renders nothing without reconciled rounds', () => {
    const r = render(
      <SGReconciliationCard
        reconciliation={{ rounds: 0, perRound: [], expectedAvg: null, actualAvg: null, gapAvg: null, byCategoryAvg: null, residualAvg: null }}
        targetHandicap={0}
      />,
    );
    expect(r.toJSON()).toBeNull();
  });
});
