// Pure logic of the capture screen (plan S2, N3; design B with C's review step, D8).
// The screen keeps no rules of its own: what to record at, what the fps pill says, when to
// stop, and which state comes next all live here, under test.

/** Auto-stop (plan 4.1): a swing fits in 8 s and longer clips only cost analysis time. */
export const MAX_RECORD_MS = 8000;

/**
 * Best mode first: fps desc, a high-speed session over an ordinary one at the same rate.
 * Native already ranks (ModeRanking.rank); this re-check keeps the pick stable on any binary.
 */
export function bestMode(modes) {
  const valid = (modes ?? []).filter((m) => m && m.fps > 0 && m.width > 0 && m.height > 0);
  return [...valid].sort((a, b) => (b.fps - a.fps) || (Number(!!b.highSpeed) - Number(!!a.highSpeed)))[0] ?? null;
}

/** Pill colour (S2): 240 green, 120 amber ("good enough"), below red ("approximate"). */
export function fpsTier(fps) {
  if (fps >= 240) return 'green';
  if (fps >= 120) return 'yellow';
  return 'red';
}

/** Below 120 fps the phone cannot time impact: offer the slow-mo import first (S2). */
export function needsFallback(mode) {
  return !mode || mode.fps < 120;
}

/** Review playback speed: about 30 fps on screen, so a 240 fps take plays at 1/8. */
export function playbackRateFor(fps) {
  if (fps >= 200) return 0.125;
  if (fps >= 100) return 0.25;
  return 1;
}

/** 3240 → "0:03.2" */
export function formatElapsed(ms) {
  const t = Math.max(0, Math.floor(ms / 100)); // tenths
  const s = Math.floor(t / 10);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${t % 10}`;
}

/**
 * Where a portrait recording sits inside the preview view: the native view letterboxes the
 * camera image (fit, centred), so the guide box is drawn over the same rectangle.
 * mode is landscape (width > height); in portrait the picture is height × width.
 */
export function previewRect(container, mode) {
  const { width: cw, height: ch } = container;
  if (!mode || !cw || !ch) return { x: 0, y: 0, width: cw || 0, height: ch || 0 };
  const pw = Math.min(mode.width, mode.height);
  const ph = Math.max(mode.width, mode.height);
  const scale = Math.min(cw / pw, ch / ph);
  const width = pw * scale;
  const height = ph * scale;
  return { x: (cw - width) / 2, y: (ch - height) / 2, width, height };
}

// --- Screen state ---------------------------------------------------------------------------
//
// loading → live ⇄ (starting → recording → stopping) → review → saving
//         ↘ blocked ('update' | 'permission' | 'no_camera')
// The camera is mounted only in live/starting/recording/stopping: the review step plays the
// take back with the camera closed, and nothing is decoded before Analyse.

export const initialCaptureState = {
  phase: 'loading',
  blocked: null,
  mode: null,
  ready: false,
  lowFpsOk: false,
  take: null,
  error: null,
  cameraKey: 0,
};

export function captureReducer(state, action) {
  switch (action.type) {
    case 'blocked':
      return { ...state, phase: 'blocked', blocked: action.reason };
    case 'modes': {
      const mode = bestMode(action.modes);
      if (!mode) return { ...state, phase: 'blocked', blocked: 'no_camera' };
      return { ...state, phase: 'live', mode, ready: false };
    }
    case 'ready':
      return state.phase === 'blocked' ? state : { ...state, ready: true, error: null };
    case 'acceptLowFps':
      return { ...state, lowFpsOk: true };
    case 'start':
      return state.phase === 'live' && state.ready ? { ...state, phase: 'starting', error: null } : state;
    case 'started':
      return state.phase === 'starting' ? { ...state, phase: 'recording' } : state;
    case 'stop':
      return state.phase === 'recording' ? { ...state, phase: 'stopping' } : state;
    case 'stopped':
      return { ...state, phase: 'review', take: action.take, ready: false };
    case 'failed':
      // A failed start/stop leaves no take behind; the camera stays as it was.
      return { ...state, phase: state.phase === 'blocked' ? 'blocked' : 'live', error: action.error ?? 'failed' };
    case 'cameraError':
      // Remount the native view on retry (a fresh session).
      return { ...state, phase: state.phase === 'review' ? 'review' : 'live', ready: false, error: 'camera' };
    case 'retryCamera':
      return { ...state, phase: 'live', ready: false, error: null, cameraKey: state.cameraKey + 1 };
    case 'interrupted':
      return { ...state, phase: 'live', ready: false, error: 'interrupted' };
    case 'retake':
      return { ...state, phase: 'live', take: null, ready: false, error: null, cameraKey: state.cameraKey + 1 };
    case 'analyse':
      return state.phase === 'review' ? { ...state, phase: 'saving' } : state;
    case 'saveFailed':
      return { ...state, phase: 'review', error: 'save' };
    default:
      return state;
  }
}

/** The native camera view is mounted only while it can be used. */
export function cameraMounted(phase) {
  return phase === 'live' || phase === 'starting' || phase === 'recording' || phase === 'stopping';
}
