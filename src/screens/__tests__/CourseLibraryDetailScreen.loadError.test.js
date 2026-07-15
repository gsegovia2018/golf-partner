import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import CourseLibraryDetailScreen from '../CourseLibraryDetailScreen';
import { fetchCourses } from '../../store/libraryStore';

// Task 6 (audit-tier3): the load IIFE had no catch — a rejected fetchCourses()
// left an unhandled promise rejection AND `loading` stuck at true forever
// (setLoading(false) never ran), so the screen showed an infinite spinner.

jest.mock('../../store/libraryStore', () => ({
  fetchCourses: jest.fn(),
  updateCourseFromEditor: jest.fn(),
  upsertCourse: jest.fn(),
}));
jest.mock('../../store/tournamentStore', () => ({
  propagateCourseToTournaments: jest.fn(),
}));

const navigation = { goBack: jest.fn(), setOptions: jest.fn() };
const route = { params: { courseId: 'c1', courseName: 'Test Course' } };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('CourseLibraryDetailScreen load error + retry (Task 6)', () => {
  beforeEach(() => {
    fetchCourses.mockReset();
  });

  test('a rejected fetchCourses() shows the error/retry state instead of spinning forever', async () => {
    fetchCourses.mockRejectedValueOnce(new Error('network down'));
    const { getByText } = render(
      wrap(<CourseLibraryDetailScreen navigation={navigation} route={route} />),
    );

    await waitFor(() => expect(getByText("Couldn't load course")).toBeTruthy());
  });

  test('pressing Retry re-fetches and clears the error state on success', async () => {
    fetchCourses.mockRejectedValueOnce(new Error('network down'));
    const { getByText, queryByText, getByPlaceholderText } = render(
      wrap(<CourseLibraryDetailScreen navigation={navigation} route={route} />),
    );

    await waitFor(() => expect(getByText("Couldn't load course")).toBeTruthy());

    fetchCourses.mockResolvedValueOnce([
      { id: 'c1', name: 'Test Course', tees: [], city: '', province: '', holes: [] },
    ]);
    fireEvent.press(getByText('Retry'));

    await waitFor(() => expect(getByPlaceholderText('Course name')).toBeTruthy());
    expect(queryByText("Couldn't load course")).toBeNull();
  });
});
