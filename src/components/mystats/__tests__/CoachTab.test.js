import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import CoachTab from '../tabs/CoachTab';

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

const heroInsight = {
  id: 'putting:putting', group: 'fixFirst', area: 'putting', areaLabel: 'Putting',
  title: 'Putting', reason: 'Putting is costing 1.8 SG / round.', metric: '-1.8 SG / round',
  impact: -1.8, tone: 'bad', confidence: 'high',
};

const stats = {
  metrics: { avgPoints: 30 },
  form: { metrics: [], hasHistory: false },
  formSeries: { metrics: { avgPoints: [] } },
  coach: {
    hero: heroInsight,
    board: { fixFirst: [heroInsight], keepDoing: [], gettingBetter: [], gettingWorse: [], nextGains: [], watch: [] },
    practicePlan: [],
  },
  coachStrategy: [
    { id: 'lag-first-6plus', title: 'Lag first from 6+ m', reason: 'Three putts.', payoffPointsPerRound: 0.6, sample: 12, basis: 'your long putts' },
  ],
};

const focus = {
  insightId: 'putting:putting', area: 'putting', areaLabel: 'Putting', title: 'Putting',
  metric: '-1.8 SG / round', baselineImpact: -1.8, committedAt: '2026-07-15T00:00:00Z', roundCountAtCommit: 8,
};

describe('CoachTab focus + strategy wiring', () => {
  test('no focus: hero shows the commit button, no FocusCard', () => {
    const onCommit = jest.fn();
    const r = render(<CoachTab stats={stats} focus={null} focusVerdict={null} onCommitFocus={onCommit} onEndFocus={jest.fn()} />);
    fireEvent.press(r.getByLabelText('Make this my focus'));
    expect(onCommit).toHaveBeenCalledWith(heroInsight);
    expect(r.queryByText('Your Focus')).toBeNull();
  });
  test('active focus: FocusCard renders, commit button hidden', () => {
    const r = render(
      <CoachTab
        stats={stats}
        focus={focus}
        focusVerdict={{ state: 'needs-more-rounds', roundsSince: 0, roundsNeeded: 2, baseline: -1.8, current: null, currentMetric: null }}
        onCommitFocus={jest.fn()}
        onEndFocus={jest.fn()}
      />,
    );
    expect(r.getByText('Your Focus')).toBeTruthy();
    expect(r.queryByLabelText('Make this my focus')).toBeNull();
  });
  test('strategy tips render', () => {
    const r = render(<CoachTab stats={stats} focus={null} focusVerdict={null} onCommitFocus={jest.fn()} onEndFocus={jest.fn()} />);
    expect(r.getByText('Play smarter')).toBeTruthy();
    expect(r.getByText('Lag first from 6+ m')).toBeTruthy();
  });
});

const formStats = (direction, delta) => ({
  ...stats,
  form: {
    hasHistory: true,
    recentCount: 5,
    historyCount: 12,
    metrics: [{ key: 'avgPoints', direction, delta }],
  },
});

const formCardBg = (r) =>
  StyleSheet.flatten(r.getByTestId('current-form-card').props.style).backgroundColor;

describe('FormTrendCard status surface', () => {
  test('improving form tints the card with the green wash', () => {
    const r = render(<CoachTab stats={formStats('up', 2.1)} focus={null} focusVerdict={null} onCommitFocus={jest.fn()} onEndFocus={jest.fn()} />);
    expect(r.getByText('Improving lately')).toBeTruthy();
    expect(formCardBg(r)).toBe('#e6f0eb');
  });

  test('declining form tints the card with the red wash', () => {
    const r = render(<CoachTab stats={formStats('down', -1.8)} focus={null} focusVerdict={null} onCommitFocus={jest.fn()} onEndFocus={jest.fn()} />);
    expect(r.getByText('Trending down lately')).toBeTruthy();
    expect(formCardBg(r)).toBe('#fbeaec');
  });

  test('steady form keeps the plain card surface', () => {
    const r = render(<CoachTab stats={formStats('flat', null)} focus={null} focusVerdict={null} onCommitFocus={jest.fn()} onEndFocus={jest.fn()} />);
    expect(r.getByText('Holding steady')).toBeTruthy();
    expect(formCardBg(r)).toBe('#ffffff');
  });
});
