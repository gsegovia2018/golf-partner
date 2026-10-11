// The real bridge (imported as '../native', which the jest.config.js mapper for
// '/swing/native' does not catch): the apiVersion gate that keeps OTA bundles safe on
// older APKs (plan S10).

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

const fakeModule = (apiVersion) => ({
  apiVersion,
  probeVideo: jest.fn(async () => ({ width: 1 })),
  analyzePose: jest.fn(async () => ({ frames: [] })),
  addListener: jest.fn(() => ({ remove: jest.fn() })),
});

describe('swing native bridge', () => {
  it('is supported when the binary speaks the required apiVersion', async () => {
    const mod = fakeModule(1);
    const { native } = load({ mod });
    expect(native.swingSupport()).toEqual({ supported: true, reason: null, apiVersion: 1, message: null });
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

  it('exposes apiVersion() for availability.js', () => {
    expect(load({ mod: fakeModule(3) }).native.apiVersion()).toBe(3);
    expect(load({ mod: null }).native.apiVersion()).toBeNull();
  });

  it('asks for an app update on an Android binary built before the module existed', () => {
    const { native } = load({ mod: null });
    expect(native.swingSupport()).toMatchObject({ supported: false, reason: 'update_app', apiVersion: null });
  });

  it('is unsupported off Android and never touches the native registry', async () => {
    const { native, requireOptionalNativeModule } = load({ os: 'web', mod: fakeModule(1) });
    expect(native.swingSupport()).toMatchObject({ supported: false, reason: 'platform' });
    await expect(native.probeVideo('x.mp4')).rejects.toMatchObject({ code: 'ERR_UNSUPPORTED' });
    expect(requireOptionalNativeModule).not.toHaveBeenCalled();
  });

  it('forwards stills and cancel, and refuses them on an old binary', async () => {
    const mod = { ...fakeModule(1), extractFrames: jest.fn(async () => ({ 557: 'file:///f/557.jpg' })), cancelAnalysis: jest.fn() };
    const { native } = load({ mod });
    await expect(native.extractFrames('v.mp4', { frames: [557], outDir: '/f' })).resolves.toEqual({ 557: 'file:///f/557.jpg' });
    native.cancelAnalysis();
    expect(mod.cancelAnalysis).toHaveBeenCalled();
    const old = load({ mod: { ...fakeModule(0), extractFrames: jest.fn() } }).native;
    await expect(old.extractFrames('v.mp4', { frames: [1], outDir: '/f' })).rejects.toMatchObject({ code: 'ERR_UPDATE_APP' });
    expect(() => old.cancelAnalysis()).not.toThrow();
  });

  it('forwards progress events from the module', () => {
    const mod = fakeModule(1);
    const { native } = load({ mod });
    const cb = jest.fn();
    native.addProgressListener(cb);
    expect(mod.addListener).toHaveBeenCalledWith('progress', cb);
  });
});
