import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import CoursesLibraryScreen from '../CoursesLibraryScreen';
import CourseLibraryDetailScreen from '../CourseLibraryDetailScreen';
import CourseEditorScreen from '../CourseEditorScreen';
import { fetchCourses, updateCourseFromEditor } from '../../store/libraryStore';

// The course library is shared: only admins (src/lib/admin.js, mirrored by
// public.is_geo_admin in RLS) add, edit or delete courses. Everyone else
// browses read-only, and their round edits stay on the round.

const ADMIN_ID = '7a9ec70d-4a4c-4509-bfbb-f1ba09120729';
const mockAuth = { user: { id: 'friend-1' } };
jest.mock('../../context/AuthContext', () => ({ useAuth: () => mockAuth }));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn((effect) => {
    const React = require('react');
    React.useEffect(effect, []);
  }),
}));

const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
const course = {
  id: 'c1', name: 'Real Club de Golf La Herrería', city: 'San Lorenzo de El Escorial', province: 'Madrid',
  holes, tees: [{ id: 't1', label: 'Amarillas', rating: 71.4, slope: 133 }],
};

jest.mock('../../store/libraryStore', () => ({
  fetchCourses: jest.fn(),
  fetchFavoriteCourseIds: jest.fn(() => Promise.resolve(new Set())),
  toggleFavoriteCourse: jest.fn(),
  upsertCourse: jest.fn(),
  deleteCourse: jest.fn(),
  updateCourseFromEditor: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../store/tournamentStore', () => ({ propagateCourseToTournaments: jest.fn() }));
// The detail screen's offline-map section needs geometry; none here.
jest.mock('../../hooks/useCourseGeometry', () => ({ useCourseGeometry: () => null }));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
const navigation = () => ({ goBack: jest.fn(), navigate: jest.fn(), setOptions: jest.fn() });

beforeEach(() => {
  fetchCourses.mockResolvedValue([course]);
  updateCourseFromEditor.mockClear();
});

describe('Courses library list', () => {
  test('a non-admin can browse but sees no add, edit or delete', async () => {
    mockAuth.user = { id: 'friend-1' };
    const { getByText, queryByText, queryByPlaceholderText } = render(wrap(<CoursesLibraryScreen navigation={navigation()} />));
    await waitFor(() => expect(getByText('Real Club de Golf La Herrería')).toBeTruthy());
    expect(queryByText('Add course')).toBeNull();
    expect(queryByPlaceholderText('New course name')).toBeNull();
  });

  test('an admin keeps the add form', async () => {
    mockAuth.user = { id: ADMIN_ID };
    const { getByText } = render(wrap(<CoursesLibraryScreen navigation={navigation()} />));
    await waitFor(() => expect(getByText('Real Club de Golf La Herrería')).toBeTruthy());
    expect(getByText('Add course')).toBeTruthy();
  });
});

describe('Course detail', () => {
  const route = { params: { courseId: 'c1', courseName: course.name } };

  test('a non-admin sees the course read-only, with no save and no tee editing', async () => {
    mockAuth.user = { id: 'friend-1' };
    const { getByPlaceholderText, queryByText } = render(wrap(<CourseLibraryDetailScreen navigation={navigation()} route={route} />));
    await waitFor(() => expect(getByPlaceholderText('Course name').props.value).toBe(course.name));
    expect(getByPlaceholderText('Course name').props.editable).toBe(false);
    expect(queryByText('Save course')).toBeNull();
    expect(queryByText('Add tee')).toBeNull();
  });

  test('an admin can edit and save', async () => {
    mockAuth.user = { id: ADMIN_ID };
    const { getByPlaceholderText, getByText } = render(wrap(<CourseLibraryDetailScreen navigation={navigation()} route={route} />));
    await waitFor(() => expect(getByPlaceholderText('Course name').props.value).toBe(course.name));
    expect(getByPlaceholderText('Course name').props.editable).toBe(true);
    expect(getByText('Save course')).toBeTruthy();
    expect(getByText('Add tee')).toBeTruthy();
  });
});

describe('Round course editor (Configure holes)', () => {
  const params = () => ({
    roundIndex: 0, courseName: course.name, initialHoles: holes, initialTees: course.tees,
    courseId: 'c1', onSave: jest.fn(),
  });

  test('a non-admin edits only the round: Done never writes the library', async () => {
    mockAuth.user = { id: 'friend-1' };
    const nav = navigation();
    const { getByText } = render(wrap(<CourseEditorScreen navigation={nav} route={{ params: params() }} />));
    fireEvent.press(getByText('Done'));
    await waitFor(() => expect(nav.goBack).toHaveBeenCalled());
    expect(updateCourseFromEditor).not.toHaveBeenCalled();
  });

  test('an admin\'s Done also updates the library course', async () => {
    mockAuth.user = { id: ADMIN_ID };
    const nav = navigation();
    const { getByText } = render(wrap(<CourseEditorScreen navigation={nav} route={{ params: params() }} />));
    fireEvent.press(getByText('Done'));
    await waitFor(() => expect(nav.goBack).toHaveBeenCalled());
    expect(updateCourseFromEditor).toHaveBeenCalledWith('c1', holes, course.tees);
  });
});

test('read-only tees show no example ratings that could pass for data', async () => {
  mockAuth.user = { id: 'friend-1' };
  fetchCourses.mockResolvedValue([{ ...course, tees: [{ id: 't1', label: 'Yellow', rating: 69, slope: 123 }] }]);
  const route = { params: { courseId: 'c1', courseName: course.name } };
  const { getByPlaceholderText, queryByPlaceholderText } = render(
    wrap(<CourseLibraryDetailScreen navigation={navigation()} route={route} />),
  );
  await waitFor(() => expect(getByPlaceholderText('Course name').props.value).toBe(course.name));
  expect(queryByPlaceholderText('79.3')).toBeNull();
  expect(queryByPlaceholderText('151')).toBeNull();
});
