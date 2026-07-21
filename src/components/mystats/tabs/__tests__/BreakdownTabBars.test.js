import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../../theme/ThemeContext';
import BreakdownTab from '../BreakdownTab';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => new Promise(() => {})),
  setItem: jest.fn(),
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

// Kept deliberately minimal: only the sections under test render, so this
// file stays independent of Score mix / Course Mastery / Career Milestones.
function statsFixture() {
  return {
    metrics: { rounds: 2, avgPoints: 30 },
    history: [
      { points: 30, holesPlayed: 18 },
      { points: 30, holesPlayed: 18 },
    ],
    parType: {
      par3: { holes: 8, avgPoints: 1.5 },
      par4: { holes: 20, avgPoints: 1.8 },
      par5: { holes: 8, avgPoints: 2 },
    },
    difficulty: {
      hard: { holes: 12, avgPoints: 1.4 },
      mid: { holes: 12, avgPoints: 1.6 },
      easy: { holes: 0, avgPoints: 0 },
    },
    teeShot: {
      hasData: true,
      fairway: { holes: 10, avgPoints: 2 },
      missed: { holes: 8, avgPoints: 1.2 },
      byDirection: {},
      teePenalty: { holes: 6, avgPoints: 0.8 },
      penaltyDrag: 2.5,
    },
  };
}

const width = (el) => StyleSheet.flatten(el.props.style).width;

describe('BreakdownTab magnitude bars', () => {
  test('normalizes fill widths against the section max', async () => {
    const { findByTestId, getByTestId } = render(wrap(
      <BreakdownTab stats={statsFixture()} onInfo={() => {}} />
    ));

    // Course section: par5 (2 pts) is the section max, par3 is 1.5/2 = 75%.
    expect(width(await findByTestId('breakdown-bar-par5-fill'))).toBe('100%');
    expect(width(getByTestId('breakdown-bar-par3-fill'))).toBe('75%');
    // Tee section normalizes independently: fairway (2 pts) is ITS max.
    expect(width(getByTestId('breakdown-bar-fairway-fill'))).toBe('100%');
    expect(width(getByTestId('breakdown-bar-missed-fill'))).toBe('60%');
    expect(width(getByTestId('breakdown-bar-teePenalty-fill'))).toBe('40%');
  });

  test('zero-sample (dim) rows keep an empty track', async () => {
    const { findByTestId, queryByTestId } = render(wrap(
      <BreakdownTab stats={statsFixture()} onInfo={() => {}} />
    ));

    expect(await findByTestId('breakdown-bar-easy')).toBeTruthy();
    expect(queryByTestId('breakdown-bar-easy-fill')).toBeNull();
  });

  test('penalty drag scales against the fixed 5 pts/round ceiling, not section max', async () => {
    const { findByTestId } = render(wrap(
      <BreakdownTab stats={statsFixture()} onInfo={() => {}} />
    ));

    // Penalty drag is points lost (a delta), not an avg-pts level — it runs
    // on the absolute PENALTY_DRAG_SCALE (5), so 2.5 pts lost reads 50%.
    expect(width(await findByTestId('breakdown-bar-penaltyDrag-fill'))).toBe('50%');
  });

  test('percentage rows use an absolute 0-100 scale, not the section max', async () => {
    const stats = {
      ...statsFixture(),
      bounceBack: { rate: 25, opportunities: 8 },
      scrambling: { pct: 75, missedGir: 8 },
    };
    const { findByTestId, getByTestId } = render(wrap(
      <BreakdownTab stats={stats} onInfo={() => {}} />
    ));

    // 75% is the section's biggest rate but still fills only 75% of the
    // track — pct bars are comparable across the whole tab.
    expect(width(await findByTestId('breakdown-bar-scrambling-fill'))).toBe('75%');
    expect(width(getByTestId('breakdown-bar-bounceBack-fill'))).toBe('25%');
  });

  test('a solo count row caps at two-thirds instead of a misleading full bar', async () => {
    const stats = {
      ...statsFixture(),
      bounceBack: { rate: 25, opportunities: 8 },
      bunkerVisits: { avgPerRound: 1.2, holesWithSand: 8 },
    };
    const { findByTestId } = render(wrap(
      <BreakdownTab stats={stats} onInfo={() => {}} />
    ));

    // Bunker visits is the only count row among recovery's rates — with no
    // comparable sibling its bar caps at value / (value * 1.5).
    expect(width(await findByTestId('breakdown-bar-bunkerVisits-fill'))).toBe(`${(2 / 3) * 100}%`);
  });

  test('count and average putting rows normalize within their own groups', async () => {
    const stats = {
      ...statsFixture(),
      shots: {
        hasData: true,
        roundsWithPuttData: 2,
        putts: { perRound: 32, holes: 36, onePutts: 8, threePuttPlus: 3, total: 64 },
      },
      puttDive: {
        hasData: true,
        twoPuttPct: 50,
        holes: 36,
        girPuttsAvg: 1.5,
        girHoles: 12,
        nonGirPuttsAvg: 2,
        nonGirHoles: 24,
        onePuttSave: { pct: 40, attempts: 10 },
      },
    };
    const { findByTestId, getByTestId } = render(wrap(
      <BreakdownTab stats={stats} onInfo={() => {}} />
    ));

    // Count group: putts/round (32) is the max; 1-putts (8) → 25%;
    // 3-putts/round (3 / 2 rounds = 1.5) → 1.5/32.
    expect(width(await findByTestId('breakdown-bar-puttsPerRound-fill'))).toBe('100%');
    expect(width(getByTestId('breakdown-bar-onePutts-fill'))).toBe('25%');
    expect(width(getByTestId('breakdown-bar-threePutts-fill'))).toBe('4.6875%');
    // Avg group (putts per hole on/off GIR) is its own honest pair.
    expect(width(getByTestId('breakdown-bar-nonGirPutts-fill'))).toBe('100%');
    expect(width(getByTestId('breakdown-bar-girPutts-fill'))).toBe('75%');
  });

  test('no-data rate rows (null rate) keep the dash with no track at all', async () => {
    const stats = {
      ...statsFixture(),
      sandSaves: { saves: 0, attempts: 0, rate: null },
    };
    const { findByText, queryByTestId } = render(wrap(
      <BreakdownTab stats={stats} onInfo={() => {}} />
    ));

    // 0 tries is "no data", not a 0% rate — no magnitude, so no bar.
    expect(await findByText('Sand-save rate')).toBeTruthy();
    expect(queryByTestId('breakdown-bar-sandSaves-fill')).toBeNull();
  });
});
