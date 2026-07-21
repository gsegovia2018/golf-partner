import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import ReportVerdictHero from '../ReportVerdictHero';

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const headline = (tone) => ({
  points: 39, perHole: 2.17, vsAvg: tone === 'bad' ? -6.9 : 4.2,
  clearedBenchmark: tone !== 'bad', verdict: 'Strong round', tone,
});
const round = { holesPlayed: 18, complete: true };

describe('ReportVerdictHero', () => {
  test('fills the hero by tone', () => {
    const good = render(wrap(<ReportVerdictHero headline={headline('good')} round={round} hasHistory />));
    const bad = render(wrap(<ReportVerdictHero headline={headline('bad')} round={round} hasHistory />));
    const goodBg = StyleSheet.flatten(good.getByTestId('report-card-verdict').props.style).backgroundColor;
    const badBg = StyleSheet.flatten(bad.getByTestId('report-card-verdict').props.style).backgroundColor;
    expect(goodBg).not.toBe(badBg);
  });

  test('shows chips for per-hole, vs-avg and benchmark', () => {
    const { getByText } = render(wrap(<ReportVerdictHero headline={headline('good')} round={round} hasHistory />));
    expect(getByText('2.17 / hole')).toBeTruthy();
    expect(getByText('+4.2 vs your avg')).toBeTruthy();
    expect(getByText(/above 2.0 mark/)).toBeTruthy();
  });

  test('hides the vs-avg chip and explains when there is no history', () => {
    const { queryByText, getByText } = render(wrap(
      <ReportVerdictHero headline={{ ...headline('good'), vsAvg: null }} round={round} hasHistory={false} />
    ));
    expect(queryByText(/vs your avg/)).toBeNull();
    expect(getByText(/more rounds/)).toBeTruthy();
  });

  test('flags incomplete rounds', () => {
    const { getByText } = render(wrap(
      <ReportVerdictHero headline={headline('good')} round={{ holesPlayed: 13, complete: false }} hasHistory />
    ));
    expect(getByText(/through 13 holes/)).toBeTruthy();
  });
});
