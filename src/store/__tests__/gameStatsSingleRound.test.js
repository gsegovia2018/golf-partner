import { weekendFixture } from './fixtures/gameStatsFixture';
import {
  singleRoundIndex, grossResult, cellLevel, scoreMix, roundCard, ledgerBestRun, scoringSplits,
  puttBuckets, shotComparePlots, awardsList,
} from '../gameStatsView';

// One player's ledger: the single-row scorecard.
const roundLedger = (t, ri, pid) => roundCard(t, ri, [pid], pid).rows[0];

const oneRound = () => {
  const t = weekendFixture();
  t.rounds = [t.rounds[0]];
  return t;
};

// A 4-hole round on par 4s: the cards are written per test.
function tiny(strokes, { handicap = 0, details } = {}) {
  const holes = [1, 2, 3, 4].map((n) => ({ number: n, par: 4, strokeIndex: n }));
  return {
    id: 'tiny',
    players: [{ id: 'a', name: 'Ana Ruiz', handicap }],
    settings: { scoringMode: 'individual' },
    rounds: [{
      id: 'r', courseName: 'Tiny', holes,
      playerHandicaps: { a: handicap },
      scores: { a: Object.fromEntries(strokes.map((s, i) => [i + 1, s]).filter(([, s]) => s != null)) },
      shotDetails: details ? { a: details } : undefined,
    }],
  };
}

describe('singleRoundIndex', () => {
  test('one scored round → its index; several or none → null', () => {
    expect(singleRoundIndex(oneRound())).toBe(0);
    expect(singleRoundIndex(weekendFixture())).toBeNull();
    const t = weekendFixture();
    t.rounds[0].scores = {};
    t.rounds[2].scores = {};
    expect(singleRoundIndex(t)).toBe(1);
    t.rounds[1].scores = {};
    expect(singleRoundIndex(t)).toBeNull();
  });
});

describe('gross vs net classification', () => {
  test('grossResult follows strokes against par only', () => {
    expect(grossResult(4, 2)).toBe('eagle');
    expect(grossResult(5, 2)).toBe('eagle');
    expect(grossResult(4, 3)).toBe('birdie');
    expect(grossResult(4, 4)).toBe('par');
    expect(grossResult(4, 5)).toBe('bogey');
    expect(grossResult(4, 6)).toBe('double');
    expect(grossResult(4, null)).toBeNull();
  });

  test('cellLevel: strokes by gross result, points by Stableford capped at 3', () => {
    expect(cellLevel('strokes', { strokes: 3, points: 4, gross: 'birdie' })).toBe(3);
    expect(cellLevel('strokes', { strokes: 2, points: 5, gross: 'eagle' })).toBe(4);
    expect(cellLevel('strokes', { strokes: 6, points: 1, gross: 'double' })).toBe(0);
    expect(cellLevel('points', { strokes: 2, points: 5, gross: 'eagle' })).toBe(3);
    expect(cellLevel('points', { strokes: 6, points: 0, gross: 'double' })).toBe(0);
    expect(cellLevel('points', { strokes: null })).toBeNull();
  });

  test('scoreMix: a net birdie (par with a stroke) is a gross par', () => {
    const t = tiny([4, 4, 4, 4], { handicap: 4 }); // a stroke on every hole
    expect(scoreMix(t, 'a', 'points')).toMatchObject({ birdies: 4, pars: 0 });
    expect(scoreMix(t, 'a', 'strokes')).toMatchObject({ birdies: 0, pars: 4 });
  });
});

describe('roundLedger', () => {
  test('18 holes split into out / in with par, strokes, points, putts, fairways x/y and GIR', () => {
    const ledger = roundLedger(oneRound(), 0, 'fx-me');
    expect(ledger.nines.map((n) => n.key)).toEqual(['out', 'in']);
    const [out, back] = ledger.nines;
    expect(out.cells).toHaveLength(9);
    expect(out.par).toBe(36);
    expect(out.strokes).toBe(52);
    expect(back.strokes).toBe(50);
    expect(out.putts).toBe(18);
    expect(back.putts).toBe(18);
    // Out drives: right, left, (par 3), fairway, super, fairway, (par 3), right, fairway.
    expect(out.fairways).toEqual({ hit: 4, of: 7 });
    expect(ledger.hasShots).toBe(true);
    expect(ledger.total).toMatchObject({ holes: 18, strokes: 102, toPar: 30, putts: 36 });
    expect(ledger.total.points).toBe(out.points + back.points);
    // Hole 1: 4 strokes with 1 putt → on the green in 3 on a par 4: no GIR.
    // Hole 4: 7 on a par 5 with 2 putts → on in 5: no GIR either.
    expect(out.cells[0]).toMatchObject({ strokes: 4, putts: 1, gir: false, gross: 'par', drive: 'right', penalties: 0 });
    expect(out.gir.hit).toBe(out.cells.filter((c) => c.gir).length);
    expect(out.gir.of).toBe(9);
    expect(back.cells.find((c) => c.number === 12).penalties).toBe(1);
  });

  test('par 3s carry no drive; a player without shots has none of the shot fields', () => {
    const ledger = roundLedger(oneRound(), 0, 'fx-jav');
    expect(ledger.hasShots).toBe(false);
    expect(ledger.nines[0].cells[2]).toMatchObject({ drive: null, putts: null, gir: null });
    expect(ledger.nines[0].fairways).toEqual({ hit: 0, of: 0 });
    expect(ledger.total.putts).toBeNull();
    expect(roundLedger(oneRound(), 0, 'fx-me').nines[0].cells[2].drive).toBeNull();
  });

  test('a 9-hole round is one tot block; unplayed holes stay out of the totals', () => {
    const t = tiny([4, null, 5, 3]);
    const ledger = roundLedger(t, 0, 'a');
    expect(ledger.nines.map((n) => n.key)).toEqual(['tot']);
    expect(ledger.nines[0].par).toBe(16);
    expect(ledger.total).toMatchObject({ holes: 3, strokes: 12, toPar: 0 });
  });
});

describe('ledgerBestRun', () => {
  test('strokes: gross par or better; points: 2+ points; a gap breaks the run', () => {
    // Handicap 4: one stroke a hole, so a bogey is still 2 points.
    const t = tiny([4, 5, 5, 4], { handicap: 4 });
    const ledger = roundLedger(t, 0, 'a');
    expect(ledgerBestRun(ledger, 'strokes')).toBeNull(); // pars at 1 and 4 only
    expect(ledgerBestRun(ledger, 'points')).toEqual({ length: 4, from: 1, to: 4 });
    const gap = roundLedger(tiny([4, 4, null, 4]), 0, 'a');
    expect(ledgerBestRun(gap, 'strokes')).toEqual({ length: 2, from: 1, to: 2 });
  });
});

describe('scoringSplits', () => {
  test('par, nine and stroke groups in points per hole', () => {
    const groups = scoringSplits(oneRound(), 'fx-me');
    expect(groups.map((g) => g.key)).toEqual(['par', 'nine', 'stroke']);
    expect(groups[0].items.map((i) => i.key)).toEqual(['par3', 'par4', 'par5']);
    expect(groups[0].items.reduce((s, i) => s + i.holes, 0)).toBe(18);
    expect(groups[1].items.map((i) => [i.key, i.holes])).toEqual([['front', 9], ['back', 9]]);
    // Handicap 16: a stroke on SI 1–16, none on SI 17 and 18.
    expect(groups[2].items.map((i) => [i.key, i.holes])).toEqual([['withStroke', 16], ['withoutStroke', 2]]);
  });

  test('a 9-hole round has no nine group', () => {
    expect(scoringSplits(tiny([4, 4, 4, 4]), 'a').map((g) => g.key)).toEqual(['par', 'stroke']);
  });
});

describe('puttBuckets', () => {
  test('counts holes by putts, 3+ together', () => {
    const t = tiny([4, 4, 5, 3], { details: { 1: { putts: 1 }, 2: { putts: 2 }, 3: { putts: 4 }, 4: { putts: 0 } } });
    expect(puttBuckets(t, 'a')).toEqual({ zero: 1, one: 1, two: 1, three: 1, holes: 4, total: 7 });
  });
});

describe('shotComparePlots', () => {
  test('empty with one logger; one axis per metric once two logged', () => {
    const t = oneRound();
    expect(shotComparePlots(t)).toEqual([]);
    t.rounds[0].shotDetails['fx-jav'] = { 1: { putts: 2, drive: 'fairway' }, 2: { putts: 1, drive: 'left' } };
    const plots = shotComparePlots(t);
    expect(plots.map((p) => p.key)).toEqual(['fir', 'gir', 'putts']);
    expect(plots[0].values.map((v) => v.player.id)).toEqual(['fx-me', 'fx-jav']);
    expect(plots[0].values[1].value).toBe(50);
    expect(plots[2].max).toBe(3);
  });
});

describe('awardsList on a one-round game', () => {
  test('no Best round, and no round or course in any detail', () => {
    const awards = awardsList(oneRound());
    expect(awards.find((a) => a.id === 'bestRound')).toBeUndefined();
    awards.forEach((a) => {
      expect(a.detail?.params?.round).toBeUndefined();
      expect(a.detail?.params?.course).toBeUndefined();
    });
    expect(awards.find((a) => a.id === 'hotStretch').detail.key).toBe('stats.game.award.stretchSingle');
    expect(awards.find((a) => a.id === 'bestGross').titleKey).toBe('stats.game.award.title.bestGrossSingle');
  });
});
