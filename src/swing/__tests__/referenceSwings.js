// Reference swings: pass-1 pose of real swings (landmarks only), written by
// tools/swing-lab/export_fixture.py. Tour players filmed down the line (public videos), one
// face-on clip, and the owner's calibrated swings with the frames he confirmed. Not a test file.
import { analyze } from '../analyze';

const NAMES = [
  'tour-scott-iron', 'tour-oosthuizen-driver', 'tour-els-hybrid', 'tour-mcilroy-iron', 'tour-mcilroy-driver',
  'tour-woods-iron', 'tour-rose-iron', 'faceon-mcilroy-driver',
  'owner-dom-18-oct-01-08', 'owner-dom-18-oct-20-20', 'owner-dom-18-oct-22-34', 'owner-jue-15-oct-17-42', 'owner-vie-16-oct-00-31',
];
export const REFERENCE = NAMES.map((n) => require(`./fixtures/reference/${n}.json`));
/** Tour swings whose positions were checked as right on the stills. */
export const TOUR = REFERENCE.filter((f) => f.name.startsWith('tour-') && f.positions === 'right');
export const OWNER = REFERENCE.filter((f) => f.who === 'owner');
export const byName = (name) => REFERENCE.find((f) => f.name === name);

/** The native analyzePose output for a fixture. */
export function referenceNative(fx) {
  const { width, height, containerFps, frameCount } = fx.video;
  return {
    video: { width, height, containerFps, frameCount },
    frames: fx.frames.map(([i, lm]) => ({ i, tMs: (i / containerFps) * 1000, lm })),
    ball: fx.ball,
    ballGoneFrame: fx.ballGoneFrame,
  };
}

/**
 * Both passes, as runAnalysis does: pass 1, then the address / impact clubhead proposals asked
 * at pass 1's frames (a binary without the club model proposes only those two).
 */
export function analyzeReference(fx) {
  const native = referenceNative(fx);
  const opts = {
    handedness: fx.handedness, heightCm: fx.heightCm, club: fx.club, source: 'import',
    probe: { captureFps: fx.video.captureFps }, marks: fx.marks ?? {},
  };
  const first = analyze(native, opts);
  if (first.error) return first;
  const shaft = {};
  Object.entries(fx.proposals).forEach(([k, p]) => {
    if (p) shaft[first.checkpoints[k].i] = { ...p, source: 'edge' };
  });
  return analyze(native, { ...opts, pass2: { shaft, addressFrame: fx.addressFrame } });
}
