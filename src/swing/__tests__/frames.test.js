import { Platform } from 'react-native';

const mockExists = new Set();
jest.mock('expo-file-system', () => ({
  Paths: { document: 'file:///doc' },
  File: class {
    constructor(...parts) { this.path = parts.slice(1).join('/'); this.uri = `file:///doc/${this.path}`; }
    get exists() { return mockExists.has(this.path); }
  },
  Directory: class {
    constructor(...parts) { this.exists = true; this.uri = parts.length > 1 ? `file:///doc/${parts.slice(1).join('/')}` : 'file:///doc/swings/s1/frames'; }
    create() {}
  },
}));
jest.mock('../../store/swingStore', () => ({ swingVideoUri: () => 'file:///doc/swings/s1/video.mp4' }));

const realOS = Platform.OS;
beforeEach(() => { jest.resetModules(); mockExists.clear(); Platform.OS = 'android'; });
afterEach(() => { Platform.OS = realOS; });

describe('getStill', () => {
  test('returns the uri of a still on disk and null otherwise', () => {
    mockExists.add('swings/s1/frames/556.jpg');
    const { getStill } = require('../frames');
    expect(getStill('s1', 556)).toBe('file:///doc/swings/s1/frames/556.jpg');
    expect(getStill('s1', 557)).toBeNull();
  });
});

describe('getStill keeps the stills it has seen (a scrub asks for ten per tick)', () => {
  const realNow = Date.now;
  afterEach(() => { Date.now = realNow; });

  test('a still found once is not looked up on disk again; a miss is looked at again after 500 ms', () => {
    let now = 1000;
    Date.now = () => now;
    const fs = require('expo-file-system');
    const exists = jest.spyOn(fs.File.prototype, 'exists', 'get');
    const { getStill } = require('../frames');
    mockExists.add('swings/s1/frames/10.jpg');
    expect(getStill('s1', 10)).toBe('file:///doc/swings/s1/frames/10.jpg');
    expect(getStill('s1', 10.2)).toBe('file:///doc/swings/s1/frames/10.jpg');
    expect(exists).toHaveBeenCalledTimes(1);

    expect(getStill('s1', 11)).toBeNull();
    mockExists.add('swings/s1/frames/11.jpg');
    now += 200;
    expect(getStill('s1', 11)).toBeNull(); // not re-checked yet
    expect(exists).toHaveBeenCalledTimes(2);
    now += 400;
    expect(getStill('s1', 11)).toBe('file:///doc/swings/s1/frames/11.jpg');
    expect(exists).toHaveBeenCalledTimes(3);
    exists.mockRestore();
  });

  test('stills written by ensureStills are known at once, even right after a miss', async () => {
    const extractFrames = jest.fn(async () => { mockExists.add('swings/s1/frames/20.jpg'); return { 20: 'file:///doc/swings/s1/frames/20.jpg' }; });
    jest.doMock('../native', () => ({ REQUIRED_API_VERSION: 1, apiVersion: 1, analyzePose: jest.fn(), extractFrames }), { virtual: true });
    const { getStill, ensureStills, stillTimings } = require('../frames');
    expect(getStill('s1', 20)).toBeNull();
    await ensureStills('s1', [20], 'target');
    expect(getStill('s1', 20)).toBe('file:///doc/swings/s1/frames/20.jpg');
    // each native call is timed: frames asked and how long it took
    expect(stillTimings()).toEqual([expect.objectContaining({ frames: 1, lane: 'target', ok: true, ms: expect.any(Number) })]);
  });
});

describe('ensureStills', () => {
  test('asks native only for the frames that are missing', async () => {
    mockExists.add('swings/s1/frames/556.jpg');
    const extractFrames = jest.fn(async () => ({ 557: 'file:///doc/swings/s1/frames/557.jpg' }));
    jest.doMock('../native', () => ({ REQUIRED_API_VERSION: 1, apiVersion: 1, analyzePose: jest.fn(), extractFrames }), { virtual: true });
    const { ensureStills } = require('../frames');
    const out = await ensureStills('s1', [556, 557]);
    expect(extractFrames).toHaveBeenCalledWith('file:///doc/swings/s1/video.mp4', { frames: [557], outDir: 'file:///doc/swings/s1/frames' });
    expect(out).toEqual({ 556: 'file:///doc/swings/s1/frames/556.jpg', 557: 'file:///doc/swings/s1/frames/557.jpg' });
  });

  test('falls back to what is on disk when native is missing or fails, and never rejects', async () => {
    mockExists.add('swings/s1/frames/556.jpg');
    jest.doMock('../native', () => { throw new Error('no module'); }, { virtual: true });
    let mod = require('../frames');
    expect(await mod.ensureStills('s1', [556, 557])).toEqual({ 556: 'file:///doc/swings/s1/frames/556.jpg', 557: null });

    jest.resetModules();
    jest.doMock('../native', () => ({ REQUIRED_API_VERSION: 1, apiVersion: 1, analyzePose: jest.fn(), extractFrames: jest.fn(async () => { throw new Error('decode'); }) }), { virtual: true });
    mod = require('../frames');
    expect(await mod.ensureStills('s1', [557])).toEqual({ 557: null });
  });

  test('on web there is no native at all', async () => {
    Platform.OS = 'web';
    const { nativeApi, ensureStills } = require('../frames');
    expect(nativeApi()).toBeNull();
    expect(await ensureStills('s1', [1])).toEqual({ 1: null });
  });
});

describe('scrub proxies (D28): the swing window, every 4th frame, no I/O per frame', () => {
  const meta = { every: 4, from: 200, to: 680, count: 121 };

  test('the window is about 1 s before the motion starts to 0.5 s after the finish, clamped', () => {
    const { proxyWindow } = require('../frames');
    const a = { fps: { capture: 240 }, internal: { motionStart: 400 }, checkpoints: { finish: { i: 640 } } };
    expect(proxyWindow(a, 1297)).toEqual([160, 760]);
    expect(proxyWindow({ ...a, internal: { motionStart: 100 } }, 1297)[0]).toBe(0);
    expect(proxyWindow({ ...a, checkpoints: { finish: { i: 1250 } } }, 1297)[1]).toBe(1296);
  });

  test('the nearest proxy inside the window; null outside it or without proxies (apiVersion 2, older swings)', () => {
    const { getProxy, proxyFrame } = require('../frames');
    expect(proxyFrame(205, meta)).toBe(204);
    expect(proxyFrame(207, meta)).toBe(208);
    expect(proxyFrame(199, meta)).toBe(200);
    expect(proxyFrame(150, meta)).toBeNull(); // outside: the canvas uses stills there
    expect(proxyFrame(682, meta)).toBe(680);
    expect(proxyFrame(700, meta)).toBeNull();
    expect(proxyFrame(300, null)).toBeNull();
    expect(getProxy('s1', 205, meta)).toBe('file:///doc/swings/s1/proxy/204.jpg');
    expect(getProxy('s1', 205, undefined)).toBeNull();
  });

  test('apiVersion 6 swings have a proxy every 2nd frame; the stored spacing decides, so both kinds work', () => {
    const { proxyFrame, proxyEveryFor } = require('../frames');
    expect(proxyEveryFor({ scrubSupport: () => true })).toBe(2);
    expect(proxyEveryFor({ scrubSupport: () => false })).toBe(4);
    expect(proxyEveryFor({})).toBe(4); // a binary bundle without the gate
    expect(proxyEveryFor(null)).toBe(4);
    const dense = { every: 2, from: 200, to: 680, count: 241 };
    expect(proxyFrame(205, dense)).toBe(206); // half way rounds up
    expect(proxyFrame(204, dense)).toBe(204);
    expect(proxyFrame(207, dense)).toBe(208);
    expect(proxyFrame(206, meta)).toBe(208); // an every-4 swing keeps its spacing
  });
});

describe('releaseFrameDecoder (apiVersion 6)', () => {
  test('closes the warm decoder on a binary that has one, never throws, does nothing otherwise', async () => {
    const releaseFrames = jest.fn(() => Promise.reject(new Error('gone')));
    jest.doMock('../native', () => ({ REQUIRED_API_VERSION: 1, apiVersion: 6, analyzePose: jest.fn(), scrubSupport: () => true, releaseFrames }), { virtual: true });
    const { releaseFrameDecoder } = require('../frames');
    expect(() => releaseFrameDecoder()).not.toThrow();
    expect(releaseFrames).toHaveBeenCalledTimes(1);
    await Promise.resolve(); // the rejection is swallowed
  });

  test('an older binary is not asked', () => {
    const releaseFrames = jest.fn();
    jest.doMock('../native', () => ({ REQUIRED_API_VERSION: 1, apiVersion: 5, analyzePose: jest.fn(), scrubSupport: () => false, releaseFrames }), { virtual: true });
    require('../frames').releaseFrameDecoder();
    expect(releaseFrames).not.toHaveBeenCalled();
  });
});

describe('ensureStills lanes (target first, neighbours after, superseded work dropped)', () => {
  // Each extractFrames call is a deferred the test settles by hand; calls are logged in start order.
  function setup() {
    const calls = [];
    const extractFrames = jest.fn((_p, { frames }) => new Promise((resolve, reject) => {
      calls.push({ frames, finish: () => { frames.forEach((f) => mockExists.add(`swings/s1/frames/${f}.jpg`)); resolve(Object.fromEntries(frames.map((f) => [f, `file:///doc/swings/s1/frames/${f}.jpg`]))); }, fail: reject });
    }));
    const cancelAnalysis = jest.fn(() => { const c = calls[calls.length - 1]; c.fail(new Error('ERR_CANCELLED')); });
    jest.doMock('../native', () => ({ REQUIRED_API_VERSION: 1, apiVersion: 1, analyzePose: jest.fn(), extractFrames, cancelAnalysis }), { virtual: true });
    return { calls, extractFrames, cancelAnalysis, ...require('../frames') };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  test('a target runs ahead of waiting neighbours and cancels the running prefetch', async () => {
    const { calls, cancelAnalysis, ensureStills } = setup();
    const near = ensureStills('s1', [11, 12, 13], 'neighbours');
    await tick();
    expect(calls.map((c) => c.frames)).toEqual([[11, 12, 13]]);
    const target = ensureStills('s1', [500], 'target');
    expect(cancelAnalysis).toHaveBeenCalledTimes(1);
    expect(await near).toEqual({ 11: null, 12: null, 13: null }); // dropped: resolves at once from disk
    await tick();
    expect(calls.map((c) => c.frames)).toEqual([[11, 12, 13], [500]]);
    calls[1].finish();
    expect(await target).toEqual({ 500: 'file:///doc/swings/s1/frames/500.jpg' });
  });

  test('a newer target supersedes a waiting one and a stale running one; never two jobs queue behind each other', async () => {
    const { calls, cancelAnalysis, ensureStills } = setup();
    const a = ensureStills('s1', [100], 'target');
    await tick();
    const b = ensureStills('s1', [200], 'target'); // a is running: cancelled
    const c = ensureStills('s1', [300], 'target'); // b waits: dropped
    expect(cancelAnalysis).toHaveBeenCalledTimes(1);
    expect(await a).toEqual({ 100: null });
    expect(await b).toEqual({ 200: null });
    await tick();
    expect(calls.map((x) => x.frames)).toEqual([[100], [300]]);
    calls[1].finish();
    expect((await c)[300]).toBe('file:///doc/swings/s1/frames/300.jpg');
    expect(calls).toHaveLength(2);
  });

  test('neighbours wait behind the target and a newer prefetch replaces an older one', async () => {
    const { calls, cancelAnalysis, ensureStills } = setup();
    const t = ensureStills('s1', [50], 'target');
    const n1 = ensureStills('s1', [49, 51], 'neighbours');
    const n2 = ensureStills('s1', [48, 49, 51, 52], 'neighbours');
    await tick();
    expect(cancelAnalysis).not.toHaveBeenCalled();
    expect(await n1).toEqual({ 49: null, 51: null });
    expect(calls.map((x) => x.frames)).toEqual([[50]]);
    calls[0].finish();
    await t;
    await tick();
    expect(calls.map((x) => x.frames)).toEqual([[50], [48, 49, 51, 52]]);
    calls[1].finish();
    expect(Object.values(await n2).every(Boolean)).toBe(true);
  });

  test('asking again for what the lane is already extracting shares the job', async () => {
    const { extractFrames, cancelAnalysis, ensureStills } = setup();
    const a = ensureStills('s1', [7], 'target');
    const b = ensureStills('s1', [7], 'target');
    await tick();
    expect(extractFrames).toHaveBeenCalledTimes(1);
    expect(cancelAnalysis).not.toHaveBeenCalled();
    expect(a).toBe(b);
  });

  test('a target already inside the running prefetch waits for it instead of cancelling it', async () => {
    const { calls, cancelAnalysis, ensureStills } = setup();
    const near = ensureStills('s1', [88, 89, 90, 91, 92], 'neighbours');
    await tick();
    const target = ensureStills('s1', [90], 'target');
    const later = ensureStills('s1', [70, 71], 'neighbours'); // the job now serves a target: a prefetch does not drop it
    expect(cancelAnalysis).not.toHaveBeenCalled();
    calls[0].finish();
    expect(await target).toEqual({ 90: 'file:///doc/swings/s1/frames/90.jpg' });
    expect(Object.values(await near).every(Boolean)).toBe(true);
    await tick();
    expect(calls.map((c) => c.frames)).toEqual([[88, 89, 90, 91, 92], [70, 71]]); // one decode for 90, no second one
    calls[1].finish();
    await later;
  });

  test('a waiting job that covers the target is kept and moved first; the stale running one is cancelled', async () => {
    const { calls, cancelAnalysis, ensureStills } = setup();
    const a = ensureStills('s1', [10], 'target');
    const n = ensureStills('s1', [9, 11, 12], 'neighbours');
    await tick();
    const t = ensureStills('s1', [12], 'target'); // 10 is stale; the waiting prefetch has 12
    expect(cancelAnalysis).toHaveBeenCalledTimes(1);
    expect(await a).toEqual({ 10: null });
    await tick();
    expect(calls.map((c) => c.frames)).toEqual([[10], [9, 11, 12]]);
    calls[1].finish();
    expect(await t).toEqual({ 12: 'file:///doc/swings/s1/frames/12.jpg' });
    expect((await n)[9]).toBeTruthy();
  });

  test('a prefetch inside the running wide prefetch waits for it instead of replacing it', async () => {
    const { calls, cancelAnalysis, ensureStills } = setup();
    const wide = ensureStills('s1', [40, 41, 42, 43, 44, 45, 46], 'neighbours');
    await tick();
    const zoom = ensureStills('s1', [42, 43, 44], 'neighbours');
    expect(cancelAnalysis).not.toHaveBeenCalled();
    calls[0].finish();
    expect(await zoom).toEqual({ 42: expect.any(String), 43: expect.any(String), 44: expect.any(String) });
    expect(Object.values(await wide).every(Boolean)).toBe(true);
    await tick();
    expect(calls).toHaveLength(1);
  });

  test('lane-less callers stay FIFO and are never cancelled or dropped', async () => {
    const { calls, cancelAnalysis, ensureStills } = setup();
    const r1 = ensureStills('s1', [1]);
    const r2 = ensureStills('s1', [2]);
    await tick();
    const t = ensureStills('s1', [900], 'target'); // may not cancel a running lane-less job
    expect(cancelAnalysis).not.toHaveBeenCalled();
    calls[0].finish();
    await r1;
    await tick();
    expect(calls.map((x) => x.frames)).toEqual([[1], [900]]); // target jumps ahead of the waiting lane-less job
    calls[1].finish();
    await t;
    await tick();
    calls[2].finish();
    expect((await r2)[2]).toBeTruthy();
  });
});
