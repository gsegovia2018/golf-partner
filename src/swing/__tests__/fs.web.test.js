import {
  File, Directory, Paths, fsReady, fsFlush, storableUri, displayUri, blobOf, _setBackendForTests,
} from '../fs.web';

// fs.web.js is the swing library's file system in the browser: a synchronous index over IndexedDB.
// The store is swapped for a Map so the index, the persistence and a "reload" can be checked here.

function memoryStore(rows = new Map()) {
  return {
    rows,
    async loadAll() { return [...rows]; },
    async put(key, value) { rows.set(key, value); },
    async del(keys) { keys.forEach((k) => rows.delete(k)); },
  };
}

let urlN = 0;
beforeAll(() => {
  global.URL.createObjectURL = jest.fn(() => { urlN += 1; return `blob:test/${urlN}`; });
  global.URL.revokeObjectURL = jest.fn();
});

describe('fs.web', () => {
  test('files written are there at once, with blob: URIs, and reach the store in order', async () => {
    const store = memoryStore();
    _setBackendForTests(store);
    await fsReady();
    const f = new File(Paths.document, 'swings', 'a', 'analysis.json');
    expect(f.exists).toBe(false);
    expect(f.uri).toBe('swingfs:/document/swings/a/analysis.json');
    f.write(JSON.stringify({ ok: 1 }));
    expect(f.exists).toBe(true);
    expect(JSON.parse(await f.text())).toEqual({ ok: 1 });
    expect(f.uri).toMatch(/^blob:/);
    expect(f.uri).toBe(f.uri); // one URL per file, not one per read
    await fsFlush();
    expect(store.rows.has('document/swings/a/analysis.json')).toBe(true);
  });

  test('a reload reads the index back; storable URIs survive it, blob: URLs do not', async () => {
    const store = memoryStore();
    _setBackendForTests(store);
    await fsReady();
    const thumb = new File(Paths.document, 'swings', 'b', 'frames', '12.jpg');
    thumb.write(new Uint8Array([1, 2, 3]));
    const stored = storableUri(thumb.uri);
    expect(stored).toBe('swingfs:/document/swings/b/frames/12.jpg');
    await fsFlush();

    _setBackendForTests(memoryStore(store.rows)); // a new page: empty index, same IndexedDB
    expect(new File(stored).exists).toBe(false);
    await fsReady();
    expect(new File(stored).exists).toBe(true);
    expect(displayUri(stored)).toMatch(/^blob:/);
    expect(displayUri('swingfs:/document/swings/b/frames/99.jpg')).toBeNull();
    expect(displayUri('file:///phone/path.jpg')).toBe('file:///phone/path.jpg');
    expect([...(await (await blobOf(displayUri(stored))).arrayBuffer().then((b) => new Uint8Array(b)))]).toEqual([1, 2, 3]);
  });

  test('directories: exists, size, list and delete (the swing folder)', async () => {
    const store = memoryStore();
    _setBackendForTests(store);
    await fsReady();
    const dir = new Directory(Paths.document, 'swings', 'c');
    expect(dir.exists).toBe(false);
    dir.create();
    expect(dir.exists).toBe(true);
    new File(dir, 'video.mp4').write(new Uint8Array(10));
    new File(dir, 'frames', '1.jpg').write(new Uint8Array(5));
    expect(dir.size).toBe(15);
    const names = new Directory(Paths.document, 'swings').list().map((e) => [e.name, e instanceof Directory]);
    expect(names).toEqual([['c', true]]);
    expect(dir.list().map((e) => e.name).sort()).toEqual(['frames', 'video.mp4']);
    dir.delete();
    expect(dir.exists).toBe(false);
    expect(new File(dir, 'video.mp4').exists).toBe(false);
    await fsFlush();
    expect([...store.rows.keys()]).toEqual([]);
  });

  test('copy from a picked file (an external blob: URL) into the library', async () => {
    _setBackendForTests(memoryStore());
    await fsReady();
    global.fetch = jest.fn(async () => ({ blob: async () => new Blob([new Uint8Array([7, 7])], { type: 'video/quicktime' }) }));
    const dest = new File(Paths.document, 'swings', 'd', 'video.mp4');
    await new File('blob:http://localhost/picked').copy(dest);
    expect(global.fetch).toHaveBeenCalledWith('blob:http://localhost/picked');
    expect(dest.size).toBe(2);
    // our own blob: URL resolves back to the stored file, not to a fetch
    expect(new File(dest.uri).path).toBe('document/swings/d/video.mp4');
  });
});
