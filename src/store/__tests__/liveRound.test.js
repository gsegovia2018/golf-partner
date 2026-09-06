import { isRoundLive, LIVE_WINDOW_MS } from '../liveRound';

const NOW = Date.parse('2026-09-06T12:00:00.000Z');
const base = { finished: false, holesPlayed: 5, totalHoles: 18, now: NOW };

describe('isRoundLive', () => {
  test('mid-round with a hole published within the window', () => {
    expect(isRoundLive({ ...base, lastActivityAt: NOW - 20 * 60 * 1000 })).toBe(true);
    expect(isRoundLive({ ...base, lastActivityAt: NOW - LIVE_WINDOW_MS })).toBe(true);
  });

  test('abandoned: last hole published months ago', () => {
    expect(isRoundLive({ ...base, lastActivityAt: Date.parse('2026-07-27T15:40:00.000Z') })).toBe(false);
    expect(isRoundLive({ ...base, lastActivityAt: NOW - LIVE_WINDOW_MS - 1 })).toBe(false);
  });

  test('unknown recency (offline build) does not demote an otherwise live round', () => {
    expect(isRoundLive({ ...base, lastActivityAt: null })).toBe(true);
  });

  test('never live when finished, not started, or complete', () => {
    expect(isRoundLive({ ...base, finished: true, lastActivityAt: NOW })).toBe(false);
    expect(isRoundLive({ ...base, holesPlayed: 0, lastActivityAt: NOW })).toBe(false);
    expect(isRoundLive({ ...base, holesPlayed: 18, lastActivityAt: NOW })).toBe(false);
  });
});
