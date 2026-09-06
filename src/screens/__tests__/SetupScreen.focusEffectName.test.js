import React from 'react';
import { act, render, waitFor, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import SetupScreen from '../SetupScreen';
import { setPendingCourses } from '../../lib/selectionBridge';

// Regression test (audit fix): the Players/Courses focus effect used to be
// `useFocusEffect(useCallback(() => {...}, []))`, so it closed over
// `nameTouched` at its MOUNT value forever. Typing a game name, then picking
// a course (which refocuses this screen), would silently overwrite the typed
// name with `buildGameName(course.name)` because the effect's stale closure
// still believed the name had never been touched. The fix reads
// `nameTouched` through a ref instead, so a later refocus sees the current
// value.
//
// This mock captures the exact callback the screen registers so the test can
// invoke it again — standing in for react-navigation firing a second `focus`
// event when the user comes back from the course picker.
let mockFocusEffect = null;
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn((effect) => {
    const ReactModule = require('react');
    mockFocusEffect = effect;
    ReactModule.useEffect(() => effect(), []);
  }),
  CommonActions: { reset: jest.fn((x) => x) },
}));

jest.mock('../../components/PostCreateInviteModal', () => {
  return function MockPostCreateInviteModal() {
    return null;
  };
});

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

jest.mock('../../store/mutate', () => ({
  mutate: jest.fn((current) => Promise.resolve(current)),
}));

function fourPlayers() {
  return Array.from({ length: 4 }, (_, i) => ({
    id: `p${i + 1}`, name: `Player ${i + 1}`, handicap: 10,
  }));
}

const navigation = {
  goBack: jest.fn(), navigate: jest.fn(), replace: jest.fn(), dispatch: jest.fn(),
};
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('SetupScreen focus effect keeps a typed name on refocus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFocusEffect = null;
  });

  test('a name typed after mount survives a course pick made from another screen', async () => {
    const route = {
      params: {
        kind: 'game',
        initialStep: 'review',
        prefill: {
          name: 'Pine Valley · 1 Jun',
          players: fourPlayers(),
          rounds: [{
            id: 'r1', courseName: 'Pine Valley', holes: [], tees: [], playerHandicaps: null, playerTees: null,
          }],
        },
      },
    };
    const { getByDisplayValue } = render(wrap(
      <SetupScreen navigation={navigation} route={route} />,
    ));
    await waitFor(() => expect(getByDisplayValue('Pine Valley · 1 Jun')).toBeTruthy());
    expect(mockFocusEffect).toEqual(expect.any(Function));

    // The scorer renames the game after mount — this must mark it "touched".
    fireEvent.changeText(getByDisplayValue('Pine Valley · 1 Jun'), 'Saturday Crew');
    await waitFor(() => expect(getByDisplayValue('Saturday Crew')).toBeTruthy());

    // They then pick a different course from the CoursePicker screen and
    // come back — that screen stashes the pick and this screen's focus
    // effect consumes it on the next focus.
    act(() => {
      setPendingCourses({
        startRoundIndex: 0,
        picks: [{ kind: 'course', course: { id: 'c2', name: 'Augusta National' } }],
      });
      mockFocusEffect();
    });

    // The typed name must survive — the stale-closure bug would have reset
    // it to "Augusta National".
    await waitFor(() => expect(getByDisplayValue('Saturday Crew')).toBeTruthy());
  });
});
