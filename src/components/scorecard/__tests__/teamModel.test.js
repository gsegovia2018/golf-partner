import { hasTeams, teamsByPlayer, teamColor } from '../teamModel';

const theme = { pairA: '#4fae8a', pairB: '#f59e0b' };

test('hasTeams: true only for two multi-member pairs', () => {
  const teamRound = { pairs: [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }, { id: 'd' }]] };
  expect(hasTeams(teamRound)).toBe(true);
  expect(hasTeams({ pairs: [[{ id: 'a' }], [{ id: 'b' }]] })).toBe(false);
  expect(hasTeams({ pairs: [] })).toBe(false);
  expect(hasTeams({})).toBe(false);
});

test('teamsByPlayer maps each player to a team index and label', () => {
  const teamRound = { pairs: [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }, { id: 'd' }]] };
  const map = teamsByPlayer(teamRound);
  expect(map.a).toEqual({ index: 0, label: 'Pair A' });
  expect(map.d).toEqual({ index: 1, label: 'Pair B' });
});

test('teamsByPlayer returns {} when there are no teams', () => {
  expect(teamsByPlayer({ pairs: [[{ id: 'a' }]] })).toEqual({});
});

test('teamColor picks pairA for index 0, pairB for index 1', () => {
  expect(teamColor(theme, 0)).toBe('#4fae8a');
  expect(teamColor(theme, 1)).toBe('#f59e0b');
});
