import AsyncStorage from '@react-native-async-storage/async-storage';
import { soundLevel, soundIndex, listeningSpans, isOwnStrike } from '../shotSound';
import {
  refreshShotSound, getShotSoundIndex, getShotSoundVersion, __resetShotSoundForTests,
} from '../shotSoundStore';
import { SOUND_EVENTS_PREFIX } from '../../lib/shotSense';

const S = 1000;
// A stop stood from 100 s to 160 s.
const stop = { start: 100 * S, end: 160 * S };
const strike = (t, own) => ({ type: 'strike', t: t * S, gyroPeak: own ? 6.2 : 0.4, accPeak: 1 });
const listen = (from, to) => [{ type: 'start', t: from * S }, { type: 'stop', t: to * S }];

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetShotSoundForTests();
});

test('a strike with my swing during the stop is a shot', () => {
  expect(soundLevel(stop, soundIndex([...listen(0, 300), strike(150, true)]))).toBe('shot');
});

test('a strike with the phone still is only heard', () => {
  expect(soundLevel(stop, soundIndex([...listen(0, 300), strike(130, false)]))).toBe('heard');
});

test('one own strike among a partner\'s makes it a shot', () => {
  const idx = soundIndex([...listen(0, 300), strike(120, false), strike(155, true)]);
  expect(soundLevel(stop, idx)).toBe('shot');
});

test('strikes just outside the stop count, further ones do not', () => {
  expect(soundLevel(stop, soundIndex([...listen(0, 300), strike(96, true)]))).toBe('shot');
  expect(soundLevel(stop, soundIndex([...listen(0, 300), strike(169, true)]))).toBe('shot');
  expect(soundLevel(stop, soundIndex([...listen(0, 300), strike(90, true), strike(175, true)]))).toBe('quiet');
});

test('quiet only when listening covered the whole stop', () => {
  expect(soundLevel(stop, soundIndex(listen(0, 300)))).toBe('quiet');
  expect(soundLevel(stop, soundIndex(listen(120, 300)))).toBeNull();
  expect(soundLevel(stop, soundIndex([]))).toBeNull();
  expect(soundLevel(stop, null)).toBeNull();
});

test('a session killed without a stop marker listened until its last event', () => {
  const events = [{ type: 'start', t: 0 }, { type: 'alive', t: 30 * S }, { type: 'alive', t: 200 * S },
    { type: 'start', t: 500 * S }, { type: 'swing', t: 520 * S, gyroPeak: 5 }];
  expect(listeningSpans(events)).toEqual([{ from: 0, to: 200 * S }, { from: 500 * S, to: 520 * S }]);
  expect(soundLevel(stop, soundIndex(events))).toBe('quiet');
});

test('own strike: gyroscope, or the accelerometer on a phone without one', () => {
  expect(isOwnStrike({ gyroPeak: 3 })).toBe(true);
  expect(isOwnStrike({ gyroPeak: 0, accPeak: 9 })).toBe(true);
  expect(isOwnStrike({ gyroPeak: 1, accPeak: 2 })).toBe(false);
  expect(isOwnStrike({})).toBe(false);
});

test('refreshShotSound reads seeded events and only bumps the version on change', async () => {
  await AsyncStorage.setItem(`${SOUND_EVENTS_PREFIX}t1-r0|0`, JSON.stringify([...listen(0, 300), strike(150, true)]));
  await refreshShotSound('t1-r0|0');
  expect(getShotSoundIndex('t1-r0|0').strikes).toHaveLength(1);
  const v = getShotSoundVersion();
  await refreshShotSound('t1-r0|0');
  expect(getShotSoundVersion()).toBe(v);
  expect(getShotSoundIndex('other').strikes).toEqual([]);
});
