import { holeComplete, autoAdvanceAction } from '../autoAdvance';

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

describe('autoAdvanceAction', () => {
  const completeScores = { a: { 3: 5 }, b: { 3: 4 } };
  const incompleteScores = { a: { 3: 5 }, b: {} };
  const base = { enabled: true, holeNumber: 3, currentHole: 3, maxHole: 18, players };

  test('schedules when the viewed hole becomes fully scored', () => {
    expect(autoAdvanceAction({ ...base, scores: completeScores })).toBe('schedule');
  });

  test('ignores writes for a hole other than the one being viewed (the clobber case)', () => {
    // A Grid-view edit (or synced remote write) lands on hole 7 while hole 3
    // is the one currently on screen with a countdown pending — this must
    // NOT cancel that countdown.
    expect(autoAdvanceAction({
      ...base, holeNumber: 7, currentHole: 3, scores: { a: { 7: 5 }, b: { 7: 4 } },
    })).toBe('ignore');
  });

  test('cancels when the setting is disabled', () => {
    expect(autoAdvanceAction({ ...base, enabled: false, scores: completeScores })).toBe('cancel');
  });

  test('cancels on the last hole even if complete', () => {
    expect(autoAdvanceAction({
      ...base, holeNumber: 18, currentHole: 18, maxHole: 18, scores: completeScores,
    })).toBe('cancel');
  });

  test('cancels when the current hole is no longer complete (e.g. a score was removed)', () => {
    expect(autoAdvanceAction({ ...base, scores: incompleteScores })).toBe('cancel');
  });
});
