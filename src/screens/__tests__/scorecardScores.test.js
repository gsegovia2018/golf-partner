import {
  canShowQuickFinish,
  buildScorecardTournamentBackState,
  getScorecardBackTarget,
  mergeScores,
  mergeShotDetails,
  shouldMarkTournamentFinishedFromScorecard,
  shouldApplyReloadSnapshot,
  clampEnteredScore,
  buildHoleMismatchRows,
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
  // Par-4, SI-1 hole. Scratch pickup = par + 2 + 0 extra = 6; ceiling = pickup
  // + 6 headroom = 12.
  const round = (playerHandicaps = {}) => ({
    holes: [{ number: 3, par: 4, strokeIndex: 1 }],
    playerHandicaps,
  });

  test('clamps an over-entered score (44) down to pickup + headroom', () => {
    expect(clampEnteredScore(round(), [{ id: 'p1', handicap: 0 }], 'p1', 3, 44)).toBe(12);
  });

  test('records a blow-up score above the pickup ball number', () => {
    expect(clampEnteredScore(round(), [{ id: 'p1', handicap: 0 }], 'p1', 3, 9)).toBe(9);
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
  // handicap of 18 gives +1 extra shot on SI 1, so pickup is 7 and the ceiling
  // is 7 + 6 = 13 — a "44" must clamp to 13, not the scratch ceiling of 12.
  test('uses the player-level handicap fallback when the round map has no entry', () => {
    expect(clampEnteredScore(round({}), [{ id: 'p1', handicap: 18 }], 'p1', 3, 44)).toBe(13);
  });

  test('does not over-clamp to the scratch ceiling when the round map is empty', () => {
    expect(clampEnteredScore(round({}), [{ id: 'p1', handicap: 18 }], 'p1', 3, 44)).not.toBe(12);
  });

  test('prefers the round per-player handicap over the player base when present', () => {
    // Round override 0 (scratch) even though base is 18 → scratch ceiling 12.
    expect(clampEnteredScore(round({ p1: 0 }), [{ id: 'p1', handicap: 18 }], 'p1', 3, 44)).toBe(12);
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

describe('buildHoleMismatchRows', () => {
  const players = [{ id: 'p1', name: 'Pedro' }, { id: 'p2', name: 'Luis' }];
  const authorName = (a) => ({ me: 'Me', juan: 'Juan', ana: 'Ana' }[a] ?? a);

  test('mine-first candidate list, named per author, playerName resolved', () => {
    const rows = buildHoleMismatchRows({
      hole: 7,
      players,
      authorName,
      authorId: 'me',
      mismatches: [
        { playerId: 'p1', mine: 5, others: [{ authorId: 'juan', value: 6 }] },
        { playerId: 'p2', mine: 3, others: [{ authorId: 'juan', value: 4 }, { authorId: 'ana', value: 5 }] },
      ],
    });
    expect(rows).toEqual([
      {
        playerId: 'p1',
        hole: 7,
        playerName: 'Pedro',
        currentValue: 5,
        candidates: [
          { value: 5, ts: 0, authorId: 'me', authorName: 'You' },
          { value: 6, ts: 0, authorId: 'juan', authorName: 'Juan' },
        ],
        blankAuthors: [],
      },
      {
        playerId: 'p2',
        hole: 7,
        playerName: 'Luis',
        currentValue: 3,
        candidates: [
          { value: 3, ts: 0, authorId: 'me', authorName: 'You' },
          { value: 4, ts: 0, authorId: 'juan', authorName: 'Juan' },
          { value: 5, ts: 0, authorId: 'ana', authorName: 'Ana' },
        ],
        blankAuthors: [],
      },
    ]);
  });

  test('unknown player falls back to a generic label', () => {
    const rows = buildHoleMismatchRows({
      hole: 1,
      players,
      authorName,
      authorId: 'me',
      mismatches: [{ playerId: 'ghost', mine: 4, others: [{ authorId: 'juan', value: 5 }] }],
    });
    expect(rows[0].playerName).toBe('Player');
  });
});
