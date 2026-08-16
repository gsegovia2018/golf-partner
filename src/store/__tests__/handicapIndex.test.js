import {
  roundDifferential, computeHandicapIndex, roundEligibility, handicapIndexSeries,
  nextRoundOutlook, monthlyIndexSeries,
} from '../handicapIndex';

// 18 identical holes: par 4, SI = hole number. Total par 72.
const holes = Array.from({ length: 18 }, (_, i) => ({
  number: i + 1, par: 4, strokeIndex: i + 1,
}));

// Every hole scored `gross`; playerTees carries slope/rating; playerHandicaps
// stores the playing handicap so getPlayingHandicap reads it directly.
function makeMyRound({ gross = 5, slope = 113, rating = 72, playingHandicap = 18, scores } = {}) {
  const scoreMap = scores
    ?? Object.fromEntries(holes.map((h) => [h.number, gross]));
  return {
    key: 't1:0',
    courseName: 'Test Course',
    tournamentDate: '2026-07-01T00:00:00Z',
    playerId: 'p1',
    player: { id: 'p1', handicap: playingHandicap },
    isComplete: true,
    round: {
      holes,
      scores: { p1: scoreMap },
      playerTees: { p1: { slope, rating } },
      playerHandicaps: { p1: playingHandicap },
    },
  };
}

describe('roundDifferential', () => {
  it('computes (113/slope) × (AGS − rating) to one decimal', () => {
    // 18 bogeys = 90 gross, hcp 18 → net double bogey cap is par+2+1=7,
    // no hole capped. Differential = (113/113) × (90 − 72) = 18.0
    const d = roundDifferential(makeMyRound({ gross: 5 }));
    expect(d).toMatchObject({ differential: 18, ags: 90, slope: 113, rating: 72 });
  });

  it('applies the slope factor', () => {
    // (113/126) × (90 − 70.5) = 17.488… → 17.5
    const d = roundDifferential(makeMyRound({ gross: 5, slope: 126, rating: 70.5 }));
    expect(d.differential).toBe(17.5);
  });

  it('caps holes at net double bogey', () => {
    // hcp 18 → 1 extra shot per hole → cap 4+2+1 = 7. A 10 counts as 7.
    const scores = Object.fromEntries(holes.map((h) => [h.number, h.number === 1 ? 10 : 5]));
    const d = roundDifferential(makeMyRound({ scores }));
    expect(d.ags).toBe(17 * 5 + 7); // 92
  });

  it('respects plus-handicap stroke giving in the cap', () => {
    // hcp -2 → gives a stroke back on the two easiest holes (SI 17, 18):
    // cap there is par+2−1 = 5, elsewhere par+2 = 6.
    const scores = Object.fromEntries(holes.map((h) => [h.number, 9]));
    const d = roundDifferential(makeMyRound({ scores, playingHandicap: -2 }));
    expect(d.ags).toBe(16 * 6 + 2 * 5); // 106
  });

  it('returns null for incomplete rounds', () => {
    const r = makeMyRound();
    r.isComplete = false;
    expect(roundDifferential(r)).toBeNull();
  });

  it('returns null for non-18-hole rounds', () => {
    const r = makeMyRound();
    r.round = { ...r.round, holes: holes.slice(0, 9) };
    expect(roundDifferential(r)).toBeNull();
  });

  it('returns null when slope or rating is missing', () => {
    expect(roundDifferential(makeMyRound({ slope: null, rating: 72 }))).toBeNull();
    expect(roundDifferential(makeMyRound({ slope: 113, rating: null }))).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(roundDifferential(null)).toBeNull();
    expect(roundDifferential(undefined)).toBeNull();
  });
});

// N complete rounds whose differentials are exactly the `diffs` values:
// slope 113, rating 72, par-72 course → differential = gross − 72.
// Playing handicap 54 keeps net double bogey caps out of the way.
function makeRounds(diffs) {
  return diffs.map((d, i) => {
    const r = makeMyRound({ playingHandicap: 54 });
    r.key = `t:${i}`;
    const total = 72 + d;
    const base = Math.floor(total / 18);
    const extra = total - base * 18; // first `extra` holes get one more stroke
    r.round.scores.p1 = Object.fromEntries(
      holes.map((h, j) => [h.number, base + (j < extra ? 1 : 0)]),
    );
    return r;
  });
}

describe('computeHandicapIndex', () => {
  it('returns null index with fewer than 3 eligible rounds', () => {
    const res = computeHandicapIndex(makeRounds([10, 12]));
    expect(res.index).toBeNull();
    expect(res.eligibleCount).toBe(2);
    expect(res.windowCount).toBe(2);
  });

  it('3 rounds: lowest 1 minus 2.0', () => {
    const res = computeHandicapIndex(makeRounds([10, 14, 12]));
    expect(res.index).toBe(8);         // 10 − 2
    expect(res.usedCount).toBe(1);
    expect(res.differentials.filter((d) => d.counting)).toHaveLength(1);
    expect(res.differentials.find((d) => d.counting).differential).toBe(10);
  });

  it('4 rounds: lowest 1 minus 1.0', () => {
    expect(computeHandicapIndex(makeRounds([10, 14, 12, 16])).index).toBe(9);
  });

  it('5 rounds: lowest 1, no adjustment', () => {
    expect(computeHandicapIndex(makeRounds([10, 14, 12, 16, 18])).index).toBe(10);
  });

  it('6 rounds: average of lowest 2 minus 1.0', () => {
    // lowest two: 10, 12 → avg 11 → 10.0
    expect(computeHandicapIndex(makeRounds([10, 14, 12, 16, 18, 20])).index).toBe(10);
  });

  it('8 rounds: average of lowest 2', () => {
    expect(computeHandicapIndex(makeRounds([10, 14, 12, 16, 18, 20, 22, 24])).index).toBe(11);
  });

  it('20 rounds: average of lowest 8, only last 20 count', () => {
    // 21 rounds: the first (differential 1) falls outside the window.
    // Window = 20 rounds with diffs 2..21 → lowest 8 = 2..9 → avg 5.5
    const res = computeHandicapIndex(makeRounds([1, ...Array.from({ length: 20 }, (_, i) => i + 2)]));
    expect(res.index).toBe(5.5);
    expect(res.usedCount).toBe(8);
    expect(res.windowCount).toBe(20);
    expect(res.eligibleCount).toBe(21);
    expect(res.differentials).toHaveLength(20);
  });

  it('caps the index at 54', () => {
    const res = computeHandicapIndex(makeRounds([60, 61, 62, 63, 64]));
    expect(res.index).toBe(54);
  });

  it('skips ineligible rounds but keeps eligible ones', () => {
    const rounds = makeRounds([10, 12, 14, 16]);
    rounds[1].isComplete = false; // drops the 12
    const res = computeHandicapIndex(rounds);
    expect(res.eligibleCount).toBe(3);
    expect(res.index).toBe(8);   // 3-round rule: lowest (10) − 2
    expect(res.totalCount).toBe(4);
  });

  it('handles empty/null input', () => {
    expect(computeHandicapIndex([]).index).toBeNull();
    expect(computeHandicapIndex(null).index).toBeNull();
  });
});

describe('roundEligibility', () => {
  it('flags partial rounds', () => {
    const r = makeMyRound();
    r.isComplete = false;
    r.holesPlayed = 14;
    expect(roundEligibility(r)).toEqual({ eligible: false, reason: 'partial' });
  });

  it('flags non-18-hole rounds', () => {
    const r = makeMyRound();
    r.round = { ...r.round, holes: holes.slice(0, 9) };
    expect(roundEligibility(r)).toEqual({ eligible: false, reason: 'nine-holes' });
  });

  it('flags missing slope/rating', () => {
    expect(roundEligibility(makeMyRound({ slope: null, rating: 72 })))
      .toEqual({ eligible: false, reason: 'no-rating' });
    expect(roundEligibility(makeMyRound({ slope: 113, rating: null })))
      .toEqual({ eligible: false, reason: 'no-rating' });
  });

  it('accepts a qualifying round', () => {
    expect(roundEligibility(makeMyRound())).toEqual({ eligible: true });
  });
});

describe('computeHandicapIndex with exclusions', () => {
  it('excluding a windowed round pulls the 21st back into the window', () => {
    // 21 rounds, diffs 1..21. Without exclusions: window 2..21, best 8 = 2..9 → 5.5.
    // Excluding diff 2 (key t:1): included = 20 diffs [1,3..21] → window = all,
    // best 8 = 1,3,4,5,6,7,8,9 → 43/8 = 5.375 → 5.4.
    const rounds = makeRounds(Array.from({ length: 21 }, (_, i) => i + 1));
    const res = computeHandicapIndex(rounds, { excludedKeys: new Set(['t:1']) });
    expect(res.index).toBe(5.4);
    expect(res.windowCount).toBe(20);
    expect(res.excludedCount).toBe(1);
    expect(res.excluded).toHaveLength(1);
    expect(res.excluded[0]).toMatchObject({ key: 't:1', differential: 2 });
    expect(res.eligibleCount).toBe(21); // includes the excluded one
    expect(res.differentials.some((d) => d.key === 't:1')).toBe(false);
  });

  it('drops below the minimum when exclusions leave fewer than 3 rounds', () => {
    const rounds = makeRounds([10, 12, 14]);
    const res = computeHandicapIndex(rounds, { excludedKeys: new Set(['t:0']) });
    expect(res.index).toBeNull();
    expect(res.windowCount).toBe(2);
    expect(res.excluded).toHaveLength(1);
  });

  it('reports ineligible rounds with reasons', () => {
    const rounds = makeRounds([10, 12, 14]);
    const partial = makeMyRound();
    partial.key = 'p:0';
    partial.isComplete = false;
    partial.holesPlayed = 14;
    const res = computeHandicapIndex([...rounds, partial]);
    expect(res.ineligible).toHaveLength(1);
    expect(res.ineligible[0]).toMatchObject({ key: 'p:0', reason: 'partial', holesPlayed: 14 });
    expect(res.totalCount).toBe(4);
    expect(res.eligibleCount).toBe(3);
  });

  it('an excluded ineligible round appears only in ineligible', () => {
    const partial = makeMyRound();
    partial.key = 'p:0';
    partial.isComplete = false;
    const res = computeHandicapIndex([partial], { excludedKeys: new Set(['p:0']) });
    expect(res.ineligible).toHaveLength(1);
    expect(res.excluded).toHaveLength(0);
    expect(res.excludedCount).toBe(0);
  });

  it('no second argument behaves as before with empty new fields', () => {
    const res = computeHandicapIndex(makeRounds([10, 14, 12]));
    expect(res.index).toBe(8);
    expect(res.excluded).toEqual([]);
    expect(res.ineligible).toEqual([]);
    expect(res.excludedCount).toBe(0);
  });
});

describe('handicapIndexSeries', () => {
  it('starts at the 3rd qualifying round and applies small-sample adjustments', () => {
    // diffs [10, 14, 12, 16, 18]:
    //   after 3 rounds: lowest (10) − 2 = 8
    //   after 4 rounds: lowest (10) − 1 = 9
    //   after 5 rounds: lowest (10)     = 10
    const series = handicapIndexSeries(makeRounds([10, 14, 12, 16, 18]));
    expect(series.map((p) => p.value)).toEqual([8, 9, 10]);
    expect(series.map((p) => p.key)).toEqual(['t:2', 't:3', 't:4']);
    expect(series[0]).toHaveProperty('date');
    expect(series[0]).toHaveProperty('courseName');
  });

  it('reflects exclusions', () => {
    // Excluding t:0 (diff 10): included [14, 12, 16, 18] →
    //   after 3: lowest (12) − 2 = 10; after 4: 12 − 1 = 11.
    const series = handicapIndexSeries(makeRounds([10, 14, 12, 16, 18]), {
      excludedKeys: new Set(['t:0']),
    });
    expect(series.map((p) => p.value)).toEqual([10, 11]);
  });

  it('windows to the last 20 within the walk', () => {
    // 21 rounds diffs 1..21. Final point must equal computeHandicapIndex's
    // index for the same rounds: 5.5.
    const rounds = makeRounds(Array.from({ length: 21 }, (_, i) => i + 1));
    const series = handicapIndexSeries(rounds);
    expect(series).toHaveLength(19); // points from the 3rd round onward
    expect(series[series.length - 1].value).toBe(computeHandicapIndex(rounds).index);
  });

  it('returns an empty array below 3 eligible rounds', () => {
    expect(handicapIndexSeries(makeRounds([10, 12]))).toEqual([]);
    expect(handicapIndexSeries([])).toEqual([]);
    expect(handicapIndexSeries(null)).toEqual([]);
  });
});

describe('nextRoundOutlook', () => {
  it('returns null without an index', () => {
    expect(nextRoundOutlook(makeRounds([10, 12]))).toBeNull();
    expect(nextRoundOutlook([])).toBeNull();
    expect(nextRoundOutlook(null)).toBeNull();
  });

  it('computes thresholds, gross target and personal low at 8 rounds', () => {
    // diffs [10, 14, 12, 16, 18, 20, 22, 24] → index avg(10,12) = 11.
    // Posting a 9th round moves to the best-3 table:
    //   drop:   (22+d)/3 < 11  → largest tenth is 10.8 (→ 10.9)
    //   rise:   (22+d)/3 > 11  → smallest tenth is 11.2 (→ 11.1... no, index 11.1)
    //   worst:  avg(10,12,14) = 12
    //   new low (walk low is 8, from the 3-round stage): (22+d)/3 < 8 → 1.8
    const rounds = makeRounds([10, 14, 12, 16, 18, 20, 22, 24]);
    const o = nextRoundOutlook(rounds);
    expect(o.index).toBe(11);
    expect(o.low).toBe(8);
    expect(o.lowDate).toBe('2026-07-01T00:00:00Z');
    expect(o.dropThreshold).toBe(10.8);
    // slope 113, rating 72 → gross target = floor(72 + 10.8) = 82
    expect(o.dropGross).toBe(82);
    expect(o.dropCourse).toBe('Test Course');
    expect(o.canRise).toBe(true);
    expect(o.riseAt).toBe(11.2);
    expect(o.worstCase).toBe(12);
    expect(o.leaving).toBeNull(); // window not full yet
    expect(o.newLowThreshold).toBe(1.8);
    expect(o.newLowIndex).toBe(7.9);
    expect(o.newLowReachable).toBe(false); // best window diff is 10
  });

  it('reports the no-downside case when a bad round cannot raise the index', () => {
    // diffs [10, 14, 12, 16, 18] → index 10 (lowest of 5). A 6th round uses
    // best-2 minus 1: even a blow-up gives avg(10,12) − 1 = 10 — no rise.
    const o = nextRoundOutlook(makeRounds([10, 14, 12, 16, 18]));
    expect(o.index).toBe(10);
    expect(o.canRise).toBe(false);
    expect(o.riseAt).toBeNull();
    expect(o.worstCase).toBe(10);
  });

  it('flags the counting differential aging out of a full window', () => {
    // 21 rounds, diffs 1..21: window 2..21, counting 2..9, index 5.5.
    // The next round evicts diff 2 — a counting one — so the index can rise:
    // worst case is avg(3..10) = 6.5.
    const rounds = makeRounds(Array.from({ length: 21 }, (_, i) => i + 1));
    const o = nextRoundOutlook(rounds);
    expect(o.index).toBe(5.5);
    expect(o.leaving).toEqual({ differential: 2, courseName: 'Test Course', counting: true });
    expect(o.canRise).toBe(true);
    expect(o.worstCase).toBe(6.5);
    // exact tenths sit on a .05 rounding boundary — assert the bracket
    expect(o.dropThreshold).toBeGreaterThanOrEqual(1.5);
    expect(o.dropThreshold).toBeLessThanOrEqual(1.6);
    expect(o.riseAt).toBeGreaterThanOrEqual(2.4);
    expect(o.riseAt).toBeLessThanOrEqual(2.5);
    // walk low is −1.0 (3-round stage: 1 − 2); no postable round reaches it
    expect(o.low).toBe(-1);
    expect(o.newLowThreshold).toBeNull();
    expect(o.newLowReachable).toBe(false);
  });

  it('respects exclusions', () => {
    // Excluding the 10 leaves [14, 12, 16, 18] → 4-round rule: 12 − 1 = 11.
    const o = nextRoundOutlook(makeRounds([10, 14, 12, 16, 18]), {
      excludedKeys: new Set(['t:0']),
    });
    expect(o.index).toBe(11);
  });
});

describe('monthlyIndexSeries', () => {
  it('carries the index flat through months without a round', () => {
    expect(monthlyIndexSeries([
      { value: 10, date: '2026-01-10' },
      { value: 9, date: '2026-01-20' },
      { value: 8.5, date: '2026-03-05' },
    ])).toEqual([
      { ym: '2026-01', value: 9, played: true },
      { ym: '2026-02', value: 9, played: false },
      { ym: '2026-03', value: 8.5, played: true },
    ]);
  });

  it('spans a year rollover', () => {
    expect(monthlyIndexSeries([
      { value: 5, date: '2025-11-02T00:00:00Z' },
      { value: 4, date: '2026-02-10T00:00:00Z' },
    ])).toEqual([
      { ym: '2025-11', value: 5, played: true },
      { ym: '2025-12', value: 5, played: false },
      { ym: '2026-01', value: 5, played: false },
      { ym: '2026-02', value: 4, played: true },
    ]);
  });

  it('handles empty input and points without dates', () => {
    expect(monthlyIndexSeries([])).toEqual([]);
    expect(monthlyIndexSeries(null)).toEqual([]);
    expect(monthlyIndexSeries([{ value: 5, date: null }])).toEqual([]);
  });
});
