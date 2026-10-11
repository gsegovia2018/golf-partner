// The only importer of the GolfSwing native module (modules/golf-swing, plan 3).
// Everything else talks to this file, so Jest mocks one path (jest.config.js).
//
// OTA safety (plan S10, R8): a JS bundle can be newer than the installed APK. Before
// offering capture or analysis, call swingSupport(): it refuses a binary whose
// apiVersion is older than REQUIRED_API_VERSION, and the UI shows "Update the app"
// instead of calling a method the binary lacks. Bump REQUIRED_API_VERSION together with
// API_VERSION in GolfSwingModule.kt whenever the contract changes.
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

export const REQUIRED_API_VERSION = 1;

export const UPDATE_APP_MESSAGE = 'Update the app to analyse your swing.';

let cached;

function nativeModule() {
  if (cached === undefined) {
    cached = Platform.OS === 'android' ? requireOptionalNativeModule('GolfSwing') : null;
  }
  return cached;
}

/** The installed binary's contract version, or null without the module (read by availability.js). */
export function apiVersion() {
  const v = Platform.OS === 'android' ? nativeModule()?.apiVersion : null;
  return typeof v === 'number' ? v : null;
}

/**
 * @returns {{ supported: boolean, reason: null | 'platform' | 'update_app',
 *   apiVersion: number | null, message: string | null }}
 *   'platform' = web/iOS, or an Android binary built before the module existed;
 *   'update_app' = the binary has the module but an older contract.
 */
export function swingSupport() {
  if (Platform.OS !== 'android') {
    return { supported: false, reason: 'platform', apiVersion: null, message: null };
  }
  const version = apiVersion();
  if (version === null || version < REQUIRED_API_VERSION) {
    return { supported: false, reason: 'update_app', apiVersion: version, message: UPDATE_APP_MESSAGE };
  }
  return { supported: true, reason: null, apiVersion: version, message: null };
}

function requireSupported() {
  const s = swingSupport();
  if (!s.supported) {
    const err = new Error(s.message ?? 'The swing analyzer is not available on this device.');
    err.code = s.reason === 'update_app' ? 'ERR_UPDATE_APP' : 'ERR_UNSUPPORTED';
    throw err;
  }
  return nativeModule();
}

/**
 * Container facts (plan 3). width/height are in display orientation (rotation applied).
 * @returns {Promise<{ width, height, durationMs, frameCount, containerFps,
 *   captureFps: number | null, rotationDeg, duplicateFrameRatio }>}
 */
export async function probeVideo(path) {
  return requireSupported().probeVideo(path);
}

/**
 * Pass 1 (plan 3, 4.1-4.3). Coordinates are normalised to the display-oriented frame
 * (video.width × video.height); ball.r is a fraction of the frame WIDTH; tMs is container
 * time (multiply by the slow-mo factor for captured time).
 * @param {string} path  file path, file:// or content:// URI
 * @param {{ model?: 'full'|'lite', sampling?: { sparseEvery?, afterImpactEvery?, denseEvery? },
 *   handedness?: 'right'|'left', heightCm?: number }} [opts]
 *   handedness and heightCm only steer the native ball search (lead foot side, expected size).
 * @returns {Promise<{ video: { width, height, containerFps, frameCount },
 *   frames: Array<{ i, tMs, lm: Array<[x, y, vis]> }>,
 *   ball: { x, y, r, conf, frame } | null, ballGoneFrame: number | null,
 *   timings: { decodeMs, inferMs, totalMs, inferences, delegate: 'gpu'|'cpu' } }>}
 */
export async function analyzePose(path, opts = {}) {
  return requireSupported().analyzePose(path, opts);
}

/**
 * Checkpoint stills (plan 3). N1 delivers the stills only: `shaft` is {} and
 * `addressFrame` null until N2 adds the clubhead search and the image-based address onset.
 * @param {{ frames: Array<{ key, i, hands?, neighbours?: number }>, ball?, expectedShaftPx?, outDir: string }} opts
 * @returns {Promise<{ stills: { [key]: { [frame]: string } }, shaft: object, addressFrame: number | null }>}
 */
export async function extractCheckpoints(path, opts) {
  return requireSupported().extractCheckpoints(path, opts);
}

/**
 * JPEGs of arbitrary frames for the Edit-marks scrubber: `<outDir>/<frame>.jpg`, full
 * decode resolution, display orientation.
 * @param {{ frames: number[], outDir: string }} opts
 * @returns {Promise<{ [frame]: string }>}  file:// URIs
 */
export async function extractFrames(path, opts) {
  return requireSupported().extractFrames(path, opts);
}

/** Stops a running analyzePose / extraction; its promise rejects with code ERR_CANCELLED. */
export function cancelAnalysis() {
  if (swingSupport().supported) nativeModule().cancelAnalysis();
}

/**
 * Module events. 'progress' (analyzePose): { stage: 'decode'|'pose', done, total } in
 * frames; both stages advance together (decoding overlaps inference). Returns a
 * subscription with remove().
 */
export function addListener(eventName, listener) {
  const mod = nativeModule();
  if (!mod || !swingSupport().supported) return { remove() {} };
  return mod.addListener(eventName, listener);
}

export function addProgressListener(listener) {
  return addListener('progress', listener);
}
