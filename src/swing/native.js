// The only importer of the GolfSwing native module (modules/golf-swing, plan 3).
// Everything else talks to this file, so Jest mocks one path (jest.config.js).
//
// OTA safety (plan S10, R8): a JS bundle can be newer than the installed APK. Before
// offering capture or analysis, call swingSupport(): it refuses a binary whose
// apiVersion is older than REQUIRED_API_VERSION, and the UI shows "Update the app"
// instead of calling a method the binary lacks. API_VERSION in GolfSwingModule.kt is bumped on
// every contract change; raise REQUIRED_API_VERSION (analysis) or CAPTURE_API_VERSION
// (recording, captureSupport()) to the version whose methods this bundle calls.
import { Platform } from 'react-native';
import { requireOptionalNativeModule, requireNativeView } from 'expo';

export const REQUIRED_API_VERSION = 2;

// Capture (N3) arrived in apiVersion 2 as a second native module, GolfSwingCamera. It is gated
// on its own so an APK with only the pose module keeps importing and analysing.
export const CAPTURE_API_VERSION = 2;

export const UPDATE_APP_MESSAGE = 'Update the app to analyse your swing.';

export const UPDATE_CAPTURE_MESSAGE = 'Update the app to record here. You can still import a slow-motion video.';

let cached;
let cachedCamera;
let cachedCameraView;

function nativeModule() {
  if (cached === undefined) {
    cached = Platform.OS === 'android' ? requireOptionalNativeModule('GolfSwing') : null;
  }
  return cached;
}

function cameraModule() {
  if (cachedCamera === undefined) {
    cachedCamera = Platform.OS === 'android' ? requireOptionalNativeModule('GolfSwingCamera') : null;
  }
  return cachedCamera;
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
 * Can this binary record (plan S2, S10)? Same shape as swingSupport(); 'update_app' when the
 * binary analyses but predates capture (apiVersion < CAPTURE_API_VERSION or no camera module).
 */
export function captureSupport() {
  const s = swingSupport();
  if (!s.supported) return s;
  if (s.apiVersion < CAPTURE_API_VERSION || !cameraModule()) {
    return { supported: false, reason: 'update_app', apiVersion: s.apiVersion, message: UPDATE_CAPTURE_MESSAGE };
  }
  return s;
}

function requireCapture() {
  const s = captureSupport();
  if (!s.supported) {
    const err = new Error(s.message ?? 'Recording is not available on this device.');
    err.code = s.reason === 'update_app' ? 'ERR_UPDATE_APP' : 'ERR_UNSUPPORTED';
    throw err;
  }
  return cameraModule();
}

/**
 * Back-camera recording modes, best first: 240 fps, then 120 (constrained high-speed
 * sessions), then the ordinary session's rate. Empty = no usable back camera.
 * @returns {Promise<Array<{ cameraId: string, width: number, height: number, fps: number, highSpeed: boolean }>>}
 */
export async function listRecordingModes() {
  return requireCapture().listRecordingModes();
}

/**
 * The native preview component, or null when captureSupport() says no. Props: `mode` (one
 * entry of listRecordingModes()), `onCameraReady({ nativeEvent: mode })`,
 * `onCameraError({ nativeEvent: { code, message } })`, `onRecordingInterrupted`. Ref methods:
 * `startRecording({ outPath })` and `stopRecording()` →
 * `{ path: 'file://…', fps, width, height, highSpeed, durationMs }`. The camera is open only
 * while the view is mounted and the app is in the foreground.
 */
export function getCameraView() {
  if (!captureSupport().supported) return null;
  if (cachedCameraView === undefined) cachedCameraView = requireNativeView('GolfSwingCamera');
  return cachedCameraView;
}

/**
 * Container facts (plan 3), read without decoding. width/height are in display orientation
 * (rotation applied). hdr = PQ/HLG transfer or a 10-bit profile (frames are analysed from
 * their top 8 bits). duplicateFrameRatio is always null here: the check needs decoded frames,
 * so analyzePose reports it.
 * @returns {Promise<{ width, height, durationMs, frameCount, containerFps,
 *   captureFps: number | null, rotationDeg, hdr: boolean, duplicateFrameRatio: null }>}
 */
export async function probeVideo(path) {
  return requireSupported().probeVideo(path);
}

/**
 * Pass 1 (plan 3, 4.1-4.3). Coordinates are normalised to the display-oriented frame
 * (video.width × video.height); ball.r is a fraction of the frame WIDTH; tMs is container
 * time (multiply by the slow-mo factor for captured time).
 * @param {string} path  file path, file:// or content:// URI
 * @param {{ model?: 'full'|'lite', sampling?: { sparseEvery?, midEvery?, followEvery? },
 *   handedness?: 'right'|'left', heightCm?: number, captureFps?: number }} [opts]
 *   handedness and heightCm only steer the native ball search (lead foot side, expected
 *   size; height clamped to 120-230 cm, default 176). captureFps is the sampling policy's
 *   time base (default: the file's capture-rate tag, else 240).
 * @returns {Promise<{ video: { width, height, containerFps, frameCount },
 *   frames: Array<{ i, tMs, lm: Array<[x, y, vis]> }>,
 *   ball: { x, y, r, conf, frame } | null, ballGoneFrame: number | null,
 *   duplicateFrameRatio: number,
 *   timings: { decodeMs, inferMs, totalMs, inferences, delegate: 'gpu'|'cpu', createMs, stagesMs } }>}
 *   Rejects with ERR_UNSUPPORTED_VIDEO when the phone can't read the clip's frames,
 *   ERR_CANCELLED after cancelAnalysis(), ERR_BUSY while another analysis runs.
 */
export async function analyzePose(path, opts = {}) {
  return requireSupported().analyzePose(path, opts);
}

/**
 * Pass 2 (plan 3, D16): one sequential decode of the checkpoint span.
 * - stills: every checkpoint ± neighbours (JPEG q85, display orientation, `<outDir>/<frame>.jpg`);
 *   `address` lists the stills around the final address frame.
 * - addressFrame: the image-based P1 (the last frame before the clubhead moves the ball patch),
 *   searched inside `addressSearch` (phases.js); null without a ball, a window or an onset.
 * - shaft: the clubhead proposal at address (at addressFrame when found) and impact only,
 *   from a radial search seeded hands -> ball; head in display px, `source: 'edge'`. Every other
 *   requested checkpoint frame is `{ head: null, hidden: false, conf: 0.1, source: 'prior' }`
 *   (no shaft tracking in v1). No ball or expectedShaftPx: priors everywhere.
 * - timings: { totalMs, decodeMs, addressDecodeMs, jpegWaitMs, onsetMs, shaftMs, decoded, stills }.
 * @param {{ frames: Array<{ key, i, hands?: [x, y], neighbours?: number }>, ball?: { x, y, r } | null,
 *   expectedShaftPx?: number, addressSearch?: { run: [a, b], latest, quiet: [a, b], minRun } | null,
 *   outDir: string }} opts  hands and ball normalised; expectedShaftPx in display px
 * @returns {Promise<{ stills: { [key]: { [frame]: string } },
 *   shaft: { [frame]: { head: [x, y] | null, hidden, conf, source: 'edge'|'prior', angleDeg?, lengthPx? } },
 *   addressFrame: number | null, timings: object }>}
 */
export async function extractCheckpoints(path, opts) {
  return requireSupported().extractCheckpoints(path, opts);
}

/**
 * JPEGs of arbitrary frames for the Edit-marks scrubber: `<outDir>/<frame>.jpg`, decode
 * resolution (halved when the long side is over 1920), display orientation.
 * @param {{ frames: number[], outDir: string }} opts
 * @returns {Promise<{ [frame]: string }>}  file:// URIs
 */
export async function extractFrames(path, opts) {
  return requireSupported().extractFrames(path, opts);
}

/**
 * Stops every analyzePose / extraction running or queued at the time of the call; their
 * promises reject with code ERR_CANCELLED. Calls made afterwards are not affected.
 */
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
