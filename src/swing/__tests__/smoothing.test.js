import {
  EURO_HANDS, GRIP_K, smoothSeries, smoothZeroLag, gatedHands, gripPoint, buildSeries, robustSigma, percentile, median,
} from '../smoothing';
import { LM } from '../geometry';
import { fixtureSamples, makeLm, CONTAINER_FPS, H } from './helpers';

const FPS = 240;
const times = (n) => Array.from({ length: n }, (_, k) => k / FPS);

describe('One-Euro, zero lag', () => {
  test('adds no lag on a ramp where the causal filter lags', () => {
    const n = 400;
    const t = times(n);
    const xy = t.map((s) => [20 * s, 50]); // slow takeaway: 20 px/s
    const fwd = smoothSeries(t, xy, EURO_HANDS);
    const zero = smoothZeroLag(t, xy, EURO_HANDS);
    const mid = 200;
    const lagFwd = Math.abs(fwd[mid][0] - xy[mid][0]);
    const lagZero = Math.abs(zero[mid][0] - xy[mid][0]);
    expect(lagFwd).toBeGreaterThan(0.3); // the bias the plan avoids
    expect(lagZero).toBeLessThan(lagFwd / 5);
  });

  test('keeps the reversal at the top within 2 frames', () => {
    const n = 300;
    const peak = 150;
    const t = times(n);
    // hands rise for 150 frames, plateau-free reversal, then fall; noise-free
    const xy = t.map((_, k) => [200, 300 - Math.min(k, 2 * peak - k) * 0.8]);
    const zero = smoothZeroLag(t, xy, EURO_HANDS);
    const top = zero.reduce((best, p, k) => (p[1] < zero[best][1] ? k : best), 0);
    expect(Math.abs(top - peak)).toBeLessThanOrEqual(2);
  });

  test('handles irregular sampling and a single sample', () => {
    const t = [0, 0.1, 0.12, 0.5, 0.51];
    const xy = t.map((s) => [10 * s, 0]);
    expect(smoothZeroLag(t, xy, EURO_HANDS)).toHaveLength(5);
    expect(smoothZeroLag([0], [[1, 2]], EURO_HANDS)).toEqual([[1, 2]]);
  });
});

describe('grip estimate and wrist gate', () => {
  test('grip = wrist + 0.35 (wrist - elbow)', () => {
    expect(GRIP_K).toBe(0.35);
    const g = gripPoint([100, 200], [80, 150]);
    expect(g[0]).toBeCloseTo(107, 6);
    expect(g[1]).toBeCloseTo(217.5, 6);
  });

  const frame = (lVis, rVis, lWr = [100, 200], rWr = [140, 200]) => makeLm({
    [LM.lWr]: [...lWr, lVis], [LM.rWr]: [...rWr, rVis], [LM.lEl]: [100, 150, 1], [LM.rEl]: [140, 150, 1],
  });

  test('drops a hidden wrist when the other is visible (fixed gate)', () => {
    const L = [frame(0.9, 0.9), frame(0.2, 0.9)];
    const idx = [0, 1];
    const both = gatedHands(idx, L, { fixed: true });
    expect(both[0]).toEqual([120, 200]);
    expect(both[1]).toEqual([140, 200]); // lead wrist (left) dropped, right only
    // without the fixed gate a low-visibility wrist that did not jump is kept
    expect(gatedHands(idx, L)[1]).toEqual([120, 200]);
  });

  test('keeps both when both are below 0.5 and nothing jumped', () => {
    const L = [frame(0.9, 0.9), frame(0.3, 0.3)];
    expect(gatedHands([0, 1], L, { fixed: true })[1]).toEqual([120, 200]);
  });

  test('rejects a planted 200 px jump at visibility 0.2 and interpolates', () => {
    const L = [0, 1, 2, 3, 4].map((k) => frame(0.9, 0.9, [100 + k, 200], [140 + k, 200]));
    L[2] = frame(0.2, 0.2, [300, 200], [340, 200]); // both wrists leap 200 px at low visibility
    const h = gatedHands([0, 1, 2, 3, 4], L);
    expect(h[2][0]).toBeCloseTo(122, 6); // interpolated between 121 and 123
    expect(h[2][1]).toBeCloseTo(200, 6);
  });

  test('an unrejected high-visibility jump is kept', () => {
    const L = [frame(0.9, 0.9), frame(0.9, 0.9, [300, 200], [340, 200])];
    expect(gatedHands([0, 1], L)[1]).toEqual([320, 200]);
  });
});

describe('stats helpers', () => {
  test('median, percentile (numpy linear) and robust sigma', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(percentile([1, 2, 3, 4, 5], 25)).toBe(2);
    expect(percentile([1, 2, 3, 4], 25)).toBeCloseTo(1.75, 6);
    expect(percentile([1, NaN, 3], 50)).toBe(2);
    expect(robustSigma([0, 1, -1, 0, 1, -1, 100])).toBeCloseTo(1.4826, 3);
  });
});

describe('buildSeries on the fixture', () => {
  const { idx, L } = fixtureSamples();
  const bodyH = H * 0.215; // ~ the lab's 182 px
  const S = buildSeries(idx, L, { containerFps: CONTAINER_FPS, factor: 8, bodyH });

  test('one smoothed point per sample, captured time, effective fps 240', () => {
    expect(S.hands).toHaveLength(idx.length);
    expect(S.effFps).toBeCloseTo(239.79, 1);
    expect(S.t[240] - S.t[0]).toBeCloseTo(240 / S.effFps, 6);
    expect(S.speed[0]).toBe(0);
  });

  test('per-clip jitter is sub-pixel and the arm length is sane', () => {
    expect(S.sigmaGrip).toBeGreaterThan(0);
    expect(S.sigmaGrip).toBeLessThan(2);
    expect(S.sigmaHead).toBeLessThan(2);
    expect(S.armPx).toBeGreaterThan(60);
    expect(S.armPx).toBeLessThan(100);
  });

  test('the grip estimate is further along the forearm than the wrist midpoint', () => {
    const k = idx.indexOf(300);
    const lm = L[k];
    const wristMid = [(lm[LM.lWr][0] + lm[LM.rWr][0]) / 2, (lm[LM.lWr][1] + lm[LM.rWr][1]) / 2];
    const dist = Math.hypot(S.hands[k][0] - wristMid[0], S.hands[k][1] - wristMid[1]);
    expect(dist).toBeGreaterThan(1); // moved along the forearm
    expect(dist).toBeLessThan(25);
  });

  test('left-handers swap lead and trail landmarks', () => {
    const left = buildSeries(idx, L, { containerFps: CONTAINER_FPS, factor: 8, handedness: 'left', bodyH });
    expect(left.lead[0]).toBe(LM.rSh);
    expect(left.trail[0]).toBe(LM.lSh);
    expect(left.trailHip).toBe(LM.lHip);
    expect(S.trailHip).toBe(LM.rHip);
  });
});
