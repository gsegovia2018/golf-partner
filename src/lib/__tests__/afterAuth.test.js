import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAfterAuth, takeAfterAuth, AFTER_AUTH_TTL_MS } from '../afterAuth';

beforeEach(() => AsyncStorage.clear());

describe('afterAuth', () => {
  test('a stored target is read once', async () => {
    await setAfterAuth('swing', 1000);
    expect(await takeAfterAuth(2000)).toBe('swing');
    expect(await takeAfterAuth(2000)).toBeNull();
  });

  test('an old target is dropped', async () => {
    await setAfterAuth('swing', 0);
    expect(await takeAfterAuth(AFTER_AUTH_TTL_MS + 1)).toBeNull();
    expect(await takeAfterAuth(0)).toBeNull();
  });

  test('nothing stored, or junk, reads as null', async () => {
    expect(await takeAfterAuth()).toBeNull();
    await AsyncStorage.setItem('golf_after_auth.v1', '{oops');
    expect(await takeAfterAuth()).toBeNull();
  });
});
