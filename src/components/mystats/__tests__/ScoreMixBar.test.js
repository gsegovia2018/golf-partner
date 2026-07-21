import React from 'react';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import ScoreMixBar from '../ScoreMixBar';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => new Promise(() => {})),
  setItem: jest.fn(),
}));

// Overrideable reduced-motion flag on top of the shared reanimated mock, so
// one test can assert the static (no-animation) render path.
let mockReducedMotion = false;
jest.mock('react-native-reanimated', () => {
  const Reanimated = jest.requireActual('react-native-reanimated/mock');
  return {
    ...Reanimated,
    useReducedMotion: () => mockReducedMotion,
  };
});

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const distribution = {
  eagles: 1, birdies: 2, pars: 8, bogeys: 5, doubles: 2, worse: 1, total: 19,
};

beforeEach(() => {
  mockReducedMotion = false;
});

describe('ScoreMixBar', () => {
  test('renders one segment plus a legend entry (dot + label + count) per bucket', () => {
    const { getByTestId, getByText } = render(wrap(
      <ScoreMixBar distribution={distribution} />
    ));

    ['birdie', 'par', 'bogey', 'double'].forEach((key) => {
      expect(getByTestId(`scoremix-segment-${key}`)).toBeTruthy();
      expect(getByTestId(`scoremix-legend-${key}`)).toBeTruthy();
    });
    // Counts merge eagles+birdies and doubles+worse — same data the
    // scoring-pattern rows read.
    expect(getByText('Birdie+ 3')).toBeTruthy();
    expect(getByText('Par 8')).toBeTruthy();
    expect(getByText('Bogey 5')).toBeTruthy();
    expect(getByText('Double+ 3')).toBeTruthy();
  });

  test('omits zero-count buckets from both the bar and the legend', () => {
    const { queryByTestId, getByTestId } = render(wrap(
      <ScoreMixBar distribution={{ ...distribution, eagles: 0, birdies: 0 }} />
    ));

    expect(queryByTestId('scoremix-segment-birdie')).toBeNull();
    expect(queryByTestId('scoremix-legend-birdie')).toBeNull();
    expect(getByTestId('scoremix-segment-par')).toBeTruthy();
  });

  test('renders nothing without holes', () => {
    const empty = render(wrap(<ScoreMixBar distribution={{}} />));
    expect(empty.toJSON()).toBeNull();

    const missing = render(wrap(<ScoreMixBar />));
    expect(missing.toJSON()).toBeNull();
  });

  test("accepts buildCourseBreakdown's summary.scoreMix counts (extra total key ignored)", () => {
    // Course-summary shape: same bucket keys plus `total` — CourseStatsScreen
    // passes it straight in as `distribution`.
    const scoreMix = { eagles: 0, birdies: 4, pars: 20, bogeys: 31, doubles: 12, worse: 8, total: 75 };
    const { getByText, getByTestId } = render(wrap(
      <ScoreMixBar distribution={scoreMix} />
    ));

    expect(getByTestId('scoremix-segment-birdie')).toBeTruthy();
    expect(getByText('Birdie+ 4')).toBeTruthy();
    expect(getByText('Par 20')).toBeTruthy();
    expect(getByText('Bogey 31')).toBeTruthy();
    expect(getByText('Double+ 20')).toBeTruthy(); // 12 doubles + 8 worse
  });

  test('reduced motion still renders the full static bar and legend', () => {
    mockReducedMotion = true;
    const { getByTestId, getByText } = render(wrap(
      <ScoreMixBar distribution={distribution} />
    ));

    ['birdie', 'par', 'bogey', 'double'].forEach((key) => {
      expect(getByTestId(`scoremix-segment-${key}`)).toBeTruthy();
    });
    expect(getByText('Par 8')).toBeTruthy();
  });
});
