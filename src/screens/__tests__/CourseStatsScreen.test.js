import React from 'react';
import { StyleSheet } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import { semantic } from '../../theme/tokens';
import CourseStatsScreen from '../CourseStatsScreen';
import { buildCourseBreakdown } from '../../store/courseBreakdown';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => new Promise(() => {})),
  setItem: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => React.createElement(React.Fragment, null, children),
    SafeAreaView: ({ children }) => React.createElement(React.Fragment, null, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

// Reduced motion on: hero count-ups and Reveal wrappers render their final
// state synchronously, so value assertions don't race animation frames.
jest.mock('react-native-reanimated', () => {
  const Reanimated = jest.requireActual('react-native-reanimated/mock');
  return {
    ...Reanimated,
    useReducedMotion: () => true,
  };
});

// react-native-view-shot (a StatDetailSheet dependency) ships untransformed
// ESM — mock the sheet like MyStatsScreen.test.js does.
jest.mock('../../components/StatDetailSheet', () => function MockStatDetailSheet() {
  return null;
});

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

jest.mock('../../store/tournamentStore', () => ({
  loadAllTournamentsWithFallback: jest.fn(() => Promise.resolve({ list: [] })),
}));

jest.mock('../../store/profileStore', () => ({
  loadProfile: jest.fn(() => Promise.resolve({ displayName: 'Marco' })),
}));

jest.mock('../../store/personalStats', () => ({
  collectMyRounds: jest.fn(() => []),
}));

jest.mock('../../store/courseBreakdown', () => ({
  filterRoundsToCourse: jest.fn(() => []),
  buildCourseBreakdown: jest.fn(),
}));

const navigation = { goBack: jest.fn() };
const route = { params: { courseKey: 'c1', courseName: 'Valle Verde' } };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const breakdown = {
  courseName: 'Valle Verde',
  summary: {
    rounds: 6,
    avgPoints: 28.5,
    bestPoints: 34,
    avgStrokes: 100.5,
    scoreMix: { eagles: 0, birdies: 4, pars: 20, bogeys: 31, doubles: 12, worse: 8, total: 75 },
    frontBack: { frontAvg: 1.6, backAvg: 1.4, delta: 0.2, rounds: 6 },
  },
  shots: null,
  holes: [
    {
      holeNumber: 3, par: 4, strokeIndex: 1, timesPlayed: 6,
      avgStrokes: 5.8, avgVsPar: 1.8, avgPoints: 0.5, bestStrokes: 4,
      avgPutts: null, penalties: 0,
    },
    {
      holeNumber: 7, par: 3, strokeIndex: 17, timesPlayed: 6,
      avgStrokes: 2.6, avgVsPar: -0.4, avgPoints: 2.7, bestStrokes: 2,
      avgPutts: null, penalties: 0,
    },
  ],
  highlights: {
    nemesis: { holeNumber: 3, avgVsPar: 1.8, timesPlayed: 6 },
    best: { holeNumber: 7, avgVsPar: -0.4, timesPlayed: 6 },
  },
};

beforeEach(() => {
  buildCourseBreakdown.mockReset();
  buildCourseBreakdown.mockReturnValue(breakdown);
});

describe('CourseStatsScreen (Clubhouse redesign)', () => {
  test('hero board renders the course record: integer count-up targets and static decimals', async () => {
    const { getByTestId, getByText } = render(wrap(
      <CourseStatsScreen navigation={navigation} route={route} />
    ));

    await waitFor(() => expect(getByTestId('course-record-board')).toBeTruthy());
    // Serif header carries the course name, left-aligned next to the chevron.
    expect(getByText('Valle Verde')).toBeTruthy();
    expect(getByText('Course Record')).toBeTruthy();
    expect(getByText('6')).toBeTruthy();       // rounds (integer → CountUpText, reduced ⇒ final)
    expect(getByText('34')).toBeTruthy();      // best pts
    expect(getByText('28.5')).toBeTruthy();    // avg pts renders the decimal, not a rounded count-up
    expect(getByText('100.5')).toBeTruthy();   // avg strokes decimal
    // Front/back meta became the hairline footnote.
    expect(getByText(/Front 1\.6 · back 1\.4 pts\/hole across 6 rounds/)).toBeTruthy();
  });

  test('best pts renders gold on the cream board; other values cream', async () => {
    const { getByTestId } = render(wrap(
      <CourseStatsScreen navigation={navigation} route={route} />
    ));
    await waitFor(() => expect(getByTestId('course-record-board')).toBeTruthy());

    const gold = StyleSheet.flatten(getByTestId('course-record-best-pts-value').props.style);
    expect(gold.color).toBe(semantic.winner.dark);
    const cream = StyleSheet.flatten(getByTestId('course-record-rounds-value').props.style);
    expect(cream.color).toBe('#f3efe6');
  });

  test('score mix renders the horizontal ScoreMixBar from summary counts', async () => {
    const { getByTestId, getByText } = render(wrap(
      <CourseStatsScreen navigation={navigation} route={route} />
    ));
    await waitFor(() => expect(getByTestId('scoremix-segment-par')).toBeTruthy());

    expect(getByText('Birdie+ 4')).toBeTruthy();
    expect(getByText('Double+ 20')).toBeTruthy(); // doubles + worse merged
  });

  test('hole table gets highlights: nemesis and best holes carry dots', async () => {
    const { getByTestId } = render(wrap(
      <CourseStatsScreen navigation={navigation} route={route} />
    ));

    await waitFor(() => expect(getByTestId('hole-dot-nemesis')).toBeTruthy());
    expect(getByTestId('hole-dot-best')).toBeTruthy();
  });

  test('null summary values render an em dash instead of a count-up', async () => {
    buildCourseBreakdown.mockReturnValue({
      ...breakdown,
      summary: {
        ...breakdown.summary,
        rounds: 0, avgPoints: null, bestPoints: null, avgStrokes: null,
        frontBack: null,
      },
      highlights: null,
    });
    const { getByTestId, getAllByText, getByText } = render(wrap(
      <CourseStatsScreen navigation={navigation} route={route} />
    ));

    await waitFor(() => expect(getByTestId('course-record-board')).toBeTruthy());
    expect(getAllByText('—')).toHaveLength(3);
    expect(getByText(/No complete round here yet/)).toBeTruthy();
  });

  test('shows the empty state when the course has no rounds', async () => {
    buildCourseBreakdown.mockReturnValue(null);
    const { getByText } = render(wrap(
      <CourseStatsScreen navigation={navigation} route={route} />
    ));

    await waitFor(() => expect(getByText('No rounds at this course yet.')).toBeTruthy());
    // Header falls back to the route param before data resolves anything.
    expect(getByText('Valle Verde')).toBeTruthy();
  });
});
