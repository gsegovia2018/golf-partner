jest.mock('../tournamentRepo');
jest.mock('../tournamentStore', () => ({ syncTournamentParticipants: jest.fn() }));

// eslint-disable-next-line import/first
import * as repo from '../tournamentRepo';
// eslint-disable-next-line import/first
import { executeMutation } from '../mutationWrites';

beforeEach(() => {
  repo.submitScore.mockResolvedValue({ status: 'agreed' });
  repo.resolveScore.mockResolvedValue();
});

test('score.set calls submitScore with authorId and never returns a conflict', async () => {
  const entry = { tournamentId: 't', ts: 1, mutation: { type: 'score.set', roundId: 'r', playerId: 'p', hole: 3, value: 4, authorId: 'a' } };
  const out = await executeMutation(entry, null);
  expect(repo.submitScore).toHaveBeenCalledWith({ tournamentId: 't', roundId: 'r', playerId: 'p', hole: 3, authorId: 'a', strokes: 4 });
  expect(out).toEqual({ conflict: null });
});

test('conflict.resolve calls resolveScore', async () => {
  const entry = { tournamentId: 't', ts: 1, mutation: { type: 'conflict.resolve', roundId: 'r', playerId: 'p', hole: 3, value: 5, resolvedBy: 'a' } };
  await executeMutation(entry, null);
  expect(repo.resolveScore).toHaveBeenCalledWith({ tournamentId: 't', roundId: 'r', playerId: 'p', hole: 3, value: 5, resolvedBy: 'a' });
});
