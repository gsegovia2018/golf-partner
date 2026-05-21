import { mergeScores } from '../ScorecardScreen';

describe('mergeScores', () => {
  test('adopts blob values for clean cells', () => {
    const blob = { a: { 1: 4, 2: 5 } };
    const local = { a: { 1: 4 } };
    const merged = mergeScores(blob, local, new Set());
    expect(merged).toEqual({ a: { 1: 4, 2: 5 } });
  });

  test('keeps the local value for a dirty cell the blob disagrees with', () => {
    const blob = { a: { 1: 4 } };       // stale: missing the newer tap
    const local = { a: { 1: 7 } };      // user tapped up to 7
    const merged = mergeScores(blob, local, new Set(['a:1']));
    expect(merged.a[1]).toBe(7);        // local edit survives the stale reload
  });

  test('a dirty cell the blob now agrees with adopts the blob value', () => {
    const blob = { a: { 1: 7 } };       // save round-tripped
    const local = { a: { 1: 7 } };
    const merged = mergeScores(blob, local, new Set(['a:1']));
    expect(merged.a[1]).toBe(7);
  });
});
