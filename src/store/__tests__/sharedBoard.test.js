// Same jest.mock pattern as src/store/__tests__/mediaStore.test.js — a fake
// getPublicUrl that just echoes the path into a deterministic URL, so
// buildSharedMediaModel's URL-building is verifiable without touching the
// network.
jest.mock('../../lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        getPublicUrl: (path) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
      }),
    },
  },
}));

// eslint-disable-next-line import/first
import { buildSharedBoardModel, buildSharedMediaModel } from '../sharedBoard';

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

    test('completed round: feedItem is a full FeedRoundCard item, not live', () => {
      const { feedItem } = model.rounds[0];
      expect(feedItem).toMatchObject({
        type: 'round',
        key: 'board-round:r1',
        tournamentName: 'Weekend Cup',
        roundIndex: 0,
        courseName: 'Pebble Beach',
        playerCount: 2,
        hiddenPlayerCount: null,
        teamsLabel: null,
        live: false,
        totalHoles: 2,
        scoringMode: 'stableford',
        finished: false, // round 2 is still partial
      });
      expect(feedItem.ts).toBe(Date.parse('2026-08-14T09:00:00.000Z'));
      // Leader (most points) first; every field FeedRoundCard's onHoleFor /
      // score tiles read is present, and avatarUrl is null by design (the
      // RPC never returns avatars — FeedRoundCard falls back to initials).
      expect(feedItem.results).toEqual([
        {
          playerId: 'p1', name: 'Ann Lee', avatarUrl: null, points: 4, strokes: 8,
          holes: 2, handicap: 0, vsPar: 0, vsParAllowed: 0,
        },
        {
          playerId: 'p2', name: 'Bob Ray', avatarUrl: null, points: 2, strokes: 10,
          holes: 2, handicap: 0, vsPar: 2, vsParAllowed: 0,
        },
      ]);
    });

    test('live partial round: feedItem is live, onHole-derivable (holes < totalHoles)', () => {
      const { feedItem } = model.rounds[1];
      expect(feedItem).toMatchObject({
        key: 'board-round:r2',
        courseName: 'Spyglass',
        roundIndex: 1,
        live: true,
        totalHoles: 2,
        finished: false,
      });
      expect(feedItem.ts).toBe(Date.parse('2026-08-14T09:00:00.000Z') + 1);
      // Both players are through 1 of 2 holes — FeedRoundCard's onHoleFor
      // would compute "on hole 2" for each from `holes: 1` + `live: true` +
      // `totalHoles: 2`.
      expect(feedItem.results.map((r) => ({ playerId: r.playerId, holes: r.holes }))).toEqual([
        { playerId: 'p1', holes: 1 },
        { playerId: 'p2', holes: 1 },
      ]);
      expect(feedItem.results[0]).toMatchObject({ points: 2, strokes: 4, vsPar: 0, vsParAllowed: 0 });
      expect(feedItem.results[1]).toMatchObject({ points: 1, strokes: 5, vsPar: 1, vsParAllowed: 0 });
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

    test('feedItem: one result per TEAM (keyed by captain), not per player', () => {
      const { feedItem } = model.rounds[0];
      expect(feedItem).toMatchObject({
        key: 'board-round:r1',
        tournamentName: 'Scramble Day',
        scoringMode: 'scramblepairs',
        playerCount: 4, // 2 teams x 2 members, not 2 result tiles
        hiddenPlayerCount: 0, // nothing is filtered on a public board
        teamsLabel: null, // scramble tiles ARE the teams
        totalHoles: 1,
        live: false, // the one hole is fully entered for both teams
        finished: false, // p2/p4 (non-captains) never carry a scores entry
      });
      // unit.name is scrambleUnits' first-names-joined label ("Ann & Bob"),
      // not the captain's own name — same label the team tile shows in the
      // real feed (scoring.js:730-745).
      expect(feedItem.results).toEqual([
        {
          playerId: 'p1', name: 'Ann & Bob', avatarUrl: null, points: 2, strokes: 4,
          holes: 1, handicap: 0, vsPar: 0, vsParAllowed: 0,
        },
        {
          playerId: 'p3', name: 'Cam & Dan', avatarUrl: null, points: 1, strokes: 5,
          holes: 1, handicap: 0, vsPar: 1, vsParAllowed: 0,
        },
      ]);
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
      // No players scored (none exist) -> no feed card, no throw.
      expect(model.rounds[0].feedItem).toBeNull();
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
      // Nobody has scored a hole yet -> no feed card, no throw.
      expect(model.rounds[0].feedItem).toBeNull();
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

describe('buildSharedMediaModel', () => {
  // Round ids/labels come from a real buildSharedBoardModel() output, so the
  // media model's roundIndex/roundLabel lookups are exercised against the
  // same shape the screen will actually pass in.
  const boardModel = buildSharedBoardModel({
    name: 'Weekend Cup',
    createdAt: '2026-08-14T09:00:00.000Z',
    players: [],
    rounds: [
      { id: 'r1', courseName: 'Pebble Beach', holes: [], scores: {} },
      { id: 'r2', courseName: 'Spyglass', holes: [], scores: {} },
    ],
  });

  test('groups rows by round, oldest-first, with public URLs built via getPublicUrl', () => {
    // RPC contract: newest-first overall (see 20260816010000_shared_board_media.sql).
    const rows = [
      {
        id: 'm3', roundId: 'r2', holeIndex: 1, kind: 'photo',
        storagePath: 't/r2/m3.jpg', thumbPath: 't/r2/thumbs/m3.jpg',
        durationS: null, createdAt: '2026-08-14T12:00:00.000Z',
      },
      {
        id: 'm2', roundId: 'r1', holeIndex: 0, kind: 'video',
        storagePath: 't/r1/m2.mp4', thumbPath: 't/r1/thumbs/m2.jpg',
        durationS: 12, createdAt: '2026-08-14T11:00:00.000Z',
      },
      {
        id: 'm1', roundId: 'r1', holeIndex: null, kind: 'photo',
        storagePath: 't/r1/m1.jpg', thumbPath: 't/r1/thumbs/m1.jpg',
        durationS: null, createdAt: '2026-08-14T10:00:00.000Z',
      },
    ];

    const media = buildSharedMediaModel(rows, boardModel);

    expect(media.total).toBe(3);
    expect(media.hasVideo).toBe(true);

    // r1 had m2 (newest) then m1 (oldest) in the input; byRoundId is
    // oldest-first for chronological story playback.
    expect(media.byRoundId.r1.map((it) => it.id)).toEqual(['m1', 'm2']);
    expect(media.byRoundId.r1[1]).toMatchObject({
      id: 'm2', roundId: 'r1', holeIndex: 0, kind: 'video', durationS: 12,
      url: 'https://cdn.test/t/r1/m2.mp4',
      thumbUrl: 'https://cdn.test/t/r1/thumbs/m2.jpg',
    });
    expect(media.byRoundId.r1[0]).toMatchObject({ id: 'm1', holeIndex: null, kind: 'photo' });
    expect(media.byRoundId.r2.map((it) => it.id)).toEqual(['m3']);

    // Cover is the newest item per round.
    expect(media.coverForRound.r1).toBe('https://cdn.test/t/r1/thumbs/m2.jpg');
    expect(media.coverForRound.r2).toBe('https://cdn.test/t/r2/thumbs/m3.jpg');

    // Stories ordered by round index (r1 then r2), matching RoundStoriesRail
    // / MemoriesStoriesViewer's expected fields.
    expect(media.stories).toHaveLength(2);
    expect(media.stories[0]).toMatchObject({
      roundId: 'r1', roundIndex: 0, roundLabel: boardModel.rounds[0].label,
      count: 2, countLabel: '2 memories', hasVideo: true,
    });
    expect(media.stories[0].mediaList.map((it) => it.id)).toEqual(['m1', 'm2']);
    expect(media.stories[1]).toMatchObject({
      roundId: 'r2', roundIndex: 1, roundLabel: boardModel.rounds[1].label,
      count: 1, countLabel: '1 photo', hasVideo: false,
    });
  });

  test('malformed/empty input never throws and returns a safe empty structure', () => {
    expect(buildSharedMediaModel(null, boardModel)).toEqual({
      byRoundId: {}, stories: [], coverForRound: {}, total: 0, hasVideo: false,
    });
    expect(buildSharedMediaModel(undefined, null)).toEqual({
      byRoundId: {}, stories: [], coverForRound: {}, total: 0, hasVideo: false,
    });
    expect(buildSharedMediaModel('not-an-array', undefined)).toEqual({
      byRoundId: {}, stories: [], coverForRound: {}, total: 0, hasVideo: false,
    });
  });

  test('malformed rows (missing roundId, non-objects) are skipped without throwing', () => {
    const rows = [
      {}, // no roundId
      null,
      'garbage',
      42,
      { id: 'y', roundId: 'r9' }, // no storagePath/thumbPath, unknown round
    ];

    const media = buildSharedMediaModel(rows, boardModel);

    expect(media.total).toBe(1);
    expect(media.hasVideo).toBe(false);
    expect(media.byRoundId.r9).toEqual([
      {
        id: 'y', roundId: 'r9', holeIndex: null, kind: 'photo',
        durationS: null, createdAt: null, url: null, thumbUrl: null,
      },
    ]);
    // Round unknown to the board model -> no roundIndex/label to attach.
    expect(media.stories).toEqual([
      expect.objectContaining({ roundId: 'r9', roundIndex: -1, roundLabel: '' }),
    ]);
  });
});
