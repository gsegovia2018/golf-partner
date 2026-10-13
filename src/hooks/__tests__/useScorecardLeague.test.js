import { renderHook, waitFor, act } from '@testing-library/react-native';
import { useScorecardLeague } from '../useScorecardLeague';
import { leagueCardsPatch } from '../../store/leagueSetup';

jest.mock('../useSetupLeagues', () => ({
  useSetupLeagues: () => ({ leagues: [], loading: false, error: false }),
}));

jest.mock('../../store/leagueStore', () => ({
  getLeagueCard: jest.fn(() => Promise.resolve(null)),
  getLeagueGameStatus: jest.fn(() => Promise.resolve([])),
  getMyLeagueCardsForRound: jest.fn(),
}));

jest.mock('../../lib/leagueOptIn', () => ({
  announceMyRoundCard: jest.fn(),
  dismissLeagueOptIn: jest.fn(() => Promise.resolve()),
  isLeagueOptInDismissed: jest.fn(() => Promise.resolve(false)),
}));

const store = require('../../store/leagueStore');
const { announceMyRoundCard } = require('../../lib/leagueOptIn');

const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));

function tournament(extra = {}) {
  return {
    id: 't1',
    kind: 'tournament',
    settings: { scoringMode: 'stableford' },
    players: [{ id: 'p1', name: 'Marcos', user_id: 'u1' }, { id: 'p2', name: 'Javier', user_id: 'u2' }],
    rounds: [{ id: 'r1', holes, tees: [] }],
    ...extra,
  };
}

const flush = () => act(() => new Promise((r) => setImmediate(r)));

function run(t, record = jest.fn(() => Promise.resolve())) {
  renderHook(() => useScorecardLeague({
    tournament: t, round: t.rounds[0], meId: 'p1', userId: 'u1', official: false, scores: {}, record,
  }));
  return record;
}

describe('useScorecardLeague repair (D5)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('the server has my card for this round but the game has no link: re-announce and record it', async () => {
    store.getMyLeagueCardsForRound.mockResolvedValue([{ id: 'card-1', leagueId: 'L1', status: 'playing' }]);
    const card = { id: 'card-1', month: '2026-10-01', existing: true };
    announceMyRoundCard.mockResolvedValue(card);

    const record = run(tournament());
    await waitFor(() => expect(record).toHaveBeenCalledWith({ league: { id: 'L1' }, card }));
    expect(store.getMyLeagueCardsForRound).toHaveBeenCalledWith('t1', 'r1');
    expect(announceMyRoundCard).toHaveBeenCalledWith(expect.objectContaining({
      roundId: 'r1', meId: 'p1', league: { id: 'L1' },
    }));
  });

  test('the game already links my card: no repair read', async () => {
    const linked = tournament(leagueCardsPatch({ leagueId: 'L1', cardId: 'card-1', playerId: 'p1', roundId: 'r1' }));
    const record = run(linked);
    await flush();
    await flush();
    expect(store.getMyLeagueCardsForRound).not.toHaveBeenCalled();
    expect(announceMyRoundCard).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  test('no card of mine for this round on the server: nothing is announced', async () => {
    store.getMyLeagueCardsForRound.mockResolvedValue([]);
    const record = run(tournament());
    await waitFor(() => expect(store.getMyLeagueCardsForRound).toHaveBeenCalled());
    await flush();
    expect(announceMyRoundCard).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  test('offline lookup: nothing recorded, no crash', async () => {
    store.getMyLeagueCardsForRound.mockRejectedValue(new Error('offline'));
    const record = run(tournament());
    await waitFor(() => expect(store.getMyLeagueCardsForRound).toHaveBeenCalled());
    await flush();
    expect(record).not.toHaveBeenCalled();
  });
});
