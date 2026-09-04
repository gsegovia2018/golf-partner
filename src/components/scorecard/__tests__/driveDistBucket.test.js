import { driveDistBucketFor, DRIVE_DIST_BUCKETS } from '../constants';

describe('driveDistBucketFor', () => {
  it('maps a measured carry to its bucket, boundaries included', () => {
    expect(driveDistBucketFor(120)).toBe('0-150');
    expect(driveDistBucketFor(150)).toBe('150-180');   // lower edge belongs to the bucket
    expect(driveDistBucketFor(179.9)).toBe('150-180');
    expect(driveDistBucketFor(210)).toBe('210-240');
    expect(driveDistBucketFor(305)).toBe('240+');
  });

  it('only ever returns a key the picker knows', () => {
    for (const m of [1, 149, 150, 205, 239, 240, 400]) {
      expect(DRIVE_DIST_BUCKETS).toContain(driveDistBucketFor(m));
    }
  });

  it('returns null for nothing to bucket', () => {
    expect(driveDistBucketFor(0)).toBeNull();
    expect(driveDistBucketFor(null)).toBeNull();
    expect(driveDistBucketFor(NaN)).toBeNull();
  });
});
