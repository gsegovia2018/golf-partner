import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useMyLeagueRows, dropLeagueRow } from '../useMyLeagueRows';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = {};
  return {
    __store: store,
    getItem: jest.fn((k) => Promise.resolve(store[k] ?? null)),
    setItem: jest.fn((k, v) => { store[k] = v; return Promise.resolve(); }),
    removeItem: jest.fn((k) => { delete store[k]; return Promise.resolve(); }),
  };
});
jest.mock('../../store/leagueStore', () => ({
  getMyLeagues: jest.fn(),
  getLeague: jest.fn(() => Promise.reject(new Error('skip'))),
}));
jest.mock('../../store/leagueView', () => ({ leagueSummary: jest.fn() }));

const { getMyLeagues } = require('../../store/leagueStore');

describe('dropLeagueRow', () => {
  test('removes the league from the cached rows, keeping the others', async () => {
    AsyncStorage.__store['@golf_league_rows'] = JSON.stringify({ meId: 'me', rows: [{ id: 'a' }, { id: 'b' }] });
    await dropLeagueRow('a');
    expect(JSON.parse(AsyncStorage.__store['@golf_league_rows'])).toEqual({ meId: 'me', rows: [{ id: 'b' }] });
  });

  test('drops the row from a mounted list at once', async () => {
    getMyLeagues.mockResolvedValue([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    const { result } = renderHook(() => useMyLeagueRows(null, 'me'));
    await waitFor(() => expect(result.current.map((r) => r.id)).toEqual(['a', 'b']));
    await act(async () => { await dropLeagueRow('a'); });
    expect(result.current.map((r) => r.id)).toEqual(['b']);
  });
});
