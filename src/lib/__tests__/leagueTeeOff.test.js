import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestLeagueTeeOff, retryLeagueTeeOff, resetLeagueTeeOffForTests } from '../leagueTeeOff';

jest.mock('../../store/leagueStore', () => ({ notifyLeagueTeeOff: jest.fn() }));
const { notifyLeagueTeeOff } = require('../../store/leagueStore');

const offline = Object.assign(new Error('You need a connection to do this.'), { offline: true });

describe('league tee-off notify', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetLeagueTeeOffForTests();
    await AsyncStorage.clear();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => { console.warn.mockRestore(); });

  test('sent once, and remembered across restarts', async () => {
    notifyLeagueTeeOff.mockResolvedValue();
    await requestLeagueTeeOff('c1');
    await requestLeagueTeeOff('c1');
    expect(notifyLeagueTeeOff).toHaveBeenCalledTimes(1);

    resetLeagueTeeOffForTests(); // a new app session
    await requestLeagueTeeOff('c1');
    await retryLeagueTeeOff('c1');
    expect(notifyLeagueTeeOff).toHaveBeenCalledTimes(1);
  });

  test('offline: kept pending and resent on the next focus', async () => {
    notifyLeagueTeeOff.mockRejectedValueOnce(offline).mockResolvedValueOnce();
    await requestLeagueTeeOff('c2');
    expect(await AsyncStorage.getItem('@golf_league_teeoff:c2')).toBe('pending');

    await retryLeagueTeeOff('c2');
    expect(notifyLeagueTeeOff).toHaveBeenCalledTimes(2);
    expect(await AsyncStorage.getItem('@golf_league_teeoff:c2')).toBe('done');
  });

  test('a server refusal is not retried', async () => {
    notifyLeagueTeeOff.mockRejectedValueOnce(Object.assign(new Error('Card not found.'), { code: 'P0001' }));
    await requestLeagueTeeOff('c3');
    await retryLeagueTeeOff('c3');
    expect(notifyLeagueTeeOff).toHaveBeenCalledTimes(1);
  });

  test('retry does nothing when there was no tap', async () => {
    await retryLeagueTeeOff('c4');
    expect(notifyLeagueTeeOff).not.toHaveBeenCalled();
  });
});
