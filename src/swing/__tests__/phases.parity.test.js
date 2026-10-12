// Parity with the swing lab reference: the same pass-1 pose samples go through
// tools/swing-lab/detect.py --variant d15 (expected) and through phases.js. Two inputs: the
// lab's speed policy (455 inferences) and sparse165, the native app's policy (218 samples:
// every 16th frame still, every 4th or 2nd moving, every frame only top -> impact).
import { detectPhases, CHECKPOINT_KEYS } from '../phases';
import { scaleFromWindow } from '../scale';

const FIXTURES = [
  ['speed policy', require('./fixtures/lab-d15-pass1.json')],
  ['sparse165', require('./fixtures/lab-d15-sparse165-pass1.json')],
];

function labSamples(lab) {
  const L = lab.data.map((rows) => {
    const lm = Array.from({ length: 33 }, () => [0, 0, 0]);
    lab.landmarks.forEach((id, n) => {
      lm[id] = rows[n];
    });
    return lm;
  });
  return { idx: lab.idx, L };
}

describe.each(FIXTURES)('phases.js matches detect.py --variant d15 on the lab pass-1 samples (%s)', (_name, lab) => {
  const { idx, L } = labSamples(lab);
  const run = () => detectPhases(idx, L, {
    containerFps: lab.containerFps,
    bodyH: lab.bodyH,
    ballGoneFrame: lab.expected.ballGoneFrame,
    addressFrame: lab.expected.addressFrame,
  });

  test('slow-mo factor 8 is estimated from the downswing', () => {
    const r = run();
    expect(r.fps.factor).toBe(lab.expected.factor);
    expect(r.fps.source).toBe('estimate');
    expect(r.fps.approximate).toBe(false);
  });

  test('every checkpoint equals the lab frame', () => {
    const r = run();
    const got = Object.fromEntries(CHECKPOINT_KEYS.map((k) => [k, r.checkpoints[k].i]));
    expect(got).toEqual(lab.expected.checkpoints);
  });

  test('internal quantities match: motionStart, hands top, per-clip jitter, arm length', () => {
    const r = run();
    expect(r.internal.motionStart).toBe(lab.expected.motionStart);
    expect(r.internal.handsTop).toBe(lab.expected.handsTop);
    expect(r.sigmaGrip).toBeCloseTo(lab.expected.sigmaGripPx, 1);
    expect(r.series.armPx).toBeCloseTo(lab.expected.armPx, 1);
    expect(r.sources).toEqual({ impact: 'ballGoneFrame', address: 'clubhead-onset' });
  });

  test('the pass-2 address window is the one detect.py hands to clubhead_onset', () => {
    const r = run();
    const { motionStart, holdFrames, checkpoints } = lab.expected;
    expect(r.addressSearch).toEqual({
      run: [r.addressRun[0], motionStart + holdFrames],
      latest: motionStart,
      quiet: [checkpoints.leadArm, checkpoints.top],
      minRun: 5, // ceil(0.02 s x 240 fps)
    });
  });

  test('scale from the address window matches the lab', () => {
    const r = run();
    const [a0, a1] = r.addressRun;
    const s = scaleFromWindow(idx, L, [a0, a1], 'right', 176);
    expect(s.legPx).toBeCloseTo(lab.expected.legPx, 0);
    expect(s.pxPerCm).toBeCloseTo(lab.expected.pxPerCm, 2);
  });

  test('without the image signals it falls back to the pose (confidence lower)', () => {
    const r = detectPhases(idx, L, { containerFps: lab.containerFps, bodyH: lab.bodyH });
    expect(r.sources).toEqual({ impact: 'pose', address: 'pose-motionStart' });
    expect(r.checkpoints.address.i).toBe(r.internal.motionStart);
    expect(r.checkpoints.address.conf).toBe(0.5);
    expect(r.checkpoints.impact.conf).toBe(0.5);
  });
});
