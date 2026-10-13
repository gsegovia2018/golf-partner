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
});
