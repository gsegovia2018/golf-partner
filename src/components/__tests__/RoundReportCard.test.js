import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import RoundReportCard from '../RoundReportCard';

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

function card(tone, verdict) {
  return {
    round: {
      key: 'round-1',
      courseName: 'Pine',
      tournamentName: 'Cup',
      holesPlayed: 18,
      complete: true,
    },
    headline: {
      points: 29,
      perHole: 1.61,
      vsAvg: tone === 'bad' ? -6.9 : tone === 'good' ? 4.2 : 0,
      clearedBenchmark: tone === 'good',
      verdict,
      tone,
    },
    callouts: { bright: [], cost: [] },
    groups: [],
    hasHistory: true,
  };
}

describe('RoundReportCard', () => {
  test('colors the verdict card by headline tone', () => {
    const tough = render(wrap(
      <RoundReportCard card={card('bad', 'Tough day')} rounds={[]} selectedKey="round-1" onSelect={() => {}} />
    ));
    const strong = render(wrap(
      <RoundReportCard card={card('good', 'Strong round')} rounds={[]} selectedKey="round-1" onSelect={() => {}} />
    ));
    const solid = render(wrap(
      <RoundReportCard card={card('neutral', 'Solid round')} rounds={[]} selectedKey="round-1" onSelect={() => {}} />
    ));

    const toughStyle = StyleSheet.flatten(tough.getByTestId('report-card-verdict').props.style);
    const strongStyle = StyleSheet.flatten(strong.getByTestId('report-card-verdict').props.style);
    const solidStyle = StyleSheet.flatten(solid.getByTestId('report-card-verdict').props.style);

    expect(toughStyle.borderColor).not.toBe(solidStyle.borderColor);
    expect(strongStyle.borderColor).not.toBe(solidStyle.borderColor);
    expect(tough.getByTestId('report-card-verdict-phrase').props.style).toEqual(expect.arrayContaining([
      expect.objectContaining({ color: expect.any(String) }),
    ]));
  });
});
