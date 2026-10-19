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
      message: native.updateAppMessage(),
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

  describe('capture gate (N3, apiVersion 2)', () => {
    function loadCapture({ apiVersion, camera }) {
      let native;
      const requireNativeView = jest.fn(() => 'GolfSwingCameraView');
      const requireOptionalNativeModule = jest.fn((name) => (name === 'GolfSwing' ? fakeModule(apiVersion) : camera));
      jest.isolateModules(() => {
        jest.doMock('react-native', () => ({ Platform: { OS: 'android' } }));
        jest.doMock('expo', () => ({ requireOptionalNativeModule, requireNativeView }));
        native = require('../native');
      });
      return { native, requireNativeView };
    }
    const camera = () => ({ listRecordingModes: jest.fn(async () => [{ cameraId: '0', width: 1280, height: 720, fps: 240, highSpeed: true }]) });

    it('records on a binary with the camera module and apiVersion 2', async () => {
      const cam = camera();
      const { native, requireNativeView } = loadCapture({ apiVersion: 2, camera: cam });
      expect(native.captureSupport()).toMatchObject({ supported: true, apiVersion: 2 });
      await expect(native.listRecordingModes()).resolves.toHaveLength(1);
      expect(native.getCameraView()).toBe('GolfSwingCameraView');
      expect(requireNativeView).toHaveBeenCalledWith('GolfSwingCamera');
    });

    it('an apiVersion 1 binary (N1 only) never touches the camera', async () => {
      const cam = camera();
      const { native, requireNativeView } = loadCapture({ apiVersion: 1, camera: cam });
      expect(native.captureSupport()).toMatchObject({ supported: false, reason: 'update_app' });
      expect(native.getCameraView()).toBeNull();
      await expect(native.listRecordingModes()).rejects.toMatchObject({ code: 'ERR_UPDATE_APP' });
      expect(cam.listRecordingModes).not.toHaveBeenCalled();
      expect(requireNativeView).not.toHaveBeenCalled();
    });

    it('a binary that analyses but lacks the camera module keeps analysing and offers the import', () => {
      const { native } = loadCapture({ apiVersion: 2, camera: null });
      expect(native.swingSupport().supported).toBe(true);
      expect(native.captureSupport()).toMatchObject({ supported: false, reason: 'update_app', message: native.updateCaptureMessage() });
    });
  });
});

describe('scrub proxies (D28): apiVersion 3, gated on their own', () => {
  it('apiVersion 3: analysis and proxies', () => {
    const { native } = load({ mod: fakeModule(3) });
    expect(native.swingSupport().supported).toBe(true);
    expect(native.proxySupport()).toBe(true);
    expect(native.PROXY_API_VERSION).toBe(3);
  });

  it('apiVersion 2: still analyses and marks (the analysis contract did not change), but writes no proxies', () => {
    const { native } = load({ mod: fakeModule(2) });
    expect(native.swingSupport().supported).toBe(true);
    expect(native.proxySupport()).toBe(false);
  });

  it('no module (web, or an APK without it): no proxies', () => {
    expect(load({ os: 'web' }).native.proxySupport()).toBe(false);
    expect(load({ mod: null }).native.proxySupport()).toBe(false);
  });
});

describe('learned club detector: apiVersion 4, gated on its own', () => {
  it('apiVersion 4: model proposals on', () => {
    const { native } = load({ mod: fakeModule(4) });
    expect(native.swingSupport().supported).toBe(true);
    expect(native.clubModelSupport()).toBe(true);
    expect(native.CLUB_MODEL_API_VERSION).toBe(4);
    expect(native.REQUIRED_API_VERSION).toBe(2);
  });

  it('apiVersion 3: still analyses and writes proxies, but no club model', () => {
    const { native } = load({ mod: fakeModule(3) });
    expect(native.swingSupport().supported).toBe(true);
    expect(native.proxySupport()).toBe(true);
    expect(native.clubModelSupport()).toBe(false);
  });

  it('no module (web, or an APK without it): no club model', () => {
    expect(load({ os: 'web' }).native.clubModelSupport()).toBe(false);
    expect(load({ mod: null }).native.clubModelSupport()).toBe(false);
  });
});

describe('club detector on demand: apiVersion 5, gated on its own', () => {
  const q = { frames: [{ frame: 9, still: 'file:///f/9.jpg', grip: [0.5, 0.5] }], video: { width: 100, height: 200 }, pxPerCm: 2, scenery: [] };

  it('apiVersion 5: detectClub and releaseClub are forwarded', async () => {
    const mod = { ...fakeModule(5), detectClub: jest.fn(async () => ({ frames: {} })), releaseClub: jest.fn(async () => {}) };
    const { native } = load({ mod });
    expect(native.CLUB_ONDEMAND_API_VERSION).toBe(5);
    expect(native.clubOnDemandSupport()).toBe(true);
    await expect(native.detectClub(q)).resolves.toEqual({ frames: {} });
    expect(mod.detectClub).toHaveBeenCalledWith(q);
    await native.releaseClub();
    expect(mod.releaseClub).toHaveBeenCalledTimes(1);
  });

  it('apiVersion 4: no on-demand proposals, detectClub is refused and nothing reaches native', async () => {
    const mod = { ...fakeModule(4), detectClub: jest.fn(), releaseClub: jest.fn() };
    const { native } = load({ mod });
    expect(native.clubModelSupport()).toBe(true);
    expect(native.clubOnDemandSupport()).toBe(false);
    await expect(native.detectClub(q)).rejects.toMatchObject({ code: 'ERR_UPDATE_APP' });
    await native.releaseClub();
    expect(mod.detectClub).not.toHaveBeenCalled();
    expect(mod.releaseClub).not.toHaveBeenCalled();
  });

  it('no module (web, or an APK without it): no on-demand proposals', () => {
    expect(load({ os: 'web' }).native.clubOnDemandSupport()).toBe(false);
    expect(load({ mod: null }).native.clubOnDemandSupport()).toBe(false);
  });
});

describe('scrubber decoder and dense proxies: apiVersion 6, gated on their own', () => {
  it('apiVersion 6: scrubSupport and releaseFrames are forwarded', async () => {
    const mod = { ...fakeModule(6), releaseFrames: jest.fn(async () => {}) };
    const { native } = load({ mod });
    expect(native.SCRUB_API_VERSION).toBe(6);
    expect(native.scrubSupport()).toBe(true);
    expect(native.clubOnDemandSupport()).toBe(true);
    await native.releaseFrames();
    expect(mod.releaseFrames).toHaveBeenCalledTimes(1);
  });

  it('apiVersion 5: everything else stays, nothing reaches a releaseFrames it lacks', async () => {
    const mod = { ...fakeModule(5), releaseFrames: jest.fn() };
    const { native } = load({ mod });
    expect(native.scrubSupport()).toBe(false);
    expect(native.clubOnDemandSupport()).toBe(true);
    await native.releaseFrames();
    expect(mod.releaseFrames).not.toHaveBeenCalled();
  });

  it('no module (web, or an APK without it): no scrub support', () => {
    expect(load({ os: 'web' }).native.scrubSupport()).toBe(false);
    expect(load({ mod: null }).native.scrubSupport()).toBe(false);
  });
});
