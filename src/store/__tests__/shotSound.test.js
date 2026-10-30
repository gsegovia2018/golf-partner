import AsyncStorage from '@react-native-async-storage/async-storage';
import { soundLevel, soundIndex, listeningSpans, isOwnSwing, isSharpStrike } from '../shotSound';
import {
  refreshShotSound, getShotSoundIndex, getShotSoundVersion, __resetShotSoundForTests,
} from '../shotSoundStore';
import { SOUND_EVENTS_PREFIX } from '../../lib/shotSense';

const S = 1000;
// A stop stood from 100 s to 160 s.
const stop = { start: 100 * S, end: 160 * S };
const strike = (t, riseMs = 3) => ({ type: 'strike', t: t * S, riseMs, gyroPeak: 0.4, accPeak: 1 });
const swing = (t, gyroPeak = 9) => ({ type: 'swing', t: t * S, gyroPeak, accPeak: 20 });
const listen = (from, to) => [{ type: 'start', t: from * S }, { type: 'stop', t: to * S }];

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetShotSoundForTests();
});

test('my hard swing with a sharp strike at its peak is a shot', () => {
  expect(soundLevel(stop, soundIndex([...listen(0, 300), swing(150), strike(150.1)]))).toBe('shot');
  expect(soundLevel(stop, soundIndex([...listen(0, 300), swing(150), strike(149.75)]))).toBe('shot');
});

test('a strike with no swing of mine is only heard', () => {
  expect(soundLevel(stop, soundIndex([...listen(0, 300), strike(130)]))).toBe('heard');
});

test('a swing and a strike apart are not a shot (a practice swing, a partner hitting)', () => {
  expect(soundLevel(stop, soundIndex([...listen(0, 300), swing(150), strike(151)]))).toBe('heard');
});

test('walking pace swings are not mine', () => {
  expect(soundLevel(stop, soundIndex([...listen(0, 300), swing(150, 4.8), strike(150)]))).toBe('heard');
});

test('a slow-rising sound (steps, clothes) is no strike', () => {
  expect(soundLevel(stop, soundIndex([...listen(0, 300), swing(150), strike(150, 28)]))).toBe('quiet');
});

test('only the stop itself and 2 s before it count, not the walk away', () => {
  expect(soundLevel(stop, soundIndex([...listen(0, 300), swing(98.5), strike(98.6)]))).toBe('shot');
  expect(soundLevel(stop, soundIndex([...listen(0, 300), swing(165), strike(165)]))).toBe('quiet');
  expect(soundLevel(stop, soundIndex([...listen(0, 300), swing(96), strike(96)]))).toBe('quiet');
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

test('own swing and sharp strike thresholds', () => {
  expect(isOwnSwing({ gyroPeak: 6 })).toBe(true);
  expect(isOwnSwing({ gyroPeak: 5.9, accPeak: 40 })).toBe(false);
  expect(isOwnSwing({})).toBe(false);
  expect(isSharpStrike({ riseMs: 10 })).toBe(true);
  expect(isSharpStrike({ riseMs: 10.1 })).toBe(false);
  expect(isSharpStrike({})).toBe(true);
});

test('refreshShotSound reads seeded events and only bumps the version on change', async () => {
  await AsyncStorage.setItem(`${SOUND_EVENTS_PREFIX}t1-r0|0`, JSON.stringify([...listen(0, 300), strike(150)]));
  await refreshShotSound('t1-r0|0');
  expect(getShotSoundIndex('t1-r0|0').strikes).toHaveLength(1);
  const v = getShotSoundVersion();
  await refreshShotSound('t1-r0|0');
  expect(getShotSoundVersion()).toBe(v);
  expect(getShotSoundIndex('other').strikes).toEqual([]);
});
