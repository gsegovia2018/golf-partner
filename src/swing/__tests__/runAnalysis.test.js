import { runAnalysis, poseOptions, pass2Ball } from '../runAnalysis';
import { fixtureNative, TRUTH, W, H } from './helpers';
import * as frames from '../frames';
import * as store from '../../store/swingStore';

const lab = require('./fixtures/lab-d15-pass1.json');

jest.mock('expo-file-system', () => ({
  Paths: { document: 'file:///doc' },
  Directory: class { constructor() { this.exists = true; this.uri = 'file:///doc/swings/s1/frames'; } create() {} },
  File: class {},
}));
jest.mock('../frames', () => ({
  nativeApi: jest.fn(),
  getStill: jest.fn(() => 'file:///doc/swings/s1/frames/556.jpg'),
  proxyDir: jest.fn(() => ({ uri: 'file:///doc/swings/s1/proxy' })),
  proxyWindow: jest.requireActual('../frames').proxyWindow,
  proxyEveryFor: jest.requireActual('../frames').proxyEveryFor,
}));
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
  test('decode events stop moving the stage once pose frames arrive (native interleaves them)', async () => {
    const listeners = [];
    const api = makeApi({
      addListener: jest.fn((name, cb) => { listeners.push(cb); return { remove: jest.fn() }; }),
      analyzePose: jest.fn(async () => {
        [['decode', 5], ['pose', 0], ['decode', 20], ['pose', 15]].forEach(([stage, done]) => listeners.forEach((cb) => cb({ stage, done, total: 100 })));
        return fixtureNative({ ball, ballGoneFrame: lab.expected.ballGoneFrame });
      }),
    });
    frames.nativeApi.mockReturnValue(api);
    const seen = [];
    await runAnalysis('s1', { onProgress: (p) => { if (p.total) seen.push(`${p.stage}:${p.done}`); } });
    expect(seen).toEqual(['reading:5', 'pose:0', 'pose:15']);
  });

  test('probe -> pose -> first save -> pass 2 -> final save, reporting the stages in order', async () => {
    const api = makeApi();
    frames.nativeApi.mockReturnValue(api);
    const stages = [];
    const partial = jest.fn();
    const res = await runAnalysis('s1', { onProgress: (p) => stages.push(p.stage), onPartial: partial });

    expect(res.pass2).toBe('done');
    expect(res.analysis.main.fault).toBe('early_extension'); // checks v2: impact is tier 1 and red
    expect(res.analysis.schema).toBe('swing-analysis/7');
    expect([...new Set(stages)]).toEqual(['reading', 'pose', 'planes']);
    expect(api.analyzePose).toHaveBeenCalledWith('file:///doc/swings/s1/video.mp4', { model: 'full', handedness: 'right', heightCm: 176 });
    // The result opens after the first save, before pass 2 finishes.
    expect(store.saveAnalysis).toHaveBeenCalledTimes(2);
    expect(partial).toHaveBeenCalledTimes(1);
    const [, first, o1] = store.saveAnalysis.mock.calls[0];
    expect(first.checks.filter((c) => c.status === 'unknown').length).toBeGreaterThan(0);
    expect(o1.pose.pass2).toBeUndefined();
    const [, , o2] = store.saveAnalysis.mock.calls[1];
    expect(o2.pose.pass2).toEqual({ shaft: {}, addressFrame: lab.expected.addressFrame, club: null });
    expect(o2.thumb).toMatch(/556\.jpg$/);
  });

  test('the swing profile reaches native: a left-handed, 162 cm golfer', async () => {
    store.getSwingProfile.mockReturnValueOnce({ heightCm: 162, handedness: 'left', asked: true });
    const api = makeApi();
    frames.nativeApi.mockReturnValue(api);
    await runAnalysis('s1');
    expect(api.analyzePose).toHaveBeenCalledWith('file:///doc/swings/s1/video.mp4', { model: 'full', handedness: 'left', heightCm: 162 });
  });

  test('poseOptions leaves an unknown height to the native default and only sends right or left', () => {
    expect(poseOptions({ heightCm: null, handedness: 'right', asked: false })).toEqual({ model: 'full', handedness: 'right' });
    expect(poseOptions({ heightCm: 0, handedness: 'weird' })).toEqual({ model: 'full', handedness: 'right' });
    expect(poseOptions(undefined)).toEqual({ model: 'full', handedness: 'right' });
    expect(poseOptions({ heightCm: '181', handedness: 'left' })).toEqual({ model: 'full', handedness: 'left', heightCm: 181 });
  });

  test('poseOptions passes the capture rate the sampling policy should use, when known', () => {
    const right = { handedness: 'right' };
    expect(poseOptions(right, { containerFps: 30, captureFps: 240 }).captureFps).toBe(240);
    expect(poseOptions(right, { containerFps: 240, captureFps: null }).captureFps).toBe(240);
    expect(poseOptions(right, { containerFps: 29.97, captureFps: null })).not.toHaveProperty('captureFps');
    expect(poseOptions(right, undefined)).not.toHaveProperty('captureFps');
  });

  test('pass 2 asks native for the seven positions and the finish (checks v2), with their grip estimate', async () => {
    const api = makeApi();
    frames.nativeApi.mockReturnValue(api);
    await runAnalysis('s1');
    const [, opts] = api.extractCheckpoints.mock.calls[0];
    expect(opts.frames.map((f) => f.key)).toEqual(['address', 'takeaway', 'leadArm', 'top', 'shaftDown', 'impact', 'trailArm', 'finish']);
    // P5, P8 and the internal frames are no longer asked for
    ['transition', 'shaftThrough', 'lateBackswing', 'preImpact', 'postImpact'].forEach((k) => expect(opts.frames.map((f) => f.key)).not.toContain(k));
    opts.frames.forEach((f) => { expect(f.neighbours).toBe(2); expect(f.hands).toHaveLength(2); });
    expect(opts.expectedShaftPx).toBeGreaterThan(100);
    expect(opts.ball).toEqual(expect.objectContaining({ x: ball.x }));
  });

  test('D28: an apiVersion 3 binary is asked for the scrub proxies (every 4th frame), an apiVersion 2 one is not', async () => {
    const v3 = makeApi({ proxySupport: () => true });
    frames.nativeApi.mockReturnValue(v3);
    await runAnalysis('s1');
    expect(v3.extractCheckpoints.mock.calls[0][1]).toMatchObject({ proxyEvery: 4, proxyDir: 'file:///doc/swings/s1/proxy' });
    const [lo, hi] = v3.extractCheckpoints.mock.calls[0][1].proxyRange; // the swing window, not the whole clip
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeLessThan(probe.frameCount - 1);
    const v2 = makeApi({ proxySupport: () => false });
    frames.nativeApi.mockReturnValue(v2);
    await runAnalysis('s1');
    expect(v2.extractCheckpoints.mock.calls[0][1]).not.toHaveProperty('proxyEvery');
    expect(v2.extractCheckpoints.mock.calls[0][1]).not.toHaveProperty('proxyDir');
  });

  test('apiVersion 6: every 2nd frame as a proxy, and the frame step\'s time base for the address track', async () => {
    const v6 = makeApi({ proxySupport: () => true, scrubSupport: () => true });
    frames.nativeApi.mockReturnValue(v6);
    await runAnalysis('s1');
    const opts = v6.extractCheckpoints.mock.calls[0][1];
    expect(opts.proxyEvery).toBe(2);
    // container fps × slow-mo factor, the phases' own time base (an older binary ignores it)
    const first = store.saveAnalysis.mock.calls[0][1];
    expect(opts.captureFps).toBeCloseTo(first.fps.container * first.fps.factor, 6);
  });

  test('apiVersion 4 binary is asked for the club model and its club block is stored; an older one is not asked', async () => {
    const club = { model: 'club_yolox_tiny_v1', input: 640, conf: 0.03, nms: 0.45 };
    const v4 = makeApi({ clubModelSupport: () => true, extractCheckpoints: jest.fn(async () => ({ shaft: {}, addressFrame: lab.expected.addressFrame, stills: {}, club })) });
    frames.nativeApi.mockReturnValue(v4);
    await runAnalysis('s1');
    expect(v4.extractCheckpoints.mock.calls[0][1]).toMatchObject({ clubModel: true });
    expect(store.saveAnalysis.mock.calls.at(-1)[2].pose.pass2.club).toEqual(club);
    const v3 = makeApi({ clubModelSupport: () => false });
    frames.nativeApi.mockReturnValue(v3);
    await runAnalysis('s1');
    expect(v3.extractCheckpoints.mock.calls[0][1]).not.toHaveProperty('clubModel');
    expect(store.saveAnalysis.mock.calls.at(-1)[2].pose.pass2.club).toBeNull();
  });

  test('pass 2 gets the address window of the first analysis (detect.py clubhead_onset)', async () => {
    const api = makeApi();
    frames.nativeApi.mockReturnValue(api);
    const partial = jest.fn();
    await runAnalysis('s1', { onPartial: partial });
    const first = partial.mock.calls[0][0];
    const [, opts] = api.extractCheckpoints.mock.calls[0];
    const { motionStart } = first.internal;
    expect(opts.addressSearch).toEqual({
      run: [expect.any(Number), motionStart + lab.expected.holdFrames],
      latest: motionStart,
      quiet: [first.checkpoints.leadArm.i, first.checkpoints.top.i],
      minRun: 5,
    });
    expect(opts.addressSearch.run[0]).toBeLessThan(motionStart);
  });

  test('the native clubhead at address and impact reaches the final analysis; a user mark wins', async () => {
    const shaft = {
      [lab.expected.addressFrame]: { head: [251, 481], hidden: false, conf: 0.47, source: 'edge' },
      [lab.expected.checkpoints.impact]: { head: [270, 504], hidden: false, conf: 0.77, source: 'edge' },
      [lab.expected.checkpoints.top]: { head: null, hidden: false, conf: 0.1, source: 'prior' },
    };
    const timings = { totalMs: 900 };
    const api = makeApi({ extractCheckpoints: jest.fn(async () => ({ shaft, addressFrame: lab.expected.addressFrame, stills: {}, timings })) });
    frames.nativeApi.mockReturnValue(api);
    const res = await runAnalysis('s1');
    const cm = res.analysis.clubMarks;
    expect(res.analysis.checkpoints.address.i).toBe(lab.expected.addressFrame);
    expect(cm.address).toMatchObject({ source: 'edge', hidden: false, conf: 0.47 });
    expect(cm.address.head[0] * W).toBeCloseTo(251, 6);
    expect(cm.impact).toMatchObject({ source: 'edge', conf: 0.77 });
    expect(cm.impact.head[1] * H).toBeCloseTo(504, 6);
    expect(cm.top).toMatchObject({ source: 'prior', head: null });
    const [, , o2] = store.saveAnalysis.mock.calls[1];
    expect(o2.pose.pass2).toEqual({ shaft, addressFrame: lab.expected.addressFrame, timings, club: null });

    // a saved user mark at impact beats the native proposal on the next analysis
    const userMarks = {
      schema: 'swing-club-labels/1',
      ball: { proposed: null, final: null, corrected: false },
      frames: [{
        i: lab.expected.checkpoints.impact,
        checkpoint: 'impact',
        hands: { proposed: null, final: null },
        head: { proposed: [270 / W, 504 / H], proposedHidden: false, final: [0.6, 0.6], finalHidden: false },
        corrected: true,
      }],
    };
    store.readMarks.mockResolvedValueOnce(userMarks).mockResolvedValueOnce(userMarks); // read at the start and before the final save
    const again = await runAnalysis('s1');
    expect(again.analysis.clubMarks.impact.source).toBe('user');
    expect(again.analysis.clubMarks.impact.head[0]).toBeCloseTo(0.6, 9);
  });

  test("pass 2 seeds from the golfer's corrected ball, also when native found none", async () => {
    const marks = (final) => ({ schema: 'swing-club-labels/1', ball: { proposed: null, final, corrected: true }, frames: [] });
    const corrected = [0.6, 0.62, 0.006];

    store.readMarks.mockResolvedValueOnce(marks(corrected));
    let api = makeApi();
    frames.nativeApi.mockReturnValue(api);
    await runAnalysis('s1');
    expect(api.extractCheckpoints.mock.calls[0][1].ball).toEqual({ x: 0.6, y: 0.62, r: 0.006 });

    store.readMarks.mockResolvedValueOnce(marks(corrected));
    api = makeApi({ analyzePose: jest.fn(async () => fixtureNative({ ball: null, ballGoneFrame: lab.expected.ballGoneFrame })) });
    frames.nativeApi.mockReturnValue(api);
    await runAnalysis('s1');
    expect(api.extractCheckpoints.mock.calls[0][1].ball).toEqual({ x: 0.6, y: 0.62, r: 0.006 });

    // no mark: native's own proposal
    api = makeApi();
    frames.nativeApi.mockReturnValue(api);
    await runAnalysis('s1');
    expect(api.extractCheckpoints.mock.calls[0][1].ball).toEqual(ball);
  });

  test('pass2Ball keeps native r when the mark has none, and null without either', () => {
    expect(pass2Ball([0.5, 0.5], { x: 0.1, y: 0.1, r: 0.004 })).toEqual({ x: 0.5, y: 0.5, r: 0.004 });
    expect(pass2Ball(null, null)).toBeNull();
    expect(pass2Ball(undefined, { x: 0.1, y: 0.2, r: 0.003 })).toEqual({ x: 0.1, y: 0.2, r: 0.003 });
  });

  test('D12: no golfer found marks the swing failed and saves nothing', async () => {
    frames.nativeApi.mockReturnValue(makeApi({ analyzePose: jest.fn(async () => ({ ...fixtureNative(), frames: [] })) }));
    const res = await runAnalysis('s1');
    expect(res).toEqual({ error: 'no_pose', detail: null });
    expect(store.markSwingFailed).toHaveBeenCalledWith('s1', 'no_pose', null);
    expect(store.saveAnalysis).not.toHaveBeenCalled();
  });

  test('a pass 2 failure keeps the first analysis (the club checks wait for the user) and makes the swing ready', async () => {
    frames.nativeApi.mockReturnValue(makeApi({ extractCheckpoints: jest.fn(async () => { throw new Error('decoder'); }) }));
    const res = await runAnalysis('s1');
    expect(res.pass2).toBe('failed');
    expect(res.analysis.error).toBeUndefined();
    expect(store.saveAnalysis).toHaveBeenCalledTimes(2);
    expect(store.saveAnalysis.mock.calls[0][2].status).toBe('pending');
    expect(store.saveAnalysis.mock.calls[1][1]).toBe(res.analysis);
    expect(store.saveAnalysis.mock.calls[1][2].status).toBeUndefined(); // the store's default: ready
    expect(store.markSwingFailed).not.toHaveBeenCalled();
  });

  test('review (D26): the swing is not ready, so not markable, until pass 2 has settled', async () => {
    frames.nativeApi.mockReturnValue(makeApi());
    await runAnalysis('s1');
    expect(store.saveAnalysis.mock.calls.map((c) => c[2].status)).toEqual(['pending', undefined]);
  });

  test('review (D26): pass 2 cancelled by leaving the screen saves nothing more', async () => {
    let cancel = false;
    const api = makeApi({ extractCheckpoints: jest.fn(async () => { cancel = true; return { shaft: {}, addressFrame: null }; }) });
    frames.nativeApi.mockReturnValue(api);
    const res = await runAnalysis('s1', { isCancelled: () => cancel });
    expect(res).toEqual({ cancelled: true });
    expect(store.saveAnalysis).toHaveBeenCalledTimes(1);
    expect(store.saveAnalysis.mock.calls[0][2].status).toBe('pending');
  });

  test('review (D26): a pass 2 that fails because it was cancelled does not make the swing ready', async () => {
    let cancel = false;
    frames.nativeApi.mockReturnValue(makeApi({ extractCheckpoints: jest.fn(async () => { cancel = true; throw new Error('cancelled'); }) }));
    const res = await runAnalysis('s1', { isCancelled: () => cancel });
    expect(res).toEqual({ cancelled: true });
    expect(store.saveAnalysis).toHaveBeenCalledTimes(1);
  });

  test('review (D26): the final save scores the club and marks as they are then, not as they were at the start', async () => {
    store.getSwing
      .mockReturnValueOnce({ id: 's1', createdAt: '2026-10-11T16:42:00.000Z', club: 'iron', source: 'import', status: 'pending' })
      .mockReturnValue({ id: 's1', createdAt: '2026-10-11T16:42:00.000Z', club: 'driver', source: 'import', status: 'pending' });
    frames.nativeApi.mockReturnValue(makeApi());
    const res = await runAnalysis('s1');
    expect(store.saveAnalysis.mock.calls[0][1].club).toBe('iron');
    expect(res.analysis.club).toBe('driver');
    expect(store.readMarks).toHaveBeenCalledTimes(2);
  });

  test('cancelling after the probe stops before the pose pass', async () => {
    const api = makeApi();
    frames.nativeApi.mockReturnValue(api);
    const res = await runAnalysis('s1', { isCancelled: () => true });
    expect(res).toEqual({ cancelled: true });
    expect(api.analyzePose).not.toHaveBeenCalled();
  });

  test('a native failure is reported as failed, with its cause kept', async () => {
    frames.nativeApi.mockReturnValue(makeApi({ probeVideo: jest.fn(async () => { throw new Error('boom'); }) }));
    const res = await runAnalysis('s1');
    expect(res.error).toBe('failed');
    expect(res.detail).toMatchObject({ code: null, message: 'boom', stage: 'reading' });
    expect(store.markSwingFailed).toHaveBeenCalledWith('s1', 'failed', res.detail);
  });

  test('a clip the phone cannot decode says so, with the native code and stage', async () => {
    const err = Object.assign(new Error('no readable image from the decoder'), { code: 'ERR_UNSUPPORTED_VIDEO' });
    frames.nativeApi.mockReturnValue(makeApi({ analyzePose: jest.fn(async () => { throw err; }) }));
    const res = await runAnalysis('s1');
    expect(res.error).toBe('video');
    expect(res.detail).toMatchObject({ code: 'ERR_UNSUPPORTED_VIDEO', stage: 'pose' });
  });

  test('without the native module (older binary) there is nothing to run', async () => {
    frames.nativeApi.mockReturnValue(null);
    expect(await runAnalysis('s1')).toEqual({ error: 'update' });
    expect(store.markSwingFailed).not.toHaveBeenCalled();
  });
});
