import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Polyline, Circle } from 'react-native-svg';
import { ThemeProvider } from '../../../theme/ThemeContext';
import CourseMasteryCard from '../CourseMasteryCard';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => new Promise(() => {})),
  setItem: jest.fn(),
}));

// Overrideable reduced-motion flag on top of the shared reanimated mock, so
// one test can assert the static (no-animation) sparkline render path — the
// same convention as ScoreMixBar.test.js.
let mockReducedMotion = false;
jest.mock('react-native-reanimated', () => {
  const Reanimated = jest.requireActual('react-native-reanimated/mock');
  return {
    ...Reanimated,
    useReducedMotion: () => mockReducedMotion,
  };
});

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const course = (over = {}) => ({
  courseKey: 'c-1',
  courseName: 'Pine',
  rounds: 2,
  avgPoints: 30,
  bestPoints: 34,
  trend: 1,
  recentPoints: [26, 34],
  ...over,
});

beforeEach(() => {
  mockReducedMotion = false;
});

describe('CourseMasteryCard course cards', () => {
  test('renders the average, its label, the course name and the rounds/best meta', () => {
    const { getByText } = render(wrap(
      <CourseMasteryCard courses={[course()]} />
    ));
    expect(getByText('30')).toBeTruthy();
    expect(getByText('AVG PTS')).toBeTruthy();
    expect(getByText('Pine')).toBeTruthy();
    expect(getByText('2 rounds · best 34 pts')).toBeTruthy();
  });

  test('draws a sparkline (polyline + end dot) when a course has two or more round points', () => {
    const view = render(wrap(
      <CourseMasteryCard courses={[course({ recentPoints: [26, 30, 34] })]} />
    ));
    expect(view.UNSAFE_getAllByType(Polyline)).toHaveLength(1);
    expect(view.UNSAFE_getAllByType(Circle)).toHaveLength(1);
  });

  test('renders no sparkline with fewer than two round points', () => {
    const single = render(wrap(
      <CourseMasteryCard courses={[course({ rounds: 1, recentPoints: [30] })]} />
    ));
    expect(single.UNSAFE_queryAllByType(Polyline)).toHaveLength(0);
    expect(single.UNSAFE_queryAllByType(Circle)).toHaveLength(0);

    const missing = render(wrap(
      <CourseMasteryCard courses={[course({ recentPoints: undefined })]} />
    ));
    expect(missing.UNSAFE_queryAllByType(Polyline)).toHaveLength(0);
  });

  test('reduced motion still renders the full static card and sparkline', () => {
    mockReducedMotion = true;
    const view = render(wrap(
      <CourseMasteryCard courses={[course()]} />
    ));
    expect(view.getByText('Pine')).toBeTruthy();
    expect(view.getByText('30')).toBeTruthy();
    expect(view.UNSAFE_getAllByType(Polyline)).toHaveLength(1);
  });
});

describe('CourseMasteryCard navigation', () => {
  test('tapping a card with a courseKey calls onSelectCourse with the course', () => {
    const onSelectCourse = jest.fn();
    const { getByLabelText } = render(wrap(
      <CourseMasteryCard courses={[course()]} onSelectCourse={onSelectCourse} />
    ));
    fireEvent.press(getByLabelText('Open Pine stats'));
    expect(onSelectCourse).toHaveBeenCalledWith(expect.objectContaining({ courseKey: 'c-1' }));
  });

  test('cards without a courseKey are not tappable', () => {
    const onSelectCourse = jest.fn();
    const { queryByLabelText, getByText } = render(wrap(
      <CourseMasteryCard
        courses={[course({ courseKey: null, courseName: 'R3' })]}
        onSelectCourse={onSelectCourse}
      />
    ));
    expect(getByText('R3')).toBeTruthy();
    expect(queryByLabelText('Open R3 stats')).toBeNull();
  });

  test('renders plain cards when no onSelectCourse handler is given', () => {
    const { getByText, queryByLabelText } = render(wrap(
      <CourseMasteryCard courses={[course()]} />
    ));
    expect(getByText('Pine')).toBeTruthy();
    expect(queryByLabelText('Open Pine stats')).toBeNull();
  });
});
