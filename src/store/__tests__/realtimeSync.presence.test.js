import { reducePresenceProgress } from '../realtimeSync';

test('reducePresenceProgress keeps the highest currentHole per author', () => {
  const state = {
    key1: [{ authorId: 'a', currentHole: 4 }],
    key2: [{ authorId: 'a', currentHole: 6 }, { authorId: 'b', currentHole: 2 }],
  };
  expect(reducePresenceProgress(state)).toEqual({ a: 6, b: 2 });
});
