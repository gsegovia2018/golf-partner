import { roundSpan, roundDurationMs, formatRoundDuration } from '../roundDuration';

const H = 60 * 60 * 1000;
const M = 60 * 1000;
const T0 = Date.parse('2026-08-04T15:20:00.000Z');

// Two scorers: mine left hole 1 at T0, hole 18 at T0+3h50; a peer's card
// trails a little either side.
const cards = {
  me: { holes: { 1: { v: 1, entries: { p1: 4 }, ts: T0 }, 18: { v: 1, entries: { p1: 5 }, ts: T0 + 3 * H + 50 * M } } },
  peer: { holes: { 1: { v: 1, entries: { p2: 4 }, ts: T0 + 2 * M }, 18: { v: 2, entries: { p2: 6 }, ts: T0 + 3 * H + 55 * M } } },
};

describe('roundSpan', () => {
  test('earliest and latest hole publication across every card', () => {
    expect(roundSpan(cards)).toEqual({ firstAt: T0, lastAt: T0 + 3 * H + 55 * M });
  });

  test('null when nothing has been published, ignoring bad timestamps', () => {
    expect(roundSpan({})).toBeNull();
    expect(roundSpan(null)).toBeNull();
    expect(roundSpan({ me: { holes: { 1: { entries: { p1: 4 }, ts: 0 } } } })).toBeNull();
    expect(roundSpan({ me: { holes: { 1: { entries: { p1: 4 } } } } })).toBeNull();
  });
});

describe('roundDurationMs', () => {
  test('first hole to the finish stamp', () => {
    expect(roundDurationMs({ endAt: T0 + 4 * H + 5 * M, cardsByAuthor: cards })).toBe(4 * H + 5 * M);
  });

  test('first hole to the last hole when nothing stamped the finish', () => {
    expect(roundDurationMs({ endAt: null, cardsByAuthor: cards })).toBe(3 * H + 55 * M);
  });

  test('an implausible stamp (archived next morning) falls back to the last hole', () => {
    expect(roundDurationMs({ endAt: T0 + 18 * H, cardsByAuthor: cards })).toBe(3 * H + 55 * M);
  });

  test('a stamp before the first hole (stale clock) falls back to the last hole', () => {
    expect(roundDurationMs({ endAt: T0 - 5 * M, cardsByAuthor: cards })).toBe(3 * H + 55 * M);
  });

  test('a premature stamp (one phone finished while another kept scoring) does not cut the round short', () => {
    expect(roundDurationMs({ endAt: T0 + 14 * M, cardsByAuthor: cards })).toBe(3 * H + 55 * M);
  });

  test('a hole fixed shortly after Finish does not extend the round (Lomas 4 Sep: hole 14 at 21:20, finish 21:07)', () => {
    const fixed = { ...cards, me: { holes: { ...cards.me.holes, 14: { v: 2, entries: { p1: 5 }, ts: T0 + 4 * H + 18 * M } } } };
    expect(roundDurationMs({ endAt: T0 + 4 * H + 5 * M, cardsByAuthor: fixed })).toBe(4 * H + 5 * M);
  });

  test('a score fixed days later does not stretch a stamped round', () => {
    const fixed = { ...cards, me: { holes: { ...cards.me.holes, 7: { v: 2, entries: { p1: 5 }, ts: T0 + 12 * 24 * H } } } };
    expect(roundDurationMs({ endAt: T0 + 4 * H, cardsByAuthor: fixed })).toBe(4 * H);
  });

  test('null without cards, or when even the span is not a round', () => {
    expect(roundDurationMs({ endAt: T0 + 4 * H, cardsByAuthor: {} })).toBeNull();
    const oneHole = { me: { holes: { 1: { entries: { p1: 4 }, ts: T0 } } } };
    expect(roundDurationMs({ endAt: null, cardsByAuthor: oneHole })).toBeNull();
    expect(roundDurationMs({ endAt: T0 + 3 * M, cardsByAuthor: oneHole })).toBeNull();
  });
});

describe('roundDurationMs start', () => {
  const END = T0 + 3 * H + 55 * M;

  test('creation counts as tee-off when it sits shortly before the first hole', () => {
    // Created 18 min before leaving hole 1 — the usual quick-start shape.
    const createdAt = new Date(T0 - 18 * M).toISOString();
    expect(roundDurationMs({ cardsByAuthor: cards, endAt: END, createdAt })).toBe(4 * H + 13 * M);
  });

  test('a game set up the night before starts at the first hole instead', () => {
    expect(roundDurationMs({ cardsByAuthor: cards, endAt: END, createdAt: T0 - 14 * H })).toBe(3 * H + 55 * M);
    // Created AFTER the first hole (scores entered later) — also ignored.
    expect(roundDurationMs({ cardsByAuthor: cards, endAt: END, createdAt: T0 + 5 * M })).toBe(3 * H + 55 * M);
  });

  test('accepts a precomputed span (the feed RPC) in place of cards', () => {
    const span = { firstAt: T0, lastAt: T0 + 3 * H };
    expect(roundDurationMs({ span, endAt: null, createdAt: T0 - 20 * M })).toBe(3 * H + 20 * M);
    expect(roundDurationMs({ span: null, cardsByAuthor: null })).toBeNull();
  });
});

describe('formatRoundDuration', () => {
  test.each([
    [48 * M, '48m'],
    [4 * H, '4h'],
    [3 * H + 52 * M, '3h 52m'],
    [3 * H + 52 * M + 40 * 1000, '3h 53m'],
    [null, null],
    [NaN, null],
  ])('%s → %s', (ms, label) => {
    expect(formatRoundDuration(ms)).toBe(label);
  });
});
