import {
  roundScoringMode, tournamentHasMixedModes, teamShapeOf, pairsForNextRound,
  laterRoundsForFixedTeamsPropagation,
} from '../scoring';

describe('roundScoringMode', () => {
  const t = { settings: { scoringMode: 'stableford' } };
  it('round override wins', () => {
    expect(roundScoringMode(t, { scoringMode: 'scramblepairs' })).toBe('scramblepairs');
  });
  it('falls back to the tournament default', () => {
    expect(roundScoringMode(t, {})).toBe('stableford');
    expect(roundScoringMode(t, undefined)).toBe('stableford');
  });
  it('falls back to stableford with no settings', () => {
    expect(roundScoringMode({}, {})).toBe('stableford');
    expect(roundScoringMode(undefined, undefined)).toBe('stableford');
  });
});

describe('tournamentHasMixedModes', () => {
  it('false for uniform and legacy tournaments', () => {
    expect(tournamentHasMixedModes({
      settings: { scoringMode: 'stableford' },
      rounds: [{}, {}],
    })).toBe(false);
    expect(tournamentHasMixedModes({
      settings: { scoringMode: 'matchplay' },
      rounds: [{ scoringMode: 'matchplay' }, {}],
    })).toBe(false);
  });
  it('true when any two rounds differ', () => {
    expect(tournamentHasMixedModes({
      settings: { scoringMode: 'stableford' },
      rounds: [{}, { scoringMode: 'scramblepairs' }],
    })).toBe(true);
  });
  it('false for zero/one round', () => {
    expect(tournamentHasMixedModes({ settings: { scoringMode: 'stableford' }, rounds: [] })).toBe(false);
    expect(tournamentHasMixedModes({ settings: { scoringMode: 'stableford' } })).toBe(false);
  });
});

describe('teamShapeOf', () => {
  it.each([
    ['individual', 'solo'], ['matchplay', 'solo'], ['sindicato', 'solo'],
    ['stableford', '2x2'], ['bestball', '2x2'], ['scramblepairs', '2x2'], ['pairsmatchplay', '2x2'],
    ['scramble3v1', '3+1'], ['scramble4', '1x4'],
  ])('%s → %s', (mode, shape) => {
    expect(teamShapeOf(mode)).toBe(shape);
  });
  it('unknown mode → solo', () => {
    expect(teamShapeOf('nonsense')).toBe('solo');
  });
});

const P4 = (id) => ({ id, name: id });

describe('pairsForNextRound', () => {
  const players = [P4('a'), P4('b'), P4('c'), P4('d')];
  it('fixedTeams copies from the latest same-shape round', () => {
    const prevPairs = [[players[0], players[1]], [players[2], players[3]]];
    const t = {
      settings: { scoringMode: 'scramblepairs', fixedTeams: true },
      players,
      rounds: [
        { id: 'r0', pairs: prevPairs, scoringMode: 'scramblepairs' },
        { id: 'r1', scoringMode: 'pairsmatchplay' }, // 2x2 too — copies r0
      ],
    };
    const pairs = pairsForNextRound(t, t.rounds[1]);
    expect(pairs.map((pr) => pr.map((p) => p.id))).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('fixedTeams does NOT copy across different shapes', () => {
    const t = {
      settings: { scoringMode: 'scramblepairs', fixedTeams: true },
      players,
      rounds: [
        { id: 'r0', pairs: [[players[0], players[1]], [players[2], players[3]]], scoringMode: 'scramblepairs' },
        { id: 'r1', scoringMode: 'scramble3v1' }, // 3+1 — fresh build
      ],
    };
    const pairs = pairsForNextRound(t, t.rounds[1]);
    expect(pairs.map((x) => x.length).sort()).toEqual([1, 3]);
  });

  it('no fixedTeams → fresh build from the round mode', () => {
    const t = {
      settings: { scoringMode: 'stableford', fixedTeams: false },
      players,
      rounds: [{ id: 'r0', scoringMode: 'scramble4' }],
    };
    expect(pairsForNextRound(t, t.rounds[0])).toHaveLength(1);
  });

  it('fixedTeams reuses a [2,3] partners shape without a spurious rebuild', () => {
    // Odd-roster Stableford-with-Partners forms one 3-player team (task 12).
    // teamShapeOf keys purely off the mode string, so this [2,3] shape must
    // round-trip through the fixedTeams reuse path exactly, not get rebuilt.
    const five = [...players, P4('e')];
    const prevPairs = [[five[0], five[1]], [five[2], five[3], five[4]]];
    const t = {
      settings: { scoringMode: 'stableford', fixedTeams: true },
      players: five,
      rounds: [
        { id: 'r0', pairs: prevPairs, scoringMode: 'stableford' },
        { id: 'r1', scoringMode: 'stableford' },
      ],
    };
    const pairs = pairsForNextRound(t, t.rounds[1]);
    expect(pairs.map((pr) => pr.map((p) => p.id))).toEqual([['a', 'b'], ['c', 'd', 'e']]);
  });
});

describe('laterRoundsForFixedTeamsPropagation', () => {
  it('includes only later rounds whose effective mode shares the edited round shape', () => {
    const t = {
      settings: { scoringMode: 'bestball' },
      rounds: [
        { id: 'r0', scoringMode: 'bestball' },
        { id: 'r1', scoringMode: 'scramble3v1' }, // 3+1 — mismatched, excluded
        { id: 'r2', scoringMode: 'pairsmatchplay' }, // 2x2 — matches, included
        { id: 'r3' }, // falls back to tournament default bestball — 2x2, included
      ],
    };
    const later = laterRoundsForFixedTeamsPropagation(t, t.rounds[0]);
    expect(later.map((r) => r.id)).toEqual(['r2', 'r3']);
  });

  it('returns an empty list when the edited round is the last round', () => {
    const t = {
      settings: { scoringMode: 'bestball' },
      rounds: [{ id: 'r0', scoringMode: 'bestball' }],
    };
    expect(laterRoundsForFixedTeamsPropagation(t, t.rounds[0])).toEqual([]);
  });

  it('returns an empty list when the edited round is not found in rounds', () => {
    const t = {
      settings: { scoringMode: 'bestball' },
      rounds: [{ id: 'r0', scoringMode: 'bestball' }, { id: 'r1', scoringMode: 'bestball' }],
    };
    expect(laterRoundsForFixedTeamsPropagation(t, { id: 'missing' })).toEqual([]);
  });
});
