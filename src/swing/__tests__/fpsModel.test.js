import {
  factorFromDownswing, provisionalFactor, fpsInfo, descents, largestDescent,
} from '../fpsModel';
import { detectPhases } from '../phases';
import { fixtureSamples, CONTAINER_FPS, H } from './helpers';

describe('fpsModel', () => {
  test('downswing duration picks the factor: fixture 61 frames at 29.97 fps is 8x', () => {
    expect(factorFromDownswing(61, CONTAINER_FPS)).toBe(8);
    expect(factorFromDownswing(65, 240)).toBe(1); // 0.27 s real time
    expect(factorFromDownswing(16, 30)).toBe(2); // 0.53 s -> 0.27 s at 2x
    expect(factorFromDownswing(33, 30)).toBe(4);
  });

  test('provisional factor from the fixture descent is 8', () => {
    const { idx, L } = fixtureSamples();
    expect(provisionalFactor(idx, L, H * 0.215, CONTAINER_FPS)).toBe(8);
  });

  test('metadata path: capture 240 over container 30 is factor 8 from the file', () => {
    const { idx, L } = fixtureSamples();
    const r = detectPhases(idx, L, { containerFps: 30, captureFps: 240 });
    expect(r.fps).toMatchObject({ factor: 8, source: 'metadata', capture: 240, approximate: false });
  });

  test('estimation path: no metadata, factor from the swing', () => {
    const { idx, L } = fixtureSamples();
    const r = detectPhases(idx, L, { containerFps: CONTAINER_FPS });
    expect(r.fps).toMatchObject({ factor: 8, source: 'estimate', interpolated: false, approximate: false });
    expect(r.fps.capture).toBeCloseTo(239.79, 1);
  });

  test('interpolated slow-mo halves the effective fps and is approximate', () => {
    const f = fpsInfo({ containerFps: 30, duplicateFrameRatio: 0.5 }, 8, 'metadata');
    expect(f).toMatchObject({ interpolated: true, effective: 120, approximate: true });
    expect(fpsInfo({ containerFps: 30, duplicateFrameRatio: 0.4 }, 8, 'metadata').interpolated).toBe(false);
  });

  test('an effective fps below 100 is approximate', () => {
    expect(fpsInfo({ containerFps: 30 }, 1, 'estimate').approximate).toBe(true);
    expect(fpsInfo({ containerFps: 60 }, 1, 'estimate').approximate).toBe(true);
    expect(fpsInfo({ containerFps: 30 }, 4, 'metadata').approximate).toBe(false);
    expect(fpsInfo({ containerFps: 30 }, 2, 'metadata').approximate).toBe(true);
  });

  test('descent segmentation ignores small up-moves and picks the biggest drop', () => {
    const y = [0, 1, 2, 3, 2.9, 4, 5, 2, 2, 8, 12];
    expect(descents(y, 0.5)).toEqual([[0, 6], [7, 10]]);
    expect(largestDescent(y, 0.5)).toEqual([7, 10]);
    expect(largestDescent([5, 5, 5], 0.1)).toEqual([0, 0]);
  });
});
