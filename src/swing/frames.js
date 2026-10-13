// Stills for the swing screens: the seam between the screens and the native module that
// another PR owns (modules/golf-swing + src/swing/native.js).
//
// NATIVE METHODS THIS FILE AND runAnalysis.js EXPECT (names and arguments; the native PR
// should match them or tell us to). Every method is async and lives on the module object
// exported by src/swing/native.js (or its default export). Paths are the file:// URIs the
// swing store hands out (swingVideoUri). Coordinates are normalised (0-1) unless a field
// says "px" (pixels of the decoded frame).
//
//   probeVideo(videoPath) -> { width, height, durationMs, frameCount, containerFps,
//                              captureFps | null, rotationDeg, hdr, duplicateFrameRatio: null }
//   analyzePose(videoPath, { model: 'full' | 'lite', handedness, heightCm, captureFps })
//                         -> { video: { width, height, containerFps, frameCount },
//                              frames: [{ i, tMs, lm: [[x, y, vis] x 33] }],
//                              ball: { x, y, r } | null, ballGoneFrame: number | null,
//                              duplicateFrameRatio, timings }
//       emits 'progress' { stage: 'decode' | 'pose', done, total } through
//       module.addListener('progress', cb) -> { remove() }
//   extractCheckpoints(videoPath, { frames: [{ key, i, hands: [x, y], neighbours: 2 }],
//                                    ball: { x, y, r } | null, expectedShaftPx,
//                                    addressSearch: { run, latest, quiet, minRun } | null, outDir })
//                         -> { stills: { [key]: { [frame]: 'file://.../frames/<frame>.jpg' } },
//                              shaft: { [frame]: { head: [x, y] px | null, hidden, conf, source } },
//                              addressFrame: number | null, timings }   (pass 2, plan 3 and D16)
//   extractFrames(videoPath, { frames: number[], outDir })
//                         -> { [frame]: 'file://.../frames/<frame>.jpg' }
//       any frame by index (the Edit marks scrubber). One sequential decode, never a seek per
//       frame.
//   cancelAnalysis()      optional; stops a running analyzePose / extractCheckpoints.
//
// Stills always live in <swing dir>/frames/<frame>.jpg, so getStill() finds them without
// native (Results on a saved swing, a web preview) and ensureStills() only calls native for
// the frames that are missing.
//
// Scrub proxies (D28, apiVersion 3) live in <swing dir>/proxy/<frame>.jpg, one every
// PROXY_EVERY frames of the whole clip, written by pass 2 (extractCheckpoints' proxyEvery).
// They go with the swing folder. A swing analysed by an older binary has none: getProxy()
// returns null and the canvas keeps the last full-resolution still while scrubbing.

import { Paths, File, Directory } from 'expo-file-system';
import { getSwingAvailability } from './availability';
import { swingVideoUri } from '../store/swingStore';

/** The native module's API object, or null when this build has none. */
export function nativeApi() {
  if (!getSwingAvailability().supported) return null;
  try {
    const m = require('./native');
    return m?.analyzePose ? m : m?.default ?? null;
  } catch {
    return null;
  }
}

export const PROXY_EVERY = 4;

const framesDir = (swingId) => new Directory(Paths.document, 'swings', swingId, 'frames');
export const proxyDir = (swingId) => new Directory(Paths.document, 'swings', swingId, 'proxy');
const stillFile = (swingId, frame) => new File(Paths.document, 'swings', swingId, 'frames', `${Math.round(frame)}.jpg`);

/** URI of the saved still for a frame, or null when it was never extracted. Synchronous. */
export function getStill(swingId, frame) {
  try {
    const f = stillFile(swingId, frame);
    return f.exists ? f.uri : null;
  } catch {
    return null;
  }
}

/**
 * Make sure the given frames have stills. Frames already on disk are returned as they are;
 * the rest are extracted by native when it is available. Resolves to { [frame]: uri | null }
 * and never rejects: a missing still is a state the screens draw, not an error.
 */
export async function ensureStills(swingId, frames) {
  const wanted = [...new Set(frames.map((f) => Math.round(f)))];
  const out = {};
  const missing = [];
  wanted.forEach((f) => {
    const uri = getStill(swingId, f);
    out[f] = uri;
    if (!uri) missing.push(f);
  });
  if (!missing.length) return out;
  const api = nativeApi();
  if (!api?.extractFrames) return out;
  try {
    const dir = framesDir(swingId);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const got = await api.extractFrames(swingVideoUri(swingId), { frames: missing, outDir: dir.uri });
    missing.forEach((f) => { out[f] = got?.[f] ?? getStill(swingId, f); });
  } catch { /* leave them null */ }
  return out;
}

/** The proxy frames nearest to `frame`, best first (rounded, then rounded down: the clip's tail). */
export function proxyFrames(frame, every = PROXY_EVERY) {
  const f = Math.max(0, Math.round(frame));
  const near = Math.round(f / every) * every;
  const down = Math.floor(f / every) * every;
  return near === down ? [near] : [near, down];
}

/** URI of the scrub proxy nearest to a frame, or null (none written for this swing). Synchronous. */
export function getProxy(swingId, frame) {
  try {
    for (const f of proxyFrames(frame)) {
      const file = new File(Paths.document, 'swings', swingId, 'proxy', `${f}.jpg`);
      if (file.exists) return file.uri;
    }
  } catch { /* none */ }
  return null;
}
