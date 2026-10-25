import {
  everyoneFinishedAt, playerFinishedAt, roundEndedAt, roundFinalizedAt, tournamentFinalizedAt,
} from '../finishStamp';
import { applyToTournament } from '../mutate';
import { homePhase } from '../homePhase';
import { reopenGame } from '../reopenGame';

jest.mock('../mutate', () => {
  const actual = jest.requireActual('../mutate');
  return {
    ...actual,
    mutate: jest.fn(async (t, m) => {
      const next = JSON.parse(JSON.stringify(t));
      actual.applyToTournament(next, m);
      return next;
    }),
  };
});

// Imported after the mock so the store module sees the real implementation.
const { isTournamentFinished } = jest.requireActual('../tournamentStore');

const NOW = Date.parse('2026-10-25T12:00:00Z');
const H = 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
const scores = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, 4]));

function game(round = {}, players = [
  { id: 'p1', name: 'Marcos', user_id: 'u1' },
  { id: 'p2', name: 'Noé', user_id: 'u2' },
  { id: 'p3', name: 'Guest' },
]) {
  return {
    id: 'g1', kind: 'game', createdAt: iso(NOW - 3 * H), currentRound: 0, players,
    rounds: [{ id: 'r1', holes, scores: { p1: scores(16), p2: scores(15) }, ...round }],
  };
}

describe('per-player finish', () => {
  test('one account player finishing leaves the round open for the other', () => {
    const t = game({ finishedBy: { p1: iso(NOW - H) } });
    expect(playerFinishedAt(t.rounds[0], 'p1')).toBe(NOW - H);
    expect(everyoneFinishedAt(t, t.rounds[0])).toBeNull();
    expect(roundEndedAt(t, t.rounds[0])).toBeNull();
    expect(isTournamentFinished(t)).toBe(false);
  });

  test('the round ends when the last account player finishes; guests are not waited for', () => {
    const t = game({ finishedBy: { p1: iso(NOW - H), p2: iso(NOW - 0.5 * H) } });
    expect(everyoneFinishedAt(t, t.rounds[0])).toBe(NOW - 0.5 * H);
    expect(roundEndedAt(t, t.rounds[0])).toBe(NOW - 0.5 * H);
    expect(roundFinalizedAt(t, t.rounds[0])).toBe(NOW - 0.5 * H);
    expect(tournamentFinalizedAt(t)).toBe(NOW - 0.5 * H);
    expect(isTournamentFinished(t)).toBe(true);
  });

  test('a game with no account players ends on the first Finish', () => {
    const t = game({ finishedBy: { p3: iso(NOW - H) } }, [{ id: 'p3', name: 'Guest' }]);
    expect(everyoneFinishedAt(t, t.rounds[0])).toBe(NOW - H);
  });

  test('a stamp still wins over the per-player taps', () => {
    const t = game({ finishedAt: iso(NOW - 2 * H), finishedBy: { p1: iso(NOW - H) } });
    expect(roundEndedAt(t, t.rounds[0])).toBe(NOW - 2 * H);
  });
});

describe('round.setPlayerFinished / round.setFinished', () => {
  test('per player, first write wins, and null reopens', () => {
    const t = game();
    applyToTournament(t, { type: 'round.setPlayerFinished', roundId: 'r1', playerIds: ['p1'], finishedAt: iso(NOW - H) });
    applyToTournament(t, { type: 'round.setPlayerFinished', roundId: 'r1', playerIds: ['p1'], finishedAt: iso(NOW) });
    expect(t.rounds[0].finishedBy).toEqual({ p1: iso(NOW - H) });
    applyToTournament(t, { type: 'round.setPlayerFinished', roundId: 'r1', playerIds: ['p1'], finishedAt: null });
    expect(t.rounds[0].finishedBy).toEqual({});
  });

  test('round.setFinished with null clears the round stamp', () => {
    const t = game({ finishedAt: iso(NOW - H) });
    applyToTournament(t, { type: 'round.setFinished', roundId: 'r1', finishedAt: null });
    expect(t.rounds[0].finishedAt).toBeNull();
  });
});

describe('Home after my own Finish', () => {
  test('my finished round is not live for me while the other player plays on', () => {
    const t = game({ finishedBy: { p1: iso(NOW - 0.1 * H) } });
    expect(homePhase([t], { userId: 'u1', now: NOW }).phase).toBe('idle');
    expect(homePhase([t], { userId: 'u2', now: NOW }).phase).toBe('live');
  });
});

describe('reopenGame', () => {
  test('clears the archive stamp, the round stamp and every Finish tap', async () => {
    const t = { ...game({ finishedAt: iso(NOW - H), finishedBy: { p1: iso(NOW - H), p2: iso(NOW - H) } }), finishedAt: iso(NOW - H) };
    const reopened = await reopenGame(t);
    expect(reopened.finishedAt).toBeNull();
    expect(reopened.rounds[0].finishedAt).toBeNull();
    expect(reopened.rounds[0].finishedBy).toEqual({});
    expect(roundEndedAt(reopened, reopened.rounds[0])).toBeNull();
    expect(isTournamentFinished(reopened)).toBe(false);
  });
});
