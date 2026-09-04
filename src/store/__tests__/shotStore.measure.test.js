import { logShot, logMeasuredShot, insertShotAfter, shotsForHole } from '../shotStore';

// Unique round ids per test — no cross-test state, no reset needed.
const A = [38.5500, -0.1400];
const NEAR_A = [38.5501, -0.1401];   // ~14 m from A
const B = [38.5520, -0.1420];        // ~280 m from A
const C = [38.5540, -0.1440];

describe('logMeasuredShot', () => {
  it('seeds the start as the club-carrying origin on an empty hole', async () => {
    const r = await logMeasuredShot({ roundId: 'm1', roundIndex: 0, holeNumber: 1, start: A, end: B, club: 'driver' });
    const hole = shotsForHole('m1', 0, 1);
    expect(hole).toHaveLength(2);
    expect(hole[0].club).toBe('driver'); // played FROM the start spot
    expect(hole[1].club).toBeNull();     // landing, nothing hit from it yet
    expect(r.originId).toBe(hole[0].id);
    expect(r.originCreated).toBe(true);
    expect(r.shotId).toBe(hole[1].id);
  });

  it('tags the chain end instead of stacking a spot when start is within 30 m', async () => {
    const origin = await logShot({ roundId: 'm2', roundIndex: 0, holeNumber: 1, pos: A, club: null });
    const r = await logMeasuredShot({ roundId: 'm2', roundIndex: 0, holeNumber: 1, start: NEAR_A, end: B, club: '7i' });
    const hole = shotsForHole('m2', 0, 1);
    expect(hole).toHaveLength(2); // no extra origin
    expect(hole[0].club).toBe('7i');
    expect(r.originId).toBe(origin.id);
    expect(r.originCreated).toBe(false);
  });

  it('inserts a new origin when start is far from the chain', async () => {
    await logShot({ roundId: 'm3', roundIndex: 0, holeNumber: 1, pos: A, club: null });
    const r = await logMeasuredShot({ roundId: 'm3', roundIndex: 0, holeNumber: 1, start: B, end: C, club: '9i' });
    const hole = shotsForHole('m3', 0, 1);
    expect(hole).toHaveLength(3);
    expect(hole[1].club).toBe('9i');
    expect(hole[2].club).toBeNull();
    expect(r.originId).toBe(hole[1].id);
    expect(r.originCreated).toBe(true);
  });
});

// A shot you played but never marked at the time — the punch-out you walked
// straight past. It goes in at its place in the chain, not on the end.
describe('insertShotAfter', () => {
  it('slots the shot in and shifts every later spot up one seq', async () => {
    const tee = await logShot({ roundId: 'i1', roundIndex: 0, holeNumber: 1, pos: A, club: 'driver' });
    await logShot({ roundId: 'i1', roundIndex: 0, holeNumber: 1, pos: B, club: '7i' });
    await logShot({ roundId: 'i1', roundIndex: 0, holeNumber: 1, pos: C, club: null });

    const added = await insertShotAfter(tee.id, NEAR_A, 'pw');
    const hole = shotsForHole('i1', 0, 1);
    expect(hole.map((s) => s.seq)).toEqual([1, 2, 3, 4]);
    expect(hole[1].id).toBe(added.id);
    expect(hole[1].club).toBe('pw');
    expect(hole[2].club).toBe('7i'); // the old shot 2, pushed down a place
  });

  it('appends when the anchor is the last spot', async () => {
    const tee = await logShot({ roundId: 'i2', roundIndex: 0, holeNumber: 1, pos: A, club: 'driver' });
    const added = await insertShotAfter(tee.id, B);
    const hole = shotsForHole('i2', 0, 1);
    expect(hole).toHaveLength(2);
    expect(hole[1].id).toBe(added.id);
    expect(hole[1].club).toBeNull();
  });

  it('does nothing without an anchor or a position', async () => {
    const tee = await logShot({ roundId: 'i3', roundIndex: 0, holeNumber: 1, pos: A, club: 'driver' });
    expect(await insertShotAfter('nope', B)).toBeNull();
    expect(await insertShotAfter(tee.id, null)).toBeNull();
    expect(shotsForHole('i3', 0, 1)).toHaveLength(1);
  });
});
