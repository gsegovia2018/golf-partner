import { recordRoundCard, announceRoundCard } from '../leagueOptIn';

jest.mock('../../store/mutate', () => {
  const { applyToTournament } = jest.requireActual('../../store/mutate');
  return {
    mutate: jest.fn((t, m) => {
      const next = JSON.parse(JSON.stringify(t));
      applyToTournament(next, m);
      return Promise.resolve(next);
    }),
  };
});

jest.mock('../../store/leagueStore', () => ({
  announceLeagueCard: jest.fn(),
}));

const { mutate } = require('../../store/mutate');
const { announceLeagueCard } = require('../../store/leagueStore');

const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
const yellow = { label: 'Yellow', slope: 125, rating: 72 };

function tournament() {
  return {
    id: 't1',
    kind: 'tournament',
    settings: { scoringMode: 'stableford' },
    players: [{ id: 'p1', name: 'Marcos', handicap: 4, user_id: 'u1' }, { id: 'p2', name: 'Javier', handicap: 10 }],
    rounds: [{
      id: 'r1', courseName: 'Centro', holes, tees: [yellow],
      playerTees: { p1: yellow, p2: yellow }, playerHandicaps: { p1: 4, p2: 11 }, manualHandicaps: {},
    }],
  };
}

const league = { id: 'L1', name: 'Mulligan', leagueHandicap: 18 };
const card = { id: 'card-1', month: '2026-10-01', leagueHandicap: 18 };

describe('recordRoundCard', () => {
  beforeEach(() => jest.clearAllMocks());

  test('scorecard path: records the card link only, the round handicaps stay untouched', async () => {
    const t = tournament();
    const next = await recordRoundCard({ tournament: t, roundId: 'r1', meId: 'p1', league, card });
    const types = mutate.mock.calls.map(([, m]) => m.type);
    expect(types).toEqual(['tournament.updateProfile']);
    expect(next.rounds[0].playerHandicaps).toEqual({ p1: 4, p2: 11 });
    expect(next.rounds[0].manualHandicaps).toEqual({});
    expect(next.rounds[0].playerIndexes).toBeUndefined();
  });

  test('pre-round path (Start Round N): my league handicap as an auto entry, never manual', async () => {
    announceLeagueCard.mockResolvedValue(card);
    const { tournament: next } = await announceRoundCard({ tournament: tournament(), roundId: 'r1', meId: 'p1', league });
    const types = mutate.mock.calls.map(([, m]) => m.type);
    expect(types).toEqual(['tournament.updateProfile', 'handicap.setLeague']);
    expect(types).not.toContain('handicap.set');
    expect(types).not.toContain('index.set');
    expect(next.rounds[0].playerIndexes).toEqual({ p1: 18 });
    expect(next.rounds[0].playerHandicaps.p1).toBe(20);
    expect(next.rounds[0].playerHandicaps.p2).toBe(11);
    expect(next.rounds[0].manualHandicaps).toEqual({ p1: false });
  });
});
