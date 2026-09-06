import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import RoundReportCard from '../RoundReportCard';

// The verdict hero's CountUpText count-up (points headline) runs on real
// setTimeout/requestAnimationFrame timers that outlive these tests' sync
// assertions, causing act() warnings unrelated to what's under test here.
// Reduced motion is CountUpText's own first-class "skip the animation" path
// (see ReportVerdictHero's `disabled={reduced}`), so force it on.
jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual('../../../__mocks__/react-native-reanimated'),
  useReducedMotion: () => true,
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

// ThemeProvider reads its persisted preference from AsyncStorage in a
// useEffect; flush that pending promise (inside act) after every render so
// its follow-up setState doesn't land outside act().
const flush = () => act(() => new Promise((resolve) => setImmediate(resolve)));
async function renderCard(ui) {
  const utils = render(wrap(ui));
  await flush();
  return utils;
}

const pph = (label, group, value, deltaVsAvg) => ({
  label, group, value, baseline: null, deltaVsAvg, deltaVs2: +(value - 2).toFixed(2), holes: 4, polarity: 'higher',
});

function card(tone, verdict, extras = {}) {
  return {
    round: {
      key: 'round-1', courseName: 'Pine', tournamentName: 'Cup',
      holesPlayed: 18, complete: true,
    },
    headline: {
      points: 29, perHole: 1.61,
      vsAvg: tone === 'bad' ? -6.9 : tone === 'good' ? 4.2 : 0,
      clearedBenchmark: tone === 'good', verdict, tone,
    },
    callouts: { bright: [], cost: [] },
    groups: [],
    hasHistory: true,
    ...extras,
  };
}

const groups = [
  { key: 'course', label: 'Where on the course',
    cells: [pph('Par 3s', 'course', 1.25, -0.7), pph('Par 5s', 'course', 2.8, 0.9)] },
  { key: 'timing', label: 'When in the round',
    cells: [pph('Opening 3', 'timing', 1.33, -0.6)] },
];

describe('RoundReportCard', () => {
  test('fills the verdict hero by headline tone', async () => {
    const tough = await renderCard(
      <RoundReportCard card={card('bad', 'Tough day')} rounds={[]} selectedKey="round-1" onSelect={() => {}} />
    );
    const strong = await renderCard(
      <RoundReportCard card={card('good', 'Strong round')} rounds={[]} selectedKey="round-1" onSelect={() => {}} />
    );
    const toughBg = StyleSheet.flatten(tough.getByTestId('report-card-verdict').props.style).backgroundColor;
    const strongBg = StyleSheet.flatten(strong.getByTestId('report-card-verdict').props.style).backgroundColor;
    expect(toughBg).not.toBe(strongBg);
    expect(strong.getByTestId('report-card-verdict-phrase')).toBeTruthy();
  });

  test('renders callout tiles when the card has callouts', async () => {
    const withCallouts = card('good', 'Strong round', {
      callouts: { bright: [pph('Par 5s', 'course', 2.8, 0.9)], cost: [pph('Par 3s', 'course', 1.25, -0.7)] },
    });
    const { getByText } = await renderCard(
      <RoundReportCard card={withCallouts} rounds={[]} selectedKey="round-1" onSelect={() => {}} />
    );
    expect(getByText('BRIGHT SPOT')).toBeTruthy();
    expect(getByText('COST YOU POINTS')).toBeTruthy();
  });

  test('renders chapters with the first one expanded', async () => {
    const { getByText, queryByText } = await renderCard(
      <RoundReportCard card={card('good', 'Strong round', { groups })} rounds={[]} selectedKey="round-1" onSelect={() => {}} />
    );
    expect(getByText('Par 3s')).toBeTruthy();          // first chapter open
    expect(queryByText('Opening 3')).toBeNull();       // second collapsed
    fireEvent.press(getByText('When in the round'));
    expect(getByText('Opening 3')).toBeTruthy();
  });

  test('Change pill opens the round picker modal', async () => {
    const { getByText } = await renderCard(
      <RoundReportCard card={card('good', 'Strong round')} rounds={[]} selectedKey="round-1" onSelect={() => {}} />
    );
    fireEvent.press(getByText('Change'));
    expect(getByText('Choose a round')).toBeTruthy();
  });

  test('renders a Round Stats link that fires onOpenRound', async () => {
    const onOpenRound = jest.fn();
    const { getByText, getByTestId } = await renderCard(
      <RoundReportCard
        card={card('good', 'Strong round')} rounds={[]} selectedKey="round-1"
        onSelect={() => {}} onOpenRound={onOpenRound}
      />
    );
    expect(getByTestId('report-card-open-round')).toBeTruthy();
    fireEvent.press(getByText('Round Stats'));
    expect(onOpenRound).toHaveBeenCalledTimes(1);
  });

  test('hides the Round Stats link when onOpenRound is not provided', async () => {
    const { queryByText } = await renderCard(
      <RoundReportCard card={card('good', 'Strong round')} rounds={[]} selectedKey="round-1" onSelect={() => {}} />
    );
    expect(queryByText('Round Stats')).toBeNull();
  });
});
