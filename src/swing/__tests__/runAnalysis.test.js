import { runAnalysis } from '../runAnalysis';
import { fixtureNative, TRUTH, W, H } from './helpers';
import * as frames from '../frames';
import * as store from '../../store/swingStore';

const lab = require('./fixtures/lab-d15-pass1.json');

jest.mock('expo-file-system', () => ({
  Paths: { document: 'file:///doc' },
  Directory: class { constructor() { this.exists = true; this.uri = 'file:///doc/swings/s1/frames'; } create() {} },
  File: class {},
}));
jest.mock('../frames', () => ({ nativeApi: jest.fn(), getStill: jest.fn(() => 'file:///doc/swings/s1/frames/556.jpg') }));
jest.mock('../../store/swingStore', () => ({
  getSwing: jest.fn(),
  getSwingProfile: jest.fn(() => ({ heightCm: 176, handedness: 'right', asked: true })),
  swingVideoUri: jest.fn(() => 'file:///doc/swings/s1/video.mp4'),
  saveAnalysis: jest.fn(() => Promise.resolve()),
  markSwingFailed: jest.fn(() => Promise.resolve()),
  readMarks: jest.fn(() => Promise.resolve(null)),
}));

const ball = { x: TRUTH.ball.x / W, y: TRUTH.ball.y / H, r: 2.1 / W };
const probe = { width: W, height: H, durationMs: 5400, frameCount: 1297, containerFps: 29.97, captureFps: null, duplicateFrameRatio: 0 };

function makeApi(over = {}) {
  const listeners = [];
  return {
    probeVideo: jest.fn(async () => probe),
    analyzePose: jest.fn(async () => {
      listeners.forEach((cb) => cb({ stage: 'decode', done: 10, total: 100 }));
      listeners.forEach((cb) => cb({ stage: 'pose', done: 50, total: 100 }));
      return fixtureNative({ ball, ballGoneFrame: lab.expected.ballGoneFrame });
    }),
    extractCheckpoints: jest.fn(async () => ({ shaft: {}, addressFrame: lab.expected.addressFrame, stills: {} })),
    addListener: jest.fn((name, cb) => { listeners.push(cb); return { remove: jest.fn() }; }),
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  store.getSwing.mockReturnValue({ id: 's1', createdAt: '2026-10-11T16:42:00.000Z', club: 'iron', source: 'import', status: 'pending' });
});

describe('runAnalysis', () => {
  test('probe -> pose -> first save -> pass 2 -> final save, reporting the stages in order', async () => {
    const api = makeApi();
    frames.nativeApi.mockReturnValue(api);
    const stages = [];
    const partial = jest.fn();
    const res = await runAnalysis('s1', { onProgress: (p) => stages.push(p.stage), onPartial: partial });

    expect(res.pass2).toBe('done');
    expect(res.analysis.main.fault).toBe('posture'); // D21: the setup comes first
    expect(res.analysis.main.consequences).toContain('early_extension');
    expect([...new Set(stages)]).toEqual(['reading', 'pose', 'planes']);
    expect(api.analyzePose).toHaveBeenCalledWith('file:///doc/swings/s1/video.mp4', { model: 'full' });
    // The result opens after the first save, before pass 2 finishes.
    expect(store.saveAnalysis).toHaveBeenCalledTimes(2);
    expect(partial).toHaveBeenCalledTimes(1);
    const [, first, o1] = store.saveAnalysis.mock.calls[0];
    expect(first.checks.filter((c) => c.status === 'unknown').length).toBeGreaterThan(0);
    expect(o1.pose.pass2).toBeUndefined();
    const [, , o2] = store.saveAnalysis.mock.calls[1];
    expect(o2.pose.pass2).toEqual({ shaft: {}, addressFrame: lab.expected.addressFrame });
    expect(o2.thumb).toMatch(/556\.jpg$/);
  });

  test('pass 2 asks native for the twelve checkpoint frames with their grip estimate', async () => {
    const api = makeApi();
    frames.nativeApi.mockReturnValue(api);
    await runAnalysis('s1');
    const [, opts] = api.extractCheckpoints.mock.calls[0];
    expect(opts.frames).toHaveLength(12);
    expect(opts.frames.map((f) => f.key)).toEqual(expect.arrayContaining(['address', 'impact', 'preImpact', 'postImpact', 'lateBackswing']));
    opts.frames.forEach((f) => { expect(f.neighbours).toBe(2); expect(f.hands).toHaveLength(2); });
    expect(opts.expectedShaftPx).toBeGreaterThan(100);
    expect(opts.ball).toEqual(expect.objectContaining({ x: ball.x }));
  });

  test('D12: no golfer found marks the swing failed and saves nothing', async () => {
    frames.nativeApi.mockReturnValue(makeApi({ analyzePose: jest.fn(async () => ({ ...fixtureNative(), frames: [] })) }));
    const res = await runAnalysis('s1');
    expect(res).toEqual({ error: 'no_pose' });
    expect(store.markSwingFailed).toHaveBeenCalledWith('s1', 'no_pose');
    expect(store.saveAnalysis).not.toHaveBeenCalled();
  });

  test('a pass 2 failure keeps the first analysis: the club checks wait for the user', async () => {
    frames.nativeApi.mockReturnValue(makeApi({ extractCheckpoints: jest.fn(async () => { throw new Error('decoder'); }) }));
    const res = await runAnalysis('s1');
    expect(res.pass2).toBe('failed');
    expect(res.analysis.error).toBeUndefined();
    expect(store.saveAnalysis).toHaveBeenCalledTimes(1);
    expect(store.markSwingFailed).not.toHaveBeenCalled();
  });

  test('cancelling after the probe stops before the pose pass', async () => {
    const api = makeApi();
    frames.nativeApi.mockReturnValue(api);
    const res = await runAnalysis('s1', { isCancelled: () => true });
    expect(res).toEqual({ cancelled: true });
    expect(api.analyzePose).not.toHaveBeenCalled();
  });

  test('a native failure is reported as failed', async () => {
    frames.nativeApi.mockReturnValue(makeApi({ probeVideo: jest.fn(async () => { throw new Error('boom'); }) }));
    expect(await runAnalysis('s1')).toEqual({ error: 'failed' });
    expect(store.markSwingFailed).toHaveBeenCalledWith('s1', 'failed');
  });

  test('without the native module (older binary) there is nothing to run', async () => {
    frames.nativeApi.mockReturnValue(null);
    expect(await runAnalysis('s1')).toEqual({ error: 'update' });
    expect(store.markSwingFailed).not.toHaveBeenCalled();
  });
});
