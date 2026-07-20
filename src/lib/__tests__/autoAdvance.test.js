import { holeComplete } from '../autoAdvance';

const players = [{ id: 'a' }, { id: 'b' }];

test('true only when every player has a score on the hole', () => {
  expect(holeComplete({ a: { 1: 5 }, b: { 1: 4 } }, players, 1)).toBe(true);
  expect(holeComplete({ a: { 1: 5 }, b: {} }, players, 1)).toBe(false);
  expect(holeComplete({ a: { 1: 5 } }, players, 1)).toBe(false);
  expect(holeComplete({ a: { 1: 0 }, b: { 1: 4 } }, players, 1)).toBe(false); // 0 = no score
});

test('empty inputs are never complete', () => {
  expect(holeComplete({}, [], 1)).toBe(false);
  expect(holeComplete(null, players, 1)).toBe(false);
});
