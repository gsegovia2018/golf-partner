import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ScrollView, StyleSheet } from 'react-native';
import StatsScreen from '../StatsScreen';

jest.mock('@expo/vector-icons', () => ({
  Feather: 'Feather',
}));

jest.mock('../../components/StatDetailSheet', () => ({
  __esModule: true,
  default: 'StatDetailSheet',
  captureAndShare: jest.fn(),
}));

const mockTheme = {
  isDark: false,
  bg: {
    primary: '#f6f3ee',
    secondary: '#ece8e1',
    card: '#ffffff',
  },
  border: {
    default: '#ddd',
    subtle: '#eee',
  },
  text: {
    primary: '#111',
    secondary: '#555',
    muted: '#777',
    inverse: '#fff',
  },
  accent: {
    primary: '#006747',
    light: '#e6f0eb',
  },
  semantic: {
    rank: { gold: '#ffd700' },
  },
  shadow: {
    card: {},
  },
  scoreColor: jest.fn(() => '#006747'),
};

jest.mock('../../theme/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme }),
}));

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));

const player = { id: 'p1', name: 'Marcos', user_id: 'u1', handicap: 0 };
const holes = Array.from({ length: 18 }, (_, index) => ({
  number: index + 1,
  par: 4,
  strokeIndex: index + 1,
}));

function makeRound(id, score = 4) {
  return {
    id,
    courseName: 'La Moraleja',
    holes,
    scores: {
      p1: Object.fromEntries(holes.map((hole) => [hole.number, score])),
    },
  };
}

let mockActiveTournament;
let mockRouteTournament;

jest.mock('../../store/tournamentStore', () => ({
  loadTournament: jest.fn(() => Promise.resolve(mockActiveTournament)),
  getActiveTournamentSnapshot: jest.fn(() => mockActiveTournament),
  getTournament: jest.fn(() => Promise.resolve(mockRouteTournament)),
  getTournamentSnapshot: jest.fn(() => null),
  getPlayingHandicap: jest.fn(() => 0),
  calcStablefordPoints: jest.fn(() => 2),
  playerPartnerSplits: jest.fn(() => ({ partners: [] })),
  // Real implementation: a round's own scoringMode overrides the
  // tournament default — the mixed-tournament gating tests below depend on
  // this per-round resolution actually running.
  roundScoringMode: jest.fn((t, round) => round?.scoringMode ?? t?.settings?.scoringMode ?? 'stableford'),
}));

jest.mock('../../components/scoringModes', () => ({
  scoringModeUsesTeams: jest.fn(() => false),
  // Real implementation: the H2H gating tests below depend on which modes
  // actually count as scramble.
  isScrambleMode: jest.requireActual('../../components/scoringModes').isScrambleMode,
}));

jest.mock('../../store/statsEngine', () => ({
  playerRoundHistory: jest.fn(() => []),
  playerAvgStableford: jest.fn(() => 0),
  playerScoreDistribution: jest.fn(() => []),
  playerStreaks: jest.fn(() => []),
  bestWorstHoles: jest.fn(() => ({ best: [], worst: [] })),
  holeDifficultyMap: jest.fn(() => []),
  headToHead: jest.fn(() => ({
    points: { p1Wins: 0, p2Wins: 0, ties: 0 },
    strokes: { p1Wins: 0, p2Wins: 0, ties: 0 },
    // totals/perRound are read by PairsTab's duel card, which the pairs-tab
    // tests below actually render.
    totals: { p1Points: 0, p2Points: 0, p1Strokes: 0, p2Strokes: 0, holesCompared: 0 },
    perRound: [],
    holes: [],
  })),
  pairPerformance: jest.fn(() => []),
  tournamentHighlights: jest.fn(() => ({})),
  hallOfShame: jest.fn(() => ({})),
  pairHoleWins: jest.fn(() => []),
  pairDifferenceByHole: jest.fn(() => null),
  tournamentMomentum: jest.fn(() => []),
  clutchOnHardest: jest.fn(() => []),
  playerConsistency: jest.fn(() => []),
  courseDNA: jest.fn(() => []),
  parTypeSplit: jest.fn(() => ({ par3: {}, par4: {}, par5: {} })),
  warmupVsClosing: jest.fn(() => []),
  handicapROI: jest.fn(() => []),
  playerNemesisAndCrushed: jest.fn(() => []),
  chaosHoles: jest.fn(() => ({})),
  collectiveExtremes: jest.fn(() => ({})),
  pairSynergy: jest.fn(() => []),
  pairCarryRatio: jest.fn(() => []),
  swingHole: jest.fn(() => []),
  par3Heartbreak: jest.fn(() => []),
  pickupChampion: jest.fn(() => []),
  anchor: jest.fn(() => []),
  zeroHero: jest.fn(() => ({})),
  skinsLeaderboard: jest.fn(() => ({ leaderboard: [], rounds: [], totalSkins: 0 })),
  matchPlayResults: jest.fn(() => []),
  pairConfigMatrix: jest.fn(() => []),
  shotStats: jest.fn(() => ({ hasData: false })),
  playersWithShotData: jest.fn(() => []),
  driveScoreImpact: jest.fn(() => []),
  puttDeepDive: jest.fn(() => ({})),
  approachScoreImpact: jest.fn(() => []),
  bounceBackRate: jest.fn(() => []),
  frontBackSplit: jest.fn(() => []),
  strokeIndexAccuracy: jest.fn(() => []),
  scramblingStats: jest.fn(() => []),
}));

function renderStats(rounds, { players = [player], scoringMode = 'stableford' } = {}) {
  mockActiveTournament = {
    id: 't1',
    players,
    settings: { scoringMode },
    rounds,
  };
  return render(<StatsScreen navigation={{ goBack: jest.fn() }} />);
}

describe('StatsScreen chrome', () => {
  test('keeps horizontal tab and round scope scrollers compact', () => {
    const { UNSAFE_getAllByType } = renderStats([makeRound('r1'), makeRound('r2', 5)]);

    const horizontalScrollViews = UNSAFE_getAllByType(ScrollView)
      .filter((node) => node.props.horizontal);
    const styles = horizontalScrollViews.map((node) => StyleSheet.flatten(node.props.style));
    const contentStyles = horizontalScrollViews.map((node) => StyleSheet.flatten(node.props.contentContainerStyle));

    expect(styles).toEqual([
      expect.objectContaining({ flexGrow: 0, maxHeight: 42 }),
      expect.objectContaining({ flexGrow: 0, maxHeight: 36 }),
    ]);
    expect(contentStyles).toEqual([
      expect.objectContaining({ alignItems: 'center' }),
      expect.objectContaining({ alignItems: 'center' }),
    ]);
  });

  test('hides Total and R1 round scope chips when there is only one round', () => {
    const { queryByText } = renderStats([makeRound('r1')]);

    expect(queryByText('Total')).toBeNull();
    expect(queryByText('R1')).toBeNull();
  });
});

const fourPlayers = [
  player,
  { id: 'p2', name: 'Bob Diaz', user_id: null, handicap: 0 },
  { id: 'p3', name: 'Cara Ruiz', user_id: null, handicap: 0 },
  { id: 'p4', name: 'Dan Vega', user_id: null, handicap: 0 },
];

describe('StatsScreen head-to-head gating', () => {

  test('shows the Head-to-Head section for a multi-player non-team mode', () => {
    const { queryByText } = renderStats([makeRound('r1')], {
      players: fourPlayers, scoringMode: 'individual',
    });

    expect(queryByText('HEAD-TO-HEAD')).toBeTruthy();
  });

  test('hides the Head-to-Head section for scramble modes', () => {
    // Scramble scores exist only under the team captain — there are no
    // per-player scores for headToHead() to compare — so the section must
    // stay hidden even though scramble's usesTeams pair-stats flag is false.
    const { queryByText } = renderStats([makeRound('r1')], {
      players: fourPlayers, scoringMode: 'scramblepairs',
    });

    expect(queryByText('HEAD-TO-HEAD')).toBeNull();
  });
});

describe('StatsScreen scramble gating', () => {
  // Scramble rounds store ONE team ball under the captain (pair[0]). Every
  // per-player statsEngine aggregate (highlights, streaks, shame, …) would
  // misattribute the team's play to the captain personally and show zero
  // data for everyone else, so the whole stats body is replaced by a
  // placeholder for scramble tournaments.
  test.each(['scramblepairs', 'scramble3v1', 'scramble4'])(
    'renders the placeholder instead of stats content for %s',
    (scoringMode) => {
      jest.clearAllMocks();
      const statsEngine = require('../../store/statsEngine');
      const { queryByText } = renderStats([makeRound('r1')], {
        players: fourPlayers, scoringMode,
      });

      // Placeholder shown…
      expect(queryByText('Team scramble tournament')).toBeTruthy();
      // …tab bar and stats content hidden…
      expect(queryByText('Players')).toBeNull();
      expect(queryByText('Overview')).toBeNull();
      expect(queryByText('Shame')).toBeNull();
      expect(queryByText('HEAD-TO-HEAD')).toBeNull();
      // …and no per-player aggregates are ever computed on team-ball data.
      expect(statsEngine.tournamentHighlights).not.toHaveBeenCalled();
      expect(statsEngine.playerScoreDistribution).not.toHaveBeenCalled();
      expect(statsEngine.hallOfShame).not.toHaveBeenCalled();
      expect(statsEngine.skinsLeaderboard).not.toHaveBeenCalled();
    },
  );

  test('keeps the normal tabs for non-scramble modes', () => {
    const { queryByText } = renderStats([makeRound('r1')], {
      players: fourPlayers, scoringMode: 'individual',
    });

    expect(queryByText('Team scramble tournament')).toBeNull();
    expect(queryByText('Players')).toBeTruthy();
    expect(queryByText('Overview')).toBeTruthy();
  });
});

describe('StatsScreen mixed scoring-mode gating (per-round overrides)', () => {
  // Rounds can now carry their own scoringMode that overrides the
  // tournament default (roundScoringMode) — a tournament is "mixed" when
  // its rounds don't all resolve to the same effective mode.

  test('a mixed tournament (one normal round, one scramble round) is not the whole-screen placeholder', () => {
    const rounds = [
      makeRound('r1'),
      { ...makeRound('r2', 5), scoringMode: 'scramblepairs' },
    ];
    const { queryByText } = renderStats(rounds, { players: fourPlayers, scoringMode: 'individual' });

    expect(queryByText('Team scramble tournament')).toBeNull();
    expect(queryByText('Overview')).toBeTruthy();
  });

  test('every round overridden to scramble still shows the placeholder even though the tournament default is not scramble', () => {
    const rounds = [
      { ...makeRound('r1'), scoringMode: 'scramble4' },
      { ...makeRound('r2', 5), scoringMode: 'scramble4' },
    ];
    const { queryByText } = renderStats(rounds, { players: fourPlayers, scoringMode: 'individual' });

    expect(queryByText('Team scramble tournament')).toBeTruthy();
    expect(queryByText('Overview')).toBeNull();
  });

  test('Head-to-Head still shows for a mixed tournament with no team rounds (scramble + solo only)', () => {
    // allScramble is false (round 1 is solo) and anyTeams is false (neither
    // round is a real team mode) — H2H is meaningful for the solo round;
    // the scramble round is blanked out of its input (next test).
    const rounds = [
      makeRound('r1'),
      { ...makeRound('r2', 5), scoringMode: 'scramblepairs' },
    ];
    const { queryByText } = renderStats(rounds, { players: fourPlayers, scoringMode: 'individual' });

    expect(queryByText('HEAD-TO-HEAD')).toBeTruthy();
  });

  test('feeds headToHead a tournament with scramble rounds blanked, so captain team balls never count as a personal duel', () => {
    // A scramble round leaves REAL scores under both team captains (each
    // team's single ball, scored off the team handicap). headToHead can't
    // tell those apart from personal scores — if two captains are compared,
    // it would count team play as a 1v1 duel. The screen must therefore
    // hand headToHead a tournament whose scramble rounds have their scores
    // stripped, while non-scramble rounds (and round indices) survive
    // untouched.
    jest.clearAllMocks();
    const statsEngine = require('../../store/statsEngine');
    const perHole = (strokes) => Object.fromEntries(holes.map((h) => [h.number, strokes]));
    const individual = {
      id: 'r1', courseName: 'La Moraleja', holes,
      scores: { p1: perHole(4), p2: perHole(5) },
    };
    // p1 and p2 are opposing captains — both hold a team-ball score.
    const scramble = {
      id: 'r2', courseName: 'La Moraleja', holes, scoringMode: 'scramblepairs',
      scores: { p1: perHole(4), p2: perHole(4) },
    };
    const { queryByText } = renderStats([individual, scramble], {
      players: fourPlayers, scoringMode: 'individual',
    });

    expect(queryByText('HEAD-TO-HEAD')).toBeTruthy();
    // The H2H matrix computes every player pairing at render time.
    expect(statsEngine.headToHead).toHaveBeenCalled();
    statsEngine.headToHead.mock.calls.forEach(([t]) => {
      // Same round count — indices (and R{n} labels) must stay aligned.
      expect(t.rounds).toHaveLength(2);
      // The individual round's scores reach headToHead intact…
      expect(t.rounds[0].scores).toEqual(individual.scores);
      // …but the scramble round's captain scores are blanked out.
      expect(t.rounds[1].scores).toBeNull();
    });
  });

  describe('with a genuine team round in the mix', () => {
    const scoringModes = require('../../components/scoringModes');

    beforeEach(() => {
      // The module-level mock stubs scoringModeUsesTeams to always return
      // false so the rest of this file never has to think about team
      // rounds. These tests need it to reflect the real "stableford" /
      // "scramblepairs" distinction, so override it locally and restore the
      // stub afterwards.
      scoringModes.scoringModeUsesTeams.mockImplementation(
        (mode) => mode === 'stableford' || mode === 'bestball' || mode === 'pairsmatchplay',
      );
    });

    afterEach(() => {
      scoringModes.scoringModeUsesTeams.mockImplementation(() => false);
    });

    test('Pairs tab appears when any round has real team data, even if another round is scramble', () => {
      const rounds = [
        { ...makeRound('r1'), scoringMode: 'stableford' },
        { ...makeRound('r2', 5), scoringMode: 'scramblepairs' },
      ];
      const { queryByText } = renderStats(rounds, { players: fourPlayers, scoringMode: 'individual' });

      expect(queryByText('Pairs')).toBeTruthy();
    });

    test('Head-to-Head stays hidden for a mixed tournament that has any real team round', () => {
      const rounds = [
        { ...makeRound('r1'), scoringMode: 'stableford' },
        { ...makeRound('r2', 5), scoringMode: 'scramblepairs' },
      ];
      const { queryByText } = renderStats(rounds, { players: fourPlayers, scoringMode: 'individual' });

      expect(queryByText('HEAD-TO-HEAD')).toBeNull();
    });

    test('feeds the Pairs-tab H2H heatmap a tournament with scramble rounds blanked too', () => {
      // Sibling of the Overview regression above, but through PairsTab:
      // anyTeams is true here (round 1 is a genuine stableford team round),
      // so the H2H surface is the Pairs tab — its "H2H HEATMAP" H2HMatrix
      // and duel card both call headToHead and must receive the same
      // scramble-blanked tournament as the Overview matrix, or captain
      // team balls leak into the heatmap.
      jest.clearAllMocks();
      const statsEngine = require('../../store/statsEngine');
      const perHole = (strokes) => Object.fromEntries(holes.map((h) => [h.number, strokes]));
      const teamRound = {
        id: 'r1', courseName: 'La Moraleja', holes, scoringMode: 'stableford',
        scores: { p1: perHole(4), p2: perHole(5) },
      };
      // p1 and p2 are opposing captains — both hold a team-ball score.
      const scramble = {
        id: 'r2', courseName: 'La Moraleja', holes, scoringMode: 'scramblepairs',
        scores: { p1: perHole(4), p2: perHole(4) },
      };
      const { getByText, queryByText } = renderStats([teamRound, scramble], {
        players: fourPlayers, scoringMode: 'individual',
      });

      fireEvent.press(getByText('Pairs'));

      expect(queryByText('H2H HEATMAP')).toBeTruthy();
      // The heatmap computes every player pairing at render time.
      expect(statsEngine.headToHead).toHaveBeenCalled();
      statsEngine.headToHead.mock.calls.forEach(([t]) => {
        // Same round count — indices (and R{n} labels) must stay aligned.
        expect(t.rounds).toHaveLength(2);
        // The genuine team round's scores reach headToHead intact…
        expect(t.rounds[0].scores).toEqual(teamRound.scores);
        // …but the scramble round's captain scores are blanked out.
        expect(t.rounds[1].scores).toBeNull();
      });
    });
  });
});

describe('route params', () => {
  test('loads the tournament from route.params.tournamentId instead of the active one', async () => {
    // Earlier tests in this file call loadTournament() via renderStats();
    // clear call history so "not.toHaveBeenCalled()" below reflects only
    // this test's render.
    jest.clearAllMocks();
    const { loadTournament, getTournament } = require('../../store/tournamentStore');
    // Two rounds: the round-scope chip is hidden for a single-round
    // tournament (see "hides Total and R1..." above), so it takes a second
    // round for the chip to render as proof the route tournament loaded.
    mockRouteTournament = {
      id: 't-old',
      name: 'Old Casual Game',
      players: [player],
      rounds: [makeRound('r-1'), makeRound('r-2')],
    };
    const { findByText } = render(
      <StatsScreen
        navigation={{ goBack: jest.fn(), navigate: jest.fn() }}
        route={{ params: { tournamentId: 't-old' } }}
      />,
    );
    // The round-scope chip proves the route tournament rendered.
    await findByText('R1');
    expect(getTournament).toHaveBeenCalledWith('t-old');
    expect(loadTournament).not.toHaveBeenCalled();
  });

  test('preselects the round scope from route.params.roundId', async () => {
    mockRouteTournament = {
      id: 't-old',
      name: 'Old Casual Game',
      players: [player],
      rounds: [makeRound('r-1'), makeRound('r-2')],
    };
    const { findByText } = render(
      <StatsScreen
        navigation={{ goBack: jest.fn(), navigate: jest.fn() }}
        route={{ params: { tournamentId: 't-old', roundId: 'r-2' } }}
      />,
    );
    const chip = await findByText('R2');
    // roundChipTextActive sets color to theme.text.inverse — the selected chip.
    expect(StyleSheet.flatten(chip.props.style).color).toBe(mockTheme.text.inverse);
    // "Total" chip must NOT be the active one.
    const totalChip = await findByText('Total');
    expect(StyleSheet.flatten(totalChip.props.style).color).not.toBe(mockTheme.text.inverse);
  });

  test('leaves the Total scope when roundId is not found', async () => {
    mockRouteTournament = {
      id: 't-old',
      name: 'Old Casual Game',
      players: [player],
      rounds: [makeRound('r-1'), makeRound('r-2')],
    };
    const { findByText } = render(
      <StatsScreen
        navigation={{ goBack: jest.fn(), navigate: jest.fn() }}
        route={{ params: { tournamentId: 't-old', roundId: 'nope' } }}
      />,
    );
    // "Total" chip must be the active one since roundId didn't match any round.
    const totalChip = await findByText('Total');
    expect(StyleSheet.flatten(totalChip.props.style).color).toBe(mockTheme.text.inverse);
    const chip = await findByText('R2');
    expect(StyleSheet.flatten(chip.props.style).color).not.toBe(mockTheme.text.inverse);
  });

  test('does not scope a single-round game to its only round', async () => {
    // Single-round tournament: the round-scope chip row is hidden (see
    // "hides Total and R1..." above), so an active-chip assertion can't
    // observe the regression. Instead assert on the Overview section title,
    // which flips between "TOURNAMENT HIGHLIGHTS" (Total scope) and "ROUND
    // HIGHLIGHTS" (round scope) — that's the only rendered signal of whether
    // roundScope got set to 0 for a one-round game.
    const { getTournament } = require('../../store/tournamentStore');
    mockRouteTournament = {
      id: 't-old',
      name: 'Old Casual Game',
      players: [player],
      rounds: [makeRound('r-1')],
    };
    const { findByText, queryByText } = render(
      <StatsScreen
        navigation={{ goBack: jest.fn(), navigate: jest.fn() }}
        route={{ params: { tournamentId: 't-old', roundId: 'r-1' } }}
      />,
    );
    await findByText('TOURNAMENT HIGHLIGHTS');
    expect(queryByText('ROUND HIGHLIGHTS')).toBeNull();
    // Chip row stays hidden for a single-round game either way.
    expect(queryByText('Total')).toBeNull();
    expect(queryByText('R1')).toBeNull();
    expect(getTournament).toHaveBeenCalledWith('t-old');
  });
});
