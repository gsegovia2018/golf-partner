import {
  parseFinishedAt, roundFinalizedAt, tournamentFinalizedAt, roundEndedAt,
} from '../finishStamp';

const ISO = '2026-08-04T19:24:55.450Z';
const MS = Date.parse(ISO);

describe('parseFinishedAt', () => {
  test('ISO strings and legacy ms epochs both parse; junk is null', () => {
    expect(parseFinishedAt(ISO)).toBe(MS);
    expect(parseFinishedAt(MS)).toBe(MS);
    expect(parseFinishedAt(null)).toBeNull();
    expect(parseFinishedAt('')).toBeNull();
    expect(parseFinishedAt('soon')).toBeNull();
    expect(parseFinishedAt(NaN)).toBeNull();
  });
});

describe('roundFinalizedAt', () => {
  test('the round stamp wins over the archive stamp', () => {
    const t = { finishedAt: '2026-09-06T00:50:00.000Z' };
    expect(roundFinalizedAt(t, { finishedAt: ISO }, 3)).toBe(MS);
  });

  test('the archive stamp is offset by round index to keep play order', () => {
    const t = { finishedAt: ISO };
    expect(roundFinalizedAt(t, {}, 2)).toBe(MS + 2);
  });

  test('null when nothing stamped it', () => {
    expect(roundFinalizedAt({}, {}, 0)).toBeNull();
    expect(roundFinalizedAt(null, null)).toBeNull();
  });
});

describe('tournamentFinalizedAt', () => {
  test('a game finalizes with its round', () => {
    const game = { kind: 'game', finishedAt: '2026-09-06T00:50:00.000Z', rounds: [{ finishedAt: ISO }] };
    expect(tournamentFinalizedAt(game)).toBe(MS);
  });

  test('a tournament finalizes when archived, whatever its rounds say', () => {
    const t = { kind: 'tournament', finishedAt: ISO, rounds: [{ finishedAt: '2026-01-01T00:00:00.000Z' }] };
    expect(tournamentFinalizedAt(t)).toBe(MS);
    expect(tournamentFinalizedAt({ kind: 'tournament', rounds: [{ finishedAt: ISO }] })).toBeNull();
  });
});

describe('roundEndedAt', () => {
  test('the round stamp, for any kind', () => {
    expect(roundEndedAt({ kind: 'tournament' }, { finishedAt: ISO })).toBe(MS);
  });

  test("a game's archive stamp stands in for its one round", () => {
    expect(roundEndedAt({ kind: 'game', finishedAt: ISO }, {})).toBe(MS);
  });

  test("a tournament's archive stamp says nothing about one round", () => {
    expect(roundEndedAt({ kind: 'tournament', finishedAt: ISO }, {})).toBeNull();
  });
});
