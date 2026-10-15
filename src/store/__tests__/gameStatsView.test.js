import { weekendFixture } from './fixtures/gameStatsFixture';
import {
  scoredRoundIndices, standingsRows, progression, raceSeries, roundResult, matchPlayRounds, scorecardGrid,
  holeStories, strokeHoleSplit, awardsList, h2hGrid, shotComparison,
} from '../gameStatsView';

const ids = (list) => list.map((x) => (x.player ?? x).id);

// A 9-hole round with SI 1-9, everyone at par-ish.
function nineHoleTournament() {
  const holes = Array.from({ length: 9 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
  const card = (strokes) => Object.fromEntries(holes.map((h) => [h.number, strokes]));
  return {
    id: 't9',
    players: [{ id: 'a', name: 'Ana Ruiz', handicap: 0 }, { id: 'b', name: 'Bea Gil', handicap: 0 }],
    settings: { scoringMode: 'individual' },
    rounds: [{
      id: 'r9', courseName: 'Nine', holes,
      playerHandicaps: { a: 0, b: 9 },
      scores: { a: card(4), b: card(5) },
    }],
  };
}

describe('standingsRows', () => {
  test('points: ranks by total, per-round values, partial rounds flagged with holes played', () => {
    const { rows, roundIndices } = standingsRows(weekendFixture());
    expect(roundIndices).toEqual([0, 1, 2]);
    expect(ids(rows)).toEqual(['fx-me', 'fx-alv', 'fx-nac', 'fx-jav']);
    expect(rows[0]).toMatchObject({ place: 1, isTie: false, total: 68, vs: 68 - 2 * 54 });
    expect(rows[0].perRound.map((r) => r.value)).toEqual([22, 24, 22]);
    const nacho = rows.find((r) => r.player.id === 'fx-nac');
    expect(nacho.perRound[2]).toEqual({ roundIndex: 2, value: 20, holes: 15, partial: true });
  });

  test('gross: only finished rounds count; ranked by finished rounds, then to-par', () => {
    const { rows } = standingsRows(weekendFixture(), { metric: 'gross' });
    expect(ids(rows)).toEqual(['fx-jav', 'fx-me', 'fx-alv', 'fx-nac']);
    const nacho = rows[3];
    expect(nacho.counted).toBe(2);
    expect(nacho.perRound[2].value).toBeNull();
    expect(nacho.total).toBe(122 + 123);
    expect(rows[0]).toMatchObject({ total: 300, vs: 300 - 216 });
  });

  test('net subtracts the playing handicap per finished round', () => {
    const { rows } = standingsRows(weekendFixture(), { metric: 'net' });
    const me = rows.find((r) => r.player.id === 'fx-me');
    expect(me.total).toBe(102 + 101 + 102 - 3 * 16);
    expect(me.place).toBe(1);
  });

  test('ties share a place and are flagged', () => {
    const t = weekendFixture();
    t.rounds = [t.rounds[0]];
    const { rows } = standingsRows(t);
    expect(rows.slice(0, 2).map((r) => [r.player.id, r.place, r.isTie])).toEqual([
      ['fx-me', 1, true], ['fx-alv', 1, true],
    ]);
  });

  test('a player with no score is listed unranked at the bottom', () => {
    const t = weekendFixture();
    t.players.push({ id: 'ghost', name: 'Ghost', handicap: 10 });
    const { rows } = standingsRows(t);
    expect(rows[rows.length - 1]).toMatchObject({ place: null, total: null });
    const gross = standingsRows(t, { metric: 'gross' }).rows;
    expect(gross[gross.length - 1]).toMatchObject({ place: null, total: null });
  });

  test('9-hole round: holes and vs follow the round length', () => {
    // Ana pars every hole off 0; Bea bogeys every hole with a stroke on each.
    const { rows } = standingsRows(nineHoleTournament());
    expect(rows.every((r) => r.holes === 9 && r.total === 18 && r.vs === 0)).toBe(true);
    expect(rows.every((r) => r.place === 1 && r.isTie)).toBe(true);
  });
});

describe('scoredRoundIndices', () => {
  test('skips rounds without scores', () => {
    const t = weekendFixture();
    t.rounds[1].scores = null;
    expect(scoredRoundIndices(t)).toEqual([0, 2]);
  });
});

describe('progression', () => {
  test('cumulative points per round in standings order, with the lead story', () => {
    const { series, caption } = progression(weekendFixture());
    expect(series[0]).toMatchObject({ values: [0, 22, 46, 68] });
    expect(ids(series)).toEqual(['fx-me', 'fx-alv', 'fx-nac', 'fx-jav']);
    // Level with Álvaro after R1, alone in front from R2.
    expect(caption).toEqual({ kind: 'took', leaderIds: ['fx-me'], round: 2, changes: 0 });
  });

  test('no caption with a single round; level caption on a shared lead', () => {
    const t = weekendFixture();
    t.rounds = [t.rounds[0]];
    expect(progression(t).caption).toBeNull();
    const two = weekendFixture();
    two.rounds = [two.rounds[0], { ...two.rounds[0], id: 'copy' }];
    expect(progression(two).caption).toEqual({ kind: 'level', leaderIds: ['fx-me', 'fx-alv'] });
  });
});

describe('raceSeries', () => {
  test('running points per hole; a line stops after the last scored hole', () => {
    const { holes, series } = raceSeries(weekendFixture(), 2);
    expect(holes).toHaveLength(18);
    expect(series[0]).toMatchObject({ total: 22, holesPlayed: 18 });
    expect(series[0].values).toHaveLength(19);
    const nacho = series.find((s) => s.player.id === 'fx-nac');
    expect(nacho.values.slice(15)).toEqual([20, null, null, null]);
  });

  test('empty for a round without scores', () => {
    const t = weekendFixture();
    t.rounds[0].scores = null;
    expect(raceSeries(t, 0)).toEqual({ holes: [], series: [] });
  });
});

describe('roundResult', () => {
  test('a team round reports each pair total', () => {
    const r = roundResult(weekendFixture(), 2);
    expect(r.kind).toBe('teams');
    expect(r.sides.map((s) => [s.members.map((m) => m.id), s.points])).toEqual([
      [['fx-me', 'fx-jav'], 38], [['fx-alv', 'fx-nac'], 37],
    ]);
  });

  test('an individual round lists who played, best first', () => {
    const t = weekendFixture();
    t.settings.scoringMode = 'individual';
    const r = roundResult(t, 2);
    expect(r.kind).toBe('individual');
    expect(r.entries[0]).toMatchObject({ points: 22 });
    expect(r.entries[0].player.id).toBe('fx-me');
  });
});

describe('matchPlayRounds', () => {
  test('Stableford-with-partners rounds are never match play', () => {
    expect(matchPlayRounds(weekendFixture())).toEqual([]);
  });

  test('a pairs match play round carries its real result', () => {
    const t = weekendFixture();
    t.rounds[1].scoringMode = 'pairsmatchplay';
    const list = matchPlayRounds(t);
    expect(list.map((r) => r.roundIndex)).toEqual([1]);
    expect(list[0].result).toEqual(roundResult(t, 1));
    expect(list[0].result.kind).toBe('teams');
  });
});

describe('scorecardGrid', () => {
  test('cells carry points and handicap strokes; Out / In / Tot totals', () => {
    const g = scorecardGrid(weekendFixture(), 2, ['fx-me', 'fx-nac']);
    expect(g.holes[0].cells[0]).toEqual({ playerId: 'fx-me', points: 2, strokes: 6, extra: 1 });
    expect(g.holes[17].cells[1].points).toBeNull();
    expect(g.totals.map((x) => [x.key, x.par, x.values])).toEqual([
      ['out', 36, [8, 13]], ['in', 36, [14, 7]], ['tot', 72, [22, 20]],
    ]);
  });

  test('a 9-hole round has a Tot row only', () => {
    const g = scorecardGrid(nineHoleTournament(), 0, ['a', 'b']);
    expect(g.nine).toBe(true);
    expect(g.totals.map((x) => x.key)).toEqual(['tot']);
    // 9-hole maths: handicap 9 over SI 1-9 is one stroke on every hole.
    expect(g.holes.every((h) => h.cells[1].extra === 1)).toBe(true);
  });
});

describe('holeStories', () => {
  test('easiest, hardest and chaos come from the selected round only', () => {
    const s = holeStories(weekendFixture(), 2);
    expect(s.easiest).toMatchObject({ roundIndex: 2, holeNumber: 7 });
    expect(s.hardest).toMatchObject({ roundIndex: 2, holeNumber: 18 });
    expect(s.chaos).toMatchObject({ roundIndex: 2, holeNumber: 16, range: 3 });
  });

  test('a solo round still has easiest / hardest, never chaos', () => {
    const t = weekendFixture();
    t.players = [t.players[0]];
    const s = holeStories(t, 0);
    expect(s.easiest).not.toBeNull();
    expect(s.chaos).toBeNull();
  });
});

describe('strokeHoleSplit', () => {
  test('splits holes by whether the player received a stroke', () => {
    const { withStroke, withoutStroke } = strokeHoleSplit(weekendFixture(), 'fx-me');
    // Playing handicap 16: a stroke on SI 1-16, so 16 of 18 holes per round.
    expect(withStroke.holes).toBe(48);
    expect(withoutStroke.holes).toBe(6);
    expect(withStroke.points + withoutStroke.points).toBe(68);
  });

  test('a scratch player has no stroke holes', () => {
    const { withStroke } = strokeHoleSplit(nineHoleTournament(), 'a');
    expect(withStroke).toMatchObject({ holes: 0, avg: null });
  });
});

describe('awardsList', () => {
  test('glory first, then shame, each naming its players', () => {
    const list = awardsList(weekendFixture(), { teams: true });
    const order = list.map((a) => a.id);
    const firstShame = list.findIndex((a) => a.tone === 'shame');
    expect(list.slice(0, firstShame).every((a) => a.tone === 'glory')).toBe(true);
    expect(list.slice(firstShame).every((a) => a.tone === 'shame')).toBe(true);
    expect(order.slice(0, 3)).toEqual(['bestRound', 'hotStretch', 'birdiesNet']);
    expect(list[0]).toMatchObject({ value: { key: 'stats.game.award.pts', params: { count: 24 } } });
    expect(ids(list[0].players)).toEqual(['fx-me']);
    expect(order).toEqual(expect.arrayContaining(['worstHole', 'coldStreak', 'gift', 'collapse', 'anchor']));
  });

  test('anchor only with team rounds; skins and gift need company', () => {
    expect(awardsList(weekendFixture(), { teams: false }).map((a) => a.id)).not.toContain('anchor');
    const solo = weekendFixture();
    solo.players = [solo.players[0]];
    const soloIds = awardsList(solo).map((a) => a.id);
    expect(soloIds).not.toContain('skins');
    expect(soloIds).not.toContain('gift');
    expect(soloIds).toContain('bestRound');
  });
});

describe('h2hGrid', () => {
  test('net hole wins, mirrored across the diagonal', () => {
    const g = h2hGrid(weekendFixture());
    expect(g[0][0]).toBeNull();
    expect(g[0][1]).toEqual({ net: 10, wins: 23, losses: 13, ties: 18 });
    expect(g[1][0].net).toBe(-10);
  });
});

describe('shotComparison', () => {
  test('one row per player who logged shot detail', () => {
    const rows = shotComparison(weekendFixture());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ firPct: 55, girPct: 6, puttsPerHole: 1.9, threePutts: 3, penalties: 6 });
  });

  test('empty without shot detail', () => {
    const t = weekendFixture();
    t.rounds.forEach((r) => { delete r.shotDetails; });
    expect(shotComparison(t)).toEqual([]);
  });
});
