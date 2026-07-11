import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme/ThemeContext';
import EditTeamsScreen from '../EditTeamsScreen';
import * as store from '../../store/tournamentStore';
import { mutate } from '../../store/mutate';

jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));

jest.mock('../../store/tournamentStore', () => ({
  getTournamentSnapshot: jest.fn(),
  getActiveTournamentSnapshot: jest.fn(),
  getTournament: jest.fn(),
  loadTournament: jest.fn(),
  subscribeTournamentChanges: jest.fn(() => () => {}),
  getPlayingHandicap: jest.fn(() => 10),
  roundScoringMode: jest.fn(() => 'bestball'),
}));

jest.mock('../../store/mutate', () => ({ mutate: jest.fn((t) => Promise.resolve(t)) }));

const P = (id) => ({ id, name: id });
const makeTournament = (id) => ({
  id,
  players: [P('a'), P('b'), P('c'), P('d')],
  settings: { scoringMode: 'bestball' },
  rounds: [{ id: `${id}-r0`, courseName: 'St Andrews', pairs: [[P('a'), P('b')], [P('c'), P('d')]], revealed: true }],
});

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderScreen(params) {
  const navigation = { goBack: jest.fn(), navigate: jest.fn(), isFocused: () => true };
  const utils = render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <EditTeamsScreen navigation={navigation} route={{ params }} />
      </ThemeProvider>
    </SafeAreaProvider>,
  );
  return { navigation, ...utils };
}

beforeEach(() => jest.clearAllMocks());

describe('EditTeamsScreen — linked tournament', () => {
  test('loads the tournament named by route.params.tournamentId, not the active one', () => {
    const linked = makeTournament('linked');
    store.getTournamentSnapshot.mockReturnValue(linked);
    store.getTournament.mockResolvedValue(linked);

    const { getByText } = renderScreen({ roundIndex: 0, tournamentId: 'linked' });

    expect(store.getTournamentSnapshot).toHaveBeenCalledWith('linked');
    expect(store.getActiveTournamentSnapshot).not.toHaveBeenCalled();
    expect(getByText('St Andrews')).toBeTruthy();
  });

  test('saving writes back to the linked tournament + round', async () => {
    const linked = makeTournament('linked');
    store.getTournamentSnapshot.mockReturnValue(linked);
    store.getTournament.mockResolvedValue(linked);

    const { getByText } = renderScreen({ roundIndex: 0, tournamentId: 'linked' });
    fireEvent.press(getByText('Save Teams'));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const [tournamentArg, mutationArg] = mutate.mock.calls[0];
    expect(tournamentArg.id).toBe('linked');
    expect(mutationArg).toMatchObject({ type: 'pairs.set', roundId: 'linked-r0' });
  });

  test('falls back to the active tournament when no id is passed', () => {
    const active = makeTournament('active');
    store.getActiveTournamentSnapshot.mockReturnValue(active);
    store.loadTournament.mockResolvedValue(active);

    renderScreen({ roundIndex: 0 });

    expect(store.getActiveTournamentSnapshot).toHaveBeenCalled();
    expect(store.getTournamentSnapshot).not.toHaveBeenCalled();
  });
});
