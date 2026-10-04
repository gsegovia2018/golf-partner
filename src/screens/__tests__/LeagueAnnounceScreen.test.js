import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import LeagueAnnounceScreen from '../LeagueAnnounceScreen';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn((effect) => {
    const React = require('react');
    React.useEffect(effect, [effect]);
  }),
}));
jest.mock('../../lib/selectionBridge', () => ({
  consumePendingCourses: jest.fn(),
}));
jest.mock('../../store/leagueStore', () => ({ announceLeagueCard: jest.fn() }));

const bridge = require('../../lib/selectionBridge');
const store = require('../../store/leagueStore');

const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
const pickedCourse = {
  id: 'c1', name: 'Golf Olivar', slope: 120, rating: 71, holes,
  tees: [{ id: 't1', label: 'Yellow', slope: 125, rating: 72 }, { id: 't2', label: 'Red', slope: 118, rating: 69 }],
};

const nav = () => ({ navigate: jest.fn(), goBack: jest.fn() });
const route = { params: { leagueId: 'L1' } };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('LeagueAnnounceScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    bridge.consumePendingCourses.mockReturnValue({ startRoundIndex: 0, picks: [{ kind: 'course', course: pickedCourse }] });
  });

  test('announces with source offapp, the course snapshot and the tee time, then goes back', async () => {
    store.announceLeagueCard.mockResolvedValue({ id: 'c1' });
    const navigation = nav();
    const { getByText, getByLabelText } = render(wrap(<LeagueAnnounceScreen navigation={navigation} route={route} />));
    expect(getByText(/Announce before your first shot\. Your group is notified now; you'll add the score after the round\./)).toBeTruthy();
    await waitFor(() => getByText('Golf Olivar'));
    fireEvent.changeText(getByLabelText('Date'), '2025-10-04');
    fireEvent.changeText(getByLabelText('Tee time'), '09:30');
    fireEvent.press(getByText('Announce card'));

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    const arg = store.announceLeagueCard.mock.calls[0][0];
    expect(arg.leagueId).toBe('L1');
    expect(arg.source).toBe('offapp');
    expect(arg.teeTime).toBe(new Date(2025, 9, 4, 9, 30).toISOString());
    // The middle tee of two is the second one.
    expect(arg.course).toMatchObject({ name: 'Golf Olivar', tee: 'Red', slope: 118, rating: 69 });
    expect(arg.course.holes).toHaveLength(18);
    expect(arg.course.holes[0]).toEqual({ n: 1, par: 4, si: 1 });
  });

  test('shows the server refusal verbatim and stays on the screen', async () => {
    store.announceLeagueCard.mockRejectedValue(new Error('You already have your October card.'));
    const navigation = nav();
    const { getByText, findByText } = render(wrap(<LeagueAnnounceScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('Golf Olivar'));
    fireEvent.press(getByText('Announce card'));
    expect(await findByText('You already have your October card.')).toBeTruthy();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  test('without a course it asks for one and does not call the server', async () => {
    bridge.consumePendingCourses.mockReturnValue(null);
    const { getByText, findByText } = render(wrap(<LeagueAnnounceScreen navigation={nav()} route={route} />));
    fireEvent.press(getByText('Announce card'));
    expect(await findByText('Pick the course you are playing.')).toBeTruthy();
    expect(store.announceLeagueCard).not.toHaveBeenCalled();
  });

  test('a 9-hole layout is refused before the server', async () => {
    bridge.consumePendingCourses.mockReturnValue({
      startRoundIndex: 0, picks: [{ kind: 'course', course: { ...pickedCourse, holes: holes.slice(0, 9) } }],
    });
    const { getByText, findByText } = render(wrap(<LeagueAnnounceScreen navigation={nav()} route={route} />));
    await waitFor(() => getByText('Golf Olivar'));
    fireEvent.press(getByText('Announce card'));
    expect(await findByText(/18-hole layout/)).toBeTruthy();
    expect(store.announceLeagueCard).not.toHaveBeenCalled();
  });

  test('a bad date shows a format hint', async () => {
    const { getByText, getByLabelText, findByText } = render(wrap(<LeagueAnnounceScreen navigation={nav()} route={route} />));
    await waitFor(() => getByText('Golf Olivar'));
    fireEvent.changeText(getByLabelText('Date'), 'tomorrow');
    fireEvent.press(getByText('Announce card'));
    expect(await findByText(/YYYY-MM-DD/)).toBeTruthy();
    expect(store.announceLeagueCard).not.toHaveBeenCalled();
  });
});
