import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  recordRoundPaces, getPaceHistory, loadPaceHistory, _resetPaceHistoryForTests,
} from '../paceHistory';

const round = (over) => ({
  type: 'round', key: 'round:t1:r1', courseName: 'RACE', holes: 18, durationMs: 4.5 * 3600e3, ts: 1, live: false, ...over,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  _resetPaceHistoryForTests();
});

test('keeps finished rounds of 9+ holes as minutes per hole', async () => {
  await recordRoundPaces([
    round(),
    round({ key: 'round:t2:r1', holes: 9, durationMs: 2 * 3600e3 }),
    round({ key: 'round:t3:r1', live: true }),
    round({ key: 'round:t4:r1', holes: 6 }),
    round({ key: 'round:t5:r1', durationMs: null }),
    { type: 'photo', key: 'x' },
  ]);
  expect(getPaceHistory()).toEqual([
    { course: 'RACE', minPerHole: 15, at: 1 },
    { course: 'RACE', minPerHole: 13.3, at: 1 },
  ]);
});

test('persists across a restart', async () => {
  await recordRoundPaces([round()]);
  _resetPaceHistoryForTests();
  await loadPaceHistory();
  expect(getPaceHistory()).toEqual([{ course: 'RACE', minPerHole: 15, at: 1 }]);
});

test('keeps only the newest 80 rounds', async () => {
  await recordRoundPaces(Array.from({ length: 90 }, (_, i) => round({ key: `round:t${i}:r1`, ts: i })));
  const kept = getPaceHistory();
  expect(kept).toHaveLength(80);
  expect(Math.min(...kept.map((r) => r.at))).toBe(10);
});
