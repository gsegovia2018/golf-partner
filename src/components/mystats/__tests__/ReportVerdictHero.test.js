import React from 'react';
import { StyleSheet } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import ReportVerdictHero from '../ReportVerdictHero';

// The hero's CountUpText count-up (points headline) runs on real
// setTimeout/requestAnimationFrame timers that outlive these tests' sync
// assertions, causing act() warnings unrelated to what's under test here.
// Reduced motion is CountUpText's own first-class "skip the animation" path
// (see ReportVerdictHero's `disabled={reduced}`), so force it on.
jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual('../../../../__mocks__/react-native-reanimated'),
  useReducedMotion: () => true,
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

// ThemeProvider reads its persisted preference from AsyncStorage in a
// useEffect; flush that pending promise (inside act) after every render so
// its follow-up setState doesn't land outside act().
const flush = () => act(() => new Promise((resolve) => setImmediate(resolve)));
async function renderHero(ui) {
  const utils = render(wrap(ui));
  await flush();
  return utils;
}

const headline = (tone) => ({
  points: 39, perHole: 2.17, vsAvg: tone === 'bad' ? -6.9 : 4.2,
  clearedBenchmark: tone !== 'bad', verdict: 'Strong round', tone,
});
const round = { holesPlayed: 18, complete: true };

describe('ReportVerdictHero', () => {
  test('fills the hero by tone', async () => {
    const good = await renderHero(<ReportVerdictHero headline={headline('good')} round={round} hasHistory />);
    const bad = await renderHero(<ReportVerdictHero headline={headline('bad')} round={round} hasHistory />);
    const goodBg = StyleSheet.flatten(good.getByTestId('report-card-verdict').props.style).backgroundColor;
    const badBg = StyleSheet.flatten(bad.getByTestId('report-card-verdict').props.style).backgroundColor;
    expect(goodBg).not.toBe(badBg);
  });

  test('shows chips for per-hole, vs-avg and benchmark', async () => {
    const { getByText } = await renderHero(<ReportVerdictHero headline={headline('good')} round={round} hasHistory />);
    expect(getByText('2.17 / hole')).toBeTruthy();
    expect(getByText('+4.2 vs your avg')).toBeTruthy();
    expect(getByText(/above 2.0 mark/)).toBeTruthy();
  });

  test('hides the vs-avg chip and explains when there is no history', async () => {
    const { queryByText, getByText } = await renderHero(
      <ReportVerdictHero headline={{ ...headline('good'), vsAvg: null }} round={round} hasHistory={false} />
    );
    expect(queryByText(/vs your avg/)).toBeNull();
    expect(getByText(/more rounds/)).toBeTruthy();
  });

  test('flags incomplete rounds', async () => {
    const { getByText } = await renderHero(
      <ReportVerdictHero headline={headline('good')} round={{ holesPlayed: 13, complete: false }} hasHistory />
    );
    expect(getByText(/through 13 holes/)).toBeTruthy();
  });
});
