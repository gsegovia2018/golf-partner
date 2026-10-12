// The real bridge: the apiVersion gate that keeps OTA bundles safe on older APKs
// (plan S10). Tests that need a fake module jest.doMock('../native') themselves.

function load({ os = 'android', mod = null } = {}) {
  let native;
  const requireOptionalNativeModule = jest.fn(() => mod);
  jest.isolateModules(() => {
    jest.doMock('react-native', () => ({ Platform: { OS: os } }));
    jest.doMock('expo', () => ({ requireOptionalNativeModule }));
    native = require('../native');
  });
  return { native, requireOptionalNativeModule };
}

const native0 = () => load().native;

const fakeModule = (apiVersion) => ({
  apiVersion,
  probeVideo: jest.fn(async () => ({ width: 1 })),
  analyzePose: jest.fn(async () => ({ frames: [] })),
  addListener: jest.fn(() => ({ remove: jest.fn() })),
});

describe('swing native bridge', () => {
  it('is supported when the binary speaks the required apiVersion', async () => {
    const mod = fakeModule(2);
    const { native } = load({ mod });
    expect(native.swingSupport()).toEqual({ supported: true, reason: null, apiVersion: 2, message: null });
    await native.analyzePose('file:///x.mp4', { model: 'full' });
    expect(mod.analyzePose).toHaveBeenCalledWith('file:///x.mp4', { model: 'full' });
  });

  it('asks for an app update when the binary is older than the bundle', async () => {
    const mod = fakeModule(0);
    const { native } = load({ mod });
    expect(native.swingSupport()).toEqual({
      supported: false,
      reason: 'update_app',
      apiVersion: 0,
      message: native.UPDATE_APP_MESSAGE,
    });
    await expect(native.analyzePose('x.mp4')).rejects.toMatchObject({ code: 'ERR_UPDATE_APP' });
    expect(mod.analyzePose).not.toHaveBeenCalled();
    expect(native.addProgressListener(() => {})).toHaveProperty('remove');
    expect(mod.addListener).not.toHaveBeenCalled();
  });

  it('refuses an N1 binary (apiVersion 1): its extractCheckpoints has no clubhead or address onset', async () => {
    expect(native0().REQUIRED_API_VERSION).toBe(2);
    const mod = { ...fakeModule(1), extractCheckpoints: jest.fn() };
    const { native } = load({ mod });
    expect(native.swingSupport()).toMatchObject({ supported: false, reason: 'update_app', apiVersion: 1 });
    await expect(native.extractCheckpoints('v.mp4', { frames: [], outDir: '/f' })).rejects.toMatchObject({ code: 'ERR_UPDATE_APP' });
    expect(mod.extractCheckpoints).not.toHaveBeenCalled();
  });

  it('forwards extractCheckpoints (pass 2) on a current binary', async () => {
    const out = { stills: {}, shaft: { 557: { head: [270, 504], hidden: false, conf: 0.8, source: 'edge' } }, addressFrame: 325 };
    const mod = { ...fakeModule(2), extractCheckpoints: jest.fn(async () => out) };
    const { native } = load({ mod });
    const opts = { frames: [{ key: 'impact', i: 557, hands: [0.46, 0.48], neighbours: 2 }], outDir: '/f' };
    await expect(native.extractCheckpoints('v.mp4', opts)).resolves.toBe(out);
    expect(mod.extractCheckpoints).toHaveBeenCalledWith('v.mp4', opts);
  });

  it('exposes apiVersion() for availability.js', () => {
    expect(load({ mod: fakeModule(3) }).native.apiVersion()).toBe(3);
    expect(load({ mod: null }).native.apiVersion()).toBeNull();
  });

  it('asks for an app update on an Android binary built before the module existed', () => {
    const { native } = load({ mod: null });
    expect(native.swingSupport()).toMatchObject({ supported: false, reason: 'update_app', apiVersion: null });
  });

  it('is unsupported off Android and never touches the native registry', async () => {
    const { native, requireOptionalNativeModule } = load({ os: 'web', mod: fakeModule(2) });
    expect(native.swingSupport()).toMatchObject({ supported: false, reason: 'platform' });
    await expect(native.probeVideo('x.mp4')).rejects.toMatchObject({ code: 'ERR_UNSUPPORTED' });
    expect(requireOptionalNativeModule).not.toHaveBeenCalled();
  });

  it('forwards stills and cancel, and refuses them on an old binary', async () => {
    const mod = { ...fakeModule(2), extractFrames: jest.fn(async () => ({ 557: 'file:///f/557.jpg' })), cancelAnalysis: jest.fn() };
    const { native } = load({ mod });
    await expect(native.extractFrames('v.mp4', { frames: [557], outDir: '/f' })).resolves.toEqual({ 557: 'file:///f/557.jpg' });
    native.cancelAnalysis();
    expect(mod.cancelAnalysis).toHaveBeenCalled();
    const old = load({ mod: { ...fakeModule(0), extractFrames: jest.fn() } }).native;
    await expect(old.extractFrames('v.mp4', { frames: [1], outDir: '/f' })).rejects.toMatchObject({ code: 'ERR_UPDATE_APP' });
    expect(() => old.cancelAnalysis()).not.toThrow();
  });

  it('forwards progress events from the module', () => {
    const mod = fakeModule(2);
    const { native } = load({ mod });
    const cb = jest.fn();
    native.addProgressListener(cb);
    expect(mod.addListener).toHaveBeenCalledWith('progress', cb);
  });
});
