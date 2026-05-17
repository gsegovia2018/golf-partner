import { playersMeFirst, pairsMeFirst } from '../playerOrder';

const A = { id: 'a', name: 'A' };
const B = { id: 'b', name: 'B' };
const C = { id: 'c', name: 'C' };
const D = { id: 'd', name: 'D' };

describe('playersMeFirst', () => {
  test('moves the me player to the front, others keep relative order', () => {
    expect(playersMeFirst([A, B, C], 'c')).toEqual([C, A, B]);
  });
  test('me already first → order unchanged', () => {
    expect(playersMeFirst([A, B, C], 'a')).toEqual([A, B, C]);
  });
  test('meId null → order unchanged', () => {
    expect(playersMeFirst([A, B, C], null)).toEqual([A, B, C]);
  });
  test('meId matches nobody → order unchanged', () => {
    expect(playersMeFirst([A, B, C], 'z')).toEqual([A, B, C]);
  });
  test('does not mutate the input array', () => {
    const input = [A, B, C];
    playersMeFirst(input, 'c');
    expect(input).toEqual([A, B, C]);
  });
  test('empty / non-array input → empty array', () => {
    expect(playersMeFirst([], 'a')).toEqual([]);
    expect(playersMeFirst(undefined, 'a')).toEqual([]);
  });
});

describe('pairsMeFirst', () => {
  test('puts the me-pair first and me first within it, flattened', () => {
    expect(pairsMeFirst([[A, B], [C, D]], 'd')).toEqual([D, C, A, B]);
  });
  test('me in the first pair → pair order unchanged, me first within', () => {
    expect(pairsMeFirst([[A, B], [C, D]], 'b')).toEqual([B, A, C, D]);
  });
  test('meId null → flattened in original order', () => {
    expect(pairsMeFirst([[A, B], [C, D]], null)).toEqual([A, B, C, D]);
  });
  test('meId matches nobody → flattened in original order', () => {
    expect(pairsMeFirst([[A, B], [C, D]], 'z')).toEqual([A, B, C, D]);
  });
  test('non-array input → empty array', () => {
    expect(pairsMeFirst(undefined, 'a')).toEqual([]);
  });
});
