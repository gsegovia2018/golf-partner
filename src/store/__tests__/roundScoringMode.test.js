import { roundScoringMode, tournamentHasMixedModes, teamShapeOf } from '../scoring';

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
