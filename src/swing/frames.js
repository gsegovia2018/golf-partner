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

const fromDisk = (swingId, wanted) => Object.fromEntries(wanted.map((f) => [f, getStill(swingId, f)]));

// One native extraction at a time (the module has a single worker thread, so a second call only
// waits behind the first). Lanes decide who goes first and who is dropped:
//   'target'     the frame the user released on: runs next, replaces any waiting target/neighbour
//                job, and cancels a running target/neighbour job that is now stale
//   'neighbours' prefetch around it: waits behind targets, replaced by a newer prefetch, dropped
//                (cancelled if running) as soon as a target arrives
//   undefined    everything else (Results, Compare): plain FIFO, never dropped, never cancelled
// A dropped job resolves at once with whatever is on disk, like a failed one.
const queue = { pending: [], running: null };
const sameFrames = (a, b) => a.length === b.length && a.every((f, i) => f === b[i]);

function drop(job) {
  job.dropped = true;
  job.resolve(fromDisk(job.swingId, job.wanted));
}

function dropRunning(lanes) {
  const r = queue.running;
  if (!r || !lanes.includes(r.lane)) return;
  drop(r);
  try { nativeApi()?.cancelAnalysis?.(); } catch { /* the job just runs to its end */ }
}

async function runJob(job) {
  try {
    const dir = framesDir(job.swingId);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const got = await nativeApi().extractFrames(swingVideoUri(job.swingId), { frames: job.missing, outDir: dir.uri });
    job.missing.forEach((f) => { job.out[f] = got?.[f] ?? getStill(job.swingId, f); });
  } catch { /* leave them null */ }
  job.resolve(job.out);
}

function pump() {
  if (queue.running || !queue.pending.length) return;
  const job = queue.pending.shift();
  queue.running = job;
  runJob(job).finally(() => { queue.running = null; pump(); });
}

/**
 * Make sure the given frames have stills. Frames already on disk are returned as they are;
 * the rest are extracted by native when it is available. Resolves to { [frame]: uri | null }
 * and never rejects: a missing still is a state the screens draw, not an error.
 * `lane` ('target' | 'neighbours') opts into priority and supersede, see above.
 */
export function ensureStills(swingId, frames, lane) {
  const wanted = [...new Set(frames.map((f) => Math.round(f)))];
  const out = {};
  const missing = [];
  wanted.forEach((f) => {
    const uri = getStill(swingId, f);
    out[f] = uri;
    if (!uri) missing.push(f);
  });
  if (!missing.length) return Promise.resolve(out);
  if (!nativeApi()?.extractFrames) return Promise.resolve(out);
  missing.sort((a, b) => a - b);

  // The same lane already asked for exactly this (a re-render): share it.
  if (lane) {
    const same = [queue.running, ...queue.pending].find((j) => j && !j.dropped && j.lane === lane && j.swingId === swingId && sameFrames(j.missing, missing));
    if (same) return same.promise;
  }
  const job = { swingId, wanted, missing, out, lane, dropped: false, resolve: null };
  job.promise = new Promise((resolve) => { job.resolve = resolve; });

  if (lane === 'target') {
    queue.pending = queue.pending.filter((j) => {
      if (j.lane !== 'target' && j.lane !== 'neighbours') return true;
      drop(j);
      return false;
    });
    dropRunning(['target', 'neighbours']);
    queue.pending.unshift(job);
  } else if (lane === 'neighbours') {
    queue.pending = queue.pending.filter((j) => {
      if (j.lane !== 'neighbours') return true;
      drop(j);
      return false;
    });
    dropRunning(['neighbours']);
    const at = queue.pending.findIndex((j) => j.lane !== 'target');
    queue.pending.splice(at < 0 ? queue.pending.length : at, 0, job);
  } else {
    queue.pending.push(job);
  }
  pump();
  return job.promise;
}

/** Tests only: forget the queue. */
export function resetStillQueue() { queue.pending = []; queue.running = null; }

/**
 * The swing window pass 2 writes proxies for (D28): about one second before the motion starts to
 * half a second after the finish, in container frames, clamped to the clip. Outside it the canvas
 * uses stills.
 */
export function proxyWindow(analysis, frameCount) {
  const fps = analysis?.fps?.capture || 240;
  const start = analysis?.internal?.motionStart ?? analysis?.checkpoints?.address?.i ?? 0;
  const finish = analysis?.checkpoints?.finish?.i ?? frameCount - 1;
  const last = Math.max(0, frameCount - 1);
  return [Math.max(0, Math.round(start - fps)), Math.min(last, Math.round(finish + fps / 2))];
}

/**
 * The proxy frame nearest to `frame` for the proxies a swing has (`pose.pass2.proxies`: { every,
 * from, to }, as native reported them), or null outside them. Pure: no file is touched per call.
 */
export function proxyFrame(frame, proxies) {
  if (!proxies?.every || !(proxies.to >= proxies.from)) return null;
  const f = Math.round(frame);
  if (f < proxies.from - proxies.every / 2 || f > proxies.to + proxies.every / 2) return null;
  const near = Math.round(f / proxies.every) * proxies.every;
  return Math.min(proxies.to, Math.max(proxies.from, near));
}

/** URI of the scrub proxy nearest to a frame, or null (none for this swing or this frame). Synchronous, no I/O. */
export function getProxy(swingId, frame, proxies) {
  const f = proxyFrame(frame, proxies);
  return f == null ? null : `${proxyDir(swingId).uri.replace(/\/$/, '')}/${f}.jpg`;
}
