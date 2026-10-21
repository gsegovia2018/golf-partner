import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import CoursePickerScreen from '../CoursePickerScreen';
import { loadCourseLibrary } from '../../store/libraryStore';
import { tournamentsIndex } from '../../store/tournamentsIndex';
import { consumePendingCourses } from '../../lib/selectionBridge';

// Search-first picker: opens from the cache, shows favourites and recent
// courses, searches and browses layouts, never creates courses, and shows
// the rounds tray for tournaments.

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn((effect) => {
    const React = require('react');
    React.useEffect(effect, []);
  }),
}));

const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
const mockLibrary = {
  clubs: [{ id: 'vm', name: 'Real Club de Campo Villa de Madrid', city: 'Madrid', province: 'Madrid' }],
  courses: [
    { id: 'vm-n', name: 'Villa de Madrid — Negro', clubId: 'vm', layoutName: 'Negro', holes, tees: [] },
    { id: 'vm-a', name: 'Villa de Madrid — Amarillo', clubId: 'vm', layoutName: 'Amarillo', holes, tees: [] },
    { id: 'fa', name: 'La Faisanera', city: 'Segovia', province: 'Castile and León', clubId: null, holes, tees: [] },
    { id: 'cng', name: 'Centro Nacional de Golf', city: 'Madrid', province: 'Madrid', clubId: null, holes, tees: [] },
  ],
  favorites: new Set(['fa']),
  usingCachedData: true,
};

jest.mock('../../store/libraryStore', () => ({
  getCachedCourseLibrary: jest.fn(() => Promise.resolve(mockLibrary)),
  // Never settles: everything must work from the cache alone.
  loadCourseLibrary: jest.fn(() => new Promise(() => {})),
  defaultHoles: jest.fn(() => []),
  toggleFavoriteCourse: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../store/tournamentsIndex', () => ({
  tournamentsIndex: {
    readIndex: jest.fn(() => Promise.resolve([
      { createdAt: '2026-10-18T09:00:00Z', courseIds: ['cng'] },
    ])),
  },
}));

function makeNavigation() {
  const listeners = {};
  return {
    goBack: jest.fn(() => {
      const e = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      (listeners.beforeRemove ?? []).forEach((fn) => fn(e));
      return e.defaultPrevented;
    }),
    navigate: jest.fn(),
    addListener: jest.fn((name, fn) => {
      (listeners[name] ??= []).push(fn);
      return () => { listeners[name] = listeners[name].filter((f) => f !== fn); };
    }),
  };
}

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
const renderPicker = (params = {}, navigation = makeNavigation()) => ({
  navigation,
  ...render(wrap(<CoursePickerScreen navigation={navigation} route={{ params: { roundIndex: 0, ...params } }} />)),
});

beforeEach(() => { consumePendingCourses(); });

test('opens from the cache with favourites and recent courses while the fresh load is in flight', async () => {
  const { getByText } = renderPicker();
  await waitFor(() => expect(getByText('La Faisanera')).toBeTruthy());
  expect(getByText('Favorites')).toBeTruthy();
  expect(getByText('Played recently')).toBeTruthy();
  expect(getByText('Centro Nacional de Golf')).toBeTruthy();
  expect(getByText(/Played 18 Oct/)).toBeTruthy();
  expect(loadCourseLibrary).toHaveBeenCalled();
  expect(tournamentsIndex.readIndex).toHaveBeenCalled();
});

test('offers no way to create a course', async () => {
  const { getByText, queryByPlaceholderText, queryByText } = renderPicker();
  await waitFor(() => expect(getByText('La Faisanera')).toBeTruthy());
  expect(queryByPlaceholderText('Course name')).toBeNull();
  expect(queryByText(/New Course/i)).toBeNull();
  fireEvent.changeText(queryByPlaceholderText('Search name, city or region'), 'zzz');
  expect(getByText('No courses match "zzz"')).toBeTruthy();
  expect(queryByText(/Create/)).toBeNull();
});

test('search lists layouts under their club and picks a layout directly', async () => {
  const { getByText, getByPlaceholderText, navigation } = renderPicker();
  await waitFor(() => expect(getByText('La Faisanera')).toBeTruthy());
  fireEvent.changeText(getByPlaceholderText('Search name, city or region'), 'villa');
  expect(getByText('Real Club de Campo Villa de Madrid')).toBeTruthy();
  fireEvent.press(getByText('Negro'));
  fireEvent.press(getByText('Add 1 Round'));
  expect(navigation.goBack).toHaveBeenCalled();
  const { picks } = consumePendingCourses();
  expect(picks.map((p) => [p.kind, p.course.id])).toEqual([['course', 'vm-n']]);
});

test('browsing a region lists its clubs, and back returns to the main view instead of leaving', async () => {
  const { getByText, queryByText, navigation } = renderPicker();
  await waitFor(() => expect(getByText('Browse by region')).toBeTruthy());
  fireEvent.press(getByText('Madrid'));
  expect(queryByText('Browse by region')).toBeNull();
  fireEvent.press(getByText('Real Club de Campo Villa de Madrid'));
  expect(getByText('Amarillo')).toBeTruthy();
  // Header back is intercepted: the picker stays, the region closes.
  expect(navigation.goBack()).toBe(true);
  await waitFor(() => expect(getByText('Browse by region')).toBeTruthy());
});

test('a tournament gets the rounds tray: picks fill rounds in order and can be reordered', async () => {
  const { getByText, getAllByText, getByLabelText, queryByText } = renderPicker({ roundIndex: 1, rounds: true });
  await waitFor(() => expect(getByText('La Faisanera')).toBeTruthy());
  expect(getByText('Tap a course for round 2')).toBeTruthy();
  fireEvent.press(getByText('La Faisanera'));
  fireEvent.press(getByText('Centro Nacional de Golf'));
  // Row pills and tray slots both name the rounds.
  expect(getAllByText('R2').length).toBeGreaterThan(0);
  expect(getAllByText('R3').length).toBeGreaterThan(0);
  expect(getByText('Tap a course for round 4')).toBeTruthy();
  fireEvent.press(getByLabelText('Move round 3 earlier'));
  fireEvent.press(getByText('Add 2 Rounds'));
  const { startRoundIndex, picks } = consumePendingCourses();
  expect(startRoundIndex).toBe(1);
  expect(picks.map((p) => p.course.id)).toEqual(['cng', 'fa']);
  expect(queryByText('Rounds')).toBeTruthy();
});

test('a game has no tray, just the add button', async () => {
  const { getByText, queryByText } = renderPicker();
  await waitFor(() => expect(getByText('La Faisanera')).toBeTruthy());
  expect(queryByText('Rounds')).toBeNull();
  fireEvent.press(getByText('La Faisanera'));
  expect(getByText('Add 1 Round')).toBeTruthy();
});

test('a star tapped on the cached list survives the fresh library landing afterwards', async () => {
  let land;
  loadCourseLibrary.mockReturnValueOnce(new Promise((resolve) => { land = resolve; }));
  const { getByText, getByLabelText, queryByText } = renderPicker();
  await waitFor(() => expect(getByText('Centro Nacional de Golf')).toBeTruthy());
  fireEvent.press(getByLabelText('Favorite: Centro Nacional de Golf'));
  // The fresh library was fetched before the tap: only La Faisanera is starred.
  land({ ...mockLibrary, favorites: new Set(['fa']), usingCachedData: false });
  await waitFor(() => expect(queryByText('Played recently')).toBeNull());
  expect(getByText('Centro Nacional de Golf')).toBeTruthy();
  expect(getByText('La Faisanera')).toBeTruthy();
});

test('a tray slot leads with the layout, so two rounds at one club stay apart', async () => {
  const { getByText, getByPlaceholderText } = renderPicker({ rounds: true });
  await waitFor(() => expect(getByText('La Faisanera')).toBeTruthy());
  fireEvent.changeText(getByPlaceholderText('Search name, city or region'), 'villa');
  fireEvent.press(getByText('Negro'));
  fireEvent.press(getByText('Amarillo'));
  expect(getByText('Negro · Real Club de Campo Villa de Madrid')).toBeTruthy();
  expect(getByText('Amarillo · Real Club de Campo Villa de Madrid')).toBeTruthy();
});
