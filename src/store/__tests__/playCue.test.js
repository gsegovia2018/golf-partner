import { getPlayCue, liveCue, quickStartCue, setPlayCue, subscribePlayCue, QUICK_START_LIMIT } from '../playCue';

describe('liveCue', () => {
  const entry = { tournament: { id: 't1' }, roundIndex: 2 };

  test('takes the next hole and my points', () => {
    const model = { courseName: 'La Herrería', unit: 'pts', myPoints: 22, next: { number: 11 } };
    expect(liveCue(entry, model)).toEqual({ tournamentId: 't1', roundIndex: 2, courseName: 'La Herrería', hole: 11, points: 22 });
  });

  test('drops points when the round is not scored in points', () => {
    const model = { courseName: 'RACE', unit: 'holes', myPoints: 3, next: null };
    expect(liveCue(entry, model)).toMatchObject({ hole: null, points: null });
  });

  test('is null without a round', () => {
    expect(liveCue(null, {})).toBeNull();
  });
});

test('quickStartCue keeps the first courses with an id, by their shown name', () => {
  const courses = [
    { id: 'a', name: 'La Herrería' },
    { name: 'No id' },
    { id: 'b', name: 'Golf Santander', layoutName: 'Golf Santander · Norte' },
    { id: 'c', name: 'RACE' },
    { id: 'd', name: 'Olivar' },
  ];
  expect(quickStartCue(courses)).toEqual([
    { id: 'a', name: 'La Herrería' },
    { id: 'b', name: 'Golf Santander · Norte' },
    { id: 'c', name: 'RACE' },
  ]);
  expect(quickStartCue(courses)).toHaveLength(QUICK_START_LIMIT);
});

test('setPlayCue notifies only on a real change and resets on null', () => {
  const fn = jest.fn();
  const off = subscribePlayCue(fn);
  setPlayCue({ live: null, quickStart: [{ id: 'a', name: 'A' }] });
  setPlayCue({ live: null, quickStart: [{ id: 'a', name: 'A' }] });
  expect(fn).toHaveBeenCalledTimes(1);
  setPlayCue(null);
  expect(getPlayCue()).toEqual({ live: null, quickStart: [] });
  off();
});
