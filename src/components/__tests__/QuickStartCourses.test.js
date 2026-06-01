import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  default as QuickStartCourses,
  coursePar,
  courseTeeCount,
  quickStartCourseMeta,
  initialQuickStartPlayerIds,
} from '../QuickStartCourses';

const courses = [
  {
    id: 'c1',
    name: 'Pine Course',
    holes: [{ par: 4 }, { par: 5 }],
    tees: [{ label: 'White' }, { label: 'Yellow' }],
  },
];

const players = [
  { id: 'p1', name: 'Guest', user_id: null, handicap: 12 },
  { id: 'p2', name: 'Me', user_id: 'u-me', handicap: 8 },
];

function renderQuickStart(props = {}) {
  return render(
    <QuickStartCourses
      courses={courses}
      players={players}
      currentUserId="u-me"
      {...props}
    />,
  );
}

describe('QuickStartCourses helpers', () => {
  test('coursePar sums hole pars when available', () => {
    expect(coursePar({
      holes: [{ par: 4 }, { par: 5 }, { par: 3 }],
    })).toBe(12);
    expect(coursePar({ holes: [] })).toBeNull();
  });

  test('courseTeeCount counts only named tees', () => {
    expect(courseTeeCount({
      tees: [{ label: 'White' }, { label: '' }, { label: 'Yellow' }],
    })).toBe(2);
  });

  test('quickStartCourseMeta combines par and tee count', () => {
    expect(quickStartCourseMeta({
      holes: [{ par: 4 }, { par: 5 }],
      tees: [{ label: 'White' }, { label: 'Yellow' }],
    })).toBe('Par 9 · 2 tees');
    expect(quickStartCourseMeta({ holes: [], tees: [] })).toBe('');
  });

  test('quickStartCourseMeta does not return partial metadata', () => {
    expect(quickStartCourseMeta({
      holes: [{ par: 4 }, { par: 5 }],
      tees: [],
    })).toBe('');
    expect(quickStartCourseMeta({
      holes: [],
      tees: [{ label: 'White' }, { label: 'Yellow' }],
    })).toBe('');
  });

  test('initialQuickStartPlayerIds preselects the signed-in user player', () => {
    const players = [
      { id: 'p1', name: 'Guest', user_id: null },
      { id: 'p2', name: 'Me', user_id: 'u-me' },
    ];
    expect(initialQuickStartPlayerIds(players, 'u-me')).toEqual(['p2']);
  });

  test('initialQuickStartPlayerIds returns empty when no signed-in user player exists', () => {
    expect(initialQuickStartPlayerIds([{ id: 'p1', user_id: null }], 'u-me')).toEqual([]);
  });
});

describe('QuickStartCourses interactions', () => {
  test('shows an empty quick-start zone when there are no favorite courses', () => {
    const onManage = jest.fn();
    const { getByLabelText, getByText } = renderQuickStart({ courses: null, onManage });

    expect(getByText('QUICK START')).toBeTruthy();
    expect(getByText('No favorite courses yet')).toBeTruthy();
    expect(getByText('Open Courses and tap the star on a course to quick start from here.')).toBeTruthy();

    fireEvent.press(getByLabelText('Manage quick start courses'));
    expect(onManage).toHaveBeenCalledTimes(1);
  });

  test('opens the sheet and preselects the signed-in player', () => {
    const { getAllByLabelText, getByLabelText, getByText, queryByLabelText } = renderQuickStart();

    fireEvent.press(getByText('Pine Course'));

    expect(getByText('Tees are auto-assigned. Use Edit details to change them.')).toBeTruthy();
    expect(getByText('Me')).toBeTruthy();
    expect(getByLabelText('Remove Me')).toBeTruthy();
    expect(queryByLabelText('Remove Guest')).toBeNull();
    expect(getAllByLabelText('Add player to quick start')).toHaveLength(3);
  });

  test('adds and removes players through setup-style slots', () => {
    const { getAllByLabelText, getByLabelText, getByText, queryByLabelText } = renderQuickStart({ currentUserId: 'other-user' });

    fireEvent.press(getByText('Pine Course'));
    expect(getByLabelText('Start quick start round').props.accessibilityState.disabled).toBe(true);
    expect(getAllByLabelText('Add player to quick start')).toHaveLength(4);

    fireEvent.press(getAllByLabelText('Add player to quick start')[0]);
    fireEvent.press(getByLabelText('Add Guest'));
    expect(getByLabelText('Remove Guest')).toBeTruthy();
    expect(getByLabelText('Start quick start round').props.accessibilityState.disabled).toBe(false);

    fireEvent.press(getByLabelText('Remove Guest'));
    expect(queryByLabelText('Remove Guest')).toBeNull();
    expect(getByLabelText('Start quick start round').props.accessibilityState.disabled).toBe(true);
  });

  test('marks linked app users in the add-player list', () => {
    const { getAllByLabelText, getAllByText, getByLabelText, getByText } = renderQuickStart({ currentUserId: 'other-user' });

    fireEvent.press(getByText('Pine Course'));
    fireEvent.press(getAllByLabelText('Add player to quick start')[0]);

    expect(getByLabelText('Add Guest')).toBeTruthy();
    expect(getByLabelText('Add Me')).toBeTruthy();
    expect(getAllByText('App user')).toHaveLength(1);
  });

  test('disables Start while starting', () => {
    const onStart = jest.fn();
    const { getByLabelText, getByText } = renderQuickStart({ onStart, starting: true });

    fireEvent.press(getByText('Pine Course'));
    expect(getByText('Starting...')).toBeTruthy();
    expect(getByLabelText('Start quick start round').props.accessibilityState.disabled).toBe(true);

    fireEvent.press(getByLabelText('Start quick start round'));
    expect(onStart).not.toHaveBeenCalled();
  });

  test('calls onStart with selected course and players', () => {
    const onStart = jest.fn();
    const { getByLabelText, getByText, queryByText } = renderQuickStart({ onStart });

    fireEvent.press(getByText('Pine Course'));
    fireEvent.press(getByLabelText('Start quick start round'));

    expect(onStart).toHaveBeenCalledWith({ course: courses[0], players: [players[1]] });
    expect(queryByText('Tees are auto-assigned. Use Edit details to change them.')).toBeNull();
  });

  test('calls onEditDetails with selected course and players', () => {
    const onEditDetails = jest.fn();
    const { getAllByLabelText, getByLabelText, getByText, queryByText } = renderQuickStart({ onEditDetails });

    fireEvent.press(getByText('Pine Course'));
    fireEvent.press(getAllByLabelText('Add player to quick start')[0]);
    fireEvent.press(getByLabelText('Add Guest'));
    fireEvent.press(getByLabelText('Edit quick start details'));

    expect(onEditDetails).toHaveBeenCalledWith({ course: courses[0], players: [players[1], players[0]] });
    expect(queryByText('Tees are auto-assigned. Use Edit details to change them.')).toBeNull();
  });

  test('shows loading and error states with retry', () => {
    const onRetryPlayers = jest.fn();
    const view = renderQuickStart({ players: [], playersLoading: true });

    fireEvent.press(view.getByText('Pine Course'));
    expect(view.getByText('Loading players...')).toBeTruthy();

    view.rerender(
      <QuickStartCourses
        courses={courses}
        players={[]}
        currentUserId="u-me"
        playersError="Could not load players."
        onRetryPlayers={onRetryPlayers}
      />,
    );

    fireEvent.press(view.getByLabelText('Retry loading players'));
    expect(onRetryPlayers).toHaveBeenCalledTimes(1);
  });

  test('does not render tee picker controls', () => {
    const { getByText, queryByText } = renderQuickStart();

    fireEvent.press(getByText('Pine Course'));

    expect(getByText('Tees are auto-assigned. Use Edit details to change them.')).toBeTruthy();
    expect(queryByText('Choose a tee')).toBeNull();
    expect(queryByText('Tee')).toBeNull();
  });

  test('auto-selects signed-in player when players arrive after opening', async () => {
    const view = renderQuickStart({ players: [], playersLoading: true });

    fireEvent.press(view.getByText('Pine Course'));

    view.rerender(
      <QuickStartCourses
        courses={courses}
        players={players}
        currentUserId="u-me"
      />,
    );

    await waitFor(() => {
      expect(view.getByLabelText('Remove Me')).toBeTruthy();
    });
  });

  test('does not clobber manual player changes after refresh', () => {
    const view = renderQuickStart();

    fireEvent.press(view.getByText('Pine Course'));
    fireEvent.press(view.getByLabelText('Remove Me'));

    view.rerender(
      <QuickStartCourses
        courses={courses}
        players={[...players]}
        currentUserId="u-me"
      />,
    );

    expect(view.queryByLabelText('Remove Me')).toBeNull();
  });

  test('renders disabled Manage when no callback is supplied', () => {
    const { getByLabelText, getByText } = renderQuickStart({ onManage: undefined });

    expect(getByText('Manage')).toBeTruthy();
    expect(getByLabelText('Manage quick start courses').props.accessibilityState.disabled).toBe(true);
  });
});
