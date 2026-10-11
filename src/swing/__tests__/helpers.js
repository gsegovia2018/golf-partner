// Shared test inputs: the prototype fixture (landmarks only) in the shapes the swing
// package works with. Not a test file (jest only runs *.test.js).

const fixture = require('./fixtures/proto-swing-pose.json');
const truth = require('./fixtures/owner-truth.json');

export const FIXTURE = fixture;
export const TRUTH = truth;
export const W = fixture.width;
export const H = fixture.height;
export const CONTAINER_FPS = fixture.containerFps;

/** Every fixture frame as {i, lm in px} (33 x [x, y, vis]). */
export function fixtureSamples() {
  const idx = [];
  const L = [];
  fixture.frames.forEach((lm, k) => {
    if (!lm) return;
    idx.push(fixture.firstFrame + k);
    L.push(lm.map(([x, y, v]) => [x * W, y * H, v]));
  });
  return { idx, L };
}

/** The native analyzePose output (plan 3) for the fixture: normalised landmarks. */
export function fixtureNative(extra = {}) {
  return {
    video: { width: W, height: H, containerFps: CONTAINER_FPS, frameCount: fixture.totalFramesInClip },
    frames: fixture.frames.map((lm, k) => ({
      i: fixture.firstFrame + k,
      tMs: ((fixture.firstFrame + k) / CONTAINER_FPS) * 1000,
      lm,
    })),
    ...extra,
  };
}

/** A flat standing pose in px for synthetic tests; override landmarks by index. */
export function makeLm(over = {}) {
  const lm = Array.from({ length: 33 }, () => [100, 100, 0.9]);
  Object.entries(over).forEach(([k, v]) => {
    lm[k] = v;
  });
  return lm;
}
