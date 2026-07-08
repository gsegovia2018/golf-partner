import React from 'react';
import { render } from '@testing-library/react-native';
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

jest.mock('../../store/tournamentStore', () => ({
  loadTournament: jest.fn(() => Promise.resolve(mockActiveTournament)),
  getActiveTournamentSnapshot: jest.fn(() => mockActiveTournament),
  getPlayingHandicap: jest.fn(() => 0),
  calcStablefordPoints: jest.fn(() => 2),
  playerPartnerSplits: jest.fn(() => ({ partners: [] })),
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

describe('StatsScreen head-to-head gating', () => {
  const fourPlayers = [
    player,
    { id: 'p2', name: 'Bob Diaz', user_id: null, handicap: 0 },
    { id: 'p3', name: 'Cara Ruiz', user_id: null, handicap: 0 },
    { id: 'p4', name: 'Dan Vega', user_id: null, handicap: 0 },
  ];

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
