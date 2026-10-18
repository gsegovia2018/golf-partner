import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import RoundFocusCard from '../RoundFocusCard';
import { msg } from '../../../store/statsMsg';

jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
const flush = () => act(() => new Promise((resolve) => setImmediate(resolve)));
async function renderCard(props) {
  const utils = render(wrap(<RoundFocusCard onOpenCoach={() => {}} {...props} />));
  await flush();
  return utils;
}

const target = {
  shot: 'approach', bucket: '100-150', kind: 'swing', lie: null,
  title: msg('stats.my.coach.ui.issue.approach.why.swing.start.right', { bucket: '100-150' }),
  cue: msg('stats.my.coach.plan.course.area.approach'),
};
const swing = {
  touched: true,
  thisRound: { kind: 'count', count: 2, total: 5 },
  before: { kind: 'count', count: 7, total: 10 },
  nowPct: 40,
  beforePct: 70,
};
const lieSummary = {
  touched: true,
  thisRound: { kind: 'lie', lie: 'uphill', count: 1, total: 6, shots: 4, greens: 3 },
  before: { kind: 'count', count: 5, total: 9 },
  nowPct: 17,
  beforePct: 56,
};
const verdict = (over) => ({ state: 'improving', level: 2, roundsSince: 3, roundsNeeded: 0, ...over });

describe('RoundFocusCard', () => {
  test('renders the overline, labelled bars with right-aligned values and the verdict + level', async () => {
    const { getByText, getByTestId } = await renderCard({ target, summary: swing, verdict: verdict() });
    expect(getByText('YOUR FOCUS')).toBeTruthy();
    expect(getByText('This round')).toBeTruthy();
    expect(getByText('Before the focus')).toBeTruthy();
    expect(getByText('2 of 5 tagged misses')).toBeTruthy();
    expect(getByText('7 of 10')).toBeTruthy();
    expect(getByText('Improving since you committed · Level 2 of 3')).toBeTruthy();
    expect(getByTestId('round-focus-card')).toBeTruthy();
  });

  test('each bar has an accessibility label with both values', async () => {
    const { getByLabelText } = await renderCard({ target, summary: swing, verdict: verdict() });
    expect(getByLabelText('This round: 2 of 5 tagged misses. Before the focus: 7 of 10')).toBeTruthy();
  });

  test('bar fills are the percents', async () => {
    const { getByTestId } = await renderCard({ target, summary: swing, verdict: verdict() });
    expect(getByTestId('round-focus-now-fill').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: '40%' })]),
    );
    expect(getByTestId('round-focus-before-fill').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: '70%' })]),
    );
  });

  test('a lie focus adds the encounters to the this-round value', async () => {
    const { getByText } = await renderCard({
      target: { ...target, kind: 'lie', lie: 'uphill' }, summary: lieSummary, verdict: verdict(),
    });
    expect(getByText('1 of 6 misses · 4 shots, 3 greens')).toBeTruthy();
    expect(getByText('5 of 9')).toBeTruthy();
  });

  test('singular shot and green', async () => {
    const one = { ...lieSummary, thisRound: { ...lieSummary.thisRound, shots: 1, greens: 1 } };
    const { getByText } = await renderCard({
      target: { ...target, kind: 'lie', lie: 'uphill' }, summary: one, verdict: verdict(),
    });
    expect(getByText('1 of 6 misses · 1 shot, 1 green')).toBeTruthy();
  });

  test('value rendering for an outcome focus with no percent bar', async () => {
    const summary = {
      touched: true,
      thisRound: { kind: 'value', value: 1, unit: 'perRound' },
      before: { kind: 'value', value: 2.5, unit: 'perRound' },
      nowPct: null,
      beforePct: null,
    };
    const { getByText, queryByTestId } = await renderCard({ target: { ...target, kind: 'outcome' }, summary, verdict: verdict() });
    expect(getByText('1.0 a round')).toBeTruthy();
    expect(getByText('2.5 a round')).toBeTruthy();
    expect(queryByTestId('round-focus-now-fill')).toBeNull();
  });

  test('no before value drops the before bar', async () => {
    const { queryByText } = await renderCard({ target, summary: { ...swing, before: null, beforePct: null }, verdict: verdict() });
    expect(queryByText('Before the focus')).toBeNull();
  });

  test.each([
    ['flat', 'Holding steady since you committed · Level 1 of 3', 1],
    ['worse', 'Getting worse since you committed · Level 1 of 3', 1],
    ['resolved', 'No longer flagged — nice work · Level 3 of 3', 3],
  ])('verdict state %s', async (state, text, level) => {
    const { getByText } = await renderCard({ target, summary: swing, verdict: verdict({ state, level }) });
    expect(getByText(text)).toBeTruthy();
  });

  test('needs more rounds shows the count and no level', async () => {
    const { getByText } = await renderCard({
      target, summary: swing, verdict: verdict({ state: 'needs-more-rounds', roundsNeeded: 2, level: 1 }),
    });
    expect(getByText('Play 2 more rounds for a verdict')).toBeTruthy();
  });

  test('needs more rounds with noData asks to play the focus shots', async () => {
    const { getByText } = await renderCard({
      target, summary: swing, verdict: verdict({ state: 'needs-more-rounds', roundsNeeded: 1, noData: true }),
    });
    expect(getByText('Play your focus shots to get a reading')).toBeTruthy();
  });

  test('no verdict renders no verdict line', async () => {
    const { queryByTestId } = await renderCard({ target, summary: swing, verdict: null });
    expect(queryByTestId('round-focus-verdict')).toBeNull();
  });

  test('Open Coach calls back', async () => {
    const onOpenCoach = jest.fn();
    const { getByText } = await renderCard({ target, summary: swing, verdict: verdict(), onOpenCoach });
    fireEvent.press(getByText('Open Coach ›'));
    expect(onOpenCoach).toHaveBeenCalledTimes(1);
  });

  test('renders nothing without a target or an untouched round', async () => {
    expect((await renderCard({ target: null, summary: swing })).toJSON()).toBeNull();
    expect((await renderCard({ target, summary: { ...swing, touched: false } })).toJSON()).toBeNull();
    expect((await renderCard({ target, summary: null })).toJSON()).toBeNull();
  });
});
