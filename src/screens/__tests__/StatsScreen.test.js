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
  // Real implementation: the scramble-gating tests below depend on scores/
  // shotDetails/pairs actually being blanked on scramble rounds.
  withoutScrambleScores: jest.requireActual('../../store/statsEngine').withoutScrambleScores,
  // Real shape: [{roundIndex, courseName, points, strokes, holesPlayed,
  // avgPerHole}] — PlayersTab now gates its whole body on history.length
  // (not the round-scoped `dist.total`), so an empty default here would
  // collapse every Players-tab test straight to "No scores yet."
  playerRoundHistory: jest.fn(() => [
    { roundIndex: 0, courseName: 'La Moraleja', points: 36, strokes: 72, holesPlayed: 18, avgPerHole: 2 },
  ]),
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
  playingToHandicap: jest.fn(() => []),
  hotStretch: jest.fn(() => []),
  parTypeSplit: jest.fn(() => ({ par3: {}, par4: {}, par5: {} })),
  // Real shape: { warmup: { avgPoints, holes, breakdown }, closing: {...}, delta }
  // — PlayersTab reads `.warmup.holes`/`.closing.holes` directly, so a bare
  // `[]` default crashes the very first Players-tab render.
  warmupVsClosing: jest.fn(() => ({
    warmup: { avgPoints: 0, holes: 0, breakdown: [] },
    closing: { avgPoints: 0, holes: 0, breakdown: [] },
    delta: 0,
  })),
  handicapROI: jest.fn(() => []),
  playerNemesisAndCrushed: jest.fn(() => []),
  chaosHoles: jest.fn(() => ({})),
  collectiveExtremes: jest.fn(() => ({})),
  pairSynergy: jest.fn(() => []),
  pairCarryRatio: jest.fn(() => []),
  pairCoverage: jest.fn(() => []),
  swingHole: jest.fn(() => []),
  // Real par3Heartbreak/pickupChampion/anchor/zeroHero return null (not an
  // empty array/object) when there's no qualifying data — ShameTab reads
  // `.entries` straight off these, so a falsy-but-truthy `[]`/`{}` default
  // would crash the very first render.
  par3Heartbreak: jest.fn(() => null),
  pickupChampion: jest.fn(() => null),
  anchor: jest.fn(() => null),
  zeroHero: jest.fn(() => null),
  nemesisEncore: jest.fn(() => null),
  skinsLeaderboard: jest.fn(() => ({ leaderboard: [], rounds: [], totalSkins: 0 })),
  matchPlayResults: jest.fn(() => []),
  pairConfigMatrix: jest.fn(() => []),
  shotStats: jest.fn(() => ({ hasData: false })),
  playersWithShotData: jest.fn(() => []),
  driveScoreImpact: jest.fn(() => []),
  girByDriveResult: jest.fn(() => ({
    fairway: { holes: 0, girPct: 0, breakdown: [] },
    miss: { holes: 0, girPct: 0, breakdown: [] },
  })),
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

describe('StatsScreen Players tab — Difficulty Split', () => {
  test('renders the DIFFICULTY SPLIT card with per-band averages and opens the hole breakdown on tap', () => {
    const { getByText, getAllByText, UNSAFE_getByType } = renderStats([makeRound('r1')]);
    fireEvent.press(getByText('Players'));

    // Labels are shape-agnostic ("Hardest/Middle/Easiest third") rather than
    // hardcoded SI ranges, since holeDifficultySplit derives its bands from
    // each round's actual max stroke index (18-hole vs 9-hole rounds split
    // differently) — see the 9-hole case below.
    expect(getByText('DIFFICULTY SPLIT')).toBeTruthy();
    expect(getByText('Hardest third')).toBeTruthy();
    expect(getByText('Middle third')).toBeTruthy();
    expect(getByText('Easiest third')).toBeTruthy();
    // 18 holes split 6/6/6 across the three bands.
    expect(getAllByText('6 holes')).toHaveLength(3);
    // calcStablefordPoints is mocked to always return 2 pts — every band averages 2.
    expect(getAllByText('2').length).toBeGreaterThanOrEqual(3);

    fireEvent.press(getByText('Hardest third'));
    const sheet = UNSAFE_getByType('StatDetailSheet');
    expect(sheet.props.title).toBe('Marcos — Hardest third');
    expect(sheet.props.rows).toHaveLength(6);
  });

  test('labels a 9-hole round\'s bands as thirds too, not the 18-hole SI ranges', () => {
    const nineHoles = Array.from({ length: 9 }, (_, index) => ({
      number: index + 1,
      par: 4,
      strokeIndex: index + 1,
    }));
    const nineHoleRound = {
      id: 'r1',
      courseName: 'La Moraleja',
      holes: nineHoles,
      scores: {
        p1: Object.fromEntries(nineHoles.map((hole) => [hole.number, 4])),
      },
    };
    const { getByText, getAllByText, queryByText } = renderStats([nineHoleRound]);
    fireEvent.press(getByText('Players'));

    // hard=SI 1-3, mid=SI 4-6, easy=SI 7-9 for a 9-hole round — the old
    // hardcoded "SI 1-6"/"SI 7-12"/"SI 13-18" labels would be wrong here.
    expect(getByText('Hardest third')).toBeTruthy();
    expect(getByText('Middle third')).toBeTruthy();
    expect(getByText('Easiest third')).toBeTruthy();
    expect(queryByText('SI 1-6')).toBeNull();
    expect(queryByText('SI 7-12')).toBeNull();
    expect(queryByText('SI 13-18')).toBeNull();
    // 9 holes split 3/3/3 across the three bands.
    expect(getAllByText('3 holes')).toHaveLength(3);
  });
});

describe('StatsScreen Players tab — Task 20 honesty items', () => {
  // A test further down overrides playerRoundHistory's return value; without
  // resetting it here, that override would leak into later tests in this
  // block (jest.clearAllMocks() clears call history, not return values) and
  // could, e.g., make a leftover "R2" history row collide with the "R2"
  // round-scope chip in a getByText query.
  beforeEach(() => {
    jest.clearAllMocks();
    const statsEngine = require('../../store/statsEngine');
    statsEngine.playerRoundHistory.mockReturnValue([
      { roundIndex: 0, courseName: 'La Moraleja', points: 36, strokes: 72, holesPlayed: 18, avgPerHole: 2 },
    ]);
  });

  test('player chips disambiguate duplicate first names by falling back to the full name', () => {
    const duplicateFirstNamePlayers = [
      { id: 'p1', name: 'Bob Diaz', user_id: 'u1', handicap: 0 },
      { id: 'p2', name: 'Bob Smith', user_id: null, handicap: 0 },
    ];
    const { getByText, queryByText } = renderStats([makeRound('r1')], { players: duplicateFirstNamePlayers });
    fireEvent.press(getByText('Players'));

    expect(getByText('Bob Diaz')).toBeTruthy();
    expect(getByText('Bob Smith')).toBeTruthy();
    // The bare "Bob" chip label must not survive — it would be ambiguous
    // between the two players.
    expect(queryByText('Bob')).toBeNull();
  });

  test('a roster with no duplicate first names keeps the short chip labels', () => {
    const { getByText, queryByText } = renderStats([makeRound('r1')], {
      players: [player, { id: 'p2', name: 'Bob Diaz', user_id: null, handicap: 0 }],
    });
    fireEvent.press(getByText('Players'));

    expect(getByText('Marcos')).toBeTruthy();
    expect(getByText('Bob')).toBeTruthy();
    expect(queryByText('Bob Diaz')).toBeNull();
  });

  test("Round History row shows the round's scoring-mode badge, holes played, and avg per hole", () => {
    jest.clearAllMocks();
    const statsEngine = require('../../store/statsEngine');
    statsEngine.playerRoundHistory.mockReturnValue([
      { roundIndex: 0, courseName: 'La Moraleja', points: 30, strokes: 76, holesPlayed: 15, avgPerHole: 2 },
    ]);
    const round = { ...makeRound('r1'), scoringMode: 'matchplay' };
    const { getByText } = renderStats([round]);
    fireEvent.press(getByText('Players'));

    expect(getByText('ROUND HISTORY')).toBeTruthy();
    expect(getByText('Match Play')).toBeTruthy();
    expect(getByText('15 holes · 2 pts/hole')).toBeTruthy();
  });

  test('Average per Round card shows an "n rounds · m holes" subtitle', () => {
    jest.clearAllMocks();
    const statsEngine = require('../../store/statsEngine');
    statsEngine.playerRoundHistory.mockReturnValue([
      { roundIndex: 0, courseName: 'La Moraleja', points: 36, strokes: 72, holesPlayed: 18, avgPerHole: 2 },
      { roundIndex: 1, courseName: 'Sotogrande', points: 34, strokes: 74, holesPlayed: 18, avgPerHole: 1.89 },
    ]);
    const { getByText } = renderStats([makeRound('r1'), makeRound('r2', 5)]);
    fireEvent.press(getByText('Players'));

    expect(getByText('2 rounds · 36 holes')).toBeTruthy();
  });

  test('renders the sticky section index with a chip for each rendered section', () => {
    const { getByText } = renderStats([makeRound('r1')]);
    fireEvent.press(getByText('Players'));

    expect(getByText('Distribution')).toBeTruthy();
    expect(getByText('Streaks')).toBeTruthy();
    expect(getByText('History')).toBeTruthy();
  });

  test('round-scope chips are enabled on the Players tab and pass roundIndex through to distribution + streaks', () => {
    jest.clearAllMocks();
    const statsEngine = require('../../store/statsEngine');
    const { getByText, getAllByText } = renderStats([makeRound('r1'), makeRound('r2', 5)]);
    fireEvent.press(getByText('Players'));

    // Chip set is now visible on this tab (was hidden before Task 20).
    expect(getByText('Total')).toBeTruthy();
    expect(getByText('R2')).toBeTruthy();
    // Tournament-wide sections that don't accept roundIndex are labeled
    // honestly instead of silently ignoring the chip.
    expect(getAllByText('All rounds').length).toBeGreaterThan(0);

    fireEvent.press(getByText('R2'));

    const distCall = statsEngine.playerScoreDistribution.mock.calls.at(-1);
    expect(distCall[2]).toEqual(expect.objectContaining({ roundIndex: 1 }));
    const streaksCall = statsEngine.playerStreaks.mock.calls.at(-1);
    expect(streaksCall[2]).toEqual(expect.objectContaining({ roundIndex: 1 }));
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

  describe('unified Pair Cards and Pair Difference drama strip', () => {
    const scoringModes = require('../../components/scoringModes');
    const pairsField = [[fourPlayers[0], fourPlayers[1]], [fourPlayers[2], fourPlayers[3]]];
    const teamRounds = () => [
      { ...makeRound('r1'), scoringMode: 'stableford', pairs: pairsField },
      { ...makeRound('r2', 5), scoringMode: 'stableford', pairs: pairsField },
    ];

    beforeEach(() => {
      jest.clearAllMocks();
      scoringModes.scoringModeUsesTeams.mockImplementation((mode) => mode === 'stableford');
    });

    afterEach(() => {
      scoringModes.scoringModeUsesTeams.mockImplementation(() => false);
    });

    test('Pair Cards renders one card per pairing with a synergy badge and a carry bar that always sums to 100%; old three section titles are gone', () => {
      const statsEngine = require('../../store/statsEngine');
      const pairKey = [fourPlayers[0].id, fourPlayers[1].id].sort().join('|');
      statsEngine.pairPerformance.mockReturnValue([
        {
          players: [fourPlayers[0], fourPlayers[1]],
          rounds: 2,
          avgPoints: 35,
          totalPoints: 70,
          roundList: [
            {
              roundIndex: 0, courseName: 'La Moraleja', combinedPoints: 35, combinedStrokes: 80,
              memberPoints: [
                { playerId: 'p1', playerName: 'Marcos', points: 18 },
                { playerId: 'p2', playerName: 'Bob Diaz', points: 17 },
              ],
            },
          ],
        },
      ]);
      statsEngine.pairSynergy.mockReturnValue([
        {
          members: [fourPlayers[0], fourPlayers[1]],
          rounds: 2, combined: 70, expected: 60, synergy: 1.17, holesPlayed: 36,
          roundList: [{ roundIndex: 0, courseName: 'La Moraleja', holesPlayed: 18, combined: 35, expected: 30, synergy: 1.17 }],
        },
      ]);
      statsEngine.pairCarryRatio.mockReturnValue([
        {
          members: [fourPlayers[0], fourPlayers[1]],
          // Each share independently rounds to 51 and 50 — a naive
          // implementation that rounds both would sum to 101%.
          shares: [
            { player: fourPlayers[0], points: 40, share: 0.505 },
            { player: fourPlayers[1], points: 30, share: 0.495 },
          ],
          totalPoints: 70, holesPlayed: 36, imbalance: 0.01,
        },
      ]);

      const { getByText, queryByText, getByTestId } = renderStats(teamRounds(), {
        players: fourPlayers, scoringMode: 'individual',
      });

      fireEvent.press(getByText('Pairs'));

      expect(getByText('PAIR CARDS')).toBeTruthy();
      expect(queryByText('PAIR CHEMISTRY')).toBeNull();
      expect(queryByText('PAIR SYNERGY')).toBeNull();
      expect(queryByText('CARRY RATIO')).toBeNull();

      // One card per pairing, with its synergy badge...
      expect(getByText('×1.17')).toBeTruthy();

      // ...and a carry bar whose two shares always sum to 100%.
      const fillA = getByTestId(`pair-carry-fill-a-${pairKey}`);
      const fillB = getByTestId(`pair-carry-fill-b-${pairKey}`);
      const widthA = parseInt(StyleSheet.flatten(fillA.props.style).width, 10);
      const widthB = parseInt(StyleSheet.flatten(fillB.props.style).width, 10);
      expect(widthA).toBe(51);
      expect(widthB).toBe(49);
      expect(widthA + widthB).toBe(100);
    });

    test('renders a drama strip under the Pair Difference chart from crossovers/maxLead/maxDeficit/finalDelta', () => {
      const statsEngine = require('../../store/statsEngine');
      statsEngine.pairDifferenceByHole.mockReturnValue({
        pair1: [fourPlayers[0], fourPlayers[1]],
        pair2: [fourPlayers[2], fourPlayers[3]],
        metric: 'points',
        courseName: 'La Moraleja',
        holes: [],
        maxLead: 5,
        maxDeficit: -2,
        finalDelta: 2,
        crossovers: 3,
        maxAbs: 5,
      });

      const { getByText } = renderStats(teamRounds(), {
        players: fourPlayers, scoringMode: 'individual',
      });

      fireEvent.press(getByText('Pairs'));

      expect(getByText('Lead changes: 3 · Biggest lead: Marcos & Bob +5 pts · Final: +2 pts')).toBeTruthy();
    });

    test('Pair Cards render a coverage line matched to the card by sorted member ids', () => {
      const statsEngine = require('../../store/statsEngine');
      const pairKey = [fourPlayers[0].id, fourPlayers[1].id].sort().join('|');
      statsEngine.pairPerformance.mockReturnValue([
        {
          players: [fourPlayers[0], fourPlayers[1]],
          rounds: 2, avgPoints: 35, totalPoints: 70, roundList: [],
        },
      ]);
      // pairCoverage returns `pair` (not `members`) and members in the
      // OPPOSITE array order from pairPerformance's `players` — the card
      // must still match by sorted id, not array position or field name.
      statsEngine.pairCoverage.mockReturnValue([
        { pair: [fourPlayers[1], fourPlayers[0]], holes: 20, coveragePct: 65, bothBlanked: 3 },
      ]);

      const { getByText, getByTestId } = renderStats(teamRounds(), {
        players: fourPlayers, scoringMode: 'individual',
      });

      fireEvent.press(getByText('Pairs'));

      expect(getByTestId(`pair-coverage-${pairKey}`)).toBeTruthy();
      expect(getByText('65% covered · 3 double-blanks')).toBeTruthy();
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
    statsEngine.playingToHandicap.mockReturnValue([]);
    statsEngine.hotStretch.mockReturnValue([]);
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

  test('playing to handicap renders ranked rows with signed deltas and opens a per-round sheet', () => {
    const statsEngine = require('../../store/statsEngine');
    statsEngine.playingToHandicap.mockReturnValue([
      {
        player: fourPlayers[0], points: 40, holesPlayed: 18, delta: 4,
        rounds: [{ roundIndex: 0, courseName: 'La Moraleja', points: 40, holesPlayed: 18, delta: 4 }],
      },
      {
        player: fourPlayers[1], points: 28, holesPlayed: 18, delta: -8,
        rounds: [{ roundIndex: 0, courseName: 'La Moraleja', points: 28, holesPlayed: 18, delta: -8 }],
      },
    ]);

    const { getByText, getAllByText, UNSAFE_getByType } = renderStats([makeRound('r1')], { players: fourPlayers });

    expect(getByText('PLAYING TO HANDICAP')).toBeTruthy();
    expect(getByText('+4')).toBeTruthy();
    expect(getByText('-8')).toBeTruthy();

    // Section renders before the H2H matrix (which also lists every
    // player's first name), so the leaderboard row is the first match.
    fireEvent.press(getAllByText(fourPlayers[0].name.split(' ')[0])[0]);

    const sheet = UNSAFE_getByType('StatDetailSheet');
    expect(sheet.props.visible).toBe(true);
    expect(sheet.props.title).toContain('+4');
    expect(sheet.props.rows).toHaveLength(1);
    expect(sheet.props.rows[0].rightPrimary).toBe('+4');
  });

  test('hot stretch renders the top 3 cards only and opens a hole-by-hole sheet', () => {
    const statsEngine = require('../../store/statsEngine');
    const breakdown = [
      { roundIndex: 0, courseName: 'La Moraleja', holeNumber: 7, par: 4, strokes: 3, points: 3 },
      { roundIndex: 0, courseName: 'La Moraleja', holeNumber: 8, par: 3, strokes: 2, points: 3 },
    ];
    statsEngine.hotStretch.mockReturnValue([
      { player: fourPlayers[0], points: 11, roundIndex: 1, startHole: 7, endHole: 12, breakdown },
      { player: fourPlayers[1], points: 9, roundIndex: 0, startHole: 3, endHole: 8, breakdown },
      { player: fourPlayers[2], points: 8, roundIndex: 0, startHole: 1, endHole: 6, breakdown },
      // 4th-place player must not render — top-3 cards only.
      { player: fourPlayers[3], points: 7, roundIndex: 0, startHole: 2, endHole: 7, breakdown },
    ]);

    const { getByText, getAllByText, queryByText, UNSAFE_getByType } = renderStats([makeRound('r1')], { players: fourPlayers });

    expect(getByText('HOT STRETCH')).toBeTruthy();
    // HighlightCard renders the value twice — once visible, once in the
    // off-screen share-capture host — so match the first (visible) one.
    const cardValues = getAllByText(/Marcos — 11 pts · R2 H7–H12/);
    expect(cardValues.length).toBeGreaterThan(0);
    // 4th-place Dan must not get a card — only the top 3 render. (Dan's
    // first name still legitimately appears elsewhere, e.g. the H2H
    // matrix headers, so match the card's exact value string instead.)
    expect(queryByText(/Dan — 7 pts/)).toBeNull();

    fireEvent.press(cardValues[0]);

    const sheet = UNSAFE_getByType('StatDetailSheet');
    expect(sheet.props.visible).toBe(true);
    expect(sheet.props.rows).toHaveLength(2);
    expect(sheet.props.rows[0].primary).toContain('Hole 7');
  });
});

describe('StatsScreen Overview tab — aggregate memoization (Task 4.1)', () => {
  // The nine Overview aggregates are each an O(players×rounds×holes) pass.
  // OverviewTab holds local `sheet` state for its detail sheets — opening
  // one must only flip that state, not re-run every aggregate. This spies
  // on the (module-mocked) statsEngine functions themselves, so it fails if
  // a future edit drops a useMemo or slips `sheet` into a dep array.
  beforeEach(() => {
    jest.clearAllMocks();
    const statsEngine = require('../../store/statsEngine');
    statsEngine.skinsLeaderboard.mockReturnValue({ leaderboard: [], rounds: [], totalSkins: 0 });
    statsEngine.playerConsistency.mockReturnValue([]);
    statsEngine.tournamentMomentum.mockReturnValue([]);
    statsEngine.clutchOnHardest.mockReturnValue([]);
    statsEngine.playingToHandicap.mockReturnValue([]);
    statsEngine.hotStretch.mockReturnValue([
      {
        player: fourPlayers[0], points: 11, roundIndex: 0, startHole: 7, endHole: 12,
        breakdown: [
          { roundIndex: 0, courseName: 'La Moraleja', holeNumber: 7, par: 4, strokes: 3, points: 3 },
        ],
      },
    ]);
  });

  test('opening the Hot Stretch detail sheet does not re-invoke any of the nine Overview aggregates', () => {
    const statsEngine = require('../../store/statsEngine');
    const { getAllByText } = renderStats([makeRound('r1')], { players: fourPlayers });

    const aggregateMocks = [
      statsEngine.tournamentHighlights,
      statsEngine.tournamentMomentum,
      statsEngine.clutchOnHardest,
      statsEngine.playerConsistency,
      statsEngine.courseDNA,
      statsEngine.skinsLeaderboard,
      statsEngine.playingToHandicap,
      statsEngine.hotStretch,
      statsEngine.strokeIndexAccuracy,
    ];
    const callsBefore = aggregateMocks.map((fn) => fn.mock.calls.length);
    expect(callsBefore.every((n) => n > 0)).toBe(true); // sanity: initial render did compute them

    // Tapping a highlight card only sets OverviewTab's local `sheet` state —
    // tournament/metric/roundIndex are unchanged, so a correctly memoized
    // tab recomputes nothing on this re-render.
    fireEvent.press(getAllByText(/Marcos — 11 pts · R1 H7–H12/)[0]);

    const callsAfter = aggregateMocks.map((fn) => fn.mock.calls.length);
    expect(callsAfter).toEqual(callsBefore);
  });

  test('toggling the points/strokes metric DOES recompute the metric-dependent aggregates', () => {
    const statsEngine = require('../../store/statsEngine');
    const { UNSAFE_getByType } = renderStats([makeRound('r1')], { players: fourPlayers });

    const highlightsCallsBefore = statsEngine.tournamentHighlights.mock.calls.length;
    const skinsCallsBefore = statsEngine.skinsLeaderboard.mock.calls.length;
    const momentumCallsBefore = statsEngine.tournamentMomentum.mock.calls.length;

    const switchEl = UNSAFE_getByType(Switch);
    fireEvent(switchEl, 'valueChange', false); // toggle to Strokes — flips `metric`

    // tournamentHighlights/skinsLeaderboard read `metric` — they must recompute.
    expect(statsEngine.tournamentHighlights.mock.calls.length).toBeGreaterThan(highlightsCallsBefore);
    expect(statsEngine.skinsLeaderboard.mock.calls.length).toBeGreaterThan(skinsCallsBefore);
    // tournamentMomentum doesn't take a metric arg at all — must NOT recompute.
    expect(statsEngine.tournamentMomentum.mock.calls.length).toBe(momentumCallsBefore);
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

describe('StatsScreen Shots tab — sample-floor gating', () => {
  // Same reset caveat as the Overview tab block above: mockReturnValue
  // persists across tests, so every test here starts from a known-good
  // baseline (one player, real data, everything else empty) and only
  // overrides the aggregate it's actually exercising.
  beforeEach(() => {
    jest.clearAllMocks();
    const statsEngine = require('../../store/statsEngine');
    statsEngine.playersWithShotData.mockReturnValue([player]);
    statsEngine.shotStats.mockReturnValue({
      hasData: true,
      roundsWithData: 1,
      putts: { perRound: 32, perHole: 1.8, onePutts: 2, threePuttPlus: 1 },
      drives: {
        recorded: 2,
        fairwayPct: 50,
        fairwaysHit: 1,
        distribution: { fairway: 1, left: 0, right: 1, short: 0, super: 0 },
      },
      penalties: { tee: 0, other: 0, total: 0 },
      gir: { eligible: 0, pct: 0, holes: 0 },
    });
    statsEngine.driveScoreImpact.mockReturnValue({ hasData: false });
    statsEngine.approachScoreImpact.mockReturnValue({ hasData: false });
    statsEngine.puttDeepDive.mockReturnValue({ hasData: false });
  });

  const emptyBucket = { holes: 0, avgPoints: 0, avgVsPar: 0, penaltyRate: 0, breakdown: [] };
  const emptyApproachBucket = { holes: 0, avgPoints: 0, avgVsPar: 0, girRate: null, girEligible: 0, breakdown: [] };

  test('a 2-sample drive bucket renders grey "need more data" instead of a colored verdict', () => {
    const statsEngine = require('../../store/statsEngine');
    statsEngine.driveScoreImpact.mockReturnValue({
      hasData: true,
      totalHoles: 2,
      buckets: {
        fairway: { holes: 2, avgPoints: 2, avgVsPar: 1, penaltyRate: 0, breakdown: [] },
        left: emptyBucket,
        right: emptyBucket,
        short: emptyBucket,
        super: emptyBucket,
      },
    });

    const { getByText } = renderStats([makeRound('r1')]);
    fireEvent.press(getByText('My Shots'));

    expect(getByText('2 holes — need more data')).toBeTruthy();
    // A 2-sample bucket must not be painted as a good/bad verdict — the "vs
    // par" value renders in the muted color, not a scoreColor tone.
    const vsParStyle = StyleSheet.flatten(getByText('+1').props.style);
    expect(vsParStyle.color).toBe(mockTheme.text.muted);
  });

  test('a 6+ sample drive bucket still renders a colored verdict', () => {
    const statsEngine = require('../../store/statsEngine');
    statsEngine.driveScoreImpact.mockReturnValue({
      hasData: true,
      totalHoles: 6,
      buckets: {
        fairway: { holes: 6, avgPoints: 2, avgVsPar: 1, penaltyRate: 0, breakdown: [] },
        left: emptyBucket,
        right: emptyBucket,
        short: emptyBucket,
        super: emptyBucket,
      },
    });

    const { getByText, queryByText } = renderStats([makeRound('r1')]);
    fireEvent.press(getByText('My Shots'));

    expect(getByText('6 holes')).toBeTruthy();
    expect(queryByText(/need more data/)).toBeNull();
    // At/above the floor the verdict color is restored (poor: avgVsPar > 0).
    const vsParStyle = StyleSheet.flatten(getByText('+1').props.style);
    expect(vsParStyle.color).not.toBe(mockTheme.text.muted);
  });

  test('a low-sample approach bucket renders grey "need more data"', () => {
    const statsEngine = require('../../store/statsEngine');
    statsEngine.approachScoreImpact.mockReturnValue({
      hasData: true,
      totalHoles: 3,
      buckets: {
        '0-50': { holes: 3, avgPoints: 2, avgVsPar: -1, girRate: 100, girEligible: 3, breakdown: [] },
        '50-100': emptyApproachBucket,
        '100-150': emptyApproachBucket,
        '150-200': emptyApproachBucket,
        '200+': emptyApproachBucket,
      },
    });

    const { getByText } = renderStats([makeRound('r1')]);
    fireEvent.press(getByText('My Shots'));

    expect(getByText('3 holes — need more data')).toBeTruthy();
    // avgVsPar -1 would normally render 'excellent'; low sample keeps it muted.
    const vsParStyle = StyleSheet.flatten(getByText('-1').props.style);
    expect(vsParStyle.color).toBe(mockTheme.text.muted);
    const girStyle = StyleSheet.flatten(getByText('100%').props.style);
    expect(girStyle.color).toBe(mockTheme.text.muted);
  });

  test('a low-sample putt deep-dive par bucket renders grey "need more data"', () => {
    const statsEngine = require('../../store/statsEngine');
    statsEngine.puttDeepDive.mockReturnValue({
      hasData: true,
      holes: 2,
      twoPuttPct: 50,
      girPuttsAvg: 1.8,
      nonGirPuttsAvg: 2.1,
      girHoles: 1,
      nonGirHoles: 1,
      byPar: {
        3: { holes: 2, avg: 1.5 },
        4: null,
        5: null,
      },
      onePuttSave: { attempts: 1, saves: 1, pct: 100 },
    });

    const { getByText } = renderStats([makeRound('r1')]);
    fireEvent.press(getByText('My Shots'));

    expect(getByText('2 holes — need more data')).toBeTruthy();
  });

  test('a 6+ sample putt deep-dive par bucket renders the plain hole count', () => {
    const statsEngine = require('../../store/statsEngine');
    statsEngine.puttDeepDive.mockReturnValue({
      hasData: true,
      holes: 6,
      twoPuttPct: 50,
      girPuttsAvg: 1.8,
      nonGirPuttsAvg: 2.1,
      girHoles: 3,
      nonGirHoles: 3,
      byPar: {
        3: { holes: 6, avg: 1.5 },
        4: null,
        5: null,
      },
      onePuttSave: { attempts: 3, saves: 2, pct: 67 },
    });

    const { getByText, queryByText } = renderStats([makeRound('r1')]);
    fireEvent.press(getByText('My Shots'));

    expect(getByText('6 holes')).toBeTruthy();
    expect(queryByText(/need more data/)).toBeNull();
  });

  test('GIR-after-drive-result greys a side under the 6-sample floor and colors the other side plainly', () => {
    const statsEngine = require('../../store/statsEngine');
    statsEngine.girByDriveResult.mockReturnValue({
      fairway: { holes: 8, girPct: 44, breakdown: [] },
      miss: { holes: 3, girPct: 18, breakdown: [] },
    });

    const { getByText } = renderStats([makeRound('r1')]);
    fireEvent.press(getByText('My Shots'));

    expect(getByText('GIR after fairway ')).toBeTruthy();
    expect(getByText(' · after a miss ')).toBeTruthy();
    const fairwayStyle = StyleSheet.flatten(getByText('44%').props.style);
    const missStyle = StyleSheet.flatten(getByText('18%').props.style);
    // fairway (8 samples) is at/above the floor — not greyed.
    expect(fairwayStyle.color).not.toBe(mockTheme.text.muted);
    // miss (3 samples) is below the 6-sample floor — greyed.
    expect(missStyle.color).toBe(mockTheme.text.muted);
  });

  test('GIR-after-drive-result is omitted when neither side has a sample', () => {
    const statsEngine = require('../../store/statsEngine');
    statsEngine.girByDriveResult.mockReturnValue({
      fairway: { holes: 0, girPct: 0, breakdown: [] },
      miss: { holes: 0, girPct: 0, breakdown: [] },
    });

    const { getByText, queryByText } = renderStats([makeRound('r1')]);
    fireEvent.press(getByText('My Shots'));

    expect(queryByText(/GIR after fairway/)).toBeNull();
  });

  test('a zero-sample miss side is hidden entirely, never rendered as a full-color 0%', () => {
    const statsEngine = require('../../store/statsEngine');
    statsEngine.girByDriveResult.mockReturnValue({
      fairway: { holes: 8, girPct: 44, breakdown: [] },
      miss: { holes: 0, girPct: 0, breakdown: [] },
    });

    const { getByText, queryByText } = renderStats([makeRound('r1')]);
    fireEvent.press(getByText('My Shots'));

    // The populated side still renders...
    expect(getByText('GIR after fairway ')).toBeTruthy();
    expect(getByText('44%')).toBeTruthy();
    // ...but the empty side is gone — no label, no misleading full-color 0%
    // (mirrors the sibling Drive/Approach Impact rows, which skip
    // zero-sample buckets outright).
    expect(queryByText(/after a miss/)).toBeNull();
    expect(queryByText('0%')).toBeNull();
  });

  test('a zero-sample fairway side is hidden while the miss side renders with its own lead-in label', () => {
    const statsEngine = require('../../store/statsEngine');
    statsEngine.girByDriveResult.mockReturnValue({
      fairway: { holes: 0, girPct: 0, breakdown: [] },
      miss: { holes: 7, girPct: 18, breakdown: [] },
    });

    const { getByText, queryByText } = renderStats([makeRound('r1')]);
    fireEvent.press(getByText('My Shots'));

    expect(getByText('GIR after a miss ')).toBeTruthy();
    expect(getByText('18%')).toBeTruthy();
    expect(queryByText(/after fairway/)).toBeNull();
    expect(queryByText('0%')).toBeNull();
  });
});

describe('StatsScreen Shame tab — fairness fixes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Zero Hero leads with the worst offender: "{FirstName} — {n} pointless holes in R{k}"', () => {
    const statsEngine = require('../../store/statsEngine');
    statsEngine.zeroHero.mockReturnValue({
      value: 5,
      entries: [
        { player: fourPlayers[0], roundIndex: 0, courseName: 'La Moraleja', count: 5, breakdown: [] },
        { player: fourPlayers[1], roundIndex: 1, courseName: 'La Moraleja', count: 3, breakdown: [] },
      ],
    });

    const { getByText, getAllByText } = renderStats([makeRound('r1')], { players: fourPlayers });
    fireEvent.press(getByText('Shame'));

    expect(getAllByText('Marcos — 5 pointless holes in R1').length).toBeGreaterThan(0);
  });

  test('Nemesis Encore leads with the worst repeat offender: "Hole 7 owns {FirstName} ({n} rounds)"', () => {
    const statsEngine = require('../../store/statsEngine');
    statsEngine.nemesisEncore.mockReturnValue([
      { player: fourPlayers[0], holeNumber: 7, courseName: 'La Moraleja', rounds: [0, 1, 2] },
      { player: fourPlayers[1], holeNumber: 3, courseName: 'La Moraleja', rounds: [0, 1] },
    ]);

    const { getByText, getAllByText } = renderStats([makeRound('r1')], { players: fourPlayers });
    fireEvent.press(getByText('Shame'));

    expect(getAllByText('Hole 7 owns Marcos (3 rounds)').length).toBeGreaterThan(0);
    // The sub must not pin entry[0]'s course onto a count that can span
    // other entries' courses — with 2+ entries it goes course-agnostic.
    expect(getAllByText('2 nemesis holes across the group').length).toBeGreaterThan(0);
  });

  test('tapping Nemesis Encore opens a detail sheet with a row per repeat round', () => {
    const statsEngine = require('../../store/statsEngine');
    statsEngine.nemesisEncore.mockReturnValue([
      { player: fourPlayers[0], holeNumber: 7, courseName: 'La Moraleja', rounds: [0, 1] },
    ]);

    const { getByText, getAllByText, UNSAFE_getByType } = renderStats(
      [makeRound('r1'), makeRound('r2', 5)],
      { players: fourPlayers },
    );
    fireEvent.press(getByText('Shame'));
    // A lone entry's sub CAN honestly carry its own course.
    expect(getAllByText('La Moraleja · 1 nemesis hole').length).toBeGreaterThan(0);
    fireEvent.press(getAllByText(/Nemesis Encore/)[0]);

    const sheet = UNSAFE_getByType('StatDetailSheet');
    expect(sheet.props.title).toBe('Marcos — Nemesis Encore');
    // one section header + one row per round the hole zeroed the player.
    expect(sheet.props.rows).toHaveLength(3);
    expect(sheet.props.rows[1].rightPrimary).toBe('0 pts');
    expect(sheet.props.rows[2].rightPrimary).toBe('0 pts');
  });

  test('Nemesis Encore sheet names every offender when entries span multiple players', () => {
    const statsEngine = require('../../store/statsEngine');
    statsEngine.nemesisEncore.mockReturnValue([
      { player: fourPlayers[0], holeNumber: 7, courseName: 'La Moraleja', rounds: [0, 1, 2] },
      { player: fourPlayers[1], holeNumber: 3, courseName: 'Northwood', rounds: [0, 1] },
    ]);

    const { getByText, getAllByText, UNSAFE_getByType } = renderStats(
      [makeRound('r1'), makeRound('r2', 5)],
      { players: fourPlayers },
    );
    fireEvent.press(getByText('Shame'));
    fireEvent.press(getAllByText(/Nemesis Encore/)[0]);

    const sheet = UNSAFE_getByType('StatDetailSheet');
    // joinNames across ALL qualifying players — the openZero / openTripleBogey
    // convention for multi-entry shame sheets.
    expect(sheet.props.title).toBe('Marcos & Bob — Nemesis Encore');
    // 2 section headers + 3 repeat rounds + 2 repeat rounds.
    expect(sheet.props.rows).toHaveLength(7);
  });

  test('Par-3 Heartbreak renders every tied leader, not just one player', () => {
    const statsEngine = require('../../store/statsEngine');
    statsEngine.par3Heartbreak.mockReturnValue({
      value: 5,
      entries: [
        { player: fourPlayers[0], avgStrokes: 5, holes: 3, totalPoints: 3, breakdown: [] },
        { player: fourPlayers[1], avgStrokes: 5, holes: 3, totalPoints: 2, breakdown: [] },
      ],
      all: [],
    });

    const { getByText, getAllByText } = renderStats([makeRound('r1')], { players: fourPlayers });
    fireEvent.press(getByText('Shame'));

    expect(getAllByText(/Marcos & Bob/).length).toBeGreaterThan(0);
    expect(getAllByText('2 tied').length).toBeGreaterThan(0);
  });

  describe('Triple Bogey Club — metric-aware wording', () => {
    const tripleBogeyShame = {
      tripleBogey: {
        value: 3,
        entries: [{
          player: fourPlayers[0], roundIndex: 0, courseName: 'La Moraleja',
          holeNumber: 5, par: 4, si: 3, strokes: 7, points: 0, vsPar: 3, breakdown: [],
        }],
      },
    };

    test('explainer says "net over par" in points mode', () => {
      const statsEngine = require('../../store/statsEngine');
      statsEngine.hallOfShame.mockReturnValue(tripleBogeyShame);

      const { getByText, getAllByText, UNSAFE_getByType } = renderStats([makeRound('r1')], { players: fourPlayers });
      fireEvent.press(getByText('Shame'));
      fireEvent.press(getAllByText(/Triple Bogey Club/)[0]);

      const sheet = UNSAFE_getByType('StatDetailSheet');
      expect(sheet.props.explainer).toMatch(/net over par/);
    });

    test('explainer says "gross over par" in strokes mode', () => {
      const statsEngine = require('../../store/statsEngine');
      statsEngine.hallOfShame.mockReturnValue(tripleBogeyShame);

      const { getByText, getAllByText, UNSAFE_getByType } = renderStats([makeRound('r1')], { players: fourPlayers });
      fireEvent.press(getByText('Shame'));
      const switchEl = UNSAFE_getByType(Switch);
      fireEvent(switchEl, 'valueChange', false); // toggle to Strokes
      fireEvent.press(getAllByText(/Triple Bogey Club/)[0]);

      const sheet = UNSAFE_getByType('StatDetailSheet');
      expect(sheet.props.explainer).toMatch(/gross over par/);
    });
  });
});

describe('StatsScreen Players tab — aggregate memoization (Task 4.2)', () => {
  // PlayersTab computes 9 statsEngine passes (plus one from personalStats,
  // not spied here) for the selected player. It holds local `sheet` state
  // for its detail sheets, so without memoization opening one would re-run
  // every aggregate again. This spies on the module-mocked functions to
  // fail if a future edit drops a useMemo or slips `sheet` into a dep array.
  beforeEach(() => {
    jest.clearAllMocks();
    const statsEngine = require('../../store/statsEngine');
    statsEngine.playerRoundHistory.mockReturnValue([
      { roundIndex: 0, courseName: 'La Moraleja', points: 36, strokes: 72, holesPlayed: 18, avgPerHole: 2 },
    ]);
    statsEngine.parTypeSplit.mockReturnValue({
      par3: { holes: 6, avgPoints: 2, breakdown: [] },
      par4: { holes: 6, avgPoints: 2, breakdown: [] },
      par5: { holes: 6, avgPoints: 2, breakdown: [] },
    });
  });

  const playersTabAggregateMocks = (statsEngine) => [
    statsEngine.playerScoreDistribution,
    statsEngine.playerStreaks,
    statsEngine.playerRoundHistory,
    statsEngine.playerAvgStableford,
    statsEngine.parTypeSplit,
    statsEngine.warmupVsClosing,
    statsEngine.handicapROI,
    statsEngine.bounceBackRate,
    statsEngine.frontBackSplit,
  ];

  test('opening the Par-Type detail sheet does not re-invoke any Players-tab aggregate', () => {
    const statsEngine = require('../../store/statsEngine');
    const { getByText } = renderStats([makeRound('r1')]);
    fireEvent.press(getByText('Players'));

    const aggregateMocks = playersTabAggregateMocks(statsEngine);
    const callsBefore = aggregateMocks.map((fn) => fn.mock.calls.length);
    expect(callsBefore.every((n) => n > 0)).toBe(true); // sanity: initial render did compute them

    // Tapping the Par 3 cell only sets PlayersTab's local `sheet` state —
    // tournament/metric/roundScope/selected player are unchanged, so a
    // correctly memoized tab recomputes nothing on this re-render.
    fireEvent.press(getByText('Par 3'));

    const callsAfter = aggregateMocks.map((fn) => fn.mock.calls.length);
    expect(callsAfter).toEqual(callsBefore);
  });

  test('changing round scope DOES recompute distribution/streaks but not the tournament-wide aggregates', () => {
    const statsEngine = require('../../store/statsEngine');
    const { getByText } = renderStats([makeRound('r1'), makeRound('r2', 5)]);
    fireEvent.press(getByText('Players'));

    const distBefore = statsEngine.playerScoreDistribution.mock.calls.length;
    const streaksBefore = statsEngine.playerStreaks.mock.calls.length;
    const avgBefore = statsEngine.playerAvgStableford.mock.calls.length;

    fireEvent.press(getByText('R2'));

    // distribution/streaks read `roundScope` — they must recompute.
    expect(statsEngine.playerScoreDistribution.mock.calls.length).toBeGreaterThan(distBefore);
    expect(statsEngine.playerStreaks.mock.calls.length).toBeGreaterThan(streaksBefore);
    // playerAvgStableford has no roundIndex param at all — must NOT recompute.
    expect(statsEngine.playerAvgStableford.mock.calls.length).toBe(avgBefore);
  });
});

describe('StatsScreen Holes tab — aggregate memoization (Task 4.2)', () => {
  // bestWorstHoles/playerNemesisAndCrushed/chaosHoles/collectiveExtremes are
  // each a tournament-wide pass. HolesTab holds local `sheet` state for its
  // detail sheets, so without memoization opening one would re-run every
  // aggregate again.
  beforeEach(() => {
    jest.clearAllMocks();
    const statsEngine = require('../../store/statsEngine');
    statsEngine.bestWorstHoles.mockReturnValue({
      best: [{
        roundIndex: 0, holeNumber: 1, par: 4, si: 1, courseName: 'La Moraleja',
        avgPoints: 3, avgVsPar: -1, playerScores: [],
      }],
      worst: [],
    });
    statsEngine.playerNemesisAndCrushed.mockReturnValue([]);
    statsEngine.chaosHoles.mockReturnValue([]);
    statsEngine.collectiveExtremes.mockReturnValue({ disasters: [], gimmes: [] });
  });

  const holesTabAggregateMocks = (statsEngine) => [
    statsEngine.bestWorstHoles,
    statsEngine.playerNemesisAndCrushed,
    statsEngine.chaosHoles,
    statsEngine.collectiveExtremes,
  ];

  test('opening the Easiest Hole detail sheet does not re-invoke any Holes-tab aggregate', () => {
    const statsEngine = require('../../store/statsEngine');
    const { getByText } = renderStats([makeRound('r1')], { players: fourPlayers });
    fireEvent.press(getByText('Holes'));

    const aggregateMocks = holesTabAggregateMocks(statsEngine);
    const callsBefore = aggregateMocks.map((fn) => fn.mock.calls.length);
    expect(callsBefore.every((n) => n > 0)).toBe(true); // sanity: initial render did compute them

    // Tapping the Easiest Hole card only sets HolesTab's local `sheet`
    // state — tournament/metric/roundScope are unchanged, so a correctly
    // memoized tab recomputes nothing on this re-render.
    fireEvent.press(getByText('R1 · Hole 1 · Par 4 · SI 1'));

    const callsAfter = aggregateMocks.map((fn) => fn.mock.calls.length);
    expect(callsAfter).toEqual(callsBefore);
  });

  test('changing round scope DOES recompute bestWorstHoles but not the round-agnostic aggregates', () => {
    const statsEngine = require('../../store/statsEngine');
    const { getByText } = renderStats([makeRound('r1'), makeRound('r2', 5)], { players: fourPlayers });
    fireEvent.press(getByText('Holes'));

    const bwBefore = statsEngine.bestWorstHoles.mock.calls.length;
    const nemesisBefore = statsEngine.playerNemesisAndCrushed.mock.calls.length;
    const chaosBefore = statsEngine.chaosHoles.mock.calls.length;
    const extremesBefore = statsEngine.collectiveExtremes.mock.calls.length;

    fireEvent.press(getByText('R2'));

    // bestWorstHoles reads `roundScope` — it must recompute.
    expect(statsEngine.bestWorstHoles.mock.calls.length).toBeGreaterThan(bwBefore);
    // None of these three take a roundIndex at all — must NOT recompute.
    expect(statsEngine.playerNemesisAndCrushed.mock.calls.length).toBe(nemesisBefore);
    expect(statsEngine.chaosHoles.mock.calls.length).toBe(chaosBefore);
    expect(statsEngine.collectiveExtremes.mock.calls.length).toBe(extremesBefore);
  });
});

describe('StatsScreen Shame tab — aggregate memoization (Task 4.2)', () => {
  // hallOfShame/par3Heartbreak/pickupChampion/anchor (which runs the full
  // pairHoleWins internally)/zeroHero/nemesisEncore are each tournament-wide
  // passes. ShameTab holds local `sheet` state for its detail sheets, so
  // without memoization opening one would re-run every aggregate again.
  beforeEach(() => {
    jest.clearAllMocks();
    const statsEngine = require('../../store/statsEngine');
    statsEngine.zeroHero.mockReturnValue({
      value: 5,
      entries: [
        { player: fourPlayers[0], roundIndex: 0, courseName: 'La Moraleja', count: 5, breakdown: [] },
      ],
    });
  });

  const shameTabAggregateMocks = (statsEngine) => [
    statsEngine.hallOfShame,
    statsEngine.par3Heartbreak,
    statsEngine.pickupChampion,
    statsEngine.anchor,
    statsEngine.zeroHero,
    statsEngine.nemesisEncore,
  ];

  test('opening the Zero Hero detail sheet does not re-invoke any Shame-tab aggregate', () => {
    const statsEngine = require('../../store/statsEngine');
    const { getByText, getAllByText } = renderStats([makeRound('r1')], { players: fourPlayers });
    fireEvent.press(getByText('Shame'));

    const aggregateMocks = shameTabAggregateMocks(statsEngine);
    const callsBefore = aggregateMocks.map((fn) => fn.mock.calls.length);
    expect(callsBefore.every((n) => n > 0)).toBe(true); // sanity: initial render did compute them

    // Tapping the Zero Hero card only sets ShameTab's local `sheet` state —
    // tournament/metric are unchanged, so a correctly memoized tab
    // recomputes nothing on this re-render.
    fireEvent.press(getAllByText(/Marcos — 5 pointless holes in R1/)[0]);

    const callsAfter = aggregateMocks.map((fn) => fn.mock.calls.length);
    expect(callsAfter).toEqual(callsBefore);
  });

  test('toggling the points/strokes metric DOES recompute hallOfShame but not the metric-agnostic aggregates', () => {
    const statsEngine = require('../../store/statsEngine');
    const { getByText, UNSAFE_getByType } = renderStats([makeRound('r1')], { players: fourPlayers });
    fireEvent.press(getByText('Shame'));

    const shameCallsBefore = statsEngine.hallOfShame.mock.calls.length;
    const par3CallsBefore = statsEngine.par3Heartbreak.mock.calls.length;
    const zeroCallsBefore = statsEngine.zeroHero.mock.calls.length;

    const switchEl = UNSAFE_getByType(Switch);
    fireEvent(switchEl, 'valueChange', false); // toggle to Strokes — flips `metric`

    // hallOfShame reads `metric` — it must recompute.
    expect(statsEngine.hallOfShame.mock.calls.length).toBeGreaterThan(shameCallsBefore);
    // par3Heartbreak/zeroHero take no metric arg at all — must NOT recompute.
    expect(statsEngine.par3Heartbreak.mock.calls.length).toBe(par3CallsBefore);
    expect(statsEngine.zeroHero.mock.calls.length).toBe(zeroCallsBefore);
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
