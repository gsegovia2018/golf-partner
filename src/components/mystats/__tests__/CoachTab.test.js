import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
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
