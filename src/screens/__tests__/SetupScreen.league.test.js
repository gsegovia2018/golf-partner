import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import SetupScreen from '../SetupScreen';
import { cardMonth } from '../../store/leagueRules';

// League play in the app (plan §4.3 Setup, P6): the "Counts for <league>"
// switch on a game's review step, and Start announcing the card before the
// game is created.

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn((effect) => {
    const React = require('react');
    React.useEffect(effect, [effect]);
  }),
  CommonActions: { reset: jest.fn((x) => x) },
}));

jest.mock('../../components/PostCreateInviteModal', () => () => null);

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

const mockOrder = [];
jest.mock('../../store/mutate', () => ({
  mutate: jest.fn((current) => { mockOrder.push('mutate'); return Promise.resolve(current); }),
}));

jest.mock('../../store/leagueStore', () => ({
  getMyLeagues: jest.fn(),
  getMyCardsForMonth: jest.fn(),
  announceLeagueCard: jest.fn(),
}));

const store = require('../../store/leagueStore');
const { mutate } = require('../../store/mutate');

const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
const yellow = { label: 'Yellow', slope: 125, rating: 72 };
const tour = (over = {}) => ({
  id: 'L1', name: 'El Club del Mulligan', seasonStart: '2000-01-01', seasonEnd: '2999-12-31',
  archivedAt: null, role: 'member', leagueHandicap: 18, ...over,
});

function params(over = {}) {
  return {
    kind: 'game',
    initialStep: 'review',
    prefill: {
      players: [{ id: 'p1', name: 'Marcos', handicap: 4, user_id: 'user-1' }],
      rounds: [{
        id: 'r1', courseName: 'Centro Nacional', holes, tees: [yellow], playerHandicaps: null, playerTees: null,
      }],
    },
    ...over,
  };
}

const navigation = {
  goBack: jest.fn(), navigate: jest.fn(), replace: jest.fn(), dispatch: jest.fn(),
};
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
const flush = () => act(() => new Promise((r) => setImmediate(r)));

function createdTournament() {
  const call = mutate.mock.calls.find(([, m]) => m.type === 'tournament.create');
  return call?.[1].tournament;
}

describe('SetupScreen league switch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOrder.length = 0;
    store.getMyLeagues.mockResolvedValue([tour()]);
    store.getMyCardsForMonth.mockResolvedValue([]);
    store.announceLeagueCard.mockImplementation(() => {
      mockOrder.push('announce');
      return Promise.resolve({ id: 'card-1', month: '2026-10-01', announcedAt: 'x', leagueHandicap: 18 });
    });
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => { Alert.alert.mockRestore(); });

  test('eligible: the switch shows, off by default, and Start creates a normal game', async () => {
    const { findByLabelText, getByText, queryByText } = render(wrap(
      <SetupScreen navigation={navigation} route={{ params: params() }} />,
    ));
    const sw = await findByLabelText('Counts for El Club del Mulligan');
    expect(sw.props.value).toBe(false);
    expect(queryByText(/strokes from your league handicap/)).toBeNull();

    fireEvent.press(getByText('Start Game'));
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(store.announceLeagueCard).not.toHaveBeenCalled();
    expect(createdTournament().league).toBeUndefined();
  });

  test('preselected from the board: on, with strokes from the league handicap on my tee', async () => {
    const { findByText, getByLabelText } = render(wrap(
      <SetupScreen navigation={navigation} route={{ params: params({ leagueId: 'L1' }) }} />,
    ));
    expect(await findByText(/^Your \w+ card · 20 strokes from your league handicap 18\.0 · counts whatever you score$/))
      .toBeTruthy();
    expect(getByLabelText('Counts for El Club del Mulligan').props.value).toBe(true);
  });

  test('on: Start announces first, then creates the game with the league link and handicap', async () => {
    const { findByText, getByText } = render(wrap(
      <SetupScreen navigation={navigation} route={{ params: params({ leagueId: 'L1' }) }} />,
    ));
    await findByText(/strokes from your league handicap/);

    fireEvent.press(getByText('Start Game'));
    await waitFor(() => expect(mutate).toHaveBeenCalled());

    expect(mockOrder).toEqual(['announce', 'mutate']);
    const t = createdTournament();
    const args = store.announceLeagueCard.mock.calls[0][0];
    expect(args).toMatchObject({
      leagueId: 'L1', source: 'app', tournamentId: t.id, roundId: `${t.id}-r0`, playerId: 'p1',
    });
    expect(args.course).toMatchObject({ name: 'Centro Nacional', tee: 'Yellow' });
    expect(args.course.holes).toHaveLength(18);
    expect(typeof args.teeTime).toBe('string');

    expect(t.league).toEqual({ leagueId: 'L1', cardId: 'card-1', playerId: 'p1' });
    expect(t.rounds[0].playerIndexes).toEqual({ p1: 18 });
    expect(t.rounds[0].playerHandicaps.p1).toBe(20);
  });

  test('already has a card this month: no switch', async () => {
    store.getMyCardsForMonth.mockResolvedValue([
      { id: 'c0', leagueId: 'L1', userId: 'user-1', month: `${cardMonth(new Date())}-01`, status: 'confirmed' },
    ]);
    const { queryByLabelText } = render(wrap(<SetupScreen navigation={navigation} route={{ params: params() }} />));
    await flush();
    await flush();
    expect(queryByLabelText('Counts for El Club del Mulligan')).toBeNull();
  });

  test('unrated tee: the switch is off and disabled, with the reason and a way to add the rating', async () => {
    const red = { label: 'Red', slope: null, rating: null };
    const prefill = params({ leagueId: 'L1' }).prefill;
    prefill.rounds[0].tees = [red];
    const { findByLabelText, getByText, queryByText } = render(wrap(
      <SetupScreen navigation={navigation} route={{ params: { ...params({ leagueId: 'L1' }), prefill } }} />,
    ));
    const sw = await findByLabelText('Counts for El Club del Mulligan');
    expect(sw.props.value).toBe(false);
    expect(sw.props.disabled).toBe(true);
    expect(getByText(/Your Red tees aren't rated, so this round can't be your \w+ card yet\./)).toBeTruthy();
    expect(queryByText(/strokes from your league handicap/)).toBeNull();

    fireEvent.press(getByText('Add slope and rating to Red tees ›'));
    expect(navigation.navigate).toHaveBeenCalledWith('CourseEditor', expect.objectContaining({
      roundIndex: 0, initialTees: [red], courseName: 'Centro Nacional',
    }));

    // Start makes a normal game: nothing is announced to the league.
    fireEvent.press(getByText('Start Game'));
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(store.announceLeagueCard).not.toHaveBeenCalled();
  });

  test('archived league: no switch', async () => {
    store.getMyLeagues.mockResolvedValue([tour({ archivedAt: '2026-01-01T00:00:00Z' })]);
    const { queryByLabelText } = render(wrap(<SetupScreen navigation={navigation} route={{ params: params() }} />));
    await flush();
    await flush();
    expect(queryByLabelText('Counts for El Club del Mulligan')).toBeNull();
  });

  test('outside the season: no switch', async () => {
    store.getMyLeagues.mockResolvedValue([tour({ seasonStart: '2999-01-01' })]);
    const { queryByLabelText } = render(wrap(<SetupScreen navigation={navigation} route={{ params: params() }} />));
    await flush();
    await flush();
    expect(queryByLabelText('Counts for El Club del Mulligan')).toBeNull();
  });

  test('a tournament never shows the switch', async () => {
    const { queryByLabelText } = render(wrap(
      <SetupScreen navigation={navigation} route={{ params: params({ kind: 'tournament' }) }} />,
    ));
    await flush();
    expect(queryByLabelText('Counts for El Club del Mulligan')).toBeNull();
    expect(store.getMyLeagues).not.toHaveBeenCalled();
  });

  describe('announce fails', () => {
    beforeEach(() => {
      store.announceLeagueCard.mockRejectedValue(new Error('You already have your October card.'));
    });

    async function startAndGetDialog() {
      const utils = render(wrap(
        <SetupScreen navigation={navigation} route={{ params: params({ leagueId: 'L1' }) }} />,
      ));
      await utils.findByText(/strokes from your league handicap/);
      fireEvent.press(utils.getByText('Start Game'));
      await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
      const [title, message, buttons] = Alert.alert.mock.calls[0];
      return { title, message, buttons };
    }

    test('shows the server message and creates nothing until the user decides', async () => {
      const { title, message, buttons } = await startAndGetDialog();
      expect(title).toBe("Couldn't announce your card");
      expect(message).toContain('You already have your October card.');
      expect(buttons.map((b) => b.text)).toEqual(['Cancel', 'Start normal game']);
      expect(mutate).not.toHaveBeenCalled();

      await act(async () => { buttons[0].onPress(); });
      await flush();
      expect(mutate).not.toHaveBeenCalled();
    });

    test('"Start normal game" creates it without the league link or handicap', async () => {
      const { buttons } = await startAndGetDialog();
      await act(async () => { buttons[1].onPress(); });
      await waitFor(() => expect(mutate).toHaveBeenCalled());
      const t = createdTournament();
      expect(t.league).toBeUndefined();
      expect(t.rounds[0].playerIndexes).toBeUndefined();
    });
  });
});
