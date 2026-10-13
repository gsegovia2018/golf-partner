import { Platform } from 'react-native';

const mockExists = new Set();
jest.mock('expo-file-system', () => ({
  Paths: { document: 'file:///doc' },
  File: class {
    constructor(...parts) { this.path = parts.slice(1).join('/'); this.uri = `file:///doc/${this.path}`; }
    get exists() { return mockExists.has(this.path); }
  },
  Directory: class {
    constructor() { this.exists = true; this.uri = 'file:///doc/swings/s1/frames'; }
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

describe('getProxy (D28 scrub proxies, every 4th frame)', () => {
  test('the nearest proxy on disk; the tail of the clip rounds down; null when the swing has none', () => {
    ['0', '4', '8', '956'].forEach((f) => mockExists.add(`swings/s1/proxy/${f}.jpg`));
    const { getProxy, proxyFrames } = require('../frames');
    expect(proxyFrames(5)).toEqual([4]);
    expect(proxyFrames(6)).toEqual([8, 4]);
    expect(getProxy('s1', 5)).toBe('file:///doc/swings/s1/proxy/4.jpg');
    expect(getProxy('s1', 7)).toBe('file:///doc/swings/s1/proxy/8.jpg');
    expect(getProxy('s1', 959)).toBe('file:///doc/swings/s1/proxy/956.jpg'); // 960 is past the end
    expect(getProxy('s2', 5)).toBeNull(); // analysed by an apiVersion 2 binary: no proxies
  });
});
