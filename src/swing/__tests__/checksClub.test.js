// Per-club thresholds (plan 5.4, D19): iron is the owner-reviewed column and must not move;
// driver is provisional. Boundaries are driven with tiny synthetic inputs (1 px = 1 cm).
import {
  runChecks, THRESHOLDS, CLUBS, DEFAULT_CLUB, normClub,
} from '../checks';
import { scaleFromWindow } from '../scale';
import { fixtureSamples, TRUTH } from './helpers';

const rad = (d) => (d * Math.PI) / 180;
const LMN = 33;

/** A 33-landmark pose with the shoulders `tilt` degrees off vertical over level hips. */
const pose33 = ({ tilt = 30, nose = [0, -150] } = {}) => {
  const lm = Array.from({ length: LMN }, () => [0, 0, 1]);
  const sh = [100 * Math.sin(rad(tilt)), -100 * Math.cos(rad(tilt)), 1];
  lm[11] = sh;
  lm[12] = sh;
  lm[23] = [0, 0, 1];
  lm[24] = [0, 0, 1];
  lm[0] = [nose[0], nose[1], 1];
  return lm;
};

const run = (club, input) => runChecks({
  ball: { x: 0, y: 200 }, handedness: 'right', pxPerCm: 1, heightCm: 176, club, ...input,
}).checks;
const one = (club, id, input, cp) => run(club, input).find((c) => c.id === id && (!cp || c.cp === cp));
const status = (club, id, input, cp) => one(club, id, input, cp).status;

const H = (x, y) => ({ x, y });
const at = (frame, hands, head = null) => ({
  frame, hands, head, hidden: false, source: 'user',
});

// D21: the setup and top-position limits, provisional and the same for both clubs.
const SETUP_TOP = {
  handsUnderShoulders: [4, 8],
  waistBend: { green: [125, 145], yellow: [115, 155] },
  backLine: [10, 20],
  handGap: { green: [10, 20], yellow: [6, 25] },
  handsOverHeels: [6, 12],
  leadArmPlane: [10, 20],
};

describe('THRESHOLDS table (D19)', () => {
  test('two clubs, iron the default, anything unknown reads as iron', () => {
    expect(CLUBS).toEqual(['iron', 'driver']);
    expect(DEFAULT_CLUB).toBe('iron');
    expect(Object.keys(THRESHOLDS)).toEqual(['iron', 'driver']);
    ['wood', 'wedge', '', null, undefined].forEach((c) => expect(normClub(c)).toBe('iron'));
    expect(normClub('driver')).toBe('driver');
  });

  test('iron keeps the original values; driver is the provisional column', () => {
    expect(THRESHOLDS.iron).toEqual({
      posture: { green: [25, 40], yellow: [20, 45] },
      handsHeight: [5, 8],
      shaftAngle: [6, 10],
      spineLoss: [3, 6],
      clubheadPlane: { green: 4, yellow: 8 },
      buttYellowCm: 15,
      headDrift: [5, 10],
      ...SETUP_TOP,
    });
    expect(THRESHOLDS.driver).toEqual({
      posture: { green: [20, 35], yellow: [15, 40] },
      handsHeight: [8, 12],
      shaftAngle: [8, 12],
      spineLoss: [4, 7],
      clubheadPlane: { green: 6, yellow: 10 },
      buttYellowCm: 20,
      headDrift: [6, 12],
      ...SETUP_TOP,
    });
  });
});

describe('each club-aware check, [measured, iron, driver]', () => {
  test('posture_address spine tilt', () => {
    [
      [30, 'green', 'green'], [37, 'green', 'yellow'], [42, 'yellow', 'red'], [22, 'yellow', 'green'],
      [17, 'red', 'yellow'], [12, 'red', 'red'], [47, 'red', 'red'],
    ].forEach(([t, iron, driver]) => {
      const input = { checkpoints: { address: at(1, H(0, 0)) }, pose: () => pose33({ tilt: t }) };
      expect([t, status('iron', 'posture_address', input)]).toEqual([t, iron]);
      expect([t, status('driver', 'posture_address', input)]).toEqual([t, driver]);
    });
  });

  test('the posture text quotes the green range of the club', () => {
    const input = { checkpoints: { address: at(1, H(0, 0)) }, pose: () => pose33({ tilt: 30 }) };
    expect(one('iron', 'posture_address', input).text).toMatch(/25–40°/);
    expect(one('driver', 'posture_address', input).text).toMatch(/20–35°/);
  });

  test('hands_height_impact', () => {
    [[4, 'green', 'green'], [7, 'yellow', 'green'], [10, 'red', 'yellow'], [13, 'red', 'red']].forEach(([d, iron, driver]) => {
      const input = { checkpoints: { address: at(1, H(0, 100)), impact: at(2, H(0, 100 - d)) }, pose: () => null };
      expect([d, status('iron', 'hands_height_impact', input)]).toEqual([d, iron]);
      expect([d, status('driver', 'hands_height_impact', input)]).toEqual([d, driver]);
    });
  });

  test('shaft_angle_impact', () => {
    const headAt = (hands, deg) => H(hands.x + 100 * Math.cos(rad(deg)), hands.y + 100 * Math.sin(rad(deg)));
    [[5, 'green', 'green'], [7, 'yellow', 'green'], [9, 'yellow', 'yellow'], [11, 'red', 'yellow'], [13, 'red', 'red']].forEach(([d, iron, driver]) => {
      const a = H(0, 100);
      const i = H(0, 100);
      const input = { checkpoints: { address: at(1, a, headAt(a, 30)), impact: at(2, i, headAt(i, 30 + d)) }, pose: () => null };
      expect([d, status('iron', 'shaft_angle_impact', input)]).toEqual([d, iron]);
      expect([d, status('driver', 'shaft_angle_impact', input)]).toEqual([d, driver]);
    });
  });

  test('spine_loss', () => {
    [[2, 'green', 'green'], [5, 'yellow', 'yellow'], [6.5, 'red', 'yellow'], [8, 'red', 'red']].forEach(([loss, iron, driver]) => {
      const input = {
        checkpoints: { address: at(1, H(0, 0)), impact: at(2, H(0, 0)) },
        pose: (f) => pose33({ tilt: f === 1 ? 35 : 35 - loss }),
      };
      expect([loss, status('iron', 'spine_loss', input)]).toEqual([loss, iron]);
      expect([loss, status('driver', 'spine_loss', input)]).toEqual([loss, driver]);
    });
  });

  test('head_drift', () => {
    [[4, 'green', 'green'], [5.5, 'yellow', 'green'], [8, 'yellow', 'yellow'], [11, 'red', 'yellow'], [13, 'red', 'red']].forEach(([d, iron, driver]) => {
      const input = {
        checkpoints: { address: at(1, H(0, 0)), impact: at(2, H(0, 0)) },
        pose: (f) => pose33({ nose: [f === 1 ? 0 : d, -150] }),
      };
      expect([d, status('iron', 'head_drift', input)]).toEqual([d, iron]);
      expect([d, status('driver', 'head_drift', input)]).toEqual([d, driver]);
    });
  });

  test('clubhead_vs_plane, impact (steep and under)', () => {
    [
      [3, 'green', 'green'], [5, 'yellow', 'green'], [7, 'yellow', 'yellow'], [9, 'red', 'yellow'], [11, 'red', 'red'],
      [-5, 'yellow', 'green'], [-7, 'yellow', 'yellow'], [-20, 'yellow', 'yellow'],
    ].forEach(([d, iron, driver]) => {
      const input = {
        checkpoints: { address: at(1, H(0, 100)), impact: at(2, H(0, 100), H(d, 160)) },
        pose: () => null,
      };
      expect([d, status('iron', 'clubhead_vs_plane', input, 'impact')]).toEqual([d, iron]);
      expect([d, status('driver', 'clubhead_vs_plane', input, 'impact')]).toEqual([d, driver]);
    });
  });

  test('butt_extension: yellow up to 15 cm for iron, 20 cm for driver, beyond the ball and inside the toes', () => {
    // Beyond the ball: the butt-end line lands `d` cm past it.
    [[10, 'yellow', 'yellow'], [17, 'red', 'yellow'], [22, 'red', 'red']].forEach(([d, iron, driver]) => {
      const input = { checkpoints: { leadArm: at(1, H(0, 100), H(-d, 0)) }, pose: () => null };
      expect([d, status('iron', 'butt_extension', input)]).toEqual([d, iron]);
      expect([d, status('driver', 'butt_extension', input)]).toEqual([d, driver]);
    });
    // Inside the toes (steep): toes at x = -100, landing d cm inside them (the 10 % margin is 10 cm).
    [[10, 'yellow', 'yellow'], [17, 'red', 'yellow'], [22, 'red', 'red']].forEach(([d, iron, driver]) => {
      const toes = pose33();
      toes[31] = [-100, 200, 1];
      toes[32] = [-100, 200, 1];
      // landing x = -100 + 10 (margin) - d  ->  head.x = -(landing) when hands are at x = 0
      const landing = -100 + 10 - d;
      const input = { checkpoints: { address: at(1, H(0, 0)), leadArm: at(2, H(0, 100), H(-landing, 0)) }, pose: (f) => (f === 1 ? toes : null) };
      expect([d, status('iron', 'butt_extension', input)]).toEqual([d, iron]);
      expect([d, status('driver', 'butt_extension', input)]).toEqual([d, driver]);
    });
  });
});

describe('the golden owner swing', () => {
  const { idx, L } = fixtureSamples();
  const poseAt = (f) => (idx.includes(f) ? L[idx.indexOf(f)] : null);
  const scale = scaleFromWindow(idx, L, [328, 338], 'right', 176);
  const marks = () => {
    const out = Object.fromEntries(Object.entries(TRUTH.checkpoints).map(([k, c]) => [k, {
      frame: c.frame, hands: c.hands, head: c.hidden ? null : c.head, hidden: c.hidden, source: 'user',
    }]));
    out.preImpact = { frame: 550, hands: { x: 222, y: 400 }, head: { x: 240, y: 470 }, hidden: false, source: 'user' };
    return out;
  };
  const score = (club) => runChecks({
    checkpoints: marks(), ball: TRUTH.ball, pose: poseAt, handedness: 'right', pxPerCm: scale.pxPerCm, heightCm: 176, motionStart: 385, finishQuietS: 0.6, club,
  }).checks;
  const key = (c) => `${c.id}${c.cp ? `@${c.cp}` : ''}`;
  const statuses = (checks) => Object.fromEntries(checks.map((c) => [key(c), c.status]));

  test('as iron it is exactly the old result, and no club, null and iron agree', () => {
    const iron = score('iron');
    expect(score(undefined)).toEqual(iron);
    expect(score(null)).toEqual(iron);
    expect(statuses(iron)).toMatchObject({
      posture_address: 'green', butt_extension: 'red', hands_height_impact: 'red', shaft_angle_impact: 'yellow',
      spine_loss: 'red', head_drift: 'yellow', 'clubhead_vs_plane@impact': 'green',
    });
  });

  test('scored as a driver the affected statuses shift and nothing else does', () => {
    const iron = statuses(score('iron'));
    const driver = statuses(score('driver'));
    expect(driver.butt_extension).toBe('yellow'); // red -> yellow: 20 cm limit
    expect(driver.hands_height_impact).toBe('yellow'); // red -> yellow: band(8, 12)
    const changed = Object.keys(iron).filter((k) => iron[k] !== driver[k]).sort();
    expect(changed).toEqual(['butt_extension', 'hands_height_impact']);
  });
});
