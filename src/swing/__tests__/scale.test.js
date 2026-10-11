import {
  legScale, scaleFromWindow, defaultHeightCm, expectedShaftPx, ballDiameterPx,
} from '../scale';
import { LM } from '../geometry';
import { fixtureSamples, makeLm } from './helpers';

const { idx, L } = fixtureSamples();

describe('scale', () => {
  test('176 cm golfer on the fixture is within 10 % of the lab scale (1.2371 px/cm)', () => {
    const s = scaleFromWindow(idx, L, [295, 305], 'right', 176);
    expect(Math.abs(s.pxPerCm / 1.2371 - 1)).toBeLessThanOrEqual(0.1);
    expect(s.legPx).toBeGreaterThan(100);
    expect(s.approx).toBe(false);
  });

  test('pxPerCm = legPx / (0.49 x height) from a synthetic straight leg', () => {
    const lm = makeLm({
      [LM.rHip]: [100, 100, 1], [LM.rKnee]: [100, 150, 1], [LM.rAnk]: [100, 200, 1],
    });
    const s = legScale([lm], 'right', 200, true);
    expect(s.legPx).toBe(100);
    expect(s.pxPerCm).toBeCloseTo(100 / 98, 6);
    expect(s.approx).toBe(true);
  });

  test('left-handers use the left leg; the window falls back to the nearest sample', () => {
    const lm = makeLm({ [LM.lHip]: [0, 0, 1], [LM.lKnee]: [0, 30, 1], [LM.lAnk]: [0, 60, 1] });
    expect(legScale([lm], 'left', 100).legPx).toBe(60);
    const s = scaleFromWindow([10, 20], [lm, lm], [1000, 1100], 'left', 100);
    expect(s.legPx).toBe(60);
  });

  test('default heights by gender and the club-search sizes', () => {
    expect(defaultHeightCm('male')).toBe(176);
    expect(defaultHeightCm('female')).toBe(163);
    expect(defaultHeightCm(undefined)).toBe(176);
    expect(expectedShaftPx(2)).toBe(210);
    expect(ballDiameterPx(2)).toBeCloseTo(8.54, 2);
  });
});
