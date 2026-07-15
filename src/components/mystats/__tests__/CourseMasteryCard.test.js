import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import CourseMasteryCard from '../CourseMasteryCard';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => new Promise(() => {})),
  setItem: jest.fn(),
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const course = (over = {}) => ({
  courseKey: 'c-1', courseName: 'Pine', rounds: 2, avgPoints: 30, bestPoints: 34, trend: 1,
  ...over,
});

describe('CourseMasteryCard navigation', () => {
  test('tapping a row with a courseKey calls onSelectCourse with the course', () => {
    const onSelectCourse = jest.fn();
    const { getByLabelText } = render(wrap(
      <CourseMasteryCard courses={[course()]} onSelectCourse={onSelectCourse} />
    ));
    fireEvent.press(getByLabelText('Open Pine stats'));
    expect(onSelectCourse).toHaveBeenCalledWith(expect.objectContaining({ courseKey: 'c-1' }));
  });

  test('rows without a courseKey are not tappable', () => {
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

  test('renders plain rows when no onSelectCourse handler is given', () => {
    const { getByText, queryByLabelText } = render(wrap(
      <CourseMasteryCard courses={[course()]} />
    ));
    expect(getByText('Pine')).toBeTruthy();
    expect(queryByLabelText('Open Pine stats')).toBeNull();
  });
});
