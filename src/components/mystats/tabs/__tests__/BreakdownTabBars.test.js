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
      penaltyDrag: 1.1,
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

  test('rows without a comparable magnitude get no bar at all', async () => {
    const { findByText, queryByTestId } = render(wrap(
      <BreakdownTab stats={statsFixture()} onInfo={() => {}} />
    ));

    // Penalty drag is points lost (a delta), not an avg-pts level — it must
    // not pretend to share a scale with the tee-outcome rows.
    expect(await findByText('Penalty drag')).toBeTruthy();
    expect(queryByTestId('breakdown-bar-penaltyDrag')).toBeNull();
    expect(queryByTestId('breakdown-bar-penaltyDrag-fill')).toBeNull();
  });
});
