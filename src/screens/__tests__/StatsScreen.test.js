import React from 'react';
import { render, fireEvent, act, within } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import { setLanguagePref } from '../../i18n';
import StatsScreen from '../StatsScreen';
import { weekendFixture } from '../../store/__tests__/fixtures/gameStatsFixture';
import { bestBallGameFixture } from '../../store/__tests__/fixtures/bestBallGameFixture';

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
    const { getByTestId, getAllByTestId, getByText } = await open(fixture());
    expect(getByTestId('progression-chart')).toBeTruthy();
    expect(getByText('Marcos took the lead for good in R2.')).toBeTruthy();
    expect(getByTestId('award-bestRound')).toBeTruthy();
    expect(getByText('Score mix · everyone')).toBeTruthy();
    // One shared legend, not one per player.
    expect(getAllByTestId('scoremix-legend')).toHaveLength(1);
  });

  test('weekend awards: hole cards, best gross and comeback open ranked sheets', async () => {
    const { getByTestId } = await open(fixture());
    expect(getByTestId('award-easiestHole')).toBeTruthy();
    expect(getByTestId('award-hardestHole')).toBeTruthy();
    fireEvent.press(getByTestId('award-bestGross'));
    expect(getByTestId('sheet').props.children).toMatch(/^Best gross round · Javier \| Finished 18-hole rounds/);
    fireEvent.press(getByTestId('award-comeback'));
    expect(getByTestId('sheet').props.children).toMatch(/^Comeback · Marcos/);
    fireEvent.press(getByTestId('award-easiestHole'));
    expect(getByTestId('sheet').props.children).toMatch(/^Easiest hole \| Highest average/);
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
    // Count-aware caption: "1 lead change", never "1 lead changes".
    expect(getByText('Álvaro & Nacho won by 7 pts · 1 lead change')).toBeTruthy();
  });

  test('a 9-hole round has a Tot row only', async () => {
    const t = fixture({ mode: 'individual' });
    const r = t.rounds[0];
    r.holes = r.holes.slice(0, 9).map((h, i) => ({ ...h, strokeIndex: i + 1 }));
    t.rounds = [r];
    const { getByTestId } = await open(t);
    fireEvent.press(getByTestId('tab-card'));
    const card = within(getByTestId('scorecard-heatmap'));
    expect(card.queryByText('Out')).toBeNull();
    expect(card.getByText('Tot')).toBeTruthy();
  });

  test('lead story and comeback lines on the round card', async () => {
    const { getByTestId, getByText, queryByTestId } = await open(fixture({ mode: 'individual' }));
    fireEvent.press(getByTestId('tab-rounds'));
    fireEvent.press(getByTestId('round-chip-2'));
    expect(getByText('Comeback: Marcos was 6 points behind after H10')).toBeTruthy();
    expect(getByText('Nacho led 13 of 18 holes · 3 lead changes')).toBeTruthy();
    fireEvent.press(getByTestId('round-chip-1'));
    expect(queryByTestId('round-comeback')).toBeNull();
    expect(getByText('Marcos led 11 of 18 holes · No lead changes')).toBeTruthy();
  });

  test('a team round tells its story about the pairs, matching the result card', async () => {
    const { getByTestId, getByText, queryByTestId } = await open(fixture());
    fireEvent.press(getByTestId('tab-rounds'));
    expect(getByText(/^Javier & Álvaro beat Marcos & Nacho/)).toBeTruthy();
    expect(getByText(/^Javier & Álvaro led \d+ of 18 holes/)).toBeTruthy();
    expect(queryByTestId('round-comeback')).toBeNull();
  });

  test('a hole story opens the hole sheet', async () => {
    const { getByTestId, getByText } = await open(fixture({ mode: 'individual' }));
    fireEvent.press(getByTestId('tab-rounds'));
    fireEvent.press(getByText('Easiest'));
    expect(getByTestId('sheet').props.children).toMatch(/^R1 · Hole/);
  });
});

describe('Players tab', () => {
  test('defaults to me: tiles, where you score, history and the shot charts', async () => {
    const { getByTestId, getByText, queryByTestId } = await open(fixture());
    fireEvent.press(getByTestId('tab-players'));
    expect(getByTestId('player-chip-fx-me').props.accessibilityState.selected).toBe(true);
    expect(getByText('points · 1 of 4')).toBeTruthy();
    expect(getByText('Where you score')).toBeTruthy();
    // One diverging chart: par types, nines and stroke holes together.
    ['par3', 'par4', 'par5', 'front', 'back', 'withStroke', 'withoutStroke'].forEach((k) => expect(getByTestId(`where-${k}`)).toBeTruthy());
    expect(getByTestId('best-runs')).toBeTruthy();
    expect(getByText('Best run · net')).toBeTruthy();
    expect(getByText(/4 pars or better · 1 birdie or better/)).toBeTruthy();
    expect(getByText('ROUND HISTORY')).toBeTruthy();
    expect(getByTestId('player-shots')).toBeTruthy();
    expect(getByTestId('fairway-fan')).toBeTruthy();
    expect(getByTestId('putt-histogram')).toBeTruthy();
    expect(getByTestId('player-bounce')).toBeTruthy();
    // Several rounds: no hole-by-hole ledger; penalties are a line, not a 0 row.
    expect(queryByTestId('hole-ledger')).toBeNull();
    expect(getByTestId('player-penalties')).toBeTruthy();
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

  test('shot comparison appears once two players logged shots, as dot plots', async () => {
    const t = fixture();
    const one = await open(t);
    fireEvent.press(one.getByTestId('tab-players'));
    expect(one.queryByTestId('shot-comparison')).toBeNull();
    one.unmount();
    t.rounds[0].shotDetails['fx-jav'] = { 1: { putts: 2, drive: 'fairway', teePenalties: 0 } };
    const { getByTestId } = await open(t);
    fireEvent.press(getByTestId('tab-players'));
    expect(getByTestId('shot-comparison')).toBeTruthy();
    expect(getByTestId('compare-fir')).toBeTruthy();
    expect(getByTestId('compare-putts')).toBeTruthy();
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
    expect(teams.getByText('PAIR CARDS')).toBeTruthy();
    expect(teams.getByText('Partner splits')).toBeTruthy();
    teams.unmount();
    const solo = await open(fixture({ mode: 'individual' }));
    fireEvent.press(solo.getByTestId('tab-rivals'));
    expect(solo.queryByText('PAIR CARDS')).toBeNull();
    expect(solo.queryByText('Partner splits')).toBeNull();
  });

  test('match play lists only match play rounds, with the same result as Rounds', async () => {
    const partners = await open(fixture());
    fireEvent.press(partners.getByTestId('tab-rivals'));
    expect(partners.queryByTestId('match-play-results')).toBeNull();
    partners.unmount();
    const t = fixture();
    t.rounds[0].scoringMode = 'pairsmatchplay';
    const mp = await open(t);
    fireEvent.press(mp.getByTestId('tab-rounds'));
    const roundLine = mp.getByText(/ beat | level on /).props.children;
    fireEvent.press(mp.getByTestId('tab-rivals'));
    const list = within(mp.getByTestId('match-play-results'));
    expect(list.getByText(roundLine)).toBeTruthy();
    expect(list.getAllByText(/^R\d$/)).toHaveLength(1);
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

// The phone walkthrough's game: one round of Best Ball / Worst Ball.
describe('a Best Ball / Worst Ball game', () => {
  const tabs = (getAllByRole) => getAllByRole('tab').map((x) => within(x).queryAllByText(/./).map((n) => n.props.children).join(''));

  test('standings default to the Play result, with Stableford, Gross and Net beside it', async () => {
    const { getAllByRole, getByRole, getAllByText, getByText, queryByText } = await open(bestBallGameFixture());
    expect(tabs(getAllByRole)).toEqual(['Result', 'Stableford', 'Gross', 'Net']);
    expect(getByRole('tab', { name: 'Result' }).props.accessibilityState.selected).toBe(true);
    // Marcos 5, Yeyen 5, Molden 4.5, Charlie 4.5: the Play board, not 30/29/27/25.
    expect(getAllByText('5')).toHaveLength(2);
    expect(getAllByText('4.5')).toHaveLength(2);
    expect(queryByText('30')).toBeNull();
    expect(getByText('Best Ball / Worst Ball points · same as the Play leaderboard')).toBeTruthy();
    fireEvent.press(getByRole('tab', { name: 'Stableford' }));
    expect(getByText('30')).toBeTruthy();
    // One round: nothing "per round".
    expect(getByText('Points · vs handicap (2 pts per hole)')).toBeTruthy();
  });

  test('a Stableford game keeps Points · Gross · Net', async () => {
    const { getAllByRole, queryByRole } = await open(fixture());
    expect(tabs(getAllByRole)).toEqual(['Points', 'Gross', 'Net']);
    expect(queryByRole('tab', { name: 'Result' })).toBeNull();
  });

  test('a best ball tournament titles its progression as Stableford, with no lead caption', async () => {
    const { getByText, queryByText } = await open(fixture({ mode: 'bestball' }));
    expect(getByText('How it unfolded · Stableford')).toBeTruthy();
    expect(queryByText('Marcos took the lead for good in R2.')).toBeNull();
  });

  test('the round result counts each pair once, as the scorecard does', async () => {
    // Played twice, so the Rounds tab (and its result card) is there.
    const g = bestBallGameFixture();
    g.rounds.push({ ...g.rounds[0], id: `${g.rounds[0].id}-again` });
    const { getByTestId, getByText } = await open(g);
    fireEvent.press(getByTestId('tab-rounds'));
    expect(getByText('Marcos & Yeyen beat Molden & Charlie 10–9')).toBeTruthy();
  });

  test('pair cards say their points are combined', async () => {
    const { getByTestId, getAllByText } = await open(bestBallGameFixture());
    fireEvent.press(getByTestId('tab-rivals'));
    expect(getByTestId('pair-avg-bb1|bb2').props.children).toBe('57');
    expect(getAllByText(/^\d+ pts combined$/)).toHaveLength(2);
    expect(getAllByText('57 pts combined')).toHaveLength(1);
  });

  test('in Spanish: Resultado · Stableford · Bruto · Neto', async () => {
    await act(() => setLanguagePref('es'));
    const { getAllByRole, getAllByText, getByText } = await open(bestBallGameFixture());
    expect(tabs(getAllByRole)).toEqual(['Resultado', 'Stableford', 'Bruto', 'Neto']);
    expect(getAllByText('4,5')).toHaveLength(2);
    fireEvent.press(getByText('Rivales'));
    expect(getAllByText('57 ptos combinados')).toHaveLength(1);
  });
});

describe('numbers and narrow screens', () => {
  const putts = (t, list) => {
    const r = t.rounds[0];
    r.holes.forEach((h, i) => { r.shotDetails['fx-me'][h.number].putts = list[i]; });
  };

  test('putts per hole keep one decimal in both languages', async () => {
    const t = fixture();
    t.rounds = [t.rounds[0]];
    putts(t, [1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 2, 2]); // 34 over 18
    await act(() => setLanguagePref('es'));
    const es = await open(t);
    fireEvent.press(es.getByTestId('tab-players'));
    expect(within(es.getByTestId('player-shots')).getByText('Putts · 1,9/hoyo')).toBeTruthy();
    expect(within(es.getByTestId('player-putts')).getByText('34 en 18 hoyos · 1,9/hoyo')).toBeTruthy();
    es.unmount();
    await act(() => setLanguagePref('en'));
    putts(t, Array(18).fill(2)); // exactly 2 per hole still shows its decimal
    const en = await open(t);
    fireEvent.press(en.getByTestId('tab-players'));
    expect(within(en.getByTestId('player-shots')).getByText('Putts · 2.0/hole')).toBeTruthy();
  });

  test('score mix counts, Where you score labels and head-to-head heads never ellipsize', async () => {
    const { getByTestId, getByText } = await open(fixture());
    const count = getByTestId('mix-count-fx-me');
    expect(count.props.numberOfLines).toBeUndefined();
    fireEvent.press(getByTestId('tab-players'));
    expect(getByText('Without a stroke').props.numberOfLines).toBeUndefined();
    fireEvent.press(getByTestId('tab-rivals'));
    const head = getByTestId('h2h-head-fx-me');
    const style = Object.assign({}, ...[head.props.style].flat(Infinity).filter(Boolean));
    expect(style.letterSpacing).toBe(0);
    expect(style.width).toBeLessThanOrEqual(56);
  });
});

// One played round: a casual game, or a tournament after its first day.
describe('a one-round game', () => {
  const single = ({ shots = false } = {}) => {
    const t = fixture();
    t.rounds = [t.rounds[0]];
    // Javier logs a few holes so the comparison has two players.
    if (shots) t.rounds[0].shotDetails['fx-jav'] = { 1: { putts: 2, drive: 'fairway' }, 2: { putts: 1, drive: 'left' } };
    return t;
  };
  const tabIds = (getAllByRole) => getAllByRole('button')
    .map((b) => b.props.testID ?? '')
    .filter((id) => /^tab-/.test(id));

  test('tabs Summary · Scorecard · Players · Rivals, header without a round count', async () => {
    const { getByTestId, queryByTestId, getByText, queryByText, getAllByRole } = await open(single());
    expect(tabIds(getAllByRole)).toEqual(['tab-summary', 'tab-card', 'tab-players', 'tab-rivals']);
    expect(getByText('Scorecard')).toBeTruthy();
    expect(queryByTestId('tab-rounds')).toBeNull();
    expect(getByText('Fin de semana en Cádiz')).toBeTruthy();
    expect(queryByText(/1 round/)).toBeNull();
    fireEvent.press(getByTestId('tab-card'));
    expect(queryByTestId('round-chip-0')).toBeNull();
    expect(getByTestId('scorecard-heatmap')).toBeTruthy();
    expect(getByTestId('pair-difference-chart')).toBeTruthy();
    expect(getByText('Hole stories')).toBeTruthy();
  });

  test('in Spanish: Resumen · Tarjeta · Jugadores · Rivales', async () => {
    await act(() => setLanguagePref('es'));
    const { getByText, queryByText } = await open(single());
    ['Resumen', 'Tarjeta', 'Jugadores', 'Rivales'].forEach((x) => expect(getByText(x)).toBeTruthy());
    expect(queryByText('Vueltas')).toBeNull();
  });

  test('a route asking for the round opens the Scorecard tab', async () => {
    const t = single();
    const { getByTestId } = await open(t, { route: { params: { tournamentId: t.id, roundId: 'fx-r0' } } });
    expect(getByTestId('tab-card').props.accessibilityState.selected).toBe(true);
  });

  test('Summary: the race with its lead line, no Best round, a one-round footer', async () => {
    const { getByTestId, queryByTestId, getByText } = await open(single());
    const race = within(getByTestId('summary-race'));
    expect(race.getByTestId('race-chart')).toBeTruthy();
    expect(race.getByTestId('round-lead')).toBeTruthy();
    expect(queryByTestId('award-bestRound')).toBeNull();
    expect(getByText('Points · vs handicap (2 pts per hole)')).toBeTruthy();
  });

  test('ledger: gross strokes by default, points after the switch, best run follows it', async () => {
    const { getByTestId } = await open(single());
    fireEvent.press(getByTestId('tab-players'));
    const ledger = within(getByTestId('hole-ledger'));
    expect(getByTestId('ledger-out')).toBeTruthy();
    expect(getByTestId('ledger-in')).toBeTruthy();
    // Hole 1: 4 strokes on a par 4 with a handicap stroke = 3 points.
    expect(ledger.getByTestId('ledger-cell-1').props.children).toBe(4);
    expect(ledger.getByTestId('ledger-total').props.children).toBe('102 strokes · +30 · 36 putts');
    expect(within(getByTestId('ledger-out')).getByText('4/7')).toBeTruthy(); // fairways on the front nine
    fireEvent.press(getByTestId('ledger-mode-points'));
    const after = within(getByTestId('hole-ledger'));
    expect(after.getByTestId('ledger-cell-1').props.children).toBe(3);
    expect(after.getByTestId('ledger-total').props.children).toMatch(/^\d+ points · 102 strokes · 36 putts$/);
    expect(after.getByText(/holes of 2\+ points \(H\d+–H\d+\)$/)).toBeTruthy();
  });

  test('a tee penalty is a dot on that hole only; GIR cells and accessibility labels', async () => {
    const { getByTestId, queryByTestId, getByLabelText } = await open(single());
    fireEvent.press(getByTestId('tab-players'));
    const dot = getByTestId('ledger-penalty-12');
    const style = Object.assign({}, ...[dot.props.style].flat(Infinity).filter(Boolean));
    expect(style).toMatchObject({ position: 'absolute', width: 6, height: 6, borderRadius: 3 });
    expect(queryByTestId('ledger-penalty-11')).toBeNull();
    expect(getByLabelText('Hole 12: tee shot in the fairway, penalty')).toBeTruthy();
    expect(getByLabelText('Hole 1: tee shot right')).toBeTruthy();
    expect(getByTestId('ledger-gir-1')).toBeTruthy();
  });

  test('a player who logged no shots: strokes rows only, a note, no shot charts', async () => {
    const { getByTestId, queryByTestId } = await open(single());
    fireEvent.press(getByTestId('tab-players'));
    fireEvent.press(getByTestId('player-chip-fx-jav'));
    const ledger = within(getByTestId('hole-ledger'));
    expect(ledger.queryByText('Putts')).toBeNull();
    expect(ledger.queryByText('Tee')).toBeNull();
    expect(ledger.getByTestId('ledger-total').props.children).toMatch(/^\d+ strokes · [+−]?\d+$/);
    expect(queryByTestId('player-shots')).toBeNull();
    expect(queryByTestId('fairway-fan')).toBeNull();
    expect(getByTestId('no-shots-note')).toBeTruthy();
  });

  test('one Strokes | Points switch for the screen: Summary mix, ledger and player mix', async () => {
    const { getByTestId } = await open(single());
    // Gross by default: Marcos made no real birdie, but net ones.
    expect(getByTestId('mix-count-fx-me').props.children).toBe('0 birdies+');
    fireEvent.press(getByTestId('mix-mode-points'));
    expect(getByTestId('mix-count-fx-me').props.children).not.toBe('0 birdies+');
    fireEvent.press(getByTestId('tab-players'));
    expect(getByTestId('ledger-mode-points').props.accessibilityState.selected).toBe(true);
    expect(getByTestId('player-mix-mode-points').props.accessibilityState.selected).toBe(true);
    fireEvent.press(getByTestId('player-mix-mode-strokes'));
    expect(getByTestId('ledger-mode-strokes').props.accessibilityState.selected).toBe(true);
  });

  test('Players tiles: points with rank, strokes to par, vs handicap', async () => {
    const { getByTestId, getByText } = await open(single());
    fireEvent.press(getByTestId('tab-players'));
    expect(getByText(/^points · T?\d of 4$/)).toBeTruthy();
    expect(getByText('102')).toBeTruthy();
    expect(getByText('strokes · +30')).toBeTruthy();
    expect(getByText('vs handicap')).toBeTruthy();
  });

  // The guard: nothing on any tab may only make sense across rounds.
  const collect = (node, out = []) => {
    if (node == null) return out;
    if (typeof node === 'string') { out.push(node); return out; }
    if (Array.isArray(node)) { node.forEach((n) => collect(n, out)); return out; }
    collect(node.children, out);
    return out;
  };
  const FORBIDDEN = {
    // "round(s)" as a word, R1-style round tags, averages.
    en: [/\brounds?\b/i, /\bR\d+\b/, /\bavg\b/i, /\baverage\b/i],
    // "vuelta" in any form (round; the ledger's nines are IDA / VTA), V1 /
    // R1 tags, "media".
    es: [/vuelta/i, /\bV\d+\b/, /\bR\d+\b/, /\bmedia\b/i],
  };

  test.each(['en', 'es'])('guard (%s): no per-round wording on any tab, either mode', async (lang) => {
    await act(() => setLanguagePref(lang));
    const utils = await open(single({ shots: true }));
    const texts = [];
    const grab = () => texts.push(...collect(utils.toJSON()));
    ['strokes', 'points'].forEach((mode) => {
      ['tab-summary', 'tab-card', 'tab-players', 'tab-rivals'].forEach((id) => {
        fireEvent.press(utils.getByTestId(id));
        if (id === 'tab-summary') fireEvent.press(utils.getByTestId(`mix-mode-${mode}`));
        grab();
        if (id === 'tab-players') {
          fireEvent.press(utils.getByTestId('player-chip-fx-alv')); // no shots logged
          grab();
          fireEvent.press(utils.getByTestId('player-chip-fx-me'));
        }
      });
    });
    expect(texts.length).toBeGreaterThan(100);
    // Allowed: the scorecard heatmap's back-nine total row, "Vuelta" (the
    // glossary keeps Ida / Vuelta for scorecard heads), matched exactly.
    const allowed = new Set(lang === 'es' ? ['Vuelta'] : []);
    const hits = texts.filter((x) => !allowed.has(x) && FORBIDDEN[lang].some((re) => re.test(x)));
    expect(hits).toEqual([]);
  });
});
