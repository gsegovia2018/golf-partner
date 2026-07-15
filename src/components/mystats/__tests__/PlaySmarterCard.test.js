import React from 'react';
import { render } from '@testing-library/react-native';
import PlaySmarterCard from '../PlaySmarterCard';
import { statExplainers } from '../statExplainers';

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

const tips = [
  { id: 'layup-150-200', title: 'Lay up from 150-200 m', reason: 'Long approaches leak.', payoffPointsPerRound: 0.8, sample: 19, basis: 'your approach buckets' },
  { id: 'lag-first-6plus', title: 'Lag first from 6+ m', reason: 'Three putts.', payoffPointsPerRound: 0.6, sample: 12, basis: 'your long putts' },
];

describe('PlaySmarterCard', () => {
  test('renders a row per tip with payoff and evidence', () => {
    const r = render(<PlaySmarterCard tips={tips} />);
    expect(r.getByText('Play smarter')).toBeTruthy();
    expect(r.getByText('Lay up from 150-200 m')).toBeTruthy();
    expect(r.getByText('≈ +0.8 pts / round')).toBeTruthy();
    expect(r.getByText('your approach buckets · 19 samples')).toBeTruthy();
  });
  test('renders nothing without tips', () => {
    expect(render(<PlaySmarterCard tips={[]} />).toJSON()).toBeNull();
    expect(render(<PlaySmarterCard tips={null} />).toJSON()).toBeNull();
  });
});

describe('coach explainers', () => {
  test('coachPractice and playSmarter entries exist with copy', () => {
    expect(statExplainers.coachPractice.title).toBe('Practice Plan');
    expect(statExplainers.playSmarter.title).toBe('Play Smarter');
    expect(statExplainers.playSmarter.explainer).toContain('1 stroke gained ≈ 1 Stableford point');
  });
});
