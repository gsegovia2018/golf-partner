import { collectMyRounds } from '../personalStats';
import {
  sharedRounds, headToHead, buildFriendSummary, friendVerdict,
} from '../friendStats';

// ── Fixture helpers ───────────────────────────────────────────────
// 18 holes, par 4 (par 72), strokeIndex = hole number. slope 113 / rating 72
// means a round's score differential is simply (capped gross − 72); playing
// handicap 18 puts the net-double-bogey cap at 7 a hole, clear of every
// score used below.
const HOLES = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
const PLAYING_HANDICAP = 18;

// A score map over all 18 holes whose gross total is exactly `total`.
function grossScores(total) {
  const base = Math.floor(total / 18);
  const extra = total - base * 18;
  const o = {};
  HOLES.forEach((h, j) => { o[h.number] = base + (j < extra ? 1 : 0); });
  return o;
}

// One tournament doc. Each round spec is
// { courseName?, gross?: { [playerId]: total }, scores?, pairs?, holes? }.
function mkTournament({
  id = 1, name = 'Weekend', kind, createdAt = '2026-07-01T00:00:00.000Z', players, rounds,
}) {
  return {
    id,
    name,
    ...(kind ? { kind } : {}),
    createdAt,
    players,
    rounds: rounds.map((r) => ({
      courseName: r.courseName ?? 'Pine',
      holes: r.holes ?? HOLES,
      scores: r.scores ?? Object.fromEntries(
        Object.entries(r.gross).map(([pid, total]) => [pid, grossScores(total)]),
      ),
      playerHandicaps: Object.fromEntries(players.map((p) => [p.id, PLAYING_HANDICAP])),
      playerTees: null,
      slope: 113,
      courseRating: 72,
      ...(r.pairs ? { pairs: r.pairs } : {}),
    })),
  };
}

const ME = { id: 'p1', name: 'Marcos', handicap: 18, user_id: 'u1' };
const FRIEND = { id: 'p2', name: 'Noe', handicap: 18, user_id: 'u2' };

const strict = { strictUserId: true };

// ── 1a: strict user_id resolution ─────────────────────────────────
describe('collectMyRounds strictUserId', () => {
  test('ignores the display-name fallback', () => {
    // A guest slot carrying the friend's name but no linked account.
    const tournaments = [mkTournament({
      id: 1,
      players: [{ id: 'g1', name: 'Noe' }],
      rounds: [{ gross: { g1: 90 } }],
    })];
    expect(collectMyRounds(tournaments, 'u2', 'Noe')).toHaveLength(1);
    expect(collectMyRounds(tournaments, 'u2', 'Noe', strict)).toHaveLength(0);
  });

  test('ignores the lone-player-of-a-solo-game fallback', () => {
    // The user's own solo game — the exact shape that matched a friend to 14
    // rounds they never played.
    const tournaments = [mkTournament({
      id: 2,
      kind: 'game',
      players: [ME],
      rounds: [{ gross: { p1: 90 } }],
    })];
    expect(collectMyRounds(tournaments, 'u2', null)).toHaveLength(1);
    expect(collectMyRounds(tournaments, 'u2', null, strict)).toHaveLength(0);
  });

  test('still resolves the linked account', () => {
    const tournaments = [mkTournament({
      id: 3,
      players: [ME, FRIEND],
      rounds: [{ gross: { p1: 90, p2: 86 } }],
    })];
    const rounds = collectMyRounds(tournaments, 'u2', null, strict);
    expect(rounds).toHaveLength(1);
    expect(rounds[0].playerId).toBe('p2');
  });
});

// ── 1d: sharedRounds ──────────────────────────────────────────────
describe('sharedRounds', () => {
  const bothPlayed = () => [mkTournament({
    id: 10,
    name: 'Spring Cup',
    players: [ME, FRIEND],
    rounds: [
      { courseName: 'Pine', gross: { p1: 90, p2: 86 } },
      { courseName: 'Oak', gross: { p1: 84, p2: 88 } },
    ],
  })];

  test('joins the rounds both players completed, chronologically', () => {
    const ts = bothPlayed();
    const shared = sharedRounds(
      collectMyRounds(ts, 'u1', null, strict),
      collectMyRounds(ts, 'u2', null, strict),
    );
    expect(shared.map((s) => s.key)).toEqual(['10:0', '10:1']);
    expect(shared[0]).toMatchObject({
      tournamentId: 10,
      tournamentName: 'Spring Cup',
      courseName: 'Pine',
      roundIndex: 0,
      meHoles: 18,
      themHoles: 18,
      partners: false,
    });
    // Playing handicap 18 on a par-72 course = one shot a hole, so a 5 is
    // 2 points and a 4 is 3. 90 gross (18×5) = 36; 86 gross (14×5 + 4×4) = 40.
    expect(shared[0].mePoints).toBe(36);
    expect(shared[0].themPoints).toBe(40);
  });

  test('skips a round either side has not finished', () => {
    const ts = bothPlayed();
    delete ts[0].rounds[1].scores.p2[18];
    const shared = sharedRounds(
      collectMyRounds(ts, 'u1', null, strict),
      collectMyRounds(ts, 'u2', null, strict),
    );
    expect(shared.map((s) => s.key)).toEqual(['10:0']);
  });

  test('skips rounds only one of them played', () => {
    const ts = [mkTournament({
      id: 11,
      players: [ME, FRIEND],
      rounds: [{ gross: { p1: 90, p2: 86 } }],
    }), mkTournament({
      id: 12,
      players: [ME],
      rounds: [{ gross: { p1: 88 } }],
    })];
    const shared = sharedRounds(
      collectMyRounds(ts, 'u1', null, strict),
      collectMyRounds(ts, 'u2', null, strict),
    );
    expect(shared.map((s) => s.key)).toEqual(['11:0']);
  });

  test('drops a join that lands on the same player slot', () => {
    const ts = bothPlayed();
    const mine = collectMyRounds(ts, 'u1', null, strict);
    expect(sharedRounds(mine, mine)).toEqual([]);
  });

  test('flags rounds played as partners', () => {
    const ts = [mkTournament({
      id: 13,
      players: [ME, FRIEND, { id: 'p3', user_id: 'u3' }, { id: 'p4', user_id: 'u4' }],
      rounds: [
        { gross: { p1: 90, p2: 86 }, pairs: [[{ id: 'p1' }, { id: 'p2' }], [{ id: 'p3' }, { id: 'p4' }]] },
        { gross: { p1: 90, p2: 86 }, pairs: [[{ id: 'p1' }, { id: 'p3' }], [{ id: 'p2' }, { id: 'p4' }]] },
      ],
    })];
    const shared = sharedRounds(
      collectMyRounds(ts, 'u1', null, strict),
      collectMyRounds(ts, 'u2', null, strict),
    );
    expect(shared.map((s) => s.partners)).toEqual([true, false]);
  });
});

// ── 1d: headToHead ────────────────────────────────────────────────
describe('headToHead', () => {
  const mkShared = (pairs) => pairs.map(([me, them], i) => ({
    key: `t:${i}`, mePoints: me, themPoints: them, partners: i === 0,
  }));

  test('counts wins, losses and ties on points', () => {
    const h = headToHead(mkShared([[36, 30], [28, 34], [32, 32]]));
    expect(h).toMatchObject({ n: 3, wins: 1, losses: 1, ties: 1, partnerRounds: 1 });
    expect(h.avgMe).toBe(32);
    expect(h.avgThem).toBe(32);
  });

  test('last5 keeps the five most recent results, oldest first', () => {
    const h = headToHead(mkShared([
      [40, 10], [10, 40], [20, 20], [40, 10], [40, 10], [10, 40], [40, 10],
    ]));
    expect(h.n).toBe(7);
    expect(h.last5).toEqual(['T', 'W', 'W', 'L', 'W']);
  });

  test('empty record', () => {
    expect(headToHead([])).toEqual({
      n: 0, wins: 0, losses: 0, ties: 0, avgMe: null, avgThem: null, last5: [], partnerRounds: 0,
    });
  });
});

// ── 1d: buildFriendSummary ────────────────────────────────────────
// Six rated rounds, chronological differentials [30, 10, 12, 14, 16, 18]
// (gross = 72 + differential). Courses: Pine ×3, Oak ×2, Elm ×1.
const SUMMARY_ROUNDS = [
  { courseName: 'Pine', diff: 30 },
  { courseName: 'Pine', diff: 10 },
  { courseName: 'Pine', diff: 12 },
  { courseName: 'Oak', diff: 14 },
  { courseName: 'Oak', diff: 16 },
  { courseName: 'Elm', diff: 18 },
];

function summaryFixture(specs = SUMMARY_ROUNDS) {
  const tournaments = [mkTournament({
    id: 20,
    players: [ME, FRIEND],
    rounds: specs.map((s) => ({ courseName: s.courseName, gross: { p2: 72 + s.diff } })),
  })];
  return collectMyRounds(tournaments, 'u2', null, strict);
}

describe('buildFriendSummary', () => {
  const summary = buildFriendSummary(summaryFixture());

  test('counts rounds and rated rounds', () => {
    expect(summary.roundCount).toBe(6);
    expect(summary.ratedCount).toBe(6);
    expect(summary.selected).toHaveLength(6);
  });

  test('recentDiff averages only the last n differentials', () => {
    // last 5 = 10,12,14,16,18 → 14.0 (all six would be 16.7)
    expect(summary.recentDiff).toEqual({ value: 14, count: 5 });
    // n = 3 → 14,16,18 → 16.0
    expect(buildFriendSummary(summaryFixture(), { n: 3 }).recentDiff)
      .toEqual({ value: 16, count: 3 });
  });

  test('index comes from the WHS window and gap is recentDiff − index', () => {
    // 6 differentials → lowest 2 (10, 12) averaged, minus 1.0 → 10.0
    expect(summary.index.value).toBe(10);
    expect(summary.index.move3m).toBeNull(); // no point 90+ days back
    expect(summary.gap).toBe(4);
  });

  test('bestDiff is the lowest differential of the career', () => {
    expect(summary.bestDiff).toMatchObject({ value: 10, courseName: 'Pine' });
  });

  test('bestRound reports the best points total with the handicap it was scored off', () => {
    // Fewest strokes (82 gross = 10×5 + 8×4, the differential-10 round) wins.
    expect(summary.bestRound).toMatchObject({
      points: 44, handicap: PLAYING_HANDICAP, courseName: 'Pine',
    });
  });

  test('series is the last 10 differentials, chronological', () => {
    expect(summary.series.map((p) => p.value)).toEqual([30, 10, 12, 14, 16, 18]);
    expect(summary.series[0].courseName).toBe('Pine');
  });

  test('homeCourse is the most-played course with its own average differential', () => {
    expect(summary.homeCourse).toMatchObject({
      courseName: 'Pine',
      rounds: 3,
      ratedCount: 3,
      // (30 + 10 + 12) / 3
      avgDifferential: 17.3,
    });
  });

  test('scoreMix and baseline come from the stats pipeline', () => {
    expect(summary.scoreMix.total).toBe(6 * 18);
    expect(summary.baseline).toBe(summary.stats.ranking.baseline);
    expect(summary.stats.metrics).toBeDefined();
  });

  test('form mirrors the avgDifferential form metric', () => {
    const metric = summary.stats.form.metrics.find((m) => m.key === 'avgDifferential');
    expect(summary.form.recent).toBe(metric.recent);
    expect(summary.form.history).toBe(metric.history);
    expect(summary.form.delta).toBe(metric.delta);
    expect(['hot', 'up', 'steady', 'down']).toContain(summary.form.chip);
  });

  test('survives a friend with no rounds', () => {
    const empty = buildFriendSummary([]);
    expect(empty.roundCount).toBe(0);
    expect(empty.ratedCount).toBe(0);
    expect(empty.recentDiff).toEqual({ value: null, count: 0 });
    expect(empty.index.value).toBeNull();
    expect(empty.gap).toBeNull();
    expect(empty.bestDiff).toBeNull();
    expect(empty.homeCourse).toBeNull();
  });
});

// ── 1d: friendVerdict ─────────────────────────────────────────────
function mkSummary(over = {}) {
  return {
    ratedCount: 8,
    gap: 0,
    index: { value: 12.4, move3m: null },
    form: { recent: null, history: null, delta: 0, chip: 'steady' },
    strengths: [],
    weaknesses: [],
    ...over,
  };
}

describe('friendVerdict', () => {
  test('gap band: at the index', () => {
    expect(friendVerdict(mkSummary({ gap: 0.4 }), { gender: 'male' }))
      .toBe('Playing right to the 12.4 the app rates him — and holding steady.');
  });

  test('gap band: a touch over', () => {
    expect(friendVerdict(mkSummary({ gap: 2 }), { gender: 'female' }))
      .toBe('A touch over the 12.4 the app rates her — and holding steady.');
  });

  test('gap band: well over, quoting the gap', () => {
    expect(friendVerdict(mkSummary({ gap: 4.2 }), { name: 'Noé' }))
      .toBe('Averaging 4.2 strokes over the 12.4 the app rates them — and holding steady.');
  });

  test('picks the trait with the largest absolute deviation', () => {
    const verdict = friendVerdict(mkSummary({
      strengths: [{ label: 'Par 5s', avgPoints: 3, sample: 54, deviation: 0.6 }],
      weaknesses: [{ label: 'Tee shot missing the fairway', avgPoints: 1, sample: 40, deviation: -1.2 }],
    }), { gender: 'male' });
    expect(verdict).toBe(
      'Playing right to the 12.4 the app rates him, lives and dies by the tee shot — and holding steady.',
    );
  });

  test('ignores thin samples and unmapped labels', () => {
    expect(friendVerdict(mkSummary({
      strengths: [{ label: 'Par 5s', avgPoints: 3, sample: 12, deviation: 2 }],
      weaknesses: [{ label: 'Easy holes', avgPoints: 1, sample: 90, deviation: -1.5 }],
    }), {})).toBe('Playing right to the 12.4 the app rates them — and holding steady.');
  });

  test('weak-only phrases never read as a strength', () => {
    expect(friendVerdict(mkSummary({
      strengths: [{ label: 'Par 3s', avgPoints: 3, sample: 40, deviation: 0.9 }],
    }), {})).toBe('Playing right to the 12.4 the app rates them — and holding steady.');
    expect(friendVerdict(mkSummary({
      weaknesses: [{ label: 'Par 3s', avgPoints: 1, sample: 40, deviation: -0.9 }],
    }), {})).toBe(
      'Playing right to the 12.4 the app rates them, par 3s are the leak — and holding steady.',
    );
  });

  test('form clause follows the differential delta', () => {
    const tail = (delta, gender) => friendVerdict(
      mkSummary({ form: { recent: null, history: null, delta, chip: 'steady' } }),
      { gender },
    ).split('— and ')[1];
    expect(tail(-4, 'male')).toBe('on his hottest stretch yet.');
    expect(tail(-4, 'female')).toBe('on her hottest stretch yet.');
    expect(tail(-4)).toBe('on their hottest stretch yet.');
    expect(tail(-1.5)).toBe('trending the right way.');
    expect(tail(-0.5)).toBe('holding steady.');
    expect(tail(null)).toBe('holding steady.');
    expect(tail(2)).toBe('grinding through a rough patch.');
  });

  test('returns null under three rated rounds', () => {
    expect(friendVerdict(mkSummary({ ratedCount: 2 }), {})).toBeNull();
    expect(friendVerdict(null, {})).toBeNull();
  });

  test('returns null without an index to compare against', () => {
    expect(friendVerdict(mkSummary({ gap: null, index: { value: null, move3m: null } }), {}))
      .toBeNull();
  });
});
