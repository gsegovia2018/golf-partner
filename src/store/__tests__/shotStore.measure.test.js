import { logShot, logMeasuredShot, shotsForHole } from '../shotStore';

// Unique round ids per test — no cross-test state, no reset needed.
const A = [38.5500, -0.1400];
const NEAR_A = [38.5501, -0.1401];   // ~14 m from A
const B = [38.5520, -0.1420];        // ~280 m from A
const C = [38.5540, -0.1440];

describe('logMeasuredShot', () => {
  it('seeds the start as origin on an empty hole', async () => {
    const r = await logMeasuredShot({ roundId: 'm1', roundIndex: 0, holeNumber: 1, start: A, end: B, club: 'driver' });
    const hole = shotsForHole('m1', 0, 1);
    expect(hole).toHaveLength(2);
    expect(hole[0].club).toBeNull();
    expect(hole[1].club).toBe('driver');
    expect(r.originId).toBe(hole[0].id);
    expect(r.shotId).toBe(hole[1].id);
  });

  it('reuses the chain when the last spot is within 30 m of start', async () => {
    await logShot({ roundId: 'm2', roundIndex: 0, holeNumber: 1, pos: A, club: null });
    const r = await logMeasuredShot({ roundId: 'm2', roundIndex: 0, holeNumber: 1, start: NEAR_A, end: B, club: '7i' });
    expect(shotsForHole('m2', 0, 1)).toHaveLength(2); // no extra origin
    expect(r.originId).toBeNull();
  });

  it('inserts a new origin when start is far from the chain', async () => {
    await logShot({ roundId: 'm3', roundIndex: 0, holeNumber: 1, pos: A, club: null });
    const r = await logMeasuredShot({ roundId: 'm3', roundIndex: 0, holeNumber: 1, start: B, end: C, club: '9i' });
    const hole = shotsForHole('m3', 0, 1);
    expect(hole).toHaveLength(3);
    expect(hole[1].club).toBeNull();
    expect(r.originId).toBe(hole[1].id);
  });
});
