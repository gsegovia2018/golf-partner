import { setScoringModeRoundPatches } from '../tournamentStore';
import { mergeScoringSettings } from '../../components/scoringModes';

function makeTournament({ players, mode, rounds, currentRound = 0, fixedTeams = false }) {
  return {
    id: 't1',
    players,
    rounds,
    currentRound,
    settings: {
      scoringMode: mode, bestBallValue: 1, worstBallValue: 1, fixedTeams,
    },
  };
}

function makeRound({ id = 'r1', revealed = true, pairs = [] } = {}) {
  return {
    id,
    holes: [],
    pairs,
    revealed,
    playerHandicaps: {},
    manualHandicaps: {},
    scores: {},
  };
}

const A = { id: 'a', name: 'A', handicap: 10 };
const B = { id: 'b', name: 'B', handicap: 12 };
const C = { id: 'c', name: 'C', handicap: 8 };
const D = { id: 'd', name: 'D', handicap: 4 };

describe('setScoringModeRoundPatches', () => {
  test('switching INTO Best Ball from individual builds two pairs of two', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'individual',
      rounds: [makeRound({ pairs: [[A], [B], [C], [D]] })],
    });
    const { patches } = setScoringModeRoundPatches(t, 'bestball');
    expect(patches).toHaveLength(1);
    expect(patches[0].roundId).toBe('r1');
    const pairs = patches[0].pairs;
    expect(pairs).toHaveLength(2);
    expect(pairs.every((pr) => pr.length === 2)).toBe(true);
    // Every player appears exactly once across the two pairs.
    expect(pairs.flat().map((p) => p.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  test('switching OUT of Best Ball to individual collapses pairs to singletons', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'bestball',
      rounds: [makeRound({ pairs: [[A, B], [C, D]] })],
    });
    const { patches } = setScoringModeRoundPatches(t, 'individual');
    expect(patches[0].pairs).toEqual([[A], [B], [C], [D]]);
  });

  test('team-to-team change with revealed pairs keeps the existing partnerships', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'stableford',
      rounds: [makeRound({ revealed: true, pairs: [[A, B], [C, D]] })],
    });
    const { patches } = setScoringModeRoundPatches(t, 'bestball');
    expect(patches[0].pairs).toEqual([[A, B], [C, D]]);
  });

  test('already-played earlier rounds are left untouched', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'individual',
      rounds: [
        makeRound({ id: 'r1', pairs: [[A], [B], [C], [D]] }),
        makeRound({ id: 'r2', pairs: [[A], [B], [C], [D]] }),
      ],
      currentRound: 1,
    });
    const { patches } = setScoringModeRoundPatches(t, 'bestball');
    expect(patches).toHaveLength(1);
    expect(patches[0].roundId).toBe('r2');
  });
});

describe('new team mode shapes', () => {
  test('switching to scramble3v1 rebuilds future rounds as 3+1', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'stableford',
      rounds: [makeRound({ id: 'r0' })],
      currentRound: 0,
    });
    const { patches } = setScoringModeRoundPatches(t, 'scramble3v1');
    expect(patches[0].pairs.map((x) => x.length).sort()).toEqual([1, 3]);
  });

  test('switching to scramble4 rebuilds future rounds as one team of 4', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'stableford',
      rounds: [makeRound({ id: 'r0' })],
      currentRound: 0,
    });
    const { patches } = setScoringModeRoundPatches(t, 'scramble4');
    expect(patches[0].pairs).toHaveLength(1);
    expect(patches[0].pairs[0]).toHaveLength(4);
  });

  test('switching to pairsmatchplay rebuilds as two pairs of 2', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'individual',
      rounds: [makeRound({ id: 'r0' })],
      currentRound: 0,
    });
    const { patches } = setScoringModeRoundPatches(t, 'pairsmatchplay');
    expect(patches[0].pairs.map((x) => x.length)).toEqual([2, 2]);
  });
});

describe('fixedTeams', () => {
  function pairIds(pairs) {
    return pairs.map((pr) => pr.map((p) => p.id).sort());
  }

  test('with fixedTeams, every future round patch carries identical pairs', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'individual',
      fixedTeams: true,
      currentRound: 0,
      rounds: [
        makeRound({ id: 'r0', revealed: false, pairs: [] }),
        makeRound({ id: 'r1', revealed: false, pairs: [] }),
        makeRound({ id: 'r2', revealed: false, pairs: [] }),
      ],
    });
    const { patches } = setScoringModeRoundPatches(t, 'bestball');
    expect(patches).toHaveLength(3);
    const [p0, p1, p2] = patches.map((p) => pairIds(p.pairs));
    expect(p0).toEqual(p1);
    expect(p1).toEqual(p2);
  });

  test('without fixedTeams, future rounds may randomize independently (shape still valid each round)', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'individual',
      fixedTeams: false,
      currentRound: 0,
      rounds: [
        makeRound({ id: 'r0', revealed: false, pairs: [] }),
        makeRound({ id: 'r1', revealed: false, pairs: [] }),
      ],
    });
    const { patches } = setScoringModeRoundPatches(t, 'bestball');
    expect(patches).toHaveLength(2);
    patches.forEach((patch) => {
      expect(patch.pairs).toHaveLength(2);
      expect(patch.pairs.every((pr) => pr.length === 2)).toBe(true);
    });
  });

  test('fixedTeams still respects an already-revealed current round', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'stableford',
      fixedTeams: true,
      currentRound: 0,
      rounds: [
        makeRound({ id: 'r0', revealed: true, pairs: [[A, B], [C, D]] }),
        makeRound({ id: 'r1', revealed: false, pairs: [] }),
      ],
    });
    const { patches } = setScoringModeRoundPatches(t, 'bestball');
    expect(pairIds(patches[0].pairs)).toEqual([['a', 'b'], ['c', 'd']]);
    expect(pairIds(patches[1].pairs)).toEqual(pairIds(patches[0].pairs));
  });

  // Regression for the Home screen's Scoring Mode sheet: the stored settings
  // still say fixedTeams:false, but the user just toggled it ON in the draft
  // being saved. HomeScreen merges the draft first and hands the patch
  // builder a tournament whose settings carry the draft's fixedTeams while
  // keeping the PRE-save scoringMode (the builder reads the old mode from
  // settings.scoringMode and takes the new mode as its argument). Called
  // that way, the same save that enables the flag must already produce
  // identical pairs for every future round.
  test('draft-enabled fixedTeams unifies patches in the same save (HomeScreen call shape)', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'individual',
      fixedTeams: false, // stored settings pre-save
      currentRound: 0,
      rounds: [
        makeRound({ id: 'r0', revealed: false, pairs: [] }),
        makeRound({ id: 'r1', revealed: false, pairs: [] }),
        makeRound({ id: 'r2', revealed: false, pairs: [] }),
      ],
    });
    const draft = {
      scoringMode: 'bestball', bestBallValue: '1', worstBallValue: '1', fixedTeams: true,
    };
    const mergedSettings = mergeScoringSettings(t.settings, draft);
    expect(mergedSettings.fixedTeams).toBe(true);
    const patchSource = {
      ...t,
      settings: { ...mergedSettings, scoringMode: t.settings.scoringMode },
    };
    const { patches } = setScoringModeRoundPatches(patchSource, draft.scoringMode);
    expect(patches).toHaveLength(3);
    const [p0, p1, p2] = patches.map((p) => pairIds(p.pairs));
    expect(p0).toEqual(p1);
    expect(p1).toEqual(p2);
    // And the shape matches the NEW mode (bestball: two pairs of two).
    expect(patches[0].pairs).toHaveLength(2);
    expect(patches[0].pairs.every((pr) => pr.length === 2)).toBe(true);
  });
});
