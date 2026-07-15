import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import FocusCard from '../FocusCard';
import CoachHero from '../CoachHero';

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

const focus = {
  insightId: 'putting:putting', area: 'putting', areaLabel: 'Putting',
  title: '6+ m putts', metric: '-1.8 SG / round', baselineImpact: -1.8,
  committedAt: '2026-07-15T00:00:00Z', roundCountAtCommit: 8,
};

describe('FocusCard', () => {
  test('renders verdict copy and matched drill', () => {
    const r = render(
      <FocusCard
        focus={focus}
        verdict={{ state: 'improving', roundsSince: 3, baseline: -1.8, current: -1.1, currentMetric: '-1.1 SG / round', delta: 0.7 }}
        onEndFocus={jest.fn()}
      />,
    );
    expect(r.getByText('6+ m putts')).toBeTruthy();
    expect(r.getByText('Improving since you committed')).toBeTruthy();
    expect(r.getByText('-1.8 SG / round → -1.1 SG / round')).toBeTruthy();
    expect(r.getByText('Lag ladder')).toBeTruthy(); // bucket-matched drill
  });
  test('needs-more-rounds copy', () => {
    const r = render(
      <FocusCard focus={focus} verdict={{ state: 'needs-more-rounds', roundsSince: 1, roundsNeeded: 1, baseline: -1.8, current: null, currentMetric: null }} onEndFocus={jest.fn()} />,
    );
    expect(r.getByText('Play 1 more round for a verdict')).toBeTruthy();
  });
  test('end focus fires', () => {
    const onEnd = jest.fn();
    const r = render(<FocusCard focus={focus} verdict={null} onEndFocus={onEnd} />);
    fireEvent.press(r.getByLabelText('End focus'));
    expect(onEnd).toHaveBeenCalled();
  });
  test('null without focus', () => {
    expect(render(<FocusCard focus={null} verdict={null} onEndFocus={jest.fn()} />).toJSON()).toBeNull();
  });
});

describe('CoachHero focus button', () => {
  const insight = { id: 'putting:putting', group: 'fixFirst', area: 'putting', areaLabel: 'Putting', title: '6+ m putts', reason: 'r', metric: '-1.8 SG / round', impact: -1.8, tone: 'bad' };
  test('button commits the insight', () => {
    const onCommit = jest.fn();
    const r = render(<CoachHero insight={insight} onCommitFocus={onCommit} focusActive={false} />);
    fireEvent.press(r.getByLabelText('Make this my focus'));
    expect(onCommit).toHaveBeenCalledWith(insight);
  });
  test('hidden while a focus is active or without handler', () => {
    const withFocus = render(<CoachHero insight={insight} onCommitFocus={jest.fn()} focusActive />);
    expect(withFocus.queryByLabelText('Make this my focus')).toBeNull();
    const noHandler = render(<CoachHero insight={insight} />);
    expect(noHandler.queryByLabelText('Make this my focus')).toBeNull();
  });
});
