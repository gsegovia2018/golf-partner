import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
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
  test('renders the receipt: expected header, per-category costs, residual and gap', () => {
    const r = render(<SGReconciliationCard reconciliation={reconciliation} targetHandicap={18} />);
    // Header: overline target label, expected score, rounds meta.
    expect(r.getByText('EXPECTED · 18 HCP')).toBeTruthy();
    expect(r.getByText('90.0')).toBeTruthy();
    expect(r.getByText('AVG OF 6 ROUNDS')).toBeTruthy();
    // Line items are costs (sign-flipped SG): putting lost 2.1 strokes.
    expect(r.getByText('Putting')).toBeTruthy();
    expect(r.getByText('+2.10')).toBeTruthy();
    expect(r.getByText('In-between & untracked')).toBeTruthy();
    expect(r.getByText('-0.90')).toBeTruthy();
    // Total row + footnote keep the sums-to-the-gap invariant.
    expect(r.getByText('Your round')).toBeTruthy();
    expect(r.getByText(/sum to the \+4\.30-stroke gap/)).toBeTruthy();
  });

  test('receipt line items sum to actual minus expected', () => {
    const costs = [
      ...Object.values(reconciliation.byCategoryAvg).map((v) => -v),
      -reconciliation.residualAvg,
    ];
    const sum = costs.reduce((acc, v) => acc + v, 0);
    expect(sum).toBeCloseTo(reconciliation.actualAvg - reconciliation.expectedAvg, 5);
    expect(sum).toBeCloseTo(-reconciliation.gapAvg, 5);
  });

  test('the actual total counts up to the decimal score', async () => {
    const r = render(<SGReconciliationCard reconciliation={reconciliation} targetHandicap={18} />);
    await waitFor(() => expect(r.getByText('94.3')).toBeTruthy(), { timeout: 3000 });
  });

  test('labels the expected score as scratch without a target handicap', () => {
    const r = render(<SGReconciliationCard reconciliation={reconciliation} targetHandicap={0} />);
    expect(r.getByText('EXPECTED · SCRATCH')).toBeTruthy();
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
