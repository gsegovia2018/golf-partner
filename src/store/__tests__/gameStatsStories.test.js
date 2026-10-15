import { weekendFixture } from './fixtures/gameStatsFixture';
import {
  awardsList, leadStory, roundComeback, playerBestRuns, weekendHoleRanking, grossRounds, improvementRows,
} from '../gameStatsView';

// Scratch players (handicap 0) on par-4 holes: 3 strokes = 3 pts, 4 = 2, 5 = 1, 6 = 0.
// A card is a list of strokes, hole by hole; null leaves the hole unscored.
function build(rounds, names = ['a', 'b']) {
  const players = names.map((id) => ({ id, name: `${id.toUpperCase()} Name`, handicap: 0 }));
  return {
    id: 'tx',
    players,
    settings: { scoringMode: 'individual' },
    rounds: rounds.map((r, ri) => {
      const len = Object.values(r.cards)[0].length;
      const holes = Array.from({ length: len }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
      return {
        id: `r${ri}`,
        courseName: r.course ?? `Course ${ri}`,
        courseId: r.courseId,
        holes,
        playerHandicaps: Object.fromEntries(players.map((p) => [p.id, 0])),
        scores: Object.fromEntries(Object.entries(r.cards).map(([pid, card]) => [
          pid, Object.fromEntries(card.map((st, i) => [i + 1, st]).filter(([, st]) => st != null)),
        ])),
      };
    }),
  };
}
const same = (n, st = 4) => Array.from({ length: n }, () => st);

describe('leadStory', () => {
  test('holes led outright; ties hold no lead; a change needs a different outright leader', () => {
    // running a: 2,3,6,9  b: 2,4,6,7 -> tie, b, tie, a
    const story = leadStory(build([{ cards: { a: [4, 5, 3, 3], b: [4, 4, 4, 5] } }]), 0);
    expect(story.total).toBe(4);
    expect(story.leaders.map((l) => [l.player.id, l.led])).toEqual([['a', 1], ['b', 1]]);
    expect(story.changes).toBe(1);
  });

  test('a tie in between does not count as a change for the same leader', () => {
    // running a: 3,5,8  b: 2,5,7 -> a, tie, a
    const story = leadStory(build([{ cards: { a: [3, 4, 3], b: [4, 3, 4] } }]), 0);
    expect(story.changes).toBe(0);
    expect(story.leaders).toEqual([expect.objectContaining({ led: 2 })]);
  });

  test('level all the way: no leaders, no changes', () => {
    expect(leadStory(build([{ cards: { a: same(3), b: same(3) } }]), 0))
      .toMatchObject({ total: 3, leaders: [], changes: 0 });
  });

  test('1-player rounds have no story; a stopped line leaves the other player leading', () => {
    expect(leadStory(build([{ cards: { a: same(3) } }], ['a']), 0)).toBeNull();
    const t = build([{ cards: { a: same(4), b: [4, 4, null, null] } }]);
    expect(leadStory(t, 0)).toMatchObject({ total: 4, leaders: [expect.objectContaining({ led: 2 })] });
  });

  test('9-hole rounds count their own holes', () => {
    expect(leadStory(build([{ cards: { a: same(9, 3), b: same(9) } }]), 0)).toMatchObject({ total: 9, changes: 0 });
  });

  test('the weekend fixture: R3 changes hands three times', () => {
    const story = leadStory(weekendFixture(), 2);
    expect(story.changes).toBe(3);
    expect(story.leaders.map((l) => l.led)).toEqual([13, 4, 1]);
  });
});

describe('roundComeback', () => {
  test('the winner who trailed by 3+ at some hole, with the hole it was first reached', () => {
    const t = build([{ cards: { a: [6, 6, 6, 3, 3, 3, 3, 3, 3], b: same(9) } }]);
    const cb = roundComeback(t, 0);
    expect(cb).toMatchObject({ deficit: 6, afterHole: 3, roundIndex: 0 });
    expect(cb.player.id).toBe('a');
  });

  test('under 3 behind, wire to wire, or a lone player is no comeback', () => {
    expect(roundComeback(build([{ cards: { a: [5, 5, 3, 3, 3], b: same(5) } }]), 0)).toBeNull();
    expect(roundComeback(build([{ cards: { a: same(5, 3), b: same(5) } }]), 0)).toBeNull();
    expect(roundComeback(build([{ cards: { a: same(5) } }], ['a']), 0)).toBeNull();
  });

  test('a player who loses the round never counts, however far behind', () => {
    expect(roundComeback(build([{ cards: { a: [6, 6, 6, 4, 4], b: same(5) } }]), 0)).toBeNull();
  });

  test('tied winners: the bigger deficit is reported', () => {
    // a and b both finish on 12; b was 0-2-... behind a at the start, a was never behind
    const t = build([{ cards: { a: [3, 3, 3, 6, 6, 6], b: [6, 6, 6, 3, 3, 3] } }]);
    const cb = roundComeback(t, 0);
    expect(cb.player.id).toBe('b');
    expect(cb.deficit).toBe(9);
  });

  test('the weekend fixture: Marcos came back in R1 (3) and R3 (6), none in R2', () => {
    const t = weekendFixture();
    expect(roundComeback(t, 0)).toMatchObject({ deficit: 3, afterHole: 9 });
    expect(roundComeback(t, 1)).toBeNull();
    expect(roundComeback(t, 2)).toMatchObject({ deficit: 6, afterHole: 10, courseName: 'Golf El Puerto' });
  });
});

describe('playerBestRuns', () => {
  test('net runs inside a round: pars show from 2, birdies from 1', () => {
    expect(playerBestRuns(build([{ cards: { a: [3, 4, 4, 5, 4] } }], ['a']), 'a')).toEqual({ par: 3, birdie: 1 });
    expect(playerBestRuns(build([{ cards: { a: [5, 4, 5, 4] } }], ['a']), 'a')).toEqual({ par: 0, birdie: 0 });
  });

  test('a run never spans two rounds', () => {
    const t = build([{ cards: { a: [4, 4, 5] } }, { cards: { a: [4, 4, 5] } }], ['a']);
    expect(playerBestRuns(t, 'a').par).toBe(2);
  });

  test('handicap strokes make it net', () => {
    const t = build([{ cards: { a: [5, 5, 5] } }], ['a']);
    t.rounds[0].playerHandicaps.a = 18;
    expect(playerBestRuns(t, 'a')).toEqual({ par: 3, birdie: 0 });
  });
});

describe('weekendHoleRanking', () => {
  test('averages per physical hole across rounds, 2+ scores, easiest first', () => {
    const t = build([
      { courseId: 'c1', cards: { a: [3, 6], b: [3, 6] } },
      { courseId: 'c1', cards: { a: [4, 6], b: [4, null] } },
      { courseId: 'c2', cards: { a: [4, 4], b: [4, 4] } },
    ]);
    const rank = weekendHoleRanking(t);
    expect(rank[0]).toMatchObject({ holeNumber: 1, courseName: 'Course 0', rounds: [0, 1], scores: 4, avgPoints: 2.5 });
    expect(rank.map((h) => h.key)).toEqual(['c1|1', 'c2|1', 'c2|2', 'c1|2']);
    expect(rank[rank.length - 1]).toMatchObject({ holeNumber: 2, scores: 3, avgPoints: 0 });
  });

  test('a hole scored once is not ranked', () => {
    const t = build([{ cards: { a: [4, 4], b: [4, null] } }, { cards: { a: [4, null], b: [4, null] } }]);
    expect(weekendHoleRanking(t).map((h) => h.key)).toEqual(['Course 0|1', 'Course 1|1']);
  });
});

describe('grossRounds', () => {
  test('lowest strokes among full-length, fully scored rounds; partial and 9-hole rounds are out', () => {
    const t = build([
      { cards: { a: same(18, 5), b: same(18, 4) } },
      { cards: { a: [...same(17, 3), null], b: same(18, 3) } },
      { cards: { a: same(9, 3), b: same(9, 3) } },
    ]);
    const { nine, rows } = grossRounds(t);
    expect(nine).toBe(false);
    expect(rows.map((r) => [r.player.id, r.roundIndex, r.strokes, r.vs]))
      .toEqual([['b', 1, 54, -18], ['b', 0, 72, 0], ['a', 0, 90, 18]]);
  });

  test('only nine-hole rounds: they are used and flagged', () => {
    const g = grossRounds(build([{ cards: { a: same(9, 5), b: same(9, 4) } }]));
    expect(g.nine).toBe(true);
    expect(g.rows[0]).toMatchObject({ strokes: 36, vs: 0 });
  });

  test('nothing finished: empty', () => {
    expect(grossRounds(build([{ cards: { a: [4, null], b: [4, null] } }])).rows).toEqual([]);
  });
});

describe('improvementRows', () => {
  test('first to last full round, needs two; biggest gain first', () => {
    const t = build([
      { cards: { a: same(18, 5), b: same(18, 4) } },
      { cards: { a: same(18, 4), b: same(18, 4) } },
      { cards: { a: same(18, 3), b: [...same(17, 4), null] } },
    ]);
    const rows = improvementRows(t);
    expect(rows.map((r) => [r.player.id, r.gain, r.from.roundIndex, r.to.roundIndex])).toEqual([['a', 36, 0, 2], ['b', 0, 0, 1]]);
  });

  test('one round or nine-hole rounds: nobody qualifies', () => {
    expect(improvementRows(build([{ cards: { a: same(18), b: same(18) } }]))).toEqual([]);
    expect(improvementRows(build([{ cards: { a: same(9) } }, { cards: { a: same(9, 3) } }], ['a']))).toEqual([]);
  });
});

describe('weekend story awards', () => {
  const ids = (t) => awardsList(t).map((a) => a.id);

  test('hole awards need 2 played rounds and read as hole cards', () => {
    expect(ids(build([{ cards: { a: [3, 6], b: [3, 6] } }]))).not.toContain('easiestHole');
    const list = awardsList(build([{ cards: { a: [3, 6], b: [3, 6] } }, { cards: { a: [4, 5], b: [4, 5] } }]));
    const easy = list.find((a) => a.id === 'easiestHole');
    const hard = list.find((a) => a.id === 'hardestHole');
    expect(easy).toMatchObject({ tone: 'glory', players: [], label: { params: { hole: 1 } } });
    expect(easy.detail).toMatchObject({ key: 'stats.game.award.holeWhere', params: { round: 1, course: 'Course 0', hole: 1, par: 4 } });
    expect(hard).toMatchObject({ tone: 'shame', label: { params: { hole: 2 } } });
    expect(list[list.length - 1].id).toBe('hardestHole');
    // equal averages: the first hole, plus how many share it
    const tied = awardsList(build([{ cards: { a: [3, 6], b: [3, 6] } }, { cards: { a: [3, 6], b: [3, 6] } }]));
    expect(tied.find((a) => a.id === 'easiestHole').detail).toMatchObject({ key: 'stats.game.award.holeWhereTied', params: { tied: 1 } });
  });

  test('ties show the first hole and the number tied; holes played in several rounds list the rounds', () => {
    const t = build([
      { courseId: 'c', cards: { a: [3, 3, 6], b: [3, 3, 6] } },
      { courseId: 'c', cards: { a: [3, 3, 6], b: [3, 3, 6] } },
    ]);
    const easy = awardsList(t).find((a) => a.id === 'easiestHole');
    expect(easy.detail).toMatchObject({ key: 'stats.game.award.holeWhereManyTied', params: { count: 2, tied: 1 } });
  });

  test('best gross: strokes and to-par; ties reported; nine-hole fallback', () => {
    const a = awardsList(build([{ cards: { a: same(18), b: same(18) } }])).find((x) => x.id === 'bestGross');
    expect(a.value).toEqual({ key: 'stats.game.award.gross', params: { strokes: 72, vs: 'E' } });
    expect(a.detail.key).toBe('stats.game.award.tied');
    expect(a.players).toHaveLength(2);
    const nine = awardsList(build([{ cards: { a: same(9, 5), b: same(9, 6) } }])).find((x) => x.id === 'bestGross');
    expect(nine.value).toEqual({ key: 'stats.game.award.grossNine', params: { strokes: 45, vs: '+9' } });
    expect(nine.detail).toMatchObject({ key: 'stats.game.award.roundCourse' });
  });

  test('comeback and most improved appear only past their thresholds', () => {
    const none = ids(build([{ cards: { a: same(9), b: same(9) } }]));
    expect(none).not.toContain('comeback');
    expect(none).not.toContain('improved');
    const list = awardsList(build([
      { cards: { a: same(18, 5), b: same(18, 4) } },
      { cards: { a: same(18, 3), b: same(18, 4) } },
    ]));
    expect(list.find((a) => a.id === 'improved')).toMatchObject({
      value: { params: { count: 36 } }, detail: { params: { from: 1, a: 18, to: 2, b: 54 } },
    });
    const w = awardsList(weekendFixture());
    expect(w.find((a) => a.id === 'comeback')).toMatchObject({
      detail: { key: 'stats.game.award.comebackDetail', params: { round: 3, count: 6, hole: 10 } },
    });
    expect(w.map((a) => a.id)).not.toContain('improved');
  });
});
