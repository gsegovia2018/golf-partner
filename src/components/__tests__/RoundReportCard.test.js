import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import RoundReportCard from '../RoundReportCard';

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

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
  test('fills the verdict hero by headline tone', () => {
    const tough = render(wrap(
      <RoundReportCard card={card('bad', 'Tough day')} rounds={[]} selectedKey="round-1" onSelect={() => {}} />
    ));
    const strong = render(wrap(
      <RoundReportCard card={card('good', 'Strong round')} rounds={[]} selectedKey="round-1" onSelect={() => {}} />
    ));
    const toughBg = StyleSheet.flatten(tough.getByTestId('report-card-verdict').props.style).backgroundColor;
    const strongBg = StyleSheet.flatten(strong.getByTestId('report-card-verdict').props.style).backgroundColor;
    expect(toughBg).not.toBe(strongBg);
    expect(strong.getByTestId('report-card-verdict-phrase')).toBeTruthy();
  });

  test('renders callout tiles when the card has callouts', () => {
    const withCallouts = card('good', 'Strong round', {
      callouts: { bright: [pph('Par 5s', 'course', 2.8, 0.9)], cost: [pph('Par 3s', 'course', 1.25, -0.7)] },
    });
    const { getByText } = render(wrap(
      <RoundReportCard card={withCallouts} rounds={[]} selectedKey="round-1" onSelect={() => {}} />
    ));
    expect(getByText('BRIGHT SPOT')).toBeTruthy();
    expect(getByText('COST YOU POINTS')).toBeTruthy();
  });

  test('renders chapters with the first one expanded', () => {
    const { getByText, queryByText } = render(wrap(
      <RoundReportCard card={card('good', 'Strong round', { groups })} rounds={[]} selectedKey="round-1" onSelect={() => {}} />
    ));
    expect(getByText('Par 3s')).toBeTruthy();          // first chapter open
    expect(queryByText('Opening 3')).toBeNull();       // second collapsed
    fireEvent.press(getByText('When in the round'));
    expect(getByText('Opening 3')).toBeTruthy();
  });

  test('Change pill opens the round picker modal', () => {
    const { getByText } = render(wrap(
      <RoundReportCard card={card('good', 'Strong round')} rounds={[]} selectedKey="round-1" onSelect={() => {}} />
    ));
    fireEvent.press(getByText('Change'));
    expect(getByText('Choose a round')).toBeTruthy();
  });

  test('renders a Round Stats link that fires onOpenRound', () => {
    const onOpenRound = jest.fn();
    const { getByText, getByTestId } = render(wrap(
      <RoundReportCard
        card={card('good', 'Strong round')} rounds={[]} selectedKey="round-1"
        onSelect={() => {}} onOpenRound={onOpenRound}
      />
    ));
    expect(getByTestId('report-card-open-round')).toBeTruthy();
    fireEvent.press(getByText('Round Stats'));
    expect(onOpenRound).toHaveBeenCalledTimes(1);
  });

  test('hides the Round Stats link when onOpenRound is not provided', () => {
    const { queryByText } = render(wrap(
      <RoundReportCard card={card('good', 'Strong round')} rounds={[]} selectedKey="round-1" onSelect={() => {}} />
    ));
    expect(queryByText('Round Stats')).toBeNull();
  });
});
