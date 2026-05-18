import {
  SCORING_MODES,
  isScoringModeAllowed,
  fallbackScoringMode,
  scoringModeCategories,
  fallbackNoticeText,
  getScoringMode,
  leaderboardToggleLabels,
} from '../scoringModes';

describe('SCORING_MODES', () => {
  test('every mode declares a non-empty category', () => {
    for (const mode of SCORING_MODES) {
      expect(typeof mode.category).toBe('string');
      expect(mode.category.length).toBeGreaterThan(0);
    }
  });
});

describe('isScoringModeAllowed', () => {
  test('matchplay needs exactly 2 players', () => {
    expect(isScoringModeAllowed('matchplay', 2)).toBe(true);
    expect(isScoringModeAllowed('matchplay', 3)).toBe(false);
  });
  test('individual needs at least 2 players', () => {
    expect(isScoringModeAllowed('individual', 1)).toBe(false);
    expect(isScoringModeAllowed('individual', 2)).toBe(true);
  });
  test('stableford with partners needs at least 3 players', () => {
    expect(isScoringModeAllowed('stableford', 2)).toBe(false);
    expect(isScoringModeAllowed('stableford', 3)).toBe(true);
  });
  test('bestball needs exactly 4 players', () => {
    expect(isScoringModeAllowed('bestball', 3)).toBe(false);
    expect(isScoringModeAllowed('bestball', 4)).toBe(true);
    expect(isScoringModeAllowed('bestball', 5)).toBe(false);
  });
  test('unknown mode is never allowed', () => {
    expect(isScoringModeAllowed('nope', 4)).toBe(false);
  });
  test('sindicato needs exactly 3 players', () => {
    expect(isScoringModeAllowed('sindicato', 2)).toBe(false);
    expect(isScoringModeAllowed('sindicato', 3)).toBe(true);
    expect(isScoringModeAllowed('sindicato', 4)).toBe(false);
  });
});

describe('fallbackScoringMode', () => {
  test('prefers stableford when the roster allows it', () => {
    expect(fallbackScoringMode(3)).toBe('stableford');
  });
  test('falls back to individual when stableford is not allowed', () => {
    expect(fallbackScoringMode(1)).toBe('individual');
  });
  test('falls back to individual for exactly 2 players (stableford needs 3+)', () => {
    expect(fallbackScoringMode(2)).toBe('individual');
  });
});

describe('scoringModeCategories', () => {
  test('groups modes into ordered sections', () => {
    const sections = scoringModeCategories();
    expect(sections.map((s) => s.category)).toEqual(['Solo', 'Head-to-head', 'Teams']);
    expect(sections[0].modes.map((m) => m.key)).toEqual(['individual', 'stableford']);
    expect(sections[1].modes.map((m) => m.key)).toEqual(['matchplay', 'sindicato']);
    expect(sections[2].modes.map((m) => m.key)).toEqual(['bestball']);
  });
  test('every mode appears exactly once across sections', () => {
    const keys = scoringModeCategories().flatMap((s) => s.modes.map((m) => m.key));
    expect(keys.sort()).toEqual(SCORING_MODES.map((m) => m.key).sort());
  });
});

describe('fallbackNoticeText', () => {
  test('explains why the mode changed', () => {
    expect(fallbackNoticeText('matchplay', 'stableford'))
      .toBe('Match Play needs exactly 2 players — switched to Stableford with Partners.');
  });
  test('returns null when either key is unknown', () => {
    expect(fallbackNoticeText('matchplay', 'nope')).toBeNull();
    expect(fallbackNoticeText('nope', 'stableford')).toBeNull();
  });
});

describe('getScoringMode', () => {
  test('returns the matching mode', () => {
    expect(getScoringMode('matchplay').label).toBe('Match Play');
  });
  test('falls back to the first mode for an unknown key', () => {
    expect(getScoringMode('nope')).toBe(SCORING_MODES[0]);
  });
});

describe('leaderboardToggleLabels', () => {
  test('Stableford modes get Stableford / Stroke Play', () => {
    expect(leaderboardToggleLabels('individual')).toEqual({ left: 'Stableford', right: 'Stroke Play' });
    expect(leaderboardToggleLabels('stableford')).toEqual({ left: 'Stableford', right: 'Stroke Play' });
  });
  test('Match Play gets Match Play / Stableford', () => {
    expect(leaderboardToggleLabels('matchplay')).toEqual({ left: 'Match Play', right: 'Stableford' });
  });
  test('Sindicato gets Sindicato / Stableford', () => {
    expect(leaderboardToggleLabels('sindicato')).toEqual({ left: 'Sindicato', right: 'Stableford' });
  });
  test('Best Ball gets Best Ball / Stableford', () => {
    expect(leaderboardToggleLabels('bestball')).toEqual({ left: 'Best Ball', right: 'Stableford' });
  });
  test('unknown mode falls back to Stableford / Stroke Play', () => {
    expect(leaderboardToggleLabels('nope')).toEqual({ left: 'Stableford', right: 'Stroke Play' });
  });
});
