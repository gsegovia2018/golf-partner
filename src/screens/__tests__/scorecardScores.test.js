import {
  canShowQuickFinish,
  buildConflictRows,
  buildScorecardTournamentBackState,
  getScorecardBackTarget,
  shouldMarkTournamentFinishedFromScorecard,
  clampEnteredScore,
  resumeVerifiedUpTo,
  resumeHole,
} from '../ScorecardScreen';

// ScorecardScreen imports useFocusEffect from @react-navigation/native, whose
// published ESM isn't transformed under jest; stub it (jest hoists this above
// the import) so pulling in the screen's helper exports doesn't load the
// untransformed module.
jest.mock('@react-navigation/native', () => ({ useFocusEffect: jest.fn() }));

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

describe('resumeVerifiedUpTo', () => {
  const holes = [1, 2, 3, 4].map((number) => ({ number }));
  const players = [{ id: 'p1' }, { id: 'p2' }];

  test('a phone that entered nothing has verified nothing', () => {
    // The peer scored the front nine while this phone was closed. Those holes
    // were never walked off here, so none of them may open pre-filled.
    expect(resumeVerifiedUpTo(holes, players, {})).toBe(0);
  });

  test('counts the leading run of holes this author marked', () => {
    const mine = { p1: { 1: 4, 2: 5 }, p2: { 1: 5 } };
    expect(resumeVerifiedUpTo(holes, players, mine)).toBe(2);
  });

  test('stops at the first hole this author left unmarked', () => {
    const mine = { p1: { 1: 4, 3: 6 } };   // hole 2 skipped
    expect(resumeVerifiedUpTo(holes, players, mine)).toBe(1);
  });

  test('a fully marked card verifies the whole round', () => {
    const mine = { p1: { 1: 4, 2: 4, 3: 4, 4: 4 } };
    expect(resumeVerifiedUpTo(holes, players, mine)).toBe(4);
  });
});

describe('resumeHole', () => {
  const holes = [1, 2, 3, 4].map((number) => ({ number }));

  test('a scorer part-way through their own card resumes at the next hole', () => {
    expect(resumeHole(holes, 2)).toBe(3);
  });

  test('a fully marked card resumes on the last hole', () => {
    expect(resumeHole(holes, 4)).toBe(4);
  });

  test('a completed round opens on the last hole even for a phone that marked nothing', () => {
    expect(resumeHole(holes, 0, { complete: true })).toBe(4);
  });
});

// The one adapter every conflict surface reads: the leave-hole prompt, the
// peer-arrival prompt and the finish gate all filter these rows.
describe('buildConflictRows', () => {
  const round = { holes: [{ number: 1, par: 4 }, { number: 2, par: 5 }] };
  const players = [{ id: 'pm', name: 'Marcos' }, { id: 'pg', name: 'Guille' }];
  const disputes = [{
    hole: 2,
    rows: [{
      playerId: 'pm',
      values: [
        { scorerKey: 'me', name: 'Marcos', value: 5, ts: 100 },
        { scorerKey: 'peer', name: 'Guille', value: 4, ts: 200 },
      ],
    }],
  }];
  const cells = { pm: { 2: { shown: 5 } } };

  test('one row per disputed cell, one candidate per scorer', () => {
    const rows = buildConflictRows({ disputes, cells, round, players, names: {} });
    expect(rows).toEqual([{
      playerId: 'pm',
      hole: 2,
      par: 5,
      playerName: 'Marcos',
      currentValue: 5,
      candidates: [
        { value: 5, ts: 100, authorId: 'me', authorName: 'Marcos' },
        { value: 4, ts: 200, authorId: 'peer', authorName: 'Guille' },
      ],
      // A blank is not an opinion, so nothing is ever listed as a blank here.
      blankAuthors: [],
    }]);
  });

  test('an unnamed scorer falls back to the generic label', () => {
    const unnamed = [{ hole: 2, rows: [{ playerId: 'pm', values: [{ scorerKey: 'x', name: null, value: 4, ts: 1 }] }] }];
    const rows = buildConflictRows({ disputes: unnamed, cells, round, players, names: {} });
    expect(rows[0].candidates[0].authorName).toBe('Another phone');
  });

  test('no disputes, no rows', () => {
    expect(buildConflictRows({ disputes: [], cells, round, players, names: {} })).toEqual([]);
  });
});

