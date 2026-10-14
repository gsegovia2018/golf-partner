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
jest.mock('../../store/leagueStore', () => ({
  announceLeagueCard: jest.fn(),
  getLeague: jest.fn(() => Promise.resolve({
    league: { id: 'L1', name: 'El Club', pointsTable: [500, 300], participationPoints: 10 },
    members: [], cards: [], cardsByMonth: {},
  })),
  getLeagueCached: jest.fn(() => Promise.resolve(null)),
  getLeagueShareLink: jest.fn(() => Promise.resolve('tok12345678901234567890')),
}));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));

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
  afterEach(() => jest.useRealTimers());

  beforeEach(() => {
    // Friday 3 Oct 2025, 08:00 local; timers stay real so waitFor works.
    jest.useFakeTimers({ now: new Date(2025, 9, 3, 8, 0), doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    jest.clearAllMocks();
    bridge.consumePendingCourses.mockReturnValue({ startRoundIndex: 0, picks: [{ kind: 'course', course: pickedCourse }] });
  });

  test('hints the post-by time as soon as the tee time is valid, and follows the pickers', async () => {
    const { getByText, getByLabelText } = render(wrap(<LeagueAnnounceScreen navigation={nav()} route={route} />));
    // Default tee time is the earliest R7 allows (now + 2 h = 10:00): 18:00 the same day.
    expect(getByText("You'll have until 18:00 to post your score — 8 hours after tee time.")).toBeTruthy();
    fireEvent.press(getByLabelText('Date and tee time'));
    for (let i = 0; i < 72; i += 1) fireEvent.press(getByLabelText('Later tee time')); // 10:00 -> 22:00
    fireEvent.press(getByLabelText('Done'));
    expect(getByText("You'll have until 06:00 tomorrow to post your score — 8 hours after tee time.")).toBeTruthy();
  });

  test('a tee time less than 2 hours away gets the notice rule, a past one the way out (R7)', async () => {
    const { getByText, getByLabelText } = render(wrap(<LeagueAnnounceScreen navigation={nav()} route={route} />));
    fireEvent.press(getByLabelText('Date and tee time'));
    fireEvent.press(getByLabelText('Earlier tee time')); // 10:00 -> 09:50
    fireEvent.press(getByLabelText('Done'));
    expect(getByText('Announce at least 2 hours before your tee time. Pick a later time.')).toBeTruthy();
    fireEvent.press(getByLabelText('Date and tee time'));
    for (let i = 0; i < 12; i += 1) fireEvent.press(getByLabelText('Earlier tee time')); // 09:50 -> 07:50
    fireEvent.press(getByLabelText('Done'));
    expect(getByText(/That tee time has passed/)).toBeTruthy();
  });

  test('announces with source offapp, the course snapshot and the tee time, then offers the group chat', async () => {
    store.announceLeagueCard.mockResolvedValue({ id: 'c1', month: '2025-10-01', postBy: null });
    const navigation = nav();
    const { getByText, getByLabelText } = render(wrap(<LeagueAnnounceScreen navigation={navigation} route={route} />));
    expect(getByText(/Announce at least 2 hours before your tee time\. Your group is notified now; you'll add the score after the round\./)).toBeTruthy();
    await waitFor(() => getByText('Golf Olivar'));
    fireEvent.press(getByLabelText('Date and tee time'));
    fireEvent.press(getByLabelText('Sat 4 Oct 2025'));
    for (let i = 0; i < 3; i += 1) fireEvent.press(getByLabelText('Earlier tee time')); // 10:00 -> 09:30
    fireEvent.press(getByLabelText('Done'));
    fireEvent.press(getByText('Announce card'));

    await waitFor(() => getByText('Announced. Your group has been notified in the app.'));
    expect(navigation.goBack).not.toHaveBeenCalled();
    // "Tell the group chat" opens the share sheet preset with the announcement.
    fireEvent.press(getByText('Tell the group chat'));
    await waitFor(() => expect(getByLabelText('Message preview').props.children).toBe(
      "I'm playing my October card for El Club: Sat 4 Oct 9:30 am at Golf Olivar, without the app. Score in by 5:30 pm."
      + '\nhttps://golf-partner.vercel.app/league-board/tok12345678901234567890',
    ));
    fireEvent.press(getByText('Done'));
    expect(navigation.goBack).toHaveBeenCalled();
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

  test('the date field starts on the earliest allowed tee time and the sheet greys out past days', async () => {
    const { getByText, getByLabelText } = render(wrap(<LeagueAnnounceScreen navigation={nav()} route={route} />));
    await waitFor(() => getByText('Golf Olivar'));
    expect(getByText('Fri 3 Oct 2025 · 10:00')).toBeTruthy();
    fireEvent.press(getByLabelText('Date and tee time'));
    expect(getByLabelText('Thu 2 Oct 2025').props.accessibilityState.disabled).toBe(true);
    expect(getByLabelText('Sat 4 Oct 2025').props.accessibilityState.disabled).toBe(false);
  });

  test('tee chips show slope and rating; an unrated one is flagged with two ways out', async () => {
    const mixed = {
      ...pickedCourse,
      tees: [{ id: 't1', label: 'Yellow', slope: 125, rating: 72 }, { id: 't2', label: 'Red', slope: null, rating: null }],
    };
    bridge.consumePendingCourses.mockReturnValue({ startRoundIndex: 0, picks: [{ kind: 'course', course: mixed }] });
    const navigation = nav();
    const { getByText, queryByText, findByText } = render(wrap(<LeagueAnnounceScreen navigation={navigation} route={route} />));
    // The middle of two tees is the second: the unrated Red one, so its note is up.
    expect(await findByText("Red tees aren't rated yet")).toBeTruthy();
    expect(getByText('slope 125 · CR 72')).toBeTruthy();
    expect(getByText('no rating')).toBeTruthy();

    // Announcing is refused before the server.
    fireEvent.press(getByText('Announce card'));
    expect(await findByText(/can't count for the league/)).toBeTruthy();
    expect(store.announceLeagueCard).not.toHaveBeenCalled();

    // Way out 1: add the rating in the course library.
    fireEvent.press(getByText('Add slope & rating'));
    expect(navigation.navigate).toHaveBeenCalledWith('CourseLibraryDetail', { courseId: 'c1', courseName: 'Golf Olivar' });

    // Way out 2: use the rated tee.
    fireEvent.press(getByText('Use Yellow'));
    expect(queryByText("Red tees aren't rated yet")).toBeNull();
    // ...and the refusal goes with it.
    expect(queryByText(/can't count for the league/)).toBeNull();
  });
});
