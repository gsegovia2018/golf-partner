// `document` is undefined in the default (native) jest environment — this
// module only runs on web, so we stub just enough of the DOM surface for
// generateVideoThumbWeb to exercise its real control flow.
function makeVideoStub() {
  let src = '';
  const srcHistory = [];
  return {
    srcHistory,
    addEventListener: jest.fn((event, cb) => {
      // Fire the events the implementation actually waits on. Both fire
      // asynchronously (mirrors real <video> event dispatch) so promise
      // ordering in the implementation is exercised for real.
      if (event === 'loadedmetadata' || event === 'seeked') {
        Promise.resolve().then(cb);
      }
    }),
    removeEventListener: jest.fn(),
    removeAttribute: jest.fn((attr) => { if (attr === 'src') src = ''; }),
    load: jest.fn(),
    remove: jest.fn(),
    get src() { return src; },
    set src(v) { src = v; srcHistory.push(v); },
    currentTime: 0,
    duration: 10,
    videoWidth: 640,
    videoHeight: 360,
  };
}

function makeCanvasStub(thumbBlob) {
  return {
    width: 0,
    height: 0,
    getContext: jest.fn(() => ({ drawImage: jest.fn() })),
    toBlob: jest.fn((cb) => cb(thumbBlob)),
  };
}

describe('generateVideoThumbWeb', () => {
  const sourceBlob = { __tag: 'sourceBlob', size: 999 };
  const thumbBlob = { __tag: 'thumbBlob', size: 42 };
  let videoStub;
  let canvasStub;
  let createElementSpy;
  let createObjectURLSpy;
  let revokeObjectURLSpy;
  let fetchSpy;
  let generateVideoThumbWeb;

  beforeEach(() => {
    jest.resetModules();
    videoStub = makeVideoStub();
    canvasStub = makeCanvasStub(thumbBlob);

    global.document = {
      createElement: jest.fn((tag) => (tag === 'video' ? videoStub : canvasStub)),
    };
    createElementSpy = global.document.createElement;

    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(sourceBlob),
    });

    let callCount = 0;
    createObjectURLSpy = jest.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      callCount += 1;
      return callCount === 1 ? 'blob:source-url' : 'blob:thumb-url';
    });
    revokeObjectURLSpy = jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    ({ generateVideoThumbWeb } = require('../videoThumbWeb'));
  });

  afterEach(() => {
    delete global.document;
    fetchSpy.mockRestore();
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
  });

  test('fetches the source into its own object URL, returns the thumb URL, revokes the source, and removes the <video> element', async () => {
    const result = await generateVideoThumbWeb('blob:caller-owned-uri', { timeSeconds: 0.5 });

    expect(result).toBe('blob:thumb-url');

    // The caller's URI is read via fetch, not handed straight to the
    // <video> element — this is what lets the source be revoked safely
    // without invalidating the caller's URI (still needed to upload the
    // original file afterwards).
    expect(fetchSpy).toHaveBeenCalledWith('blob:caller-owned-uri');
    expect(createObjectURLSpy).toHaveBeenCalledWith(sourceBlob);
    // The <video> element decoded the source url this function created —
    // not the caller's raw uri directly.
    expect(videoStub.srcHistory).toEqual(['blob:source-url']);

    // The source object URL this function created must be revoked.
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:source-url');
    // The returned thumb URL is the caller's responsibility — not revoked here.
    expect(revokeObjectURLSpy).not.toHaveBeenCalledWith('blob:thumb-url');

    // The <video> element must not be left dangling: its src is cleared and
    // the element itself is removed.
    expect(videoStub.removeAttribute).toHaveBeenCalledWith('src');
    expect(videoStub.src).toBe('');
    expect(videoStub.remove).toHaveBeenCalledTimes(1);

    expect(createElementSpy).toHaveBeenCalledWith('video');
    expect(createElementSpy).toHaveBeenCalledWith('canvas');
  });

  test('still revokes the source and removes the <video> element when the decode fails', async () => {
    videoStub.addEventListener = jest.fn((event, cb) => {
      if (event === 'error') Promise.resolve().then(cb);
    });

    await expect(generateVideoThumbWeb('blob:caller-owned-uri')).rejects.toThrow();

    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:source-url');
    expect(videoStub.removeAttribute).toHaveBeenCalledWith('src');
    expect(videoStub.remove).toHaveBeenCalledTimes(1);
  });

  test('throws outside of a browser environment without touching URL/document', async () => {
    delete global.document;
    await expect(generateVideoThumbWeb('blob:x')).rejects.toThrow(
      'videoThumbWeb called outside of a browser environment',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
