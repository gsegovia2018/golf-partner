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
//                                    addressSearch: { run, latest, quiet, minRun } | null, outDir,
//                                    proxyEvery, proxyDir, proxyRange, clubModel, captureFps })
//                         -> { stills: { [key]: { [frame]: 'file://.../frames/<frame>.jpg' } },
//                              shaft: { [frame]: { head: [x, y] px | null, hidden, conf, source } },
//                              (source 'edge' | 'prior', or from apiVersion 4 'model' | 'model-shaft'; see native.js),
//                              addressFrame: number | null, timings }   (pass 2, plan 3 and D16)
//   extractFrames(videoPath, { frames: number[], outDir })
//                         -> { [frame]: 'file://.../frames/<frame>.jpg' }
//       any frame by index (the Edit marks scrubber). One sequential decode, never a seek per
//       frame; from apiVersion 6 the decoder stays warm between calls (scrubSupport()), and
//       releaseFrames() closes it (releaseFrameDecoder below).
//   detectClub({ frames: [{ frame, still, grip }], video, pxPerCm, scenery })      (apiVersion 5, see native.js)
//                         -> { frames: { [frame]: { head: [x, y] px | null, hidden, conf, source, boxes } }, timings }
//       the club detector on the stills of chosen frames (clubOnDemand.js); releaseClub() closes it.
//   cancelAnalysis()      optional; stops a running analyzePose / extractCheckpoints.
//
// Stills always live in <swing dir>/frames/<frame>.jpg, so getStill() finds them without
// native (Results on a saved swing, a web preview) and ensureStills() only calls native for
// the frames that are missing.
//
// Scrub proxies (D28, apiVersion 3) live in <swing dir>/proxy/<frame>.jpg, one every
// proxyEveryFor() frames of the swing window (PROXY_EVERY, or PROXY_EVERY_DENSE from apiVersion 6),
// written by pass 2 (extractCheckpoints' proxyEvery). The canvas reads the spacing a swing has from
// `pose.pass2.proxies.every`, so swings analysed with either keep working.
// They go with the swing folder. A swing analysed by an older binary has none: getProxy()
// returns null and the canvas keeps the last full-resolution still while scrubbing.

import {
  Paths, File, Directory, displayUri,
} from './fs';
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
export const PROXY_EVERY_DENSE = 2;

/** The proxy spacing to ask a binary for: every 2nd frame from apiVersion 6 (scrubSupport), else every 4th. */
export const proxyEveryFor = (api) => (api?.scrubSupport?.() ? PROXY_EVERY_DENSE : PROXY_EVERY);

/** Closes the scrubber's warm decoder (the canvas unmounts); never throws, a no-op without one. */
export function releaseFrameDecoder() {
  try {
    const api = nativeApi();
    if (api?.scrubSupport?.()) Promise.resolve(api.releaseFrames()).catch(() => {});
  } catch { /* nothing to release */ }
}

const framesDir = (swingId) => new Directory(Paths.document, 'swings', swingId, 'frames');
export const proxyDir = (swingId) => new Directory(Paths.document, 'swings', swingId, 'proxy');
const stillFile = (swingId, frame) => new File(Paths.document, 'swings', swingId, 'frames', `${Math.round(frame)}.jpg`);

// Which stills are known to be on disk, per swing (frame -> uri). The scrubber asks getStill() for
// nine thumbnails and the picture on every drag tick, so a still seen once (on disk, or written by
// ensureStills) is not looked up again. Stills are never deleted while their swing exists, so a hit
// stays true. A miss is never cached for good: it is looked at again after MISS_RECHECK_MS.
const MISS_RECHECK_MS = 500;
const present = new Map(); // swingId -> Map(frame -> uri)
const missedAt = new Map(); // 'swingId/frame' -> ms of the last miss

function remember(swingId, frame, uri) {
  if (!uri) return;
  let m = present.get(swingId);
  if (!m) { m = new Map(); present.set(swingId, m); }
  m.set(frame, uri);
  missedAt.delete(`${swingId}/${frame}`);
}

/** The disk itself, recorded either way. */
function checkDisk(swingId, f) {
  try {
    const file = stillFile(swingId, f);
    if (file.exists) { remember(swingId, f, file.uri); return file.uri; }
  } catch { /* treated as missing */ }
  missedAt.set(`${swingId}/${f}`, Date.now());
  return null;
}

const knownStill = (swingId, f) => present.get(swingId)?.get(f) ?? null;

/** URI of the saved still for a frame, or null when it was never extracted. Synchronous. */
export function getStill(swingId, frame) {
  const f = Math.round(frame);
  const hit = knownStill(swingId, f);
  if (hit) return hit;
  const at = missedAt.get(`${swingId}/${f}`);
  if (at != null && Date.now() - at < MISS_RECHECK_MS) return null;
  return checkDisk(swingId, f);
}

/** What is on disk now (no miss throttling): ensureStills' answers. */
const onDisk = (swingId, f) => knownStill(swingId, f) ?? checkDisk(swingId, f);
const fromDisk = (swingId, wanted) => Object.fromEntries(wanted.map((f) => [f, onDisk(swingId, f)]));

// The last native extractions (frames asked, ms), newest last, for tuning the scrubber on a device.
const TIMINGS_KEPT = 20;
const timings = [];

/** The last TIMINGS_KEPT native extractFrames calls: [{ frames, ms, lane, ok }], oldest first. */
export function stillTimings() { return timings.slice(); }

// One native extraction at a time (the module has a single worker thread, so a second call only
// waits behind the first). Lanes decide who goes first and who is dropped:
//   'target'     the frame the user released on: runs next, replaces any waiting target/neighbour
//                job, and cancels a running target/neighbour job that is now stale. A job that is
//                already extracting the frame (running, or waiting) is kept and waited for instead:
//                cancelling it would throw away a decode that was about to produce it
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
  if (!r || r.dropped || !lanes.includes(r.lane)) return;
  drop(r);
  try { nativeApi()?.cancelAnalysis?.(); } catch { /* the job just runs to its end */ }
}

function logTiming(entry) {
  timings.push(entry);
  if (timings.length > TIMINGS_KEPT) timings.shift();
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log(`[stills] extractFrames ${entry.frames} frame(s) in ${entry.ms} ms (${entry.lane ?? 'fifo'}${entry.ok ? '' : ', failed'})`);
  }
}

async function runJob(job) {
  const t0 = Date.now();
  let ok = false;
  try {
    const dir = framesDir(job.swingId);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const got = await nativeApi().extractFrames(swingVideoUri(job.swingId), { frames: job.missing, outDir: dir.uri });
    ok = true;
    job.missing.forEach((f) => {
      const uri = got?.[f] ?? onDisk(job.swingId, f);
      remember(job.swingId, f, uri);
      job.out[f] = uri;
    });
  } catch { /* leave them null */ }
  logTiming({
    frames: job.missing.length, ms: Date.now() - t0, lane: job.lane, ok,
  });
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
    const uri = onDisk(swingId, f);
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

  // Frames a target / neighbour job is already extracting (the wide prefetch when a position opens,
  // then a stop or the zoomed row inside it): wait for that job instead of starting another.
  // A target keeps it (the job becomes the target, so a later prefetch cannot drop it) and still
  // supersedes the other waiting work; a running job is never cancelled here (it is the one that
  // covers, or a waiting one does and the running one is stale). A prefetch just waits.
  const covers = (j) => j && !j.dropped && j.swingId === swingId && (j.lane === 'target' || j.lane === 'neighbours')
    && missing.every((f) => j.missing.includes(f));
  const host = lane === 'target' || lane === 'neighbours' ? (covers(queue.running) ? queue.running : queue.pending.find(covers)) : null;
  const waitFor = (h) => h.promise.then((got) => {
    const res = { ...out };
    missing.forEach((f) => { res[f] = got?.[f] ?? onDisk(swingId, f); });
    return res;
  });
  if (host && lane === 'neighbours') return waitFor(host);
  if (host) {
    host.lane = 'target';
    queue.pending = queue.pending.filter((j) => {
      if (j === host || (j.lane !== 'target' && j.lane !== 'neighbours')) return true;
      drop(j);
      return false;
    });
    if (host !== queue.running) {
      dropRunning(['target', 'neighbours']);
      queue.pending = [host, ...queue.pending.filter((j) => j !== host)];
    }
    pump();
    return waitFor(host);
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

/** Tests only: forget the queue, the known stills and the timings. */
export function resetStillQueue() {
  queue.pending = []; queue.running = null;
  present.clear(); missedAt.clear(); timings.length = 0;
}

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
  // displayUri: the web serves a stored file from a blob: URL (fs.web.js); a phone's path is already one
  return f == null ? null : displayUri(`${proxyDir(swingId).uri.replace(/\/$/, '')}/${f}.jpg`);
}
