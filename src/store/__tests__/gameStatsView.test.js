import { weekendFixture } from './fixtures/gameStatsFixture';
import { bestBallGameFixture } from './fixtures/bestBallGameFixture';
import {
  scoredRoundIndices, standingsRows, progression, raceSeries, roundResult, matchPlayRounds, roundCard,
  holeStories, strokeHoleSplit, awardsList, h2hGrid, shotComparison, resultStandings,
} from '../gameStatsView';
import { roundLeaderboard, tournamentLeaderboardResolved, calcBestWorstBall } from '../tournamentStore';
import { pairsMatchRoundTally } from '../scoring';

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

describe('resultStandings (the Play leaderboard)', () => {
  const rowsOf = (res) => res.rows.map((r) => [r.player.id, r.points, r.place, r.isTie]);

  test('best ball game: the round board in best/worst-ball points, not Stableford', () => {
    const t = bestBallGameFixture();
    const res = resultStandings(t);
    expect(res.mode).toBe('bestball');
    expect(res.sameAsStableford).toBe(false);
    // Same figures and order as the Play board; fewer strokes break the tie.
    expect(res.rows.map((r) => [r.player.id, r.points]))
      .toEqual(roundLeaderboard(t, t.rounds[0]).entries.map((e) => [e.player.id, e.points]));
    expect(rowsOf(res)).toEqual([
      ['bb1', 5, 1, false], ['bb2', 5, 2, false], ['bb3', 4.5, 3, false], ['bb4', 4.5, 4, false],
    ]);
    // Individual Stableford tells another story (Molden second).
    expect(standingsRows(t).rows.map((r) => [r.player.id, r.total]))
      .toEqual([['bb1', 30], ['bb3', 29], ['bb2', 27], ['bb4', 25]]);
  });

  test('Stableford with partners: Play shows the individual total, same as Points', () => {
    const t = weekendFixture();
    const res = resultStandings(t);
    expect(res.mode).toBe('stableford');
    expect(res.sameAsStableford).toBe(true);
    expect(res.rows.map((r) => [r.player.id, r.points]))
      .toEqual(standingsRows(t).rows.map((r) => [r.player.id, r.total]));
  });

  test('a tournament uses the overall board, mixed modes included', () => {
    const bb = weekendFixture();
    bb.settings.scoringMode = 'bestball';
    expect(resultStandings(bb).rows.map((r) => [r.player.id, r.points]))
      .toEqual(tournamentLeaderboardResolved(bb).entries.map((e) => [e.player.id, e.points]));
    expect(resultStandings(bb).sameAsStableford).toBe(false);

    const mixed = weekendFixture();
    mixed.rounds[1].scoringMode = 'bestball';
    const res = resultStandings(mixed);
    expect(res.mode).toBe('stableford');
    expect(res.sameAsStableford).toBe(true);
  });

  test('a mixed tournament with a scramble round counts it as Play does', () => {
    const t = weekendFixture();
    t.rounds[0].scoringMode = 'scramblepairs';
    const res = resultStandings(t);
    expect(res.mode).toBe('stableford');
    expect(res.rows.map((r) => [r.player.id, r.points]))
      .toEqual(tournamentLeaderboardResolved(t).entries.map((e) => [e.player.id, e.points]));
    expect(res.sameAsStableford).toBe(false);
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

  test('best ball: each pair once, equal to the scorecard match panel (best + worst balls won)', () => {
    const t = bestBallGameFixture();
    const r = roundResult(t, 0);
    const bw = calcBestWorstBall(t.rounds[0], t.players);
    const team = (k) => bw.bestBall[k] + bw.worstBall[k];
    expect(r.kind).toBe('teams');
    expect(r.sides.map((s) => [s.members.map((m) => m.id), s.points])).toEqual([
      [['bb1', 'bb2'], team('pair1')], [['bb3', 'bb4'], team('pair2')],
    ]);
    expect(r.sides.map((s) => s.points)).toEqual([10, 9]);
  });

  test('pairs match play: each pair once, equal to the match tally', () => {
    const t = bestBallGameFixture();
    t.settings.scoringMode = 'pairsmatchplay';
    const r = roundResult(t, 0);
    const tally = pairsMatchRoundTally(t.rounds[0], t.players);
    expect(r.sides.map((s) => s.points).sort()).toEqual([tally.team1, tally.team2].sort());
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

describe('roundCard', () => {
  test('rows carry points and handicap strokes; out / in totals per row', () => {
    const card = roundCard(weekendFixture(), 2, ['fx-nac', 'fx-me'], 'fx-me');
    expect(card.rows.map((r) => r.id)).toEqual(['fx-me', 'fx-nac']);
    expect(card.rows[0].nines[0].cells[0]).toMatchObject({ points: 2, strokes: 6, extra: 1 });
    expect(card.rows[1].nines[1].cells[8].points).toBeNull();
    expect(card.nines.map((n) => [n.key, n.par])).toEqual([['out', 36], ['in', 36]]);
    expect(card.rows.map((r) => r.nines.map((n) => n.points))).toEqual([[8, 14], [13, 7]]);
    expect(card.rows.map((r) => r.total.points)).toEqual([22, 20]);
  });

  test('a 9-hole round is one tot block', () => {
    const card = roundCard(nineHoleTournament(), 0, ['a', 'b']);
    expect(card.nines.map((n) => n.key)).toEqual(['tot']);
    // 9-hole maths: handicap 9 over SI 1-9 is one stroke on every hole.
    expect(card.rows[1].nines[0].cells.every((c) => c.extra === 1)).toBe(true);
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
