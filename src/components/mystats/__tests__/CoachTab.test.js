import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import CoachTab from '../tabs/CoachTab';
import {
  onePutting, tieStats, fewRounds, approachShort, week, focusRecord, verdictOf,
} from './coachFixtures';

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

const tabProps = (stats, opts = {}, props = {}) => ({
  stats,
  targetHandicap: 15,
  week: week(stats, opts),
  focus: opts.focus ?? null,
  focusVerdict: opts.verdict ?? null,
  onCommitFocus: jest.fn(),
  onEndFocus: jest.fn(),
  onChangeMinutes: jest.fn(),
  onDismissNotice: jest.fn(),
  swingSupport: { supported: false, reason: 'web' },
  ...props,
});
const renderTab = (stats, opts, props) => render(<CoachTab {...tabProps(stats, opts, props)} />);
const order = (r, ids) => {
  const json = JSON.stringify(r.toJSON());
  return ids.map((id) => json.indexOf(`"${id}"`));
};

// The stats the form tests below need, on the plain shape.
const stats = onePutting();

describe('CoachTab composition (design B)', () => {
  test('card order: target, diagnosis, plan, form, board; no focus card without a focus', () => {
    const r = renderTab(onePutting());
    const at = order(r, ['diagnosis-card', 'weekly-plan-card', 'current-form-card', 'coach-board']);
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(r.queryByTestId('focus-card')).toBeNull();
    expect(r.getByText(/vs 15-handicap target/)).toBeTruthy();
  });

  test('with a focus the focus card comes first, after the target row, and the buttons are gone', () => {
    const stats2 = approachShort();
    const r = renderTab(stats2, { focus: focusRecord(), verdict: verdictOf() });
    const at = order(r, ['focus-card', 'diagnosis-card', 'weekly-plan-card']);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(at[0]).toBeGreaterThan(0);
    expect(r.queryByLabelText('Work on this')).toBeNull();
    expect(r.getByText('Your Focus')).toBeTruthy();
  });

  test('no focus: the diagnosis card commits the chain', () => {
    const onCommit = jest.fn();
    const r = renderTab(onePutting(), {}, { onCommitFocus: onCommit });
    fireEvent.press(r.getByLabelText('Work on this'));
    expect(onCommit.mock.calls[0][0].leak.id).toBe('leak:putting:6+');
  });

  test('the minutes sheet writes the minutes upstream', () => {
    const onChangeMinutes = jest.fn();
    const r = renderTab(onePutting(), {}, { onChangeMinutes });
    fireEvent.press(r.getByTestId('plan-change-minutes'));
    fireEvent.press(r.getByLabelText('90 min a week'));
    expect(onChangeMinutes).toHaveBeenCalledWith(90);
  });

  test('the board is folded as More findings with counts, and expands', () => {
    const r = renderTab(onePutting());
    const row = r.getByTestId('more-findings');
    expect(row.props.accessibilityState.expanded).toBe(false);
    expect(r.getByText('Improve now 1 · Protect 1')).toBeTruthy();
    expect(r.queryByText('Off the tee')).toBeNull();
    fireEvent.press(row);
    expect(r.getByTestId('more-findings').props.accessibilityState.expanded).toBe(true);
    expect(r.getByText('Off the tee')).toBeTruthy();
  });

  test('the board pill comes from the plan; the top leak is not a board row', () => {
    const r = renderTab(onePutting(), { minutesPerWeek: 120 });
    fireEvent.press(r.getByTestId('more-findings'));
    // the second leak (approach) is a next gain with its range session in the plan
    expect(r.getAllByText(/^This week: Range · \d+ min$/).length).toBeGreaterThan(0);
    expect(r.getAllByText('Fix first')).toHaveLength(1); // the diagnosis badge, not a board group
  });

  test('Play smarter keeps the tips the chain does not show', () => {
    const s = onePutting();
    s.coachStrategy.push({
      id: 'tee-club-down', causeId: 'cause:tee:trouble:driver', titleMsg: { key: 'stats.my.tip.clubDown.title' },
      reasonMsg: { key: 'stats.my.tip.clubDown.reason', params: { pct: 28, sg: 0.8 } }, payoffPointsPerRound: 0.5, sample: 32,
      basisMsg: { key: 'stats.my.tip.clubDown.basis' },
    });
    const r = renderTab(s);
    expect(r.getByText('Play smarter')).toBeTruthy();
    expect(r.getAllByText(/^Lag first from 6\+ m/)).toHaveLength(1); // in Play smarter only
    expect(r.getByText('Club down on tight tee shots')).toBeTruthy();
  });

  test('Play smarter shows the tip that used to sit in the diagnosis chain', () => {
    const r = renderTab(onePutting());
    expect(r.getByText('Play smarter')).toBeTruthy();
    expect(r.getAllByText(/^Lag first from 6\+ m/)).toHaveLength(1);
  });

  test('the old-focus notice shows once and can be dismissed', () => {
    const onDismiss = jest.fn();
    const r = renderTab(onePutting(), {}, { focusNotice: { kind: 'v1-closed', closedAt: '2026-10-16T08:00:00Z' }, onDismissNotice: onDismiss });
    expect(r.getByText('Your old focus was closed; pick a new one.')).toBeTruthy();
    fireEvent.press(r.getByLabelText('Dismiss'));
    expect(onDismiss).toHaveBeenCalled();
    expect(renderTab(onePutting()).queryByTestId('focus-notice')).toBeNull();
  });

  test('the since-commit notice says the focus is now judged since it started, and dismisses', () => {
    const onDismiss = jest.fn();
    const r = renderTab(onePutting(), {}, { focusNotice: { kind: 'since-commit', at: '2026-10-18T08:00:00Z' }, onDismissNotice: onDismiss });
    expect(r.getByText('Your focus is now judged only on rounds since you started it.')).toBeTruthy();
    expect(r.queryByText('Your old focus was closed; pick a new one.')).toBeNull();
    fireEvent.press(r.getByLabelText('Dismiss'));
    expect(onDismiss).toHaveBeenCalled();
  });

  test('a notice of an unknown kind shows nothing', () => {
    const r = renderTab(onePutting(), {}, { focusNotice: { kind: 'something-new' }, onDismissNotice: jest.fn() });
    expect(r.queryByTestId('focus-notice')).toBeNull();
  });

  test('few rounds: no focus button, no board crash, plan still shown', () => {
    const r = renderTab(fewRounds());
    expect(r.queryByLabelText('Work on this')).toBeNull();
    expect(r.getByText('Not enough rounds to rank your leaks yet')).toBeTruthy();
    expect(r.getByTestId('weekly-plan-card')).toBeTruthy();
  });

  test('tie: both focus buttons, both chains', () => {
    const r = renderTab(tieStats());
    expect(r.getByLabelText('Work on Approach')).toBeTruthy();
    expect(r.getByLabelText('Work on Off the tee')).toBeTruthy();
  });

  test('without a week (stats before the diagnosis) the tab still renders its form and board', () => {
    const r = render(<CoachTab stats={{ ...stats, coachDiagnosis: undefined }} focus={null} focusVerdict={null} />);
    expect(r.getByText('Current form')).toBeTruthy();
    expect(r.queryByTestId('diagnosis-card')).toBeNull();
  });
});

const formStats = (direction, delta) => ({
  ...stats,
  form: {
    hasHistory: true,
    recentCount: 5,
    historyCount: 12,
    // The form card reads avgDifferential — points can't carry a trend
    // across a handicap change. `direction` is already polarity-aware.
    metrics: [{ key: 'avgDifferential', direction, delta }],
  },
});

const formCardBg = (r) =>
  StyleSheet.flatten(r.getByTestId('current-form-card').props.style).backgroundColor;

describe('FormTrendCard status surface', () => {
  test('improving form tints the card with the green wash', () => {
    const r = render(<CoachTab stats={formStats('up', -2.1)} focus={null} focusVerdict={null} onCommitFocus={jest.fn()} onEndFocus={jest.fn()} />);
    expect(r.getByText('Improving lately')).toBeTruthy();
    expect(formCardBg(r)).toBe('#e6f0eb');
  });

  test('declining form tints the card with the red wash', () => {
    const r = render(<CoachTab stats={formStats('down', 1.8)} focus={null} focusVerdict={null} onCommitFocus={jest.fn()} onEndFocus={jest.fn()} />);
    expect(r.getByText('Trending down lately')).toBeTruthy();
    expect(formCardBg(r)).toBe('rgba(200,16,46,0.07)');
  });

  test('steady form keeps the plain card surface', () => {
    const r = render(<CoachTab stats={formStats('flat', null)} focus={null} focusVerdict={null} onCommitFocus={jest.fn()} onEndFocus={jest.fn()} />);
    expect(r.getByText('Holding steady')).toBeTruthy();
    expect(formCardBg(r)).toBe('#ffffff');
  });
});
