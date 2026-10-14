import { toLeagueError, leagueCodeExists, OFFLINE_MESSAGE } from '../leagueStore';

const mockRpc = jest.fn();
jest.mock('../../lib/supabase', () => ({
  supabase: { rpc: (...a) => mockRpc(...a), auth: { getUser: jest.fn() } },
}));

describe('toLeagueError', () => {
  test('real network failures read as offline', () => {
    expect(toLeagueError(new TypeError('Network request failed')).offline).toBe(true);
    expect(toLeagueError({ message: 'Failed to fetch' }).message).toBe(OFFLINE_MESSAGE);
  });

  test('an error without a code that is not a network failure keeps its own message', () => {
    const e = toLeagueError({ message: 'The resource already exists' });
    expect(e.message).toBe('The resource already exists');
    expect(e.offline).toBe(false);
  });

  test('a coded error keeps its message and code', () => {
    const e = toLeagueError({ code: 'P0001', message: 'Nope' });
    expect(e.message).toBe('Nope');
    expect(e.code).toBe('P0001');
  });
});

describe('leagueCodeExists', () => {
  beforeEach(() => mockRpc.mockReset());

  test('true for a known league code, false for an unknown one or a failure', async () => {
    mockRpc.mockResolvedValueOnce({ data: { id: 'L1', name: 'Mulligan' }, error: null });
    expect(await leagueCodeExists('abcd2345')).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('get_league_by_code', { p_code: 'ABCD2345' });

    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await leagueCodeExists('ZZZZZZZZ')).toBe(false);

    mockRpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'denied' } });
    expect(await leagueCodeExists('ABCD2345')).toBe(false);
  });
});
