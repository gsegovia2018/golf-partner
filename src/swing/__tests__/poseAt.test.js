import { poseAtFrame } from '../poseAt';

const lm = (v) => Array.from({ length: 33 }, () => [v, v * 2, 1]);
const pose = { frames: [{ i: 10, lm: lm(0.2) }, { i: 14, lm: lm(0.6) }, { i: 15, lm: null }] };

describe('poseAtFrame', () => {
  test('returns a sampled frame as is and blends between samples', () => {
    expect(poseAtFrame(pose, 10)[0]).toEqual([0.2, 0.4, 1]);
    const mid = poseAtFrame(pose, 12);
    expect(mid[5][0]).toBeCloseTo(0.4);
    expect(mid[5][1]).toBeCloseTo(0.8);
  });
  test('is null outside the samples or without any', () => {
    expect(poseAtFrame(pose, 9)).toBeNull();
    expect(poseAtFrame(pose, 20)).toBeNull();
    expect(poseAtFrame(null, 10)).toBeNull();
  });
});
