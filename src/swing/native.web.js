// The GolfSwing bridge on the web: the same contract as native.js (read its comments for every
// method), implemented in the browser by src/swing/web/ (plan 2026-10-23-swing-analyzer-web).
// Metro picks this file for web builds; Android keeps native.js and the Kotlin module.
//
// What the web has: analysis (probe, pass 1, pass 2 with stills, proxies and the club model) and
// the scrubber's frames, at apiVersion 6. What it doesn't: recording (no browser records
// high-speed video), so captureSupport() says 'platform' and the UI offers import only.
//
// Jobs run one at a time, like the module's single worker thread: a scrubber request made during
// an analysis waits behind it. detectClub has its own lane (the module's club thread).

import { t } from '../i18n';
import { openClip } from './web/source';
import { analyzePoseWeb } from './web/analyzePose';
import { extractCheckpointsWeb } from './web/checkpoints';
import { openClubDetector } from './web/club';
import { ClubWarm, timeoutScheduler, Lru } from './web/core/framePlan';
import { ClubOnDemand } from './web/core/clubOnDemand';
import { ClubDecode } from './web/core/clubDecode';
import { CancelledError } from './web/core/geom';
import { WebFrame, makeCanvas, canvasJpeg } from './web/webFrame';
import { File, blobOf } from './fs';
import { browserCanAnalyse } from './web/support';

export const REQUIRED_API_VERSION = 2;
export const CAPTURE_API_VERSION = 2;
export const PROXY_API_VERSION = 3;
export const CLUB_MODEL_API_VERSION = 4;
export const CLUB_ONDEMAND_API_VERSION = 5;
export const SCRUB_API_VERSION = 6;

/** The web implementation's contract version (GolfSwingModule.kt API_VERSION). */
const WEB_API_VERSION = 6;

const STILL_QUALITY = 0.85;
/** The scrubber's decoder stays open this long after its last request (FrameSessions). */
const FRAMES_IDLE_MS = 5000;

export const updateAppMessage = () => t('misc.swing.updateApp');

export const updateCaptureMessage = () => t('misc.swing.updateCapture');

let supported;

export function apiVersion() {
  if (supported === undefined) supported = browserCanAnalyse();
  return supported ? WEB_API_VERSION : null;
}

export function swingSupport() {
  if (apiVersion() === null) return { supported: false, reason: 'platform', apiVersion: null, message: null };
  return { supported: true, reason: null, apiVersion: WEB_API_VERSION, message: null };
}

/** No recording in a browser: import only. */
export function captureSupport() {
  return { supported: false, reason: 'platform', apiVersion: apiVersion(), message: null };
}

export const proxySupport = () => swingSupport().supported;
export const clubModelSupport = () => swingSupport().supported;
export const scrubSupport = () => swingSupport().supported;
export const clubOnDemandSupport = () => swingSupport().supported;

export async function listRecordingModes() {
  const err = new Error(t('misc.swing.recordingUnavailable'));
  err.code = 'ERR_UNSUPPORTED';
  throw err;
}

export const getCameraView = () => null;

// --- events ------------------------------------------------------------------------

const listeners = new Map(); // event -> Set

export function addListener(eventName, listener) {
  if (!listeners.has(eventName)) listeners.set(eventName, new Set());
  listeners.get(eventName).add(listener);
  return { remove() { listeners.get(eventName)?.delete(listener); } };
}

export const addProgressListener = (listener) => addListener('progress', listener);

function emit(eventName, payload) {
  listeners.get(eventName)?.forEach((l) => { try { l(payload); } catch { /* a listener's problem */ } });
}

// --- jobs --------------------------------------------------------------------------

const tokens = new Set();
let lane = Promise.resolve();
let busy = false;

function fail(code, e) {
  if (e?.code === 'ERR_CANCELLED' || e instanceof CancelledError) {
    const c = new Error('cancelled');
    c.code = 'ERR_CANCELLED';
    return c;
  }
  if (e?.code === 'ERR_UNSUPPORTED_VIDEO') return e;
  const err = new Error(e?.message ?? String(e));
  err.code = code;
  return err;
}

/** Runs `work(cancelled)` on the single lane; rejects with `code` (or the cancel / unsupported codes). */
function job(code, work) {
  const token = { cancelled: false };
  tokens.add(token);
  const run = lane.then(async () => {
    if (token.cancelled) throw new CancelledError();
    return work(() => token.cancelled);
  });
  lane = run.catch(() => {});
  return run.then(
    (v) => { tokens.delete(token); return v; },
    (e) => {
      tokens.delete(token);
      const err = fail(code, e);
      // runAnalysis keeps a failed pass 2 quiet (the swing stays usable): say why in the console
      if (err.code !== 'ERR_CANCELLED') console.warn(`[swing] ${code}: ${e?.stack ?? e}`);
      throw err;
    },
  );
}

export function cancelAnalysis() {
  tokens.forEach((tk) => { tk.cancelled = true; });
}

// --- clips -------------------------------------------------------------------------

// The last clips opened (sample tables, decoders): pass 1, pass 2 and the scrubber reuse them.
const clips = new Lru(2);
const opened = new Map(); // path -> Promise<clip>

async function clipFor(path) {
  if (!opened.has(path)) {
    const p = (async () => {
      const blob = await blobOf(path);
      // the element fallback plays the file: our own blob: URL, or one made for it
      const url = String(path).startsWith('blob:') ? path : URL.createObjectURL(blob);
      return openClip(blob, { url });
    })();
    opened.set(path, p);
    p.catch(() => opened.delete(path));
    // Lru evicts the oldest: close its decoder
    clips.getOrPut(path, () => p);
    [...opened.keys()].filter((k) => !clips.keys.has(k)).forEach((k) => {
      opened.get(k).then((c) => c.close(), () => {});
      opened.delete(k);
    });
  }
  return opened.get(path);
}

async function writeFile(dirUri, name, blob) {
  const f = new File(dirUri, name);
  f.write(blob);
  return f.uri;
}

// --- the contract ------------------------------------------------------------------

export async function probeVideo(path) {
  return job('ERR_PROBE', async () => {
    const { track } = await clipFor(path);
    return {
      width: track.dispW,
      height: track.dispH,
      durationMs: track.durationUs / 1000,
      frameCount: track.ptsUs.length,
      containerFps: track.containerFps,
      captureFps: track.captureFps,
      rotationDeg: track.rotation,
      hdr: track.hdr,
      duplicateFrameRatio: null,
    };
  });
}

export async function analyzePose(path, opts = {}) {
  if (busy) {
    const err = new Error('an analysis is already running');
    err.code = 'ERR_BUSY';
    throw err;
  }
  busy = true;
  try {
    return await job('ERR_ANALYZE', async (cancelled) => {
      releaseFramesNow();
      const clip = await clipFor(path);
      return analyzePoseWeb(clip, opts, {
        cancelled,
        progress: (stage, done, total) => emit('progress', { stage, done, total }),
      });
    });
  } finally {
    busy = false;
  }
}

export async function extractCheckpoints(path, opts) {
  return job('ERR_STILLS', async (cancelled) => {
    releaseFramesNow();
    const clip = await clipFor(path);
    return extractCheckpointsWeb(clip, opts, { cancelled, write: writeFile, openDetector: openClubDetector });
  });
}

// The scrubber's frames: the clip's decoder resumes forward between requests (source.js), so a
// warm session is just the clip kept open; it closes FRAMES_IDLE_MS after the last request.
let framesIdle = null;
let framesPath = null;

function releaseFramesNow() {
  if (framesIdle) clearTimeout(framesIdle);
  framesIdle = null;
  framesPath = null;
}

export async function extractFrames(path, opts) {
  return job('ERR_STILLS', async (cancelled) => {
    if (framesIdle) clearTimeout(framesIdle);
    framesPath = path;
    const clip = await clipFor(path);
    const n = clip.track.ptsUs.length;
    const wanted = new Set((opts?.frames ?? []).map((f) => Math.round(f)).filter((f) => f >= 0 && f < n));
    const out = {};
    if (wanted.size) {
      const lo = Math.min(...wanted);
      const hi = Math.max(...wanted);
      const writes = [];
      for await (const d of clip.frames(lo, hi, { cancelled, want: (f) => wanted.has(f) })) {
        if (cancelled()) throw new CancelledError();
        if (!wanted.has(d.frame) || out[d.frame]) continue;
        const c = new WebFrame(d, clip.track).full();
        const f = d.frame;
        out[f] = true;
        writes.push(canvasJpeg(c, STILL_QUALITY).then((b) => writeFile(opts.outDir, `${f}.jpg`, b)).then((uri) => { out[f] = uri; }));
      }
      await Promise.all(writes);
    }
    framesIdle = setTimeout(() => { framesIdle = null; framesPath = null; }, FRAMES_IDLE_MS);
    return Object.fromEntries(Object.entries(out).filter(([, v]) => typeof v === 'string'));
  });
}

export async function releaseFrames() {
  const p = framesPath;
  releaseFramesNow();
  if (p && opened.has(p)) {
    // closing the decoder frees it; the clip reopens it on the next request
    (await opened.get(p)).close();
  }
}

// --- the club detector on demand (its own lane) ------------------------------------

const clubWarm = new ClubWarm(() => openClubDetector(), timeoutScheduler);
let clubLane = Promise.resolve();

async function loadStill(uri) {
  const blob = await blobOf(uri);
  const bmp = await createImageBitmap(blob);
  try {
    const c = makeCanvas(ClubDecode.SIZE, ClubDecode.SIZE);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, ClubDecode.SIZE, ClubDecode.SIZE);
    const d = ctx.getImageData(0, 0, ClubDecode.SIZE, ClubDecode.SIZE).data;
    const rgb = new Uint8Array(ClubDecode.SIZE * ClubDecode.SIZE * 3);
    for (let i = 0, k = 0; k < d.length; i += 3, k += 4) {
      rgb[i] = d[k];
      rgb[i + 1] = d[k + 1];
      rgb[i + 2] = d[k + 2];
    }
    return { rgb, width: bmp.width, height: bmp.height };
  } finally {
    bmp.close?.();
  }
}

export async function detectClub(opts) {
  const finite = (v) => (Number.isFinite(v) && v > 0 ? v : null);
  const req = {
    frames: (opts?.frames ?? []).map((f) => ({
      frame: f.frame,
      still: f.still,
      grip: Array.isArray(f.grip) && f.grip.length >= 2 && Number.isFinite(f.grip[0]) && Number.isFinite(f.grip[1]) ? { x: f.grip[0], y: f.grip[1] } : null,
    })),
    width: finite(opts?.video?.width) ?? 0,
    height: finite(opts?.video?.height) ?? 0,
    pxPerCm: finite(opts?.pxPerCm),
    scenery: (opts?.scenery ?? []).map((b) => ClubOnDemand.sceneryBox(b.cls, b.box, b.score)).filter(Boolean),
  };
  const run = clubLane.then(() => ClubOnDemand.run(req, clubWarm, loadStill));
  clubLane = run.catch(() => {});
  try {
    return await run;
  } catch (e) {
    throw fail('ERR_CLUB', e);
  }
}

export async function releaseClub() {
  clubLane = clubLane.then(() => clubWarm.release());
  await clubLane;
}
