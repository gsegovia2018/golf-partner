import React from 'react';
import { StyleSheet } from 'react-native';
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
  v: 2,
  leakId: 'leak:approach:100-150',
  category: 'approach',
  bucket: '100-150',
  causeId: 'cause:approach:short',
  metricKey: 'approach.shortRate.100-150',
  baselineValue: 71,
  committedAt: '2026-10-02T09:00:00Z',
  roundCountAtCommit: 9,
};
const verdict = (over = {}) => ({
  state: 'improving', early: true, roundsSince: 3, level: 2, unit: 'percent', baseline: 71, current: 48, delta: 23, ...over,
});

describe('FocusCard (v2)', () => {
  test('improving, early read: before to after in the metric unit, level line', () => {
    const r = render(<FocusCard focus={focus} verdict={verdict()} onEndFocus={jest.fn()} />);
    expect(r.getByText('Approach · 100-150 m')).toBeTruthy();
    expect(r.getByText('Short misses from 100-150 m')).toBeTruthy();
    expect(r.getByText('Improving since you committed')).toBeTruthy();
    expect(r.getByText('Early read: 3 rounds in, the verdict settles at 4.')).toBeTruthy();
    const ba = r.getByTestId('focus-before-after');
    expect(ba).toBeTruthy();
    expect(r.getByText('71%')).toBeTruthy();
    expect(r.getByText('48%')).toBeTruthy();
    expect(r.getByText('At commit')).toBeTruthy();
    expect(r.getByText('Now')).toBeTruthy();
    expect(r.getByTestId('focus-level').props.children).toBe('Level 2 of 3 · 3 rounds in · since 2 Oct');
    expect(r.queryByTestId('focus-badge')).toBeNull();
    expect(r.queryByText('Your focus')).toBeNull(); // the title is the only "Your Focus"
  });

  test('no early read once the verdict has settled', () => {
    const r = render(<FocusCard focus={focus} verdict={verdict({ early: false, roundsSince: 5 })} onEndFocus={jest.fn()} />);
    expect(r.queryByTestId('focus-early')).toBeNull();
  });

  test('sg metrics read with their sign and unit', () => {
    const r = render(
      <FocusCard
        focus={{ ...focus, category: 'putting', bucket: null, metricKey: 'sg.putting' }}
        verdict={verdict({ unit: 'sgPerRound', baseline: -1.4, current: -0.9 })}
        onEndFocus={jest.fn()}
      />,
    );
    expect(r.getByText('-1.40 SG / round')).toBeTruthy();
    expect(r.getByText('-0.90 SG / round')).toBeTruthy();
  });

  test('worse reads in words and tone, flat and resolved too', () => {
    const worse = render(<FocusCard focus={focus} verdict={verdict({ state: 'worse', current: 80 })} onEndFocus={jest.fn()} />);
    expect(worse.getByText('Getting worse since you committed')).toBeTruthy();
    const flat = render(<FocusCard focus={focus} verdict={verdict({ state: 'flat', current: 70 })} onEndFocus={jest.fn()} />);
    expect(flat.getByText('Holding steady since you committed')).toBeTruthy();
    const done = render(<FocusCard focus={focus} verdict={verdict({ state: 'resolved', current: null, early: false })} onEndFocus={jest.fn()} />);
    expect(done.getByText('No longer flagged — nice work')).toBeTruthy();
    expect(done.getByText('No reading yet for this metric.')).toBeTruthy();
  });

  test('improving at level 3 says it is ready to move on', () => {
    const r = render(<FocusCard focus={focus} verdict={verdict({ level: 3, roundsSince: 5, early: false })} onEndFocus={jest.fn()} />);
    expect(r.getByText('Ready to move on: end this focus and pick the next one.')).toBeTruthy();
    const lower = render(<FocusCard focus={focus} verdict={verdict({ level: 2 })} onEndFocus={jest.fn()} />);
    expect(lower.queryByText(/Ready to move on/)).toBeNull();
  });

  test('shows the recalibration note when the focus was rebased', () => {
    const r = render(
      <FocusCard
        focus={{ ...focus, rebasedAt: '2026-10-16T08:00:00Z' }}
        verdict={{ state: 'needs-more-rounds', roundsNeeded: 2, roundsSince: 0, level: 1, unit: 'percent', baseline: 71, current: null, early: true }}
        onEndFocus={jest.fn()}
      />,
    );
    expect(r.getByText('Baselines recalibrated on 16 Oct — progress is measured from then.')).toBeTruthy();
  });

  test('says so when a changed target handicap restarted the verdict', () => {
    const verdictNow = { state: 'needs-more-rounds', roundsNeeded: 2, roundsSince: 4, level: 3, unit: 'percent', baseline: 71, current: null, early: true };
    const rebased = { ...focus, rebasedAt: '2026-10-16T08:00:00Z' };
    const r = render(<FocusCard focus={{ ...rebased, rebaseReason: { kind: 'target', from: 15, to: 0 } }} verdict={verdictNow} onEndFocus={jest.fn()} />);
    expect(r.getByText("Target changed to scratch on 16 Oct: the verdict restarts from today's numbers.")).toBeTruthy();
    expect(r.queryByText(/Baselines recalibrated/)).toBeNull();
    const nine = render(<FocusCard focus={{ ...rebased, rebaseReason: { kind: 'target', from: 0, to: 9 } }} verdict={verdictNow} onEndFocus={jest.fn()} />);
    expect(nine.getByText(/^Target changed to 9 on 16 Oct/)).toBeTruthy();
  });

  test('needs-more-rounds copy, with no early read yet', () => {
    const r = render(
      <FocusCard
        focus={focus}
        verdict={{ state: 'needs-more-rounds', roundsSince: 1, roundsNeeded: 1, level: 1, unit: 'percent', baseline: 71, current: null, early: true }}
        onEndFocus={jest.fn()}
      />,
    );
    expect(r.getByText('Play 1 more round for a verdict')).toBeTruthy();
    expect(r.queryByTestId('focus-early')).toBeNull();
  });

  test('end focus fires and is a 44 px target', () => {
    const onEnd = jest.fn();
    const r = render(<FocusCard focus={focus} verdict={null} onEndFocus={onEnd} />);
    fireEvent.press(r.getByLabelText('End focus'));
    expect(onEnd).toHaveBeenCalled();
    expect(StyleSheet.flatten(r.getByLabelText('End focus').props.style).minHeight).toBeGreaterThanOrEqual(44);
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
  test('shows the points equivalent when present', () => {
    const r = render(<CoachHero insight={{ ...insight, pointsPerRound: -1.8 }} />);
    expect(r.getByText('≈ -1.8 pts / round')).toBeTruthy();
  });
  test('no points caption without pointsPerRound', () => {
    const r = render(<CoachHero insight={insight} />);
    expect(r.queryByText(/pts \/ round/)).toBeNull();
  });
});
