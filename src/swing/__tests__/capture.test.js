import {
  MAX_RECORD_MS, bestMode, fpsTier, needsFallback, playbackRateFor, formatElapsed, previewRect,
  captureReducer, initialCaptureState, cameraMounted,
} from '../capture';

const m = (fps, highSpeed, width = 1280, height = 720) => ({ cameraId: '0', width, height, fps, highSpeed });

describe('mode choice and fps pill', () => {
  test('prefers 240 fps, then 120, then the ordinary rate; high speed wins a tie', () => {
    expect(bestMode([m(30, false), m(120, true), m(240, true), m(60, false)]).fps).toBe(240);
    expect(bestMode([m(30, false), m(120, true)]).fps).toBe(120);
    expect(bestMode([m(120, false), m(120, true)]).highSpeed).toBe(true);
    expect(bestMode([m(30, false)]).fps).toBe(30);
  });

  test('no usable mode → null', () => {
    expect(bestMode([])).toBeNull();
    expect(bestMode(null)).toBeNull();
    expect(bestMode([m(0, false), { fps: 30 }])).toBeNull();
  });

  test('pill tiers: 240 green, 120 amber, below red', () => {
    expect(fpsTier(240)).toBe('green');
    expect(fpsTier(480)).toBe('green');
    expect(fpsTier(120)).toBe('yellow');
    expect(fpsTier(60)).toBe('red');
  });

  test('fallback below 120 fps or without a camera', () => {
    expect(needsFallback(m(30, false))).toBe(true);
    expect(needsFallback(null)).toBe(true);
    expect(needsFallback(m(120, true))).toBe(false);
  });

  test('review plays a 240 fps take at 1/8, 120 at 1/4, ordinary at 1', () => {
    expect(playbackRateFor(240)).toBe(0.125);
    expect(playbackRateFor(120)).toBe(0.25);
    expect(playbackRateFor(30)).toBe(1);
  });

  test('elapsed format and the 8 s auto-stop', () => {
    expect(formatElapsed(3240)).toBe('0:03.2');
    expect(formatElapsed(0)).toBe('0:00.0');
    expect(formatElapsed(65_000)).toBe('1:05.0');
    expect(MAX_RECORD_MS).toBe(8000);
  });

  test('preview rect letterboxes the portrait picture like the native view', () => {
    const r = previewRect({ width: 400, height: 900 }, m(240, true));
    expect(r.width).toBeCloseTo(400);
    expect(r.height).toBeCloseTo(400 * 16 / 9);
    expect(r.y).toBeCloseTo((900 - r.height) / 2);
    expect(r.x).toBe(0);
    expect(previewRect({ width: 400, height: 600 }, m(240, true)).height).toBe(600);
  });
});

describe('captureReducer', () => {
  const run = (...actions) => actions.reduce(captureReducer, initialCaptureState);
  const take = { path: 'file:///cache/t.mp4', fps: 240, durationMs: 4100 };

  test('record → stop → review; the camera is not mounted in review', () => {
    let s = run({ type: 'modes', modes: [m(240, true)] }, { type: 'ready' });
    expect(s.phase).toBe('live');
    expect(cameraMounted(s.phase)).toBe(true);
    s = run(...[{ type: 'modes', modes: [m(240, true)] }, { type: 'ready' }, { type: 'start' }, { type: 'started' }, { type: 'stop' }, { type: 'stopped', take }]);
    expect(s.phase).toBe('review');
    expect(s.take).toBe(take);
    expect(cameraMounted(s.phase)).toBe(false);
  });

  test('cannot start before the camera is ready', () => {
    const s = run({ type: 'modes', modes: [m(240, true)] }, { type: 'start' });
    expect(s.phase).toBe('live');
  });

  test('no camera → blocked; older binary → blocked update', () => {
    expect(run({ type: 'modes', modes: [] })).toMatchObject({ phase: 'blocked', blocked: 'no_camera' });
    expect(run({ type: 'blocked', reason: 'update' })).toMatchObject({ phase: 'blocked', blocked: 'update' });
  });

  test('retake drops the take and remounts a fresh camera', () => {
    const before = run({ type: 'modes', modes: [m(240, true)] }, { type: 'stopped', take });
    const s = captureReducer(before, { type: 'retake' });
    expect(s).toMatchObject({ phase: 'live', take: null, ready: false });
    expect(s.cameraKey).toBe(before.cameraKey + 1);
  });

  test('analyse only from review; a failed save returns to review', () => {
    expect(run({ type: 'analyse' }).phase).toBe('loading');
    const s = run({ type: 'stopped', take }, { type: 'analyse' });
    expect(s.phase).toBe('saving');
    expect(captureReducer(s, { type: 'saveFailed' })).toMatchObject({ phase: 'review', error: 'save' });
  });

  test('an interrupted take goes back to live with a message', () => {
    const s = run({ type: 'modes', modes: [m(240, true)] }, { type: 'ready' }, { type: 'start' }, { type: 'started' }, { type: 'interrupted' });
    expect(s).toMatchObject({ phase: 'live', error: 'interrupted', ready: false });
    // The camera reopens on return; the message stays until the next take starts.
    const back = captureReducer(s, { type: 'ready' });
    expect(back).toMatchObject({ ready: true, error: 'interrupted' });
    expect(captureReducer(back, { type: 'start' }).error).toBeNull();
  });
});
