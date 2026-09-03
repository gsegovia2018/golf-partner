import {
  buildRoundHighlights, buildPersonalRecords, selectAchievements,
  buildRoundAchievements,
} from '../roundAchievements';

// ── Fixture helpers ───────────────────────────────────────────────
// Par-4 layout, strokeIndex = hole number (so SI 1-18 on a full round).
function mkHoles(n = 18, par = 4) {
  return Array.from({ length: n }, (_, i) => ({ number: i + 1, par, strokeIndex: i + 1 }));
}

// Every hole = `strokes`, with `overrides` keyed by hole number on top.
function scoresOf(holes, strokes, overrides = {}) {
  const o = {};
  holes.forEach((h) => { o[h.number] = overrides[h.number] ?? strokes; });
  return o;
}

// A raw tournament — the shape RoundSummaryScreen already holds in memory.
// Handicaps are stored per round (playerHandicaps), so every fixture below
// plays off scratch unless it says otherwise.
function mkTournament({ players, holes = mkHoles(), scores, pairs = null, scoringMode }) {
  const playerHandicaps = {};
  players.forEach((p) => { playerHandicaps[p.id] = p.handicap ?? 0; });
  return {
    id: 't1',
    name: 'Cup',
    players,
    rounds: [{
      id: 'r1', courseName: 'Pine Valley', holes, scores, pairs,
      playerHandicaps, scoringMode,
    }],
  };
}

const solo = [{ id: 'p1', name: 'Ana', handicap: 0 }];

function idsOf(list) {
  return list.map((c) => c.id);
}
function byId(list, id) {
  return list.find((c) => c.id === id);
}

// ── Tier A: round-local highlights ────────────────────────────────

describe('buildRoundHighlights', () => {
  test('reports the longest par-or-better run with the holes it covers', () => {
    const holes = mkHoles();
    // Bogeys everywhere except a clean run on holes 6-9.
    const scores = scoresOf(holes, 5, { 6: 4, 7: 4, 8: 4, 9: 4 });
    const t = mkTournament({ players: solo, holes, scores: { p1: scores } });

    const streak = byId(buildRoundHighlights(t, 0), 'parStreak');
    expect(streak.title).toBe('4 in a row');
    expect(streak.holes).toEqual([6, 7, 8, 9]);
    expect(streak.playerName).toBe('Ana');
  });

  test('a run of two is below the floor and never fires', () => {
    const holes = mkHoles();
    const scores = scoresOf(holes, 5, { 6: 4, 7: 4 });
    const t = mkTournament({ players: solo, holes, scores: { p1: scores } });

    expect(idsOf(buildRoundHighlights(t, 0))).not.toContain('parStreak');
  });

  test('surfaces eagles and birdies with their holes', () => {
    const holes = mkHoles();
    const scores = scoresOf(holes, 5, { 3: 2, 11: 3, 14: 3 });
    const t = mkTournament({ players: solo, holes, scores: { p1: scores } });
    const found = buildRoundHighlights(t, 0);

    expect(byId(found, 'eagle').holes).toEqual([3]);
    expect(byId(found, 'birdies').title).toBe('2 birdies');
    // Scattered holes must never be phrased as a span — "holes 11-14" would
    // claim a clean run across 12 and 13, which were bogeys.
    expect(byId(found, 'birdies').subtitle).toBe('On holes 11 and 14');
    // An eagle must outrank a birdie haul.
    expect(byId(found, 'eagle').rarity).toBeGreaterThan(byId(found, 'birdies').rarity);
  });

  test('a long scattered list is truncated, never run together', () => {
    const holes = mkHoles();
    const scores = scoresOf(holes, 5, { 2: 3, 6: 3, 9: 3, 13: 3, 17: 3 });
    const t = mkTournament({ players: solo, holes, scores: { p1: scores } });

    expect(byId(buildRoundHighlights(t, 0), 'birdies').subtitle)
      .toBe('On holes 2, 6, 9 and 2 more');
  });

  test('eagles and birdies are gross, so a handicap cannot manufacture one', () => {
    const holes = mkHoles();
    // 18 handicap = a shot a hole, so every par is a NET birdie — but none of
    // them is a birdie, and the card must not claim eighteen of them.
    const players = [{ id: 'p1', name: 'Ana', handicap: 18 }];
    const t = mkTournament({ players, holes, scores: { p1: scoresOf(holes, 4) } });

    expect(idsOf(buildRoundHighlights(t, 0))).not.toContain('birdies');
  });

  test('a blow-up is tagged as a roast, not a celebration', () => {
    const holes = mkHoles();
    const scores = scoresOf(holes, 4, { 12: 8 });
    const t = mkTournament({ players: solo, holes, scores: { p1: scores } });

    const blowUp = byId(buildRoundHighlights(t, 0), 'blowUp');
    expect(blowUp.tone).toBe('roast');
    expect(blowUp.title).toBe('Hole 12 happened');
    expect(blowUp.holes).toEqual([12]);
  });

  test('handicap shots rescue a hole before it counts as a blow-up', () => {
    const holes = mkHoles();
    // 18 handicap = one shot on every hole, so a 7 on a par 4 is net +2.
    const players = [{ id: 'p1', name: 'Ana', handicap: 18 }];
    const t = mkTournament({
      players, holes, scores: { p1: scoresOf(holes, 5, { 12: 7 }) },
    });

    expect(idsOf(buildRoundHighlights(t, 0))).not.toContain('blowUp');
  });

  test('playing to handicap fires at 36 points and reports the surplus', () => {
    const holes = mkHoles();
    // Level par off scratch = 2 points a hole = exactly 36.
    const level = mkTournament({ players: solo, holes, scores: { p1: scoresOf(holes, 4) } });
    expect(byId(buildRoundHighlights(level, 0), 'playedToHandicap').title)
      .toBe('Played to handicap');

    // Three birdies on top = 39.
    const under = mkTournament({
      players: solo, holes, scores: { p1: scoresOf(holes, 4, { 2: 3, 5: 3, 9: 3 }) },
    });
    expect(byId(buildRoundHighlights(under, 0), 'playedToHandicap').title)
      .toBe('Beat handicap by 3');
  });

  test('an unfinished round makes no whole-round handicap claim', () => {
    const holes = mkHoles();
    const scores = scoresOf(holes, 4);
    delete scores[18];
    const t = mkTournament({ players: solo, holes, scores: { p1: scores } });

    expect(idsOf(buildRoundHighlights(t, 0))).not.toContain('playedToHandicap');
  });

  test('finds the hole that split the group', () => {
    const holes = mkHoles();
    // A pickup (>= par + 2 + shots received) carries no real stroke count, so
    // chaosHoles ignores it — Bea's 6 only counts because her 18 handicap puts
    // her pickup threshold on this par 4 at 7.
    const players = [
      { id: 'p1', name: 'Ana', handicap: 0 },
      { id: 'p2', name: 'Bea', handicap: 18 },
    ];
    const t = mkTournament({
      players,
      holes,
      scores: {
        p1: scoresOf(holes, 4, { 7: 3 }),
        p2: scoresOf(holes, 5, { 7: 6 }),
      },
    });

    const chaos = byId(buildRoundHighlights(t, 0), 'chaosHole');
    expect(chaos.title).toBe('Hole 7 split the group');
    expect(chaos.tone).toBe('fun');
    expect(chaos.holes).toEqual([7]);
  });

  test('names who carried the pair', () => {
    const holes = mkHoles();
    const players = [
      { id: 'p1', name: 'Ana', handicap: 0 },
      { id: 'p2', name: 'Bea', handicap: 0 },
    ];
    const t = mkTournament({
      players,
      holes,
      // Ana pars out (36 pts); Bea triples every hole (0 pts).
      scores: { p1: scoresOf(holes, 4), p2: scoresOf(holes, 7) },
      pairs: [[{ id: 'p1' }, { id: 'p2' }]],
    });

    const carry = byId(buildRoundHighlights(t, 0), 'carriedThePair');
    expect(carry.title).toBe('Carried the pair');
    expect(carry.playerName).toBe('Ana');
    expect(carry.subtitle).toBe("100% of the team's points");
  });

  test('a back-nine charge reads out both nines', () => {
    const holes = mkHoles();
    // Bogeys out (9 pts), pars home (18 pts).
    const scores = {};
    holes.forEach((h) => { scores[h.number] = h.number <= 9 ? 5 : 4; });
    const t = mkTournament({ players: solo, holes, scores: { p1: scores } });

    const charge = byId(buildRoundHighlights(t, 0), 'backNineCharge');
    expect(charge.subtitle).toBe('9 points out, 18 points back');
  });

  test('scramble rounds carry a team ball, so claim nothing per player', () => {
    const holes = mkHoles();
    const t = mkTournament({
      players: solo, holes, scores: { p1: scoresOf(holes, 4) },
      scoringMode: 'scramblepairs',
    });

    expect(buildRoundHighlights(t, 0)).toEqual([]);
  });

  test('a round with no scores yields nothing', () => {
    const t = mkTournament({ players: solo, scores: {} });
    expect(buildRoundHighlights(t, 0)).toEqual([]);
    expect(buildRoundHighlights(t, 7)).toEqual([]);
  });
});

// ── Tier B: personal records ──────────────────────────────────────

// A MyRound record, matching collectMyRounds output. isComplete/holesPlayed
// are derived from `scores` exactly as collectMyRounds derives them.
function mkMyRound({
  key, courseName = 'Pine Valley', holes = mkHoles(), scores,
  handicap = 0, tournamentDate = '2026-05-01',
}) {
  const isComplete = holes.length > 0 && holes.every((h) => scores[h.number] != null);
  return {
    key,
    courseName,
    tournamentName: 'Cup',
    tournamentDate,
    tournamentId: key,
    roundIndex: 0,
    playerId: 'p1',
    player: { id: 'p1', name: 'Ana', handicap, user_id: 'u1' },
    round: {
      id: key, courseName, holes,
      scores: { p1: scores },
      playerHandicaps: { p1: handicap },
    },
    completed: true,
    isComplete,
    holesPlayed: holes.filter((h) => scores[h.number] != null).length,
    points: 0,
  };
}

// `n` prior rounds of level bogey golf (18 points each) at Pine Valley.
function bogeyHistory(n, { courseName = 'Pine Valley' } = {}) {
  const holes = mkHoles();
  return Array.from({ length: n }, (_, i) => mkMyRound({
    key: `h${i}`, courseName, holes, scores: scoresOf(holes, 5),
  }));
}

describe('buildPersonalRecords', () => {
  test('a level-par round beats a career of bogey golf', () => {
    const holes = mkHoles();
    const now = mkMyRound({ key: 'now', holes, scores: scoresOf(holes, 4) });
    const found = buildPersonalRecords([...bogeyHistory(4), now], 'now');

    const best = byId(found, 'bestRoundEver');
    expect(best.title).toBe('Best round ever');
    expect(best.subtitle).toContain('36 points');
    expect(best.subtitle).toContain('18');
  });

  test('two rounds of history is too thin for an "ever" claim', () => {
    const holes = mkHoles();
    const now = mkMyRound({ key: 'now', holes, scores: scoresOf(holes, 4) });
    const found = buildPersonalRecords([...bogeyHistory(2), now], 'now');

    expect(idsOf(found)).not.toContain('bestRoundEver');
  });

  test('an unfinished round is never a personal best', () => {
    const holes = mkHoles();
    const scores = scoresOf(holes, 3);
    delete scores[18];
    const now = mkMyRound({ key: 'now', holes, scores });

    expect(buildPersonalRecords([...bogeyHistory(4), now], 'now')).toEqual([]);
  });

  test('a course record reads out the gross strokes it beat', () => {
    const holes = mkHoles();
    // History: 90 strokes a round at Pine Valley. Now: 72.
    const now = mkMyRound({ key: 'now', holes, scores: scoresOf(holes, 4) });
    const found = buildPersonalRecords([...bogeyHistory(4), now], 'now');

    const record = byId(found, 'courseRecord');
    expect(record.title).toBe('Course record at Pine Valley');
    expect(record.subtitle).toBe('72 strokes — your best here was 90');
  });

  test('a first visit to a course claims no course record', () => {
    const holes = mkHoles();
    const now = mkMyRound({
      key: 'now', courseName: 'Valderrama', holes, scores: scoresOf(holes, 4),
    });
    const found = buildPersonalRecords([...bogeyHistory(4), now], 'now');

    expect(idsOf(found)).not.toContain('courseRecord');
    // The career record still stands — it is not course-scoped.
    expect(idsOf(found)).toContain('bestRoundEver');
  });

  test('a 9-hole round never beats an 18-hole stroke record', () => {
    const nine = mkHoles(9);
    const now = mkMyRound({ key: 'now', holes: nine, scores: scoresOf(nine, 4) });
    const found = buildPersonalRecords([...bogeyHistory(4), now], 'now');

    expect(idsOf(found)).not.toContain('courseRecord');
    expect(idsOf(found)).not.toContain('bestRoundEver');
  });

  test('marks the tenth round', () => {
    const holes = mkHoles();
    const now = mkMyRound({ key: 'now', holes, scores: scoresOf(holes, 5) });
    const found = buildPersonalRecords([...bogeyHistory(9), now], 'now');

    expect(byId(found, 'roundMilestone').title).toBe('Your 10th round');
  });

  test('an unknown round key yields nothing', () => {
    expect(buildPersonalRecords(bogeyHistory(4), 'missing')).toEqual([]);
    expect(buildPersonalRecords(null, 'now')).toEqual([]);
  });
});

// ── Selection ─────────────────────────────────────────────────────

describe('selectAchievements', () => {
  const mk = (id, tone, rarity) => ({ id, tone, rarity, title: id, subtitle: '' });

  test('keeps only the strongest instance of each detector', () => {
    const picked = selectAchievements([
      mk('parStreak', 'great', 48),
      mk('parStreak', 'great', 72),
      mk('birdies', 'great', 50),
    ]);

    expect(picked).toHaveLength(2);
    expect(byId(picked, 'parStreak').rarity).toBe(72);
  });

  test('ranks by rarity and caps at the limit', () => {
    const picked = selectAchievements([
      mk('a', 'great', 10), mk('b', 'great', 90),
      mk('c', 'great', 50), mk('d', 'great', 70),
    ], { limit: 2 });

    expect(idsOf(picked)).toEqual(['b', 'd']);
  });

  test('admits one roast, and never as the leading card', () => {
    const picked = selectAchievements([
      mk('blowUp', 'roast', 99), mk('chaosHole', 'roast', 98),
      mk('a', 'great', 10), mk('b', 'great', 20),
    ], { limit: 3 });

    expect(picked.filter((c) => c.tone === 'roast')).toHaveLength(1);
    expect(picked[0].tone).not.toBe('roast');
  });

  test('a round with nothing good in it still shows its roast', () => {
    const picked = selectAchievements([mk('blowUp', 'roast', 33)], { limit: 4 });
    expect(idsOf(picked)).toEqual(['blowUp']);
  });

  test('nothing to say is an empty strip, not a crash', () => {
    expect(selectAchievements([])).toEqual([]);
    expect(selectAchievements(null)).toEqual([]);
  });
});

describe('buildRoundAchievements', () => {
  test('merges records with highlights, records leading', () => {
    const holes = mkHoles();
    const t = mkTournament({ players: solo, holes, scores: { p1: scoresOf(holes, 4) } });
    const now = mkMyRound({ key: 'now', holes, scores: scoresOf(holes, 4) });

    const picked = buildRoundAchievements({
      tournament: t,
      roundIndex: 0,
      myRounds: [...bogeyHistory(4), now],
      roundKey: 'now',
    });

    expect(picked[0].id).toBe('bestRoundEver');
    expect(idsOf(picked)).toContain('parStreak');
  });

  test('without history it still shows the round-local highlights', () => {
    const holes = mkHoles();
    const t = mkTournament({ players: solo, holes, scores: { p1: scoresOf(holes, 4) } });

    const picked = buildRoundAchievements({ tournament: t, roundIndex: 0 });
    expect(picked.length).toBeGreaterThan(0);
    expect(idsOf(picked)).not.toContain('bestRoundEver');
  });
});
