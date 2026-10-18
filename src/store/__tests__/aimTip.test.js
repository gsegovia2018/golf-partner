import { aimTip, aimHazards, AIM_MIN } from '../aimTip';

// approachMissByDistance rows carry rates over directionKnown.
const row = (known, dir) => ({
  directionKnown: known,
  leftRate: Math.round((dir.left ?? 0) / known * 100),
  rightRate: Math.round((dir.right ?? 0) / known * 100),
  shortRate: Math.round((dir.short ?? 0) / known * 100),
  longRate: Math.round((dir.long ?? 0) / known * 100),
});
const pooled = (dir) => {
  const d = { left: 0, right: 0, short: 0, long: 0, ...dir };
  return { byDirection: d, directionKnown: d.left + d.right + d.short + d.long };
};
const stats = (bucketRow, tend, drive) => ({
  approachMissByDistance: { buckets: bucketRow ? { '100-150': bucketRow } : {} },
  approachTendency: tend,
  driveImpact: drive ? { buckets: drive } : undefined,
});
const approach = (s, extra = {}) => aimTip({ shot: 'approach', par: 4, bucket: '100-150', stats: s, hazards: [], ...extra });

describe('aimTip approach side bias', () => {
  it('uses the bucket row at 8 direction-known misses', () => {
    const tip = approach(stats(row(10, { right: 7, left: 3 })));
    expect(tip).toMatchObject({
      shot: 'approach', kind: 'side', miss: 'right', aim: 'left-half',
      evidence: { count: 7, total: 10, scope: 'bucket' }, hazard: null,
    });
    expect(tip.msg).toEqual({ key: 'stats.aim.title.left-half', params: undefined });
    expect(tip.detail).toEqual({ key: 'stats.aim.why.approach.right', params: { count: 7, total: 10, bucket: '100-150' } });
  });

  it('falls back to the pooled tendency when the bucket row is under 8', () => {
    const tip = approach(stats(row(7, { right: 7 }), pooled({ left: 3, right: 9 })));
    expect(tip.evidence).toEqual({ count: 9, total: 12, scope: 'all' });
    expect(tip.detail.key).toBe('stats.aim.why.approach.right.all');
  });

  it('falls back to pooled when the bucket is null', () => {
    const tip = approach(stats(null, pooled({ left: 8, right: 2 })), { bucket: null });
    expect(tip).toMatchObject({ miss: 'left', aim: 'right-half', evidence: { count: 8, total: 10, scope: 'all' } });
  });

  it('gives no tip when pooled is under 10 and bucket under 8', () => {
    expect(approach(stats(row(7, { right: 7 }), pooled({ right: 9 })))).toBeNull();
  });

  it('requires 2x the other side', () => {
    expect(approach(stats(row(10, { right: 6, left: 4 })))).toBeNull();
    expect(approach(stats(row(9, { right: 6, left: 3 })))?.miss).toBe('right');
  });

  it('exports the thresholds', () => {
    expect(AIM_MIN).toEqual({ bucketMisses: 8, pooledMisses: 10, driveMisses: 10, ratio: 2 });
  });
});

describe('aimTip length bias', () => {
  it('short misses -> club up', () => {
    const tip = approach(stats(row(10, { short: 7, long: 2, left: 1 })));
    expect(tip).toMatchObject({ kind: 'club', miss: 'short', aim: 'club-up' });
    expect(tip.msg.key).toBe('stats.aim.title.club-up');
  });
  it('long misses -> club down', () => {
    const tip = approach(stats(row(10, { long: 7, short: 2, left: 1 })));
    expect(tip).toMatchObject({ kind: 'club', miss: 'long', aim: 'club-down' });
  });
  it('needs the length miss to be the largest direction', () => {
    // short 4 vs long 1 is 4x, but right (5) is larger; right vs left (3) is no 2x side bias
    expect(approach(stats(row(13, { short: 4, long: 1, right: 5, left: 3 })))).toBeNull();
  });
  it('the larger share wins between a side and a length bias', () => {
    // right 6 vs left 1 (side) ; short 3 vs long 0 not largest -> side
    expect(approach(stats(row(10, { right: 6, left: 1, short: 3 })))?.kind).toBe('side');
    // short 6 of 12 vs long 1; right 5 vs left 0 -> short share 0.5 > right 0.42
    expect(approach(stats(row(12, { short: 6, long: 1, right: 5 })))?.kind).toBe('club');
    // right 6 of 11 beats short 4 vs long 1 (not the largest anyway)
    expect(approach(stats(row(11, { short: 4, long: 1, right: 6 })))?.kind).toBe('side');
  });
  it('a side bias with a length bias at equal share keeps the side', () => {
    expect(approach(stats(row(12, { short: 5, long: 2, right: 5 })))?.kind).toBe('side');
  });
});

describe('aimTip tee bias', () => {
  const drive = (left, right) => ({ left: { holes: left }, right: { holes: right }, fairway: { holes: 20 } });
  const tee = (d, extra = {}) => aimTip({ shot: 'tee', par: 4, bucket: null, stats: stats(null, null, d), hazards: [], ...extra });

  it('left misses -> right edge', () => {
    expect(tee(drive(12, 3))).toMatchObject({
      shot: 'tee', kind: 'side', miss: 'left', aim: 'right-edge',
      evidence: { count: 12, total: 15, scope: 'all' },
    });
    expect(tee(drive(12, 3)).detail).toEqual({ key: 'stats.aim.why.tee.left', params: { count: 12, total: 15, bucket: null } });
  });
  it('right misses -> left edge', () => {
    expect(tee(drive(2, 9)).aim).toBe('left-edge');
  });
  it('needs 10 misses and 2x', () => {
    expect(tee(drive(5, 4))).toBeNull();
    expect(tee(drive(9, 0))).toBeNull();
    expect(tee(drive(7, 4))).toBeNull();
  });
  it('no tee tip on par 3', () => {
    expect(tee(drive(12, 3), { par: 3 })).toBeNull();
  });
});

describe('aimTip hazards', () => {
  const s = stats(row(10, { right: 8, left: 2 }));
  it('names a hazard on the miss side and keeps the aim', () => {
    const tip = approach(s, { hazards: [{ kind: 'water', side: 'right', reach: 100 }] });
    expect(tip).toMatchObject({ aim: 'left-half', hazard: { kind: 'water', side: 'right' } });
    expect(tip.hazardMsg).toEqual({ key: 'stats.aim.hazard.water.right', params: undefined });
  });
  it('a hazard on the aim side switches the aim to the middle', () => {
    const tip = approach(s, { hazards: [{ kind: 'water', side: 'left', reach: 100 }] });
    expect(tip).toMatchObject({ aim: 'middle', hazard: { kind: 'water', side: 'left' } });
    expect(tip.msg.key).toBe('stats.aim.title.middle');
    expect(tip.hazardMsg.key).toBe('stats.aim.hazard.water.left');
  });
  it('water on both sides -> middle', () => {
    const tip = approach(s, { hazards: [
      { kind: 'water', side: 'left', reach: 90 }, { kind: 'water', side: 'right', reach: 90 },
    ] });
    expect(tip).toMatchObject({ aim: 'middle', hazard: { kind: 'water', side: 'both' } });
    expect(tip.hazardMsg.key).toBe('stats.aim.hazard.water.both');
  });
  it('water outranks a bunker on the other side', () => {
    const tip = approach(s, { hazards: [
      { kind: 'bunker', side: 'left', reach: 90 }, { kind: 'water', side: 'right', reach: 90 },
    ] });
    expect(tip).toMatchObject({ aim: 'left-half', hazard: { kind: 'water', side: 'right' } });
  });
  it('a bunker alone behaves like any hazard', () => {
    const tip = approach(s, { hazards: [{ kind: 'bunker', side: 'left', reach: 90 }] });
    expect(tip).toMatchObject({ aim: 'middle', hazard: { kind: 'bunker', side: 'left' } });
  });
  it('centre hazards are ignored', () => {
    const tip = approach(s, { hazards: [{ kind: 'water', side: 'centre', reach: 90 }] });
    expect(tip).toMatchObject({ aim: 'left-half', hazard: null });
  });
  it('unmapped (no hazards) -> same tip without the clause', () => {
    const tip = approach(s, { hazards: undefined });
    expect(tip).toMatchObject({ aim: 'left-half', hazard: null, hazardMsg: null });
  });
  it('hazards never create a tip on their own', () => {
    expect(approach(stats(row(10, { right: 5, left: 5 })), { hazards: [{ kind: 'water', side: 'left', reach: 90 }] })).toBeNull();
  });
  it('a hazard on the aim side of a tee tip switches to the middle', () => {
    const d = { left: { holes: 12 }, right: { holes: 3 }, fairway: { holes: 20 } };
    const tip = aimTip({ shot: 'tee', par: 5, bucket: null, stats: stats(null, null, d),
      hazards: [{ kind: 'water', side: 'right', reach: 220 }] });
    expect(tip).toMatchObject({ aim: 'middle', hazard: { kind: 'water', side: 'right' } });
  });
  it('club tips carry no hazard', () => {
    const tip = approach(stats(row(10, { short: 8, long: 1 })), { hazards: [{ kind: 'water', side: 'left', reach: 90 }] });
    expect(tip).toMatchObject({ aim: 'club-up', hazard: null });
  });
});

describe('aimTip guards', () => {
  it('returns null for missing stats or unknown shot', () => {
    expect(aimTip({ shot: 'approach', par: 4, bucket: null, stats: null })).toBeNull();
    expect(aimTip({ shot: 'putt', par: 4, stats: {} })).toBeNull();
    expect(aimTip(undefined)).toBeNull();
  });
});

describe('aimHazards', () => {
  // Hole runs due north from tee T to green G (300 m). West is left.
  const T = [38.5, -0.1];
  const m = (north, east) => [T[0] + north / 111320, T[1] + east / (111320 * Math.cos(T[0] * Math.PI / 180))];
  const G = m(300, 0);
  const hz = (kind, north, east) => ({ kind, poly: [m(north, east), m(north + 2, east + 2)] });
  const geometry = { hazards: [
    hz('water', 295, 20),    // right of the green, 5 m short of it
    hz('bunker', 300, -15),  // left of the green
    hz('water', 200, -20),   // left, 100 m from the green, 200 m from the tee
    hz('bunker', 150, 20),   // right, 150 m from the tee
    hz('tree', 295, 20),     // not water/bunker
  ] };

  it('approach: hazards within 30 m of the green, side from the player line', () => {
    const out = aimHazards({ shot: 'approach', holeGeometry: geometry, from: m(150, 0), greenCentre: G });
    expect(out.map((h) => [h.kind, h.side]).sort()).toEqual([['bunker', 'left'], ['water', 'right']]);
    expect(out.every((h) => typeof h.reach === 'number')).toBe(true);
  });

  it('tee: hazards whose reach is within drive distance +/- 30 m', () => {
    const out = aimHazards({ shot: 'tee', holeGeometry: geometry, from: T, greenCentre: G, driveDistance: 210 });
    expect(out.map((h) => [h.kind, h.side])).toEqual([['water', 'left']]);
    expect(out[0].reach).toBeGreaterThan(190);
    expect(out[0].reach).toBeLessThan(210);
  });

  it('tee without a drive distance, or unmapped geometry -> []', () => {
    expect(aimHazards({ shot: 'tee', holeGeometry: geometry, from: T, greenCentre: G })).toEqual([]);
    expect(aimHazards({ shot: 'approach', holeGeometry: null, from: T, greenCentre: G })).toEqual([]);
    expect(aimHazards({ shot: 'approach', holeGeometry: { hazards: [] }, from: T })).toEqual([]);
  });
});
