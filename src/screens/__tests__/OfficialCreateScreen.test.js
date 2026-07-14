import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import OfficialCreateScreen from '../OfficialCreateScreen';

// Task 3.1: OfficialCreateScreen.handleCreate used navigation.navigate (a
// push) on success/partial-failure, leaving the Review step in the stack —
// Back + re-tap "Create Tournament" created a SECOND tournament. Fixed by
// replacing the stack entry and tracking createdTournamentId so a
// re-invocation short-circuits instead of re-creating.

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn((effect) => {
    const React = require('react');
    React.useEffect(effect, [effect]);
  }),
}));

jest.mock('../../lib/selectionBridge', () => ({
  consumePendingCourses: jest.fn(() => ({
    startRoundIndex: 0,
    picks: [{
      kind: 'course',
      course: {
        id: 'c1', name: 'Pine Valley', holes: [], tees: [], slope: 120, rating: 72,
      },
    }],
  })),
}));

jest.mock('../../store/officialAdmin', () => ({
  createOfficialTournament: jest.fn(),
  addRosterPlayer: jest.fn(() => Promise.resolve()),
  createRound: jest.fn(() => Promise.resolve()),
}));

const navigation = { navigate: jest.fn(), goBack: jest.fn(), replace: jest.fn() };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

async function goToReview(getByText, getByPlaceholderText) {
  fireEvent.changeText(getByPlaceholderText('Player name'), 'Alice');
  fireEvent.press(getByText('Add Player'));
  fireEvent.press(getByText('Next')); // roster -> rounds
  await waitFor(() => getByText('ROUNDS'));
  fireEvent.press(getByText('Next')); // rounds -> format
  await waitFor(() => getByText('FORMAT'));
  fireEvent.press(getByText('Next')); // format -> review
  await waitFor(() => getByText('REVIEW & CONFIRM'));
}

describe('OfficialCreateScreen duplicate-create guard (Task 3.1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const { createOfficialTournament } = require('../../store/officialAdmin');
    createOfficialTournament.mockResolvedValue('tid-1');
  });

  test('re-invoking handleCreate after success does not insert a second tournament', async () => {
    const {
      createOfficialTournament, addRosterPlayer, createRound,
    } = require('../../store/officialAdmin');
    const { getByText, getByPlaceholderText } = render(
      wrap(<OfficialCreateScreen navigation={navigation} />)
    );

    await goToReview(getByText, getByPlaceholderText);

    fireEvent.press(getByText('Create Tournament'));
    await waitFor(() => expect(createOfficialTournament).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('OfficialSetup', { tournamentId: 'tid-1' }));

    // Simulate Back landing on Review (stack entry replaced, but here we
    // exercise the same mounted instance) + re-tap "Create Tournament".
    fireEvent.press(getByText('Create Tournament'));

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenLastCalledWith('OfficialSetup', { tournamentId: 'tid-1' });
    });

    expect(createOfficialTournament).toHaveBeenCalledTimes(1);
    expect(addRosterPlayer).toHaveBeenCalledTimes(1);
    expect(createRound).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).not.toHaveBeenCalledWith('OfficialSetup', expect.anything());
  });

  test('success navigates by replace, not push, so Review is not left in the stack', async () => {
    const { getByText, getByPlaceholderText } = render(
      wrap(<OfficialCreateScreen navigation={navigation} />)
    );

    await goToReview(getByText, getByPlaceholderText);
    fireEvent.press(getByText('Create Tournament'));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('OfficialSetup', { tournamentId: 'tid-1' }));
    expect(navigation.navigate).not.toHaveBeenCalledWith('OfficialSetup', expect.anything());
  });

  test('partial failure (roster insert throws after tournament row exists) also replaces, and a re-tap short-circuits', async () => {
    const {
      createOfficialTournament, addRosterPlayer, createRound,
    } = require('../../store/officialAdmin');
    addRosterPlayer.mockRejectedValueOnce(new Error('roster insert failed'));

    const { getByText, getByPlaceholderText } = render(
      wrap(<OfficialCreateScreen navigation={navigation} />)
    );

    await goToReview(getByText, getByPlaceholderText);
    fireEvent.press(getByText('Create Tournament'));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('OfficialSetup', { tournamentId: 'tid-1' }));
    expect(createOfficialTournament).toHaveBeenCalledTimes(1);

    // Re-tap after the partial failure: must short-circuit, not re-create.
    fireEvent.press(getByText('Create Tournament'));
    await waitFor(() => expect(navigation.replace).toHaveBeenLastCalledWith('OfficialSetup', { tournamentId: 'tid-1' }));

    expect(createOfficialTournament).toHaveBeenCalledTimes(1);
    expect(createRound).not.toHaveBeenCalled();
  });
});
