import React from 'react';
import { render, fireEvent, act, within } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import { setLanguagePref } from '../../i18n';
import StatsScreen from '../StatsScreen';
import { weekendFixture } from '../../store/__tests__/fixtures/gameStatsFixture';

// loadTournament() resolves in a microtask after the first render; flush it.
const flush = () => act(() => new Promise((resolve) => setImmediate(resolve)));

jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

// The sheet renders its title so a test can see which sheet opened.
jest.mock('../../components/StatDetailSheet', () => {
  const { Text: RNText } = require('react-native');
  return {
    __esModule: true,
    default: ({ visible, title, subtitle }) => (visible ? <RNText testID="sheet">{`${title} | ${subtitle ?? ''}`}</RNText> : null),
  };
});

let mockActive;
let mockById;
jest.mock('../../store/tournamentStore', () => ({
  ...jest.requireActual('../../store/tournamentStore'),
  loadTournament: jest.fn(() => Promise.resolve(mockActive)),
  getActiveTournamentSnapshot: jest.fn(() => null),
  getTournament: jest.fn(() => Promise.resolve(mockById)),
  getTournamentSnapshot: jest.fn(() => null),
}));

const navigation = { goBack: jest.fn(), navigate: jest.fn() };

function fixture({ mode = 'stableford', players } = {}) {
  const t = weekendFixture();
  t.players[0].user_id = 'u1';
  t.settings.scoringMode = mode;
  if (players) {
    t.players = t.players.slice(0, players);
    const keep = new Set(t.players.map((p) => p.id));
    t.rounds.forEach((r) => {
      r.scores = Object.fromEntries(Object.entries(r.scores).filter(([id]) => keep.has(id)));
      r.pairs = null;
    });
  }
  return t;
}

async function open(tournament, { route } = {}) {
  mockActive = tournament;
  mockById = tournament;
  const utils = render(
    <ThemeProvider>
      <StatsScreen navigation={navigation} route={route} />
    </ThemeProvider>,
  );
  await flush();
  return utils;
}

afterEach(async () => {
  await act(() => setLanguagePref('en'));
});

describe('StatsScreen shell', () => {
  test('four tabs; Rivals needs two players', async () => {
    const { getByTestId, unmount } = await open(fixture());
    ['summary', 'rounds', 'players', 'rivals'].forEach((k) => expect(getByTestId(`tab-${k}`)).toBeTruthy());
    unmount();
    const solo = await open(fixture({ mode: 'individual', players: 1 }));
    expect(solo.queryByTestId('tab-rivals')).toBeNull();
  });

  test('header names the game and its rounds', async () => {
    const { getByText } = await open(fixture());
    expect(getByText('Fin de semana en Cádiz · 3 rounds')).toBeTruthy();
  });

  test('no scores yet shows the empty state', async () => {
    const t = fixture();
    t.rounds.forEach((r) => { r.scores = {}; });
    const { getByText, queryByTestId } = await open(t);
    expect(getByText('Nothing to show yet')).toBeTruthy();
    expect(queryByTestId('tab-summary')).toBeNull();
  });

  test('an all-scramble game shows the placeholder', async () => {
    const { getByText } = await open(fixture({ mode: 'scramblepairs' }));
    expect(getByText('Team scramble tournament')).toBeTruthy();
  });

  test('route params: loads the given game and opens its round on Rounds', async () => {
    const t = fixture();
    const { getByTestId } = await open(t, { route: { params: { tournamentId: t.id, roundId: 'fx-r1' } } });
    expect(getByTestId('round-chip-1').props.accessibilityState.selected).toBe(true);
  });
});

describe('Summary tab', () => {
  test('standings lead with points, per-round detail, partial rounds marked', async () => {
    const { getByText } = await open(fixture());
    expect(getByText('Final standings')).toBeTruthy();
    expect(getByText('68')).toBeTruthy();
    expect(getByText('22 · 24 · 22')).toBeTruthy();
    expect(getByText('18 · 18 · 20 (15 h)')).toBeTruthy();
  });

  test('Gross ranks finished rounds only', async () => {
    const { getByText, getByRole } = await open(fixture());
    fireEvent.press(getByRole('tab', { name: 'Gross' }));
    expect(getByText('Finished rounds only · gross strokes · to par')).toBeTruthy();
    expect(getByText('98 · 99 · 103')).toBeTruthy();
    expect(getByText('122 · 123 · –')).toBeTruthy();
  });

  test('progression chart with the lead caption, awards and score mix', async () => {
    const { getByTestId, getByText } = await open(fixture());
    expect(getByTestId('progression-chart')).toBeTruthy();
    expect(getByText('Marcos took the lead for good in R2.')).toBeTruthy();
    expect(getByTestId('award-bestRound')).toBeTruthy();
    expect(getByText('Score mix · everyone')).toBeTruthy();
  });

  test('an award opens its detail sheet', async () => {
    const { getByTestId } = await open(fixture());
    fireEvent.press(getByTestId('award-bestRound'));
    expect(getByTestId('sheet').props.children).toMatch(/^Best round · Marcos/);
  });

  test('tapping a standings row opens that player on Players', async () => {
    const { getByText, getByTestId } = await open(fixture());
    fireEvent.press(getByText('Javier Montero'));
    expect(getByTestId('player-chip-fx-jav').props.accessibilityState.selected).toBe(true);
  });

  test('one round: no progression chart', async () => {
    const t = fixture();
    t.rounds = [t.rounds[0]];
    const { queryByTestId } = await open(t);
    expect(queryByTestId('progression-chart')).toBeNull();
  });
});

describe('Rounds tab', () => {
  test('round chips, result, race and scorecard with Out / In / Tot', async () => {
    const { getByTestId, getByText } = await open(fixture({ mode: 'individual' }));
    fireEvent.press(getByTestId('tab-rounds'));
    expect(getByText('R1 · Real Club de Golf de Sevilla')).toBeTruthy();
    fireEvent.press(getByTestId('round-chip-2'));
    expect(getByText('Marcos wins with 22 pts, Nacho next on 20 pts')).toBeTruthy();
    expect(getByTestId('race-chart')).toBeTruthy();
    const card = within(getByTestId('scorecard-heatmap'));
    expect(card.getByText('Out')).toBeTruthy();
    expect(card.getByText('In')).toBeTruthy();
    expect(card.getByText('Tot')).toBeTruthy();
    expect(getByText('Hole stories')).toBeTruthy();
  });

  test('a team round shows pair totals and the pair-vs-pair chart', async () => {
    const { getByTestId, getByText } = await open(fixture());
    fireEvent.press(getByTestId('tab-rounds'));
    fireEvent.press(getByTestId('round-chip-2'));
    expect(getByText('Marcos & Javier beat Álvaro & Nacho 38–37')).toBeTruthy();
    expect(getByTestId('pair-difference-chart')).toBeTruthy();
  });

  test('a 9-hole round has a Tot row only', async () => {
    const t = fixture({ mode: 'individual' });
    const r = t.rounds[0];
    r.holes = r.holes.slice(0, 9).map((h, i) => ({ ...h, strokeIndex: i + 1 }));
    t.rounds = [r];
    const { getByTestId } = await open(t);
    fireEvent.press(getByTestId('tab-rounds'));
    const card = within(getByTestId('scorecard-heatmap'));
    expect(card.queryByText('Out')).toBeNull();
    expect(card.getByText('Tot')).toBeTruthy();
  });

  test('a hole story opens the hole sheet', async () => {
    const { getByTestId, getByText } = await open(fixture({ mode: 'individual' }));
    fireEvent.press(getByTestId('tab-rounds'));
    fireEvent.press(getByText('Easiest'));
    expect(getByTestId('sheet').props.children).toMatch(/^R1 · Hole/);
  });
});

describe('Players tab', () => {
  test('defaults to me: tiles, where you score, stroke holes, history and shots', async () => {
    const { getByTestId, getByText } = await open(fixture());
    fireEvent.press(getByTestId('tab-players'));
    expect(getByTestId('player-chip-fx-me').props.accessibilityState.selected).toBe(true);
    expect(getByText('points · 1 of 4')).toBeTruthy();
    expect(getByText('Where you score')).toBeTruthy();
    expect(getByText('Stroke holes')).toBeTruthy();
    expect(getByText('ROUND HISTORY')).toBeTruthy();
    expect(getByTestId('player-shots')).toBeTruthy();
  });

  test('a player without shot detail gets no shots section', async () => {
    const { getByTestId, queryByTestId } = await open(fixture());
    fireEvent.press(getByTestId('tab-players'));
    fireEvent.press(getByTestId('player-chip-fx-jav'));
    expect(queryByTestId('player-shots')).toBeNull();
  });

  test('a history row opens the round sheet', async () => {
    const { getByTestId, getByText } = await open(fixture());
    fireEvent.press(getByTestId('tab-players'));
    fireEvent.press(getByText('Montecastillo Golf'));
    expect(getByTestId('sheet').props.children).toMatch(/^R2 · Montecastillo Golf/);
  });

  test('shot comparison appears once two players logged shots', async () => {
    const t = fixture();
    t.rounds[0].shotDetails['fx-jav'] = { 1: { putts: 2, drive: 'fairway', teePenalties: 0 } };
    const { getByTestId } = await open(t);
    fireEvent.press(getByTestId('tab-players'));
    expect(getByTestId('shot-comparison')).toBeTruthy();
  });
});

describe('Rivals tab', () => {
  test('a head-to-head cell opens the duel sheet', async () => {
    const { getByTestId } = await open(fixture({ mode: 'individual' }));
    fireEvent.press(getByTestId('tab-rivals'));
    fireEvent.press(getByTestId('h2h-cell-fx-me-fx-jav'));
    expect(getByTestId('sheet').props.children).toMatch(/^Marcos vs Javier/);
  });

  test('teams only with real team rounds', async () => {
    const teams = await open(fixture());
    fireEvent.press(teams.getByTestId('tab-rivals'));
    expect(teams.getByText('MATCH PLAY')).toBeTruthy();
    teams.unmount();
    const solo = await open(fixture({ mode: 'individual' }));
    fireEvent.press(solo.getByTestId('tab-rivals'));
    expect(solo.queryByText('MATCH PLAY')).toBeNull();
    expect(solo.queryByText('Partner splits')).toBeNull();
  });

  test('partner splits hide with fixed teams', async () => {
    const t = fixture();
    t.settings.fixedTeams = true;
    const { getByTestId, queryByText } = await open(t);
    fireEvent.press(getByTestId('tab-rivals'));
    expect(queryByText('Partner splits')).toBeNull();
  });
});

describe('StatsScreen in Spanish', () => {
  test('tabs and standings', async () => {
    await act(() => setLanguagePref('es'));
    const { getByText } = await open(fixture());
    expect(getByText('Resumen')).toBeTruthy();
    expect(getByText('Vueltas')).toBeTruthy();
    expect(getByText('Rivales')).toBeTruthy();
    expect(getByText('Clasificación final')).toBeTruthy();
  });
});
