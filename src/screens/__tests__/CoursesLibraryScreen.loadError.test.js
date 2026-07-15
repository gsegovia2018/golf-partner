import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import CoursesLibraryScreen from '../CoursesLibraryScreen';
import { fetchCourses, fetchFavoriteCourseIds } from '../../store/libraryStore';

// Task 6 (audit-tier3): load() previously had a try/finally with no catch,
// so a rejected fetchCourses() left `courses` at its initial [] and rendered
// the "No courses yet" empty state instead of surfacing the failure — a
// false-empty state indistinguishable from a genuinely empty library.

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn((effect) => {
    const React = require('react');
    React.useEffect(effect, []);
  }),
}));

jest.mock('../../store/libraryStore', () => ({
  fetchCourses: jest.fn(),
  fetchFavoriteCourseIds: jest.fn(() => Promise.resolve(new Set())),
  deleteCourse: jest.fn(),
  upsertCourse: jest.fn(),
  toggleFavoriteCourse: jest.fn(),
}));

const navigation = { goBack: jest.fn(), navigate: jest.fn() };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('CoursesLibraryScreen load error + retry (Task 6)', () => {
  beforeEach(() => {
    fetchCourses.mockReset();
    fetchFavoriteCourseIds.mockClear();
  });

  test('a rejected fetchCourses() shows the error/retry state, not the empty state', async () => {
    fetchCourses.mockRejectedValueOnce(new Error('network down'));
    const { getByText, queryByText } = render(wrap(<CoursesLibraryScreen navigation={navigation} />));

    await waitFor(() => expect(getByText("Couldn't load courses")).toBeTruthy());
    expect(queryByText('No courses yet')).toBeNull();
  });

  test('pressing Retry re-fetches and clears the error state on success', async () => {
    fetchCourses.mockRejectedValueOnce(new Error('network down'));
    const { getByText, queryByText } = render(wrap(<CoursesLibraryScreen navigation={navigation} />));

    await waitFor(() => expect(getByText("Couldn't load courses")).toBeTruthy());

    fetchCourses.mockResolvedValueOnce([]);
    fireEvent.press(getByText('Retry'));

    await waitFor(() => expect(getByText('No courses yet')).toBeTruthy());
    expect(queryByText("Couldn't load courses")).toBeNull();
  });
});
