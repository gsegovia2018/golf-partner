import {
  playerAvgStableford, playerAvgPerHole, playerRoundHistory, strokeIndexAccuracy,
  hallOfShame, bounceBackRate, warmupVsClosing, tournamentMomentum, courseDNA,
} from '../statsEngine';
import { playerPartnerSplits } from '../tournamentStore';
import { holes18, buildTournament } from './statsFixtures';

const h9 = () => holes18().slice(0, 9);
const fill = (holes, f) => Object.fromEntries(holes.map((h) => [h.number, f(h)]));
const players = [
  { id: 'a', name: 'Ann', handicap: 0 },
  { id: 'b', name: 'Bob', handicap: 18 },
  { id: 'c', name: 'Cy', handicap: 0 },
  { id: 'd', name: 'Di', handicap: 0 },
];
const ph = { a: 0, b: 18, c: 0, d: 0 };

describe('playerAvgStableford counts only full, fully-scored rounds', () => {
  const H18 = holes18();
  const H9 = h9();
  const partial = fill(H18, (h) => h.par);
  delete partial[18];
  const t = buildTournament({
    players,
    rounds: [
      { courseName: 'X', holes: H18, playerHandicaps: ph, scores: { a: fill(H18, (h) => h.par) } }, // 36
      { courseName: 'Y', holes: H9, playerHandicaps: ph, scores: { a: fill(H9, (h) => h.par) } }, // 18
      { courseName: 'Z', holes: H18, playerHandicaps: ph, scores: { a: partial } }, // 34
    ],
  });

  it('ignores the nine-hole and the partial round', () => {
    expect(playerAvgStableford(t, 'a')).toBe(36);
  });
  it('exposes pts/hole over every hole played', () => {
    expect(playerAvgPerHole(t, 'a')).toBe(2);
  });
  it('flags rows in the history', () => {
    expect(playerRoundHistory(t, 'a').map((r) => r.fullRound)).toEqual([true, false, false]);
  });
  it('returns 0 with no full round', () => {
    const only9 = buildTournament({ players, rounds: [{ courseName: 'Y', holes: H9, playerHandicaps: ph, scores: { a: fill(H9, (h) => h.par) } }] });
    expect(playerAvgStableford(only9, 'a')).toBe(0);
  });
});

describe('strokeIndexAccuracy ranks within each course', () => {
  it('does not compare holes across courses', () => {
    const H = holes18();
    const t = buildTournament({
      players,
      rounds: [
        { courseName: 'X', courseId: 'x', holes: H, playerHandicaps: ph, scores: { a: fill(H, (h) => h.par + 1) } },
        { courseName: 'Y', courseId: 'y', holes: H, playerHandicaps: ph, scores: { a: fill(H, (h) => h.par) } },
      ],
    });
    const rows = strokeIndexAccuracy(t);
    expect(rows).toHaveLength(36);
    rows.forEach((r) => {
      expect(r.actualSi).toBe(9.5); // every hole ties within its own course
      expect(r.siGap).toBe(r.printedSi - 9.5);
    });
  });
});

describe('playerPartnerSplits resolves the partner name', () => {
  it('uses the roster when pairs are thin {id} objects', () => {
    const H = h9();
    const t = buildTournament({
      players,
      rounds: [{
        courseName: 'X', holes: H, playerHandicaps: ph,
        pairs: [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }, { id: 'd' }]],
        scores: { a: fill(H, (h) => h.par), b: fill(H, (h) => h.par), c: fill(H, (h) => h.par), d: fill(H, (h) => h.par) },
      }],
    });
    const { partners } = playerPartnerSplits(t, 'a');
    expect(partners).toHaveLength(1);
    expect(partners[0].partner.name).toBe('Bob');
  });
});

describe('hallOfShame triple bogey club in strokes mode', () => {
  it('skips pickups', () => {
    const H = holes18();
    // Bob (hcp 18) gets a stroke on every hole; par+3 gross is a pickup.
    const t = buildTournament({
      players,
      rounds: [{
        courseName: 'X', holes: H, playerHandicaps: ph,
        scores: { a: fill(H, (h) => h.par), b: fill(H, (h) => (h.number === 1 ? h.par + 3 : h.par)) },
      }],
    });
    expect(hallOfShame(t, { metric: 'strokes' }).tripleBogey).toBeNull();
  });
});

describe('bounceBackRate', () => {
  it('a blank hole is not a failed recovery', () => {
    const H = holes18();
    const sc = fill(H, (h) => h.par);
    sc[1] = 5; delete sc[2]; sc[3] = 6;
    const t = buildTournament({ players, rounds: [{ courseName: 'X', holes: H, playerHandicaps: ph, scores: { a: sc } }] });
    const r = bounceBackRate(t)[0];
    // H1 bogey -> H2 blank: no opportunity. H3 bogey -> H4 par: a bounce-back.
    expect(r.opportunities).toBe(1);
    expect(r.bounceBacks).toBe(1);
  });
});

describe('warmupVsClosing labels follow the round length', () => {
  it('reports the hole range of a nine-hole round', () => {
    const H = h9();
    const t = buildTournament({ players, rounds: [{ courseName: 'X', holes: H, playerHandicaps: ph, scores: { a: fill(H, (h) => h.par) } }] });
    expect(warmupVsClosing(t, 'a').range).toEqual({ warmupStart: 1, warmupEnd: 3, closingStart: 7, closingEnd: 9 });
  });
  it('reports H16-18 on an eighteen', () => {
    const H = holes18();
    const t = buildTournament({ players, rounds: [{ courseName: 'X', holes: H, playerHandicaps: ph, scores: { a: fill(H, (h) => h.par) } }] });
    expect(warmupVsClosing(t, 'a').range).toEqual({ warmupStart: 1, warmupEnd: 3, closingStart: 16, closingEnd: 18 });
  });
});

describe('tournamentMomentum / courseDNA ignore partial rounds in round totals', () => {
  const H18 = holes18();
  const H9 = h9();
  const part = fill(H18, (h) => h.par);
  delete part[10]; // part-scored eighteen on the same course
  const t = buildTournament({
    players,
    rounds: [
      { courseName: 'X', courseId: 'x', holes: H18, playerHandicaps: ph, scores: { a: fill(H18, (h) => h.par) } },
      { courseName: 'X', courseId: 'x', holes: H18, playerHandicaps: ph, scores: { a: part } },
    ],
  });
  it('momentum min/max skip the part-scored round', () => {
    const a = tournamentMomentum(t).find((m) => m.player.id === 'a');
    expect(a.minPts).toBe(36);
    expect(a.maxPts).toBe(36);
    expect(a.rounds.map((r) => r.fullRound)).toEqual([true, false]);
  });
  it('momentum min/max skip a nine-hole round', () => {
    const nine = buildTournament({ players, rounds: [
      t.rounds[0],
      { courseName: 'Y', holes: H9, playerHandicaps: ph, scores: { a: fill(H9, (h) => h.par) } },
    ] });
    expect(tournamentMomentum(nine).find((m) => m.player.id === 'a').minPts).toBe(36);
  });
  it('course DNA roundPoints averages full rounds only', () => {
    const c = courseDNA(t).find((r) => r.player.id === 'a').courses[0];
    expect(c.roundPoints).toBe(36);
    expect(c.avgPoints).toBe(2);
    expect(c.rounds).toBe(2);
  });
});
