// 9-hole rounds. A nine-hole course's stroke indices run 1-9, so strokes are
// allocated over nine holes and the WHS course handicap is computed off HALF
// the handicap index against the tee's 9-hole rating/slope/par. Everything
// here is the Golfpark Waldkirch case (four rated 9-hole loops).
import {
  calcExtraShots,
  calcStablefordPoints,
  pickupStrokes,
  calcPlayingHandicap,
  deriveRoundPlayingHandicap,
  holeCountOf,
  roundTotals,
} from '../scoring';

// Golfpark Waldkirch — Grün (9): par 35, SIs as published by the club.
const GRUEN_NINE = [
  { number: 1, par: 4, strokeIndex: 4 },
  { number: 2, par: 4, strokeIndex: 5 },
  { number: 3, par: 3, strokeIndex: 6 },
  { number: 4, par: 5, strokeIndex: 2 },
  { number: 5, par: 3, strokeIndex: 8 },
  { number: 6, par: 4, strokeIndex: 3 },
  { number: 7, par: 5, strokeIndex: 7 },
  { number: 8, par: 4, strokeIndex: 1 },
  { number: 9, par: 3, strokeIndex: 9 },
];

describe('holeCountOf', () => {
  it('reports 9 only for a nine-hole card', () => {
    expect(holeCountOf(GRUEN_NINE)).toBe(9);
    expect(holeCountOf({ holes: GRUEN_NINE })).toBe(9);
  });

  it('treats everything else — including a missing hole list — as 18', () => {
    expect(holeCountOf({ holes: Array(18).fill({ par: 4 }) })).toBe(18);
    expect(holeCountOf({ holes: Array(12).fill({ par: 4 }) })).toBe(18);
    expect(holeCountOf(undefined)).toBe(18);
  });
});

describe('calcExtraShots over nine holes', () => {
  it('wraps at 9, not 18 — a 12 handicap gets a second shot on SI 1-3', () => {
    expect(calcExtraShots(12, 1, 9)).toBe(2);
    expect(calcExtraShots(12, 3, 9)).toBe(2);
    expect(calcExtraShots(12, 4, 9)).toBe(1);
    expect(calcExtraShots(12, 9, 9)).toBe(1);
  });

  it('gives every hole exactly one shot at a 9 handicap', () => {
    for (let si = 1; si <= 9; si += 1) expect(calcExtraShots(9, si, 9)).toBe(1);
  });

  it('agrees with the 18-hole allocation while the handicap fits in one pass', () => {
    for (let si = 1; si <= 9; si += 1) {
      expect(calcExtraShots(5, si, 9)).toBe(calcExtraShots(5, si, 18));
    }
  });

  it('gives shots back from the easiest hole for a plus handicap', () => {
    expect(calcExtraShots(-2, 9, 9)).toBe(-1);
    expect(calcExtraShots(-2, 8, 9)).toBe(-1);
    expect(calcExtraShots(-2, 7, 9)).toBe(0);
  });

  it('defaults to 18 when no hole count is passed', () => {
    expect(calcExtraShots(12, 3)).toBe(1);
  });
});

describe('calcStablefordPoints over nine holes', () => {
  it('counts the second stroke a 12 handicap receives on the hardest hole', () => {
    // SI 1, par 4, 5 strokes. Over nine holes a 12 handicap gets 2 shots
    // here (net 3 — a net birdie, 3 points); over eighteen it gets only 1.
    expect(calcStablefordPoints(4, 5, 12, 1, 9)).toBe(3);
    expect(calcStablefordPoints(4, 5, 12, 1, 18)).toBe(2);
  });
});

describe('pickupStrokes over nine holes', () => {
  it('tracks the nine-hole shot allocation', () => {
    expect(pickupStrokes(4, 12, 1, 9)).toBe(8);   // par + 2 + 2 shots
    expect(pickupStrokes(4, 12, 4, 9)).toBe(7);   // par + 2 + 1 shot
  });
});

describe('calcPlayingHandicap over nine holes', () => {
  // Waldkirch Grün (9), tee Gr28: CR 35.3 / slope 132, par 35.
  it('halves the index and uses the tee\'s 9-hole rating', () => {
    // 18/2 = 9 → 9 × 132/113 + (35.3 − 35) = 10.51 + 0.3 → 11
    expect(calcPlayingHandicap(18, 132, 35.3, 35, 9)).toBe(11);
    // The same index over 18 holes on the same numbers would double it.
    expect(calcPlayingHandicap(18, 132, 35.3, 35, 18)).toBe(21);
  });

  it('halves the index even with no slope to work from', () => {
    expect(calcPlayingHandicap(15, null, null, 35, 9)).toBe(8);
  });
});

describe('deriveRoundPlayingHandicap on a 9-hole round', () => {
  const round = {
    holes: GRUEN_NINE,
    playerTees: { p1: { label: 'Gr28', slope: 132, rating: 35.3 } },
  };

  it('derives the 9-hole course handicap from the round\'s own hole list', () => {
    expect(deriveRoundPlayingHandicap(18, round, 'p1')).toBe(11);
  });
});

describe('roundTotals on a 9-hole round', () => {
  it('scores every hole off the nine-hole allocation', () => {
    const player = { id: 'p1', name: 'A', handicap: 18 };
    const round = {
      holes: GRUEN_NINE,
      playerHandicaps: { p1: 12 },
      // Par on every hole.
      scores: { p1: Object.fromEntries(GRUEN_NINE.map((h) => [h.number, h.par])) },
    };
    // 12 shots over 9 holes: 1 everywhere, 2 on SI 1-3. Par with n shots is
    // 2 + n points, so 6 holes × 3 + 3 holes × 4 = 30.
    const [row] = roundTotals(round, [player]);
    expect(row.totalPoints).toBe(30);
    expect(row.totalStrokes).toBe(35);
  });
});
