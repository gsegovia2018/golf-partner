import { buildSharedBoardModel } from '../sharedBoard';

// Handicaps are pinned to 0 throughout these fixtures so Stableford points
// reduce to `2 + par - strokes` with no extra-shot noise, matching the style
// of the existing round fixtures in scoring.test.js / tournamentStore.test.js
// (e.g. `playerHandicaps: { a: 0, b: 0, c: 0, d: 0 }` in scramble.test.js).

describe('buildSharedBoardModel', () => {
  describe('two-round tournament: one completed round, one live partial round', () => {
    const players = [
      { id: 'p1', name: 'Ann Lee', handicap: 10 },
      { id: 'p2', name: 'Bob Ray', handicap: 5 },
    ];
    const holes = [
      { number: 1, par: 4, strokeIndex: 1 },
      { number: 2, par: 4, strokeIndex: 2 },
    ];
    const payload = {
      name: 'Weekend Cup',
      kind: 'casual',
      createdAt: '2026-08-14T09:00:00.000Z',
      currentRound: 1,
      players,
      rounds: [
        {
          id: 'r1',
          courseName: 'Pebble Beach',
          scoringMode: 'stableford',
          holes,
          playerHandicaps: { p1: 0, p2: 0 },
          // p1: birdie, birdie (2+4-4=2 each -> 4 pts, 8 strokes)
          // p2: bogey, bogey (2+4-5=1 each -> 2 pts, 10 strokes)
          scores: { p1: { 1: 4, 2: 4 }, p2: { 1: 5, 2: 5 } },
        },
        {
          id: 'r2',
          courseName: 'Spyglass',
          scoringMode: 'stableford',
          holes,
          playerHandicaps: { p1: 0, p2: 0 },
          // only hole 1 entered for both players; hole 2 untouched
          scores: { p1: { 1: 4 }, p2: { 1: 5 } },
        },
      ],
    };

    const model = buildSharedBoardModel(payload);

    test('top-level shape', () => {
      expect(model.tournamentName).toBe('Weekend Cup');
      expect(model.rounds).toHaveLength(2);
      expect(model.liveRoundIndex).toBe(1);
    });

    test('round labels reuse formatRoundLabel (ordinal + course)', () => {
      expect(model.rounds[0].label).toBe('Round 1 · Pebble Beach');
      expect(model.rounds[1].label).toBe('Round 2 · Spyglass');
    });

    test('only the current, unfinished round is live', () => {
      expect(model.rounds[0].isLive).toBe(false);
      expect(model.rounds[1].isLive).toBe(true);
    });

    test('completed round: full leaderboard entries in points order', () => {
      const { entries } = model.rounds[0].leaderboard;
      expect(entries.map((e) => e.player.id)).toEqual(['p1', 'p2']);
      expect(entries[0]).toMatchObject({ points: 4, strokes: 8, place: 1, isTie: false });
      expect(entries[1]).toMatchObject({ points: 2, strokes: 10, place: 2, isTie: false });
      expect(model.rounds[0].holesPlayed).toBe(2);
      expect(model.rounds[0].thru).toBe(2);
    });

    test('live round: partial leaderboard entries and thru count', () => {
      const { entries } = model.rounds[1].leaderboard;
      expect(entries.map((e) => e.player.id)).toEqual(['p1', 'p2']);
      expect(entries[0]).toMatchObject({ points: 2, strokes: 4, place: 1 });
      expect(entries[1]).toMatchObject({ points: 1, strokes: 5, place: 2 });
      expect(model.rounds[1].holesPlayed).toBe(2);
      expect(model.rounds[1].thru).toBe(1); // hole 1 fully entered, hole 2 not
    });

    test('overall standings sum across both rounds, including the live one', () => {
      expect(model.overall.map((e) => e.player.id)).toEqual(['p1', 'p2']);
      expect(model.overall[0]).toMatchObject({ points: 6, strokes: 12, place: 1 });
      expect(model.overall[1]).toMatchObject({ points: 3, strokes: 15, place: 2 });
    });
  });

  describe('scramble round: team score lives under the captain', () => {
    const players = [
      { id: 'p1', name: 'Ann Lee', handicap: 0 },
      { id: 'p2', name: 'Bob Ray', handicap: 0 },
      { id: 'p3', name: 'Cam Fox', handicap: 0 },
      { id: 'p4', name: 'Dan Oak', handicap: 0 },
    ];
    const payload = {
      name: 'Scramble Day',
      kind: 'casual',
      createdAt: '2026-08-15T09:00:00.000Z',
      currentRound: 0,
      players,
      rounds: [
        {
          id: 'r1',
          courseName: 'Links',
          scoringMode: 'scramblepairs',
          holes: [{ number: 1, par: 4, strokeIndex: 1 }],
          pairs: [[players[0], players[1]], [players[2], players[3]]],
          playerHandicaps: { p1: 0, p2: 0, p3: 0, p4: 0 },
          // team p1/p2 (captain p1) birdies; team p3/p4 (captain p3) bogeys.
          // Only the captains carry score keys — teammates never do.
          scores: { p1: { 1: 4 }, p3: { 1: 5 } },
        },
      ],
    };

    const model = buildSharedBoardModel(payload);

    test('round leaderboard has one entry per player, each teammate crediting the team result', () => {
      const { entries } = model.rounds[0].leaderboard;
      expect(entries).toHaveLength(4);
      expect(entries.every((e) => Number.isFinite(e.points) && Number.isFinite(e.strokes))).toBe(true);
      const byId = Object.fromEntries(entries.map((e) => [e.player.id, e]));
      expect(byId.p1).toMatchObject({ points: 2, strokes: 4 });
      expect(byId.p2).toMatchObject({ points: 2, strokes: 4 });
      expect(byId.p3).toMatchObject({ points: 1, strokes: 5 });
      expect(byId.p4).toMatchObject({ points: 1, strokes: 5 });
      // Teammates tie with each other, not across teams.
      expect(byId.p1.isTie).toBe(true);
      expect(byId.p2.isTie).toBe(true);
    });

    test('overall standings credit each teammate the team result, no per-player garbage', () => {
      expect(model.overall).toHaveLength(4);
      const byId = Object.fromEntries(model.overall.map((e) => [e.player.id, e]));
      expect(byId.p1).toMatchObject({ points: 2, strokes: 4 });
      expect(byId.p3).toMatchObject({ points: 1, strokes: 5 });
      expect(model.overall.every((e) => Number.isFinite(e.points))).toBe(true);
    });
  });

  describe('malformed payloads', () => {
    test('falsy payloads return null', () => {
      expect(buildSharedBoardModel(null)).toBeNull();
      expect(buildSharedBoardModel(undefined)).toBeNull();
      expect(buildSharedBoardModel(0)).toBeNull();
      expect(buildSharedBoardModel('')).toBeNull();
    });

    test('empty object returns a safe empty structure, not a throw', () => {
      const model = buildSharedBoardModel({});
      expect(model).toEqual({
        tournamentName: '',
        rounds: [],
        overall: [],
        liveRoundIndex: null,
      });
    });

    test('missing players tolerated: empty leaderboards, no throw', () => {
      const model = buildSharedBoardModel({
        name: 'No Roster',
        rounds: [{ id: 'r1', holes: [{ number: 1, par: 4, strokeIndex: 1 }], scores: {} }],
      });
      expect(model.rounds).toHaveLength(1);
      expect(model.rounds[0].leaderboard.entries).toEqual([]);
      expect(model.rounds[0].holesPlayed).toBe(1);
      expect(model.rounds[0].thru).toBe(0);
      expect(model.overall).toEqual([]);
    });

    test('empty scores tolerated: zeroed entries, no throw', () => {
      const model = buildSharedBoardModel({
        name: 'Not Started',
        players: [{ id: 'p1', name: 'Ann Lee', handicap: 0 }],
        rounds: [{
          id: 'r1',
          scoringMode: 'stableford',
          holes: [{ number: 1, par: 4, strokeIndex: 1 }],
          playerHandicaps: { p1: 0 },
          scores: {},
        }],
      });
      expect(model.rounds[0].leaderboard.entries).toEqual([
        expect.objectContaining({ player: { id: 'p1', name: 'Ann Lee', handicap: 0 }, points: 0, strokes: 0 }),
      ]);
      expect(model.rounds[0].thru).toBe(0);
    });

    test('missing rounds array tolerated', () => {
      const model = buildSharedBoardModel({ name: 'No Rounds', players: [{ id: 'p1', name: 'Ann' }] });
      expect(model.rounds).toEqual([]);
      // The overall board still lists the roster (0 pts/0 strokes each) even
      // with no rounds — matches tournamentLeaderboard's existing behavior of
      // seeding one zeroed row per player regardless of rounds played.
      expect(model.overall).toEqual([
        expect.objectContaining({ player: { id: 'p1', name: 'Ann' }, points: 0, strokes: 0 }),
      ]);
      expect(model.liveRoundIndex).toBeNull();
    });
  });
});
