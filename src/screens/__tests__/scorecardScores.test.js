import {
  canShowQuickFinish,
  getScorecardBackTarget,
  mergeScores,
  shouldMarkTournamentFinishedFromScorecard,
  shouldApplyReloadSnapshot,
} from '../ScorecardScreen';

describe('mergeScores', () => {
  test('adopts blob values for clean cells', () => {
    const blob = { a: { 1: 4, 2: 5 } };
    const local = { a: { 1: 4 } };
    const merged = mergeScores(blob, local, new Set());
    expect(merged).toEqual({ a: { 1: 4, 2: 5 } });
  });

  test('keeps the local value for a dirty cell the blob disagrees with', () => {
    const blob = { a: { 1: 4 } };       // stale: missing the newer tap
    const local = { a: { 1: 7 } };      // user tapped up to 7
    const merged = mergeScores(blob, local, new Set(['a:1']));
    expect(merged.a[1]).toBe(7);        // local edit survives the stale reload
  });

  test('a dirty cell the blob now agrees with adopts the blob value', () => {
    const blob = { a: { 1: 7 } };       // save round-tripped
    const local = { a: { 1: 7 } };
    const merged = mergeScores(blob, local, new Set(['a:1']));
    expect(merged.a[1]).toBe(7);
  });
});

describe('getScorecardBackTarget', () => {
  test('in-progress casual scorecards pop back to the existing round details route', () => {
    expect(getScorecardBackTarget({
      official: false,
      viewOnly: false,
      canGoBack: true,
    })).toBe('previous');
  });
});

describe('scorecard finish behavior', () => {
  test('partial single-round games are explicitly marked finished from the scorecard', () => {
    expect(shouldMarkTournamentFinishedFromScorecard({
      tournament: { kind: 'game', rounds: [{}] },
      tournamentDone: false,
    })).toBe(true);
  });

  test('partial multi-round tournaments are not archived by finishing one scorecard round', () => {
    expect(shouldMarkTournamentFinishedFromScorecard({
      tournament: { kind: 'tournament', rounds: [{}, {}] },
      tournamentDone: false,
    })).toBe(false);
  });

  test('quick finish is shown only for editable casual games', () => {
    expect(canShowQuickFinish({
      tournament: { kind: 'game' },
      official: false,
      viewOnly: false,
    })).toBe(true);
    expect(canShowQuickFinish({
      tournament: { kind: 'game' },
      official: true,
      viewOnly: false,
    })).toBe(false);
    expect(canShowQuickFinish({
      tournament: { kind: 'game' },
      official: false,
      viewOnly: true,
    })).toBe(false);
    expect(canShowQuickFinish({
      tournament: { kind: 'tournament' },
      official: false,
      viewOnly: false,
    })).toBe(false);
  });
});

describe('shouldApplyReloadSnapshot', () => {
  test('skips a reload snapshot when a local save started while the reload was in flight', () => {
    expect(shouldApplyReloadSnapshot({
      preserveLocalEdits: false,
      pendingSave: true,
      hasTournament: true,
    })).toBe(false);
  });

  test('still applies the initial load even if pending state is set defensively', () => {
    expect(shouldApplyReloadSnapshot({
      preserveLocalEdits: false,
      pendingSave: true,
      hasTournament: false,
    })).toBe(true);
  });
});
