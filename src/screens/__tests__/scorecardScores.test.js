import {
  canShowQuickFinish,
  buildScorecardTournamentBackState,
  getScorecardBackTarget,
  mergeScores,
  mergeShotDetails,
  shouldMarkTournamentFinishedFromScorecard,
  shouldApplyReloadSnapshot,
  clampEnteredScore,
} from '../ScorecardScreen';

// ScorecardScreen imports useFocusEffect from @react-navigation/native, whose
// published ESM isn't transformed under jest; stub it (jest hoists this above
// the import) so pulling in the screen's helper exports doesn't load the
// untransformed module.
jest.mock('@react-navigation/native', () => ({ useFocusEffect: jest.fn() }));

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

describe('mergeShotDetails', () => {
  test('keeps the local detail for a dirty shot cell the blob disagrees with', () => {
    const blob = { me: { 5: { putts: null, drive: null } } };
    const local = { me: { 5: { putts: 2, drive: 'fairway' } } };
    const merged = mergeShotDetails(blob, local, new Set(['me:5']));
    expect(merged.me[5]).toEqual({ putts: 2, drive: 'fairway' });
  });

  test('a locally-deleted dirty shot cell stays deleted despite a stale blob copy', () => {
    // Hold-to-clear removed hole 5's detail locally; a reload that raced the
    // save still carries the old detail. The deletion must win — not be
    // resurrected, and not linger as an explicit `undefined` key either.
    const blob = { me: { 5: { putts: 2, drive: 'fairway' } } };
    const local = { me: {} };
    const merged = mergeShotDetails(blob, local, new Set(['me:5']));
    expect('5' in merged.me).toBe(false);
  });
});

describe('clampEnteredScore (screen-level score entry clamp)', () => {
  // Par-4, SI-1 hole. Scratch pickup ceiling = par + 2 + 0 extra = 6.
  const round = (playerHandicaps = {}) => ({
    holes: [{ number: 3, par: 4, strokeIndex: 1 }],
    playerHandicaps,
  });

  test('clamps an over-entered score (44) down to the pickup max', () => {
    expect(clampEnteredScore(round(), [{ id: 'p1', handicap: 0 }], 'p1', 3, 44)).toBe(6);
  });

  test('leaves a normal in-range score unchanged', () => {
    expect(clampEnteredScore(round(), [{ id: 'p1', handicap: 0 }], 'p1', 3, 4)).toBe(4);
  });

  test('clears (undefined) pass through — clearing must not become 1', () => {
    expect(clampEnteredScore(round(), [{ id: 'p1', handicap: 0 }], 'p1', 3, undefined)).toBeUndefined();
  });

  test('a missing hole passes the raw value through (defensive)', () => {
    expect(clampEnteredScore(round(), [{ id: 'p1', handicap: 0 }], 'p1', 99, 44)).toBe(44);
  });

  // The bug this guards: when round.playerHandicaps has NO entry for the
  // player (legacy / pre-normalization round, or official members whose
  // handicap lives only on the player object), the clamp must resolve the
  // handicap from players[].handicap — NOT default to scratch (0). A base
  // handicap of 18 gives +1 extra shot on SI 1, so the pickup ceiling is 7,
  // and a legitimately high "44" must clamp to 7, not be over-clamped to 6.
  test('uses the player-level handicap fallback when the round map has no entry', () => {
    expect(clampEnteredScore(round({}), [{ id: 'p1', handicap: 18 }], 'p1', 3, 44)).toBe(7);
  });

  test('does not over-clamp to the scratch ceiling when the round map is empty', () => {
    expect(clampEnteredScore(round({}), [{ id: 'p1', handicap: 18 }], 'p1', 3, 44)).not.toBe(6);
  });

  test('prefers the round per-player handicap over the player base when present', () => {
    // Round override 0 (scratch) even though base is 18 → scratch ceiling 6.
    expect(clampEnteredScore(round({ p1: 0 }), [{ id: 'p1', handicap: 18 }], 'p1', 3, 44)).toBe(6);
  });
});

describe('getScorecardBackTarget', () => {
  test('scorecards opened from the live center action return to the round summary even when stack back is available', () => {
    expect(getScorecardBackTarget({
      official: false,
      viewOnly: false,
      canGoBack: true,
      requestedBackTarget: 'tournament',
    })).toBe('tournament');
  });

  test('in-progress casual scorecards opened from round details pop back to the existing route', () => {
    expect(getScorecardBackTarget({
      official: false,
      viewOnly: false,
      canGoBack: true,
    })).toBe('previous');
  });
});

describe('buildScorecardTournamentBackState', () => {
  test('anchors a live scorecard back stack under Play before the tournament route', () => {
    const state = {
      index: 1,
      routes: [
        {
          key: 'main',
          name: 'Main',
          state: {
            index: 0,
            routes: [{ name: 'Feed' }, { name: 'Home' }],
          },
        },
        { key: 'scorecard', name: 'Scorecard', params: { backTarget: 'tournament' } },
      ],
    };

    expect(buildScorecardTournamentBackState(state)).toMatchObject({
      index: 1,
      routes: [
        {
          name: 'Main',
          params: { screen: 'Home', params: { viewMode: 'list' } },
        },
        { name: 'Tournament', params: { viewMode: 'tournament' } },
      ],
    });
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
