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
  handicap = 0, tournamentDate = '2026-05-01', slope = null, courseRating = null,
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
      // Round-level slope/rating is the legacy fallback resolveRoundTee uses
      // when a round has no per-player tee snapshot — enough to make a round
      // eligible for a WHS differential.
      ...(slope != null ? { slope, courseRating } : {}),
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

  test('breaking a round number for the first time is its own landmark', () => {
    const holes = mkHoles();
    // Four rounds of level bogey golf — 90 strokes each, never under 80.
    const today = mkMyRound({ key: 'now', holes, scores: scoresOf(holes, 4) });
    const found = buildPersonalRecords([...bogeyHistory(4), today], 'now');

    const card = byId(found, 'brokeGross');
    expect(card.title).toBe('Broke 80 for the first time');
    expect(card.subtitle).toBe('72 strokes — you had never been under 80');
  });

  test('a card with a pickup on it has no gross score to break anything with', () => {
    const holes = mkHoles();
    // 6 on a par 4 off scratch is exactly the pickup value (par + 2), so this
    // round was never holed out and its 74 strokes are not a real total.
    const today = mkMyRound({ key: 'now', holes, scores: scoresOf(holes, 4, { 12: 6 }) });

    expect(idsOf(buildPersonalRecords([...bogeyHistory(4), today], 'now')))
      .not.toContain('brokeGross');
  });

  test('the best single nine stands on its own', () => {
    const holes = mkHoles();
    // Pars out, bogeys back: 18 points on the front against a career best
    // nine of 9, but only 27 for the round.
    const scores = {};
    holes.forEach((h) => { scores[h.number] = h.number <= 9 ? 4 : 5; });
    const today = mkMyRound({ key: 'now', holes, scores });

    const card = byId(buildPersonalRecords([...bogeyHistory(4), today], 'now'), 'bestNineEver');
    expect(card.subtitle).toBe('18 points on the front — your best was 9');
  });

  test('the handicap-neutral record catches a round the points miss', () => {
    const holes = mkHoles();
    // Slope 113 makes the differential just (strokes - rating), so these are
    // easy to read: the strong old round was on a course rated 60 (diff 8),
    // today is 80 strokes on one rated 78 (diff 2) — a worse card in points,
    // a better one once the course is taken into account.
    const easy = { slope: 113, courseRating: 60 };
    const history = [
      mkMyRound({ key: 'h0', holes, scores: scoresOf(holes, 4, { 1: 3, 2: 3, 3: 3, 4: 3 }), ...easy }),
      ...Array.from({ length: 3 }, (_, i) => mkMyRound({
        key: `h${i + 1}`, holes, scores: scoresOf(holes, 5), ...easy,
      })),
    ];
    const today = mkMyRound({
      key: 'now', courseName: 'Carnoustie', holes,
      scores: scoresOf(holes, 5, { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4, 7: 4, 8: 4, 9: 4, 10: 4 }),
      slope: 113, courseRating: 78,
    });
    const found = buildPersonalRecords([...history, today], 'now');

    expect(idsOf(found)).not.toContain('bestRoundEver');
    expect(byId(found, 'bestDifferentialEver').subtitle)
      .toBe('2 differential — your best was 8');
  });

  test('the handicap-neutral record only speaks when the points record does not', () => {
    const holes = mkHoles();
    const rated = { slope: 113, courseRating: 72 };
    // History: four rounds of bogey golf, differential 18. Today is level par
    // for a differential of 0, and a career best on points too — so the
    // points card fires and the differential card stays out of its way.
    const history = Array.from({ length: 4 }, (_, i) => mkMyRound({
      key: `h${i}`, holes, scores: scoresOf(holes, 5), ...rated,
    }));
    const today = mkMyRound({ key: 'now', holes, scores: scoresOf(holes, 4), ...rated });
    const found = idsOf(buildPersonalRecords([...history, today], 'now'));

    expect(found).toContain('bestRoundEver');
    expect(found).not.toContain('bestDifferentialEver');
  });

  test('a first eagle takes over the round-local eagle card', () => {
    const holes = mkHoles();
    const today = mkMyRound({ key: 'now', holes, scores: scoresOf(holes, 5, { 8: 2 }) });

    const card = byId(buildPersonalRecords([...bogeyHistory(4), today], 'now'), 'eagle');
    expect(card.title).toBe('Your first eagle');
    // Same id as the Tier A card, higher rarity — the selector swaps one for
    // the other rather than showing two cards about the same eagle.
    expect(card.rarity).toBeGreaterThan(95);
  });

  test('the career birdie tally is credited even when it jumps a rung', () => {
    const holes = mkHoles();
    // History carries 8 birdies; three more today steps straight past 10.
    const history = bogeyHistory(4).map((r, i) => (i === 0
      ? mkMyRound({ key: 'h0', holes, scores: scoresOf(holes, 5, { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3, 7: 3, 8: 3 }) })
      : r));
    const today = mkMyRound({ key: 'now', holes, scores: scoresOf(holes, 5, { 11: 3, 12: 3, 13: 3 }) });

    const card = byId(buildPersonalRecords([...history, today], 'now'), 'birdieMilestone');
    expect(card.title).toBe('Career birdie number 10');
    expect(card.subtitle).toBe('3 today, 11 in the book');
  });

  test('a course never played before is a card of its own', () => {
    const holes = mkHoles();
    const today = mkMyRound({ key: 'now', courseName: 'Augusta', holes, scores: scoresOf(holes, 5) });

    const card = byId(buildPersonalRecords([...bogeyHistory(4), today], 'now'), 'newCourse');
    expect(card.title).toBe('First time at Augusta');
  });

  test('a hole that has blanked you here before, finally answered', () => {
    const holes = mkHoles();
    // 7 on a par 4 off scratch is worth nothing; two rounds of that on hole 7
    // make it a nemesis at this course. Today it gives up a par.
    const history = Array.from({ length: 4 }, (_, i) => mkMyRound({
      key: `h${i}`, holes, scores: scoresOf(holes, 5, i < 2 ? { 7: 7 } : {}),
    }));
    const today = mkMyRound({ key: 'now', holes, scores: scoresOf(holes, 5) });

    const card = byId(buildPersonalRecords([...history, today], 'now'), 'nemesisSlain');
    expect(card.title).toBe('Hole 7 finally paid out');
    expect(card.holes).toEqual([7]);
  });

  test('a good day at a course speaks even when it is not a record there', () => {
    const holes = mkHoles();
    // One strong round in the history (40 points, 68 strokes) keeps both
    // course records out of reach; the average is still well beaten.
    const strong = scoresOf(holes, 4, { 1: 3, 2: 3, 3: 3, 4: 3 });
    const history = [
      mkMyRound({ key: 'h0', holes, scores: strong }),
      ...bogeyHistory(3).map((r, i) => ({ ...r, key: `h${i + 1}` })),
    ];
    // 28 points off 80 strokes: above the 23.5 average, below both records.
    const today = mkMyRound({
      key: 'now', holes, scores: scoresOf(holes, 5, { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4, 7: 4, 8: 4, 9: 4, 10: 4 }),
    });
    const found = buildPersonalRecords([...history, today], 'now');

    expect(idsOf(found)).not.toContain('courseRecord');
    expect(idsOf(found)).not.toContain('bestAtCourse');
    expect(byId(found, 'aboveCourseAverage').subtitle).toContain('28 points');
  });

  test('an unknown round key yields nothing', () => {
    expect(buildPersonalRecords(bogeyHistory(4), 'missing')).toEqual([]);
    expect(buildPersonalRecords(null, 'now')).toEqual([]);
  });
});

// ── Selection ─────────────────────────────────────────────────────

// ── Tier A: the fun half ──────────────────────────────────────────

// A mixed layout — par 3s on 3/6/12/16, par 5s on 4/9/13/18 — for the
// detectors that care what kind of hole they are looking at.
function mixedHoles() {
  const pars = { 3: 3, 6: 3, 12: 3, 16: 3, 4: 5, 9: 5, 13: 5, 18: 5 };
  return mkHoles().map((h) => (pars[h.number] ? { ...h, par: pars[h.number] } : h));
}

describe('buildRoundHighlights — gross streaks', () => {
  test('a shot on every hole does not manufacture a run of pars', () => {
    const holes = mkHoles();
    // An 18-handicapper on SI 1-18 receives a shot everywhere, so bogeys are
    // net par right across the card. Gross, they are eighteen bogeys.
    const t = mkTournament({
      players: [{ id: 'p1', name: 'Ana', handicap: 18 }],
      holes,
      scores: { p1: scoresOf(holes, 5) },
    });

    expect(idsOf(buildRoundHighlights(t, 0))).not.toContain('parStreak');
  });

  test('back-to-back birdies are their own card', () => {
    const holes = mkHoles();
    const scores = scoresOf(holes, 5, { 5: 3, 6: 3, 7: 3 });
    const t = mkTournament({ players: solo, holes, scores: { p1: scores } });

    const streak = byId(buildRoundHighlights(t, 0), 'birdieStreak');
    expect(streak.title).toBe('3 birdies in a row');
    expect(streak.subtitle).toBe('Straight through holes 5-7');
  });

  test('a long run of nothing but bogeys is the bogey train', () => {
    const holes = mkHoles();
    // Bogeys on 4-8; pars elsewhere, so the run is bounded and exact.
    const scores = scoresOf(holes, 4, { 4: 5, 5: 5, 6: 5, 7: 5, 8: 5 });
    const t = mkTournament({ players: solo, holes, scores: { p1: scores } });

    const train = byId(buildRoundHighlights(t, 0), 'bogeyTrain');
    expect(train.tone).toBe('fun');
    expect(train.subtitle).toBe('5 bogeys in a row on holes 4-8, nothing else');
  });
});

describe('buildRoundHighlights — the wider set', () => {
  test('par 5s played well are a playground', () => {
    const holes = mixedHoles();
    // Birdie every par 5 (4 on a par 5), par everything else.
    const scores = {};
    holes.forEach((h) => { scores[h.number] = h.par === 5 ? h.par - 1 : h.par; });
    const t = mkTournament({ players: solo, holes, scores: { p1: scores } });

    const card = byId(buildRoundHighlights(t, 0), 'par5Playground');
    expect(card.subtitle).toBe('12 points off 4 par 5s');
  });

  test('the three hardest holes have their own card', () => {
    const holes = mkHoles();
    // SI 1-3 are holes 1-3 in this layout — birdie all three.
    const scores = scoresOf(holes, 5, { 1: 3, 2: 3, 3: 3 });
    const t = mkTournament({ players: solo, holes, scores: { p1: scores } });

    const card = byId(buildRoundHighlights(t, 0), 'clutchOnHardest');
    expect(card.subtitle).toBe('9 points across the 3 toughest holes on the card');
  });

  test('six adjacent holes of birdies is a hot stretch', () => {
    const holes = mkHoles();
    const scores = scoresOf(holes, 5, { 4: 3, 5: 3, 6: 3, 7: 3, 8: 3, 9: 3 });
    const t = mkTournament({ players: solo, holes, scores: { p1: scores } });

    const card = byId(buildRoundHighlights(t, 0), 'hotStretch');
    expect(card.title).toBe('6 holes on fire');
    expect(card.subtitle).toBe('18 points from hole 4 to 9');
  });

  test('holes won outright are counted, but only for an outright leader', () => {
    const holes = mkHoles();
    const winner = scoresOf(holes, 4, { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3 });
    const t = mkTournament({
      players: [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bo' }],
      holes,
      scores: { p1: winner, p2: scoresOf(holes, 4) },
    });

    expect(byId(buildRoundHighlights(t, 0), 'skinsKing').title).toBe('Won 5 holes outright');

    // Both players birdieing the same five holes leaves nobody outright.
    const tied = mkTournament({
      players: [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bo' }],
      holes,
      scores: { p1: winner, p2: winner },
    });
    expect(idsOf(buildRoundHighlights(tied, 0))).not.toContain('skinsKing');
  });

  test('a hole nobody scored on belongs to the whole group', () => {
    const holes = mkHoles();
    const t = mkTournament({
      players: [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bo' }],
      holes,
      scores: { p1: scoresOf(holes, 4, { 7: 7 }), p2: scoresOf(holes, 4, { 7: 8 }) },
    });

    const card = byId(buildRoundHighlights(t, 0), 'everyoneBlanked');
    expect(card.title).toBe('Hole 7 beat everyone');
    expect(card.playerId).toBeNull();
  });

  test('a round of nothing but pars is a metronome', () => {
    const holes = mkHoles();
    const t = mkTournament({ players: solo, holes, scores: { p1: scoresOf(holes, 4) } });

    const card = byId(buildRoundHighlights(t, 0), 'metronome');
    expect(card.tone).toBe('fun');
    expect(card.subtitle).toBe('2 points a hole, and barely a wobble all day');
  });

  test('pickups are counted and the holes named, never run together', () => {
    const holes = mkHoles();
    // Scratch on a par 4 picks up at 6 strokes (par + 2 + no extra shots).
    const t = mkTournament({
      players: solo, holes, scores: { p1: scoresOf(holes, 4, { 2: 6, 9: 6, 15: 6 }) },
    });

    const card = byId(buildRoundHighlights(t, 0), 'pickupKing');
    expect(card.tone).toBe('roast');
    expect(card.title).toBe('Picked up 3 times');
    expect(card.subtitle).toBe('Pocket beat putter on holes 2, 9 and 15');
  });

  test('par 3s that cost a stroke a hole are roasted, unless it is a tie', () => {
    const holes = mixedHoles();
    const par3 = (n) => holes.find((h) => h.number === n).par === 3;
    const clean = {}; const rough = {};
    holes.forEach((h) => { clean[h.number] = h.par; rough[h.number] = par3(h.number) ? 6 : h.par; });
    const t = mkTournament({
      players: [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bo' }],
      holes,
      scores: { p1: clean, p2: rough },
    });

    const card = byId(buildRoundHighlights(t, 0), 'par3Trouble');
    expect(card.playerName).toBe('Bo');
    expect(card.subtitle).toBe('6 strokes a hole across 4 of them');

    // Both equally bad: naming one of them would be a coin toss, so neither.
    const tied = mkTournament({
      players: [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bo' }],
      holes,
      scores: { p1: rough, p2: rough },
    });
    expect(idsOf(buildRoundHighlights(tied, 0))).not.toContain('par3Trouble');
  });

  test('a front nine spent early is the mirror of the back-nine charge', () => {
    const holes = mkHoles();
    const scores = {};
    holes.forEach((h) => { scores[h.number] = h.number <= 9 ? 4 : 6; });
    const t = mkTournament({ players: solo, holes, scores: { p1: scores } });

    const card = byId(buildRoundHighlights(t, 0), 'frontNineFade');
    expect(card.tone).toBe('roast');
    expect(card.subtitle).toBe('18 points on the front, 0 on the back');
  });
});

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

  test('one player cannot take every seat', () => {
    const hot = ['a', 'b', 'c', 'd'].map((id, i) => ({
      id, tone: 'great', rarity: 90 - i, title: id, subtitle: '', playerId: 'p1',
    }));
    const others = [
      { id: 'e', tone: 'good', rarity: 50, title: 'e', subtitle: '', playerId: 'p2' },
      { id: 'f', tone: 'good', rarity: 49, title: 'f', subtitle: '', playerId: 'p3' },
    ];

    const picked = selectAchievements([...hot, ...others], { limit: 4 });
    expect(picked.filter((c) => c.playerId === 'p1')).toHaveLength(2);
    expect(idsOf(picked)).toEqual(['a', 'b', 'e', 'f']);
  });

  test('group facts are about the round, so the cap does not apply to them', () => {
    const group = ['a', 'b', 'c'].map((id, i) => ({
      id, tone: 'fun', rarity: 90 - i, title: id, subtitle: '', playerId: null,
    }));

    expect(idsOf(selectAchievements(group, { limit: 3 }))).toEqual(['a', 'b', 'c']);
  });

  test('a fun card keeps a seat even when the scoring cards outrank it', () => {
    const serious = ['a', 'b', 'c'].map((id, i) => ({
      id, tone: 'great', rarity: 90 - i, title: id, subtitle: '', playerId: `p${i}`,
    }));
    const fun = { id: 'z', tone: 'fun', rarity: 10, title: 'z', subtitle: '', playerId: 'p9' };

    expect(idsOf(selectAchievements([...serious, fun], { limit: 3 }))).toEqual(['a', 'b', 'z']);
  });

  test('a single headline card is never the roast', () => {
    const picked = selectAchievements([
      { id: 'r', tone: 'roast', rarity: 99, title: 'r', subtitle: '', playerId: 'p1' },
      { id: 'g', tone: 'good', rarity: 40, title: 'g', subtitle: '', playerId: 'p2' },
    ], { limit: 1 });

    expect(idsOf(picked)).toEqual(['g']);
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

  test('a record-breaking day still leaves room for the round itself', () => {
    const holes = mkHoles();
    // Level par against a career of bogey golf sets five records at once.
    const t = mkTournament({ players: solo, holes, scores: { p1: scoresOf(holes, 4) } });
    const now = mkMyRound({ key: 'now', holes, scores: scoresOf(holes, 4) });
    const myRounds = [...bogeyHistory(4), now];

    expect(buildPersonalRecords(myRounds, 'now').length).toBeGreaterThan(3);

    const picked = buildRoundAchievements({
      tournament: t, roundIndex: 0, myRounds, roundKey: 'now',
    });
    const records = picked.filter((c) => c.playerId == null && c.tone !== 'fun');
    expect(records.length).toBeLessThanOrEqual(3);
    expect(picked.some((c) => c.playerId === 'p1')).toBe(true);
  });

  test('without history it still shows the round-local highlights', () => {
    const holes = mkHoles();
    const t = mkTournament({ players: solo, holes, scores: { p1: scoresOf(holes, 4) } });

    const picked = buildRoundAchievements({ tournament: t, roundIndex: 0 });
    expect(picked.length).toBeGreaterThan(0);
    expect(idsOf(picked)).not.toContain('bestRoundEver');
  });
});
