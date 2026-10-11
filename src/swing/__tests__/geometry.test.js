import {
  LM, pt, mid, angleAboveHorizontal, sideOfLine, extendToY, spineTiltDeg, trailShoulder, mirrorX, planeAngles,
} from '../geometry';
import { fixtureSamples, FIXTURE } from './helpers';

const BALL = { x: 273, y: 505 };
const HANDS_ADDRESS = { x: 210, y: 425 };
const { idx, L } = fixtureSamples();
const at = (f) => L[idx.indexOf(f)];
const tilt = (f) => {
  const lm = at(f);
  return spineTiltDeg(mid(pt(lm[LM.lHip]), pt(lm[LM.rHip])), mid(pt(lm[LM.lSh]), pt(lm[LM.rSh])));
};

describe('geometry (ports plane.py)', () => {
  test('angleAboveHorizontal ignores the facing direction', () => {
    expect(angleAboveHorizontal({ x: 0, y: 10 }, { x: 10, y: 0 })).toBeCloseTo(45, 5);
    expect(angleAboveHorizontal({ x: 10, y: 10 }, { x: 0, y: 0 })).toBeCloseTo(45, 5);
    expect(angleAboveHorizontal({ x: 0, y: 0 }, { x: 10, y: 10 })).toBeCloseTo(-45, 5);
  });

  test('shaft plane 52 and shoulder plane 67 degrees at address', () => {
    const planes = planeAngles(BALL, HANDS_ADDRESS, trailShoulder(at(300)));
    expect(planes.shaftPlaneDeg).toBeCloseTo(FIXTURE.expected.shaftPlaneDeg, 0);
    expect(Math.abs(planes.shaftPlaneDeg - 52)).toBeLessThanOrEqual(2);
    expect(Math.abs(planes.shoulderPlaneDeg - 67)).toBeLessThanOrEqual(2);
  });

  test('the trail shoulder is the one nearer the camera, mirrored for left-handers', () => {
    const lm = at(300);
    const right = trailShoulder(lm, 'right');
    const left = trailShoulder(lm, 'left');
    expect(right.x).toBeLessThan(left.x);
  });

  test('spine tilt: 32 degrees at address, about 25 at impact', () => {
    expect(Math.abs(tilt(300) - FIXTURE.expected.spineTiltAddressDeg)).toBeLessThanOrEqual(2);
    expect(Math.abs(tilt(556) - FIXTURE.expected.spineTiltImpactDeg)).toBeLessThanOrEqual(2);
  });

  test('sideOfLine is positive on the ball side and in px', () => {
    // plane.py: the hands at impact sit above the address shaft plane (about 20 px)
    expect(sideOfLine({ x: 220, y: 405 }, BALL, HANDS_ADDRESS)).toBeCloseTo(20.2, 0);
    // a point on the plane is 0, a point below it is negative
    expect(sideOfLine(HANDS_ADDRESS, BALL, HANDS_ADDRESS)).toBeCloseTo(0, 6);
    expect(sideOfLine({ x: 250, y: 520 }, BALL, HANDS_ADDRESS)).toBeLessThan(0);
    // direction of the defining points does not flip the sign
    expect(sideOfLine({ x: 220, y: 405 }, HANDS_ADDRESS, BALL)).toBeCloseTo(20.2, 0);
  });

  test('extendToY: the butt-end line at lead-arm parallel (plane.py marks)', () => {
    // clubhead (115, 270), hands (190, 365): the extension reaches ball height at x = 300.5
    expect(extendToY({ x: 115, y: 270 }, { x: 190, y: 365 }, BALL.y)).toBeCloseTo(300.5, 1);
    expect(extendToY({ x: 0, y: 5 }, { x: 10, y: 5 }, 9)).toBeNull();
  });

  test('mirrorX flips around the ball for left-handers only', () => {
    expect(mirrorX(200, 273, 'right')).toBe(200);
    expect(mirrorX(200, 273, 'left')).toBe(346);
  });
});
