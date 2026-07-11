import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ScrollView, StyleSheet, Switch } from 'react-native';
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

jest.mock('../../store/tournamentStore', () => ({
  loadTournament: jest.fn(() => Promise.resolve(mockActiveTournament)),
  getActiveTournamentSnapshot: jest.fn(() => mockActiveTournament),
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
  // Real implementation: the scramble-gating tests below depend on scores/
  // shotDetails/pairs actually being blanked on scramble rounds.
  withoutScrambleScores: jest.requireActual('../../store/statsEngine').withoutScrambleScores,
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

    test('Total round scope passes roundIndex: null (not the first completed round) to hole-wins and the H2H duel', () => {
      // Regression for the old effectiveRound substitution: with "Total"
      // selected, Pairs-tab sections that support a tournament-wide
      // aggregate must actually get one instead of silently narrowing to
      // round 1.
      jest.clearAllMocks();
      const statsEngine = require('../../store/statsEngine');
      const rounds = [
        { ...makeRound('r1'), scoringMode: 'stableford' },
        { ...makeRound('r2', 5), scoringMode: 'stableford' },
      ];
      const { getByText, getAllByText } = renderStats(rounds, { players: fourPlayers, scoringMode: 'individual' });

      fireEvent.press(getByText('Pairs'));

      const holeWinsCall = statsEngine.pairHoleWins.mock.calls.at(-1);
      expect(holeWinsCall[1]).toEqual(expect.objectContaining({ roundIndex: null }));

      // Only the duel card's headToHead call carries a 4th (options) arg —
      // the H2H heatmap calls headToHead with just the 3 player args. Check
      // only the most recent duel call — mock.calls accumulates across every
      // render, including earlier renders before state settled.
      const duelCalls = statsEngine.headToHead.mock.calls.filter((call) => call.length === 4);
      expect(duelCalls.length).toBeGreaterThan(0);
      expect(duelCalls.at(-1)[3]).toEqual(expect.objectContaining({ roundIndex: null }));

      // Both sections (Hole Wins + Head to Head) label their effective scope.
      expect(getAllByText('All rounds').length).toBeGreaterThanOrEqual(2);
    });

    test('selecting a round chip scopes hole-wins and the H2H duel to that round, and labels it', () => {
      jest.clearAllMocks();
      const statsEngine = require('../../store/statsEngine');
      const rounds = [
        { ...makeRound('r1'), scoringMode: 'stableford' },
        { ...makeRound('r2', 5), scoringMode: 'stableford' },
      ];
      const { getByText, getAllByText } = renderStats(rounds, { players: fourPlayers, scoringMode: 'individual' });

      fireEvent.press(getByText('Pairs'));
      fireEvent.press(getByText('R1'));

      const holeWinsCall = statsEngine.pairHoleWins.mock.calls.at(-1);
      expect(holeWinsCall[1]).toEqual(expect.objectContaining({ roundIndex: 0 }));

      const duelCalls = statsEngine.headToHead.mock.calls.filter((call) => call.length === 4);
      expect(duelCalls.length).toBeGreaterThan(0);
      expect(duelCalls.at(-1)[3]).toEqual(expect.objectContaining({ roundIndex: 0 }));

      // Both sections (Hole Wins + Head to Head) label their effective scope.
      expect(getAllByText('R1 · La Moraleja').length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('StatsScreen Overview tab — presentation honesty', () => {
  // jest.clearAllMocks() only clears call history — a .mockReturnValue() set
  // by one test keeps applying in the next one. These tests each customize a
  // different statsEngine aggregate, so every test starts from the same
  // known-empty baseline (matching the module-level mock factory defaults)
  // and only overrides what it actually needs.
  beforeEach(() => {
    jest.clearAllMocks();
    const statsEngine = require('../../store/statsEngine');
    statsEngine.skinsLeaderboard.mockReturnValue({ leaderboard: [], rounds: [], totalSkins: 0 });
    statsEngine.playerConsistency.mockReturnValue([]);
    statsEngine.tournamentMomentum.mockReturnValue([]);
    statsEngine.clutchOnHardest.mockReturnValue([]);
  });

  test('two tied skins leaders both render rank #1, styled gold', () => {
    const statsEngine = require('../../store/statsEngine');
    statsEngine.skinsLeaderboard.mockReturnValue({
      leaderboard: [
        { player: fourPlayers[0], skins: 3, ties: 0, breakdown: [] },
        { player: fourPlayers[1], skins: 3, ties: 0, breakdown: [] },
        { player: fourPlayers[2], skins: 1, ties: 0, breakdown: [] },
      ],
      rounds: [],
      totalSkins: 7,
    });

    const { getAllByText } = renderStats([makeRound('r1')], { players: fourPlayers });

    const rankOnes = getAllByText('#1');
    expect(rankOnes).toHaveLength(2);
    rankOnes.forEach((el) => {
      const flat = StyleSheet.flatten(el.props.style);
      expect(flat.color).toBe(mockTheme.semantic.rank.gold);
    });
  });

  test('consistency list hides players under 18 counted holes behind a muted note', () => {
    const statsEngine = require('../../store/statsEngine');
    statsEngine.playerConsistency.mockReturnValue([
      { player: fourPlayers[0], stdev: 0.5, mean: 2, holesPlayed: 18, breakdown: [] },
      { player: fourPlayers[1], stdev: 0.3, mean: 2.5, holesPlayed: 9, breakdown: [] },
    ]);

    const { getByText, queryByText } = renderStats([makeRound('r1')], { players: fourPlayers });

    // Qualified player (18 holes) shows a real ranked row.
    expect(getByText(/σ 0\.5/)).toBeTruthy();
    // Under-18-hole player's raw stdev never renders...
    expect(queryByText(/σ 0\.3/)).toBeNull();
    // ...replaced by an honest muted note.
    expect(getByText('Needs a full round of data.')).toBeTruthy();
  });

  test('strokes-mode Best Round empty state explains the 18-hole requirement', () => {
    const { getByText, queryByText, UNSAFE_getByType } = renderStats([makeRound('r1')], {
      players: fourPlayers,
    });

    // Points mode (default) keeps the original generic copy.
    expect(getByText('No scores for this round yet.')).toBeTruthy();

    const switchEl = UNSAFE_getByType(Switch);
    fireEvent(switchEl, 'valueChange', false); // toggle to Strokes

    expect(queryByText('No scores for this round yet.')).toBeNull();
    expect(getByText('No completed rounds yet — strokes mode needs all 18 holes.')).toBeTruthy();
  });

  test('a skins row with zero skins but a tied hole is tappable and lists the ties', () => {
    const statsEngine = require('../../store/statsEngine');
    const [p1, p2] = fourPlayers;
    const tiedHoleEntry = {
      roundIndex: 0, courseName: 'La Moraleja', holeNumber: 5, par: 4, si: 3,
      bestVal: 2, winner: null, tiedLeaders: [p1, p2], players: [],
    };
    statsEngine.skinsLeaderboard.mockReturnValue({
      leaderboard: [
        { player: p1, skins: 0, ties: 1, breakdown: [] },
        { player: p2, skins: 0, ties: 1, breakdown: [] },
        { player: fourPlayers[2], skins: 2, ties: 0, breakdown: [] },
      ],
      rounds: [{ roundIndex: 0, courseName: 'La Moraleja', skinsPerPlayer: {}, holes: [tiedHoleEntry] }],
      totalSkins: 2,
    });

    const { getAllByText, UNSAFE_getByType } = renderStats([makeRound('r1')], { players: fourPlayers });

    // The Head-to-Head matrix also renders every player's first name as a
    // row/column header below the Skins section, so match the leaderboard
    // row specifically: it's the first (and only pressable) occurrence.
    fireEvent.press(getAllByText(p1.name.split(' ')[0])[0]);

    const sheet = UNSAFE_getByType('StatDetailSheet');
    expect(sheet.props.visible).toBe(true);
    expect(sheet.props.rows).toHaveLength(1);
    expect(sheet.props.rows[0].primary).toContain('Hole 5');
  });

  test('momentum bar tone accounts for holes played, not just the raw points total', () => {
    const statsEngine = require('../../store/statsEngine');
    // 16 pts over only 9 holes is a strong pace (16/9 === 32/18, the
    // "excellent" cutoff) even though 16 alone would read as "poor" against
    // the old full-round-only thresholds.
    statsEngine.tournamentMomentum.mockReturnValue([
      { player: fourPlayers[0], rounds: [
        { roundIndex: 0, courseName: 'La Moraleja', points: 16, strokes: 40, holesPlayed: 9 },
      ], minPts: 16, maxPts: 16 },
    ]);

    renderStats([makeRound('r1')], { players: fourPlayers });

    expect(mockTheme.scoreColor).toHaveBeenCalledWith('excellent');
    expect(mockTheme.scoreColor).not.toHaveBeenCalledWith('poor');
  });

  test('shows a pts badge beside points-only section titles when the Strokes toggle is active', () => {
    const statsEngine = require('../../store/statsEngine');
    statsEngine.clutchOnHardest.mockReturnValue([
      { player: fourPlayers[0], points: 6, strokes: 12, holesPlayed: 3, breakdown: [], avgPoints: 2, avgStrokes: 4 },
    ]);

    const { getByText, queryByText, UNSAFE_getByType } = renderStats([makeRound('r1')], { players: fourPlayers });

    expect(queryByText('pts')).toBeNull();

    const switchEl = UNSAFE_getByType(Switch);
    fireEvent(switchEl, 'valueChange', false); // toggle to Strokes

    expect(getByText('CLUTCH ON HARDEST HOLES')).toBeTruthy();
    expect(getByText('pts')).toBeTruthy();
  });
});

describe('StatsScreen Holes tab — heatmap honesty', () => {
  test('avg cell renders "-" (not 0) for a hole nobody scored', () => {
    const statsEngine = require('../../store/statsEngine');
    statsEngine.holeDifficultyMap.mockReturnValue([
      { holeNumber: 1, par: 4, si: 1, playerScores: [], avgPoints: null, avgStrokes: null },
    ]);

    const { getByText, getAllByText } = renderStats([makeRound('r1')]);
    fireEvent.press(getByText('Holes'));

    // One dash for the lone player's empty cell, one for the Avg column —
    // a null average must never fall back to rendering "0".
    expect(getAllByText('-')).toHaveLength(2);
  });
});
