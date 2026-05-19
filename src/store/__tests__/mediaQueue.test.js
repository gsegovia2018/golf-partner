import {
  enqueueMedia, listQueueForRound, clearQueue,
} from '../mediaQueue';

// A round id is only unique within its tournament, so a queued upload must be
// matched on BOTH tournament and round — otherwise one game's photos leak onto
// another game whose round happens to share an id.
describe('listQueueForRound', () => {
  beforeEach(async () => { await clearQueue(); });

  test('scopes queued uploads to one tournament and round', async () => {
    await enqueueMedia({ id: 'm1', tournamentId: 'tA', roundId: 'r1', kind: 'photo' });
    await enqueueMedia({ id: 'm2', tournamentId: 'tB', roundId: 'r1', kind: 'photo' });
    await enqueueMedia({ id: 'm3', tournamentId: 'tA', roundId: 'r2', kind: 'photo' });

    const forA = await listQueueForRound('tA', 'r1');
    expect(forA.map((e) => e.id)).toEqual(['m1']);
  });

  test('excludes another tournament whose round shares the same id', async () => {
    await enqueueMedia({ id: 'm1', tournamentId: 'tA', roundId: 'shared', kind: 'photo' });
    await enqueueMedia({ id: 'm2', tournamentId: 'tB', roundId: 'shared', kind: 'photo' });

    const forB = await listQueueForRound('tB', 'shared');
    expect(forB.map((e) => e.id)).toEqual(['m2']);
  });
});
