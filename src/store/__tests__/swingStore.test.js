import AsyncStorage from '@react-native-async-storage/async-storage';

// In-memory expo-file-system: files are path -> string, directories are a set of
// paths. Just the surface swingStore uses.
jest.mock('expo-file-system', () => {
  const files = new Map();
  const dirs = new Set();
  const join = (parts) => parts
    .map((p) => (typeof p === 'string' ? p : p.uri))
    .join('/').replace(/([^:/])\/{2,}/g, '$1/').replace(/\/$/, '');
  class Directory {
    constructor(...parts) { this.uri = join(parts); }
    get name() { return this.uri.split('/').pop(); }
    get exists() { return dirs.has(this.uri); }
    get size() {
      let n = 0;
      files.forEach((v, k) => { if (k.startsWith(`${this.uri}/`)) n += v.length; });
      return n;
    }
    create() {
      const parts = this.uri.split('/');
      for (let i = 4; i <= parts.length; i += 1) dirs.add(parts.slice(0, i).join('/')); // file:///x/...
    }
    delete() {
      dirs.forEach((d) => { if (d === this.uri || d.startsWith(`${this.uri}/`)) dirs.delete(d); });
      [...files.keys()].forEach((k) => { if (k.startsWith(`${this.uri}/`)) files.delete(k); });
    }
    copy(dest) {
      dirs.add(dest.uri);
      [...files.entries()].forEach(([k, v]) => { if (k.startsWith(`${this.uri}/`)) files.set(dest.uri + k.slice(this.uri.length), v); });
    }
    list() {
      const prefix = `${this.uri}/`;
      const names = new Set();
      dirs.forEach((d) => { if (d.startsWith(prefix)) names.add(d.slice(prefix.length).split('/')[0]); });
      return [...names].map((n) => new Directory(this, n));
    }
  }
  class File {
    constructor(...parts) { this.uri = join(parts); }
    get exists() { return files.has(this.uri); }
    create() { files.set(this.uri, files.get(this.uri) ?? ''); }
    write(s) { files.set(this.uri, s); }
    async text() { return files.get(this.uri); }
    copy(dest) {
      if (!files.has(this.uri)) throw new Error('missing source');
      files.set(dest.uri, files.get(this.uri));
    }
  }
  return {
    Paths: { document: new Directory('file:///doc'), cache: new Directory('file:///cache') },
    Directory,
    File,
    __files: files,
    __dirs: dirs,
  };
});

const fs = require('expo-file-system');
const store = require('../swingStore');
const { emptyMarks } = require('../../swing/labels');

const seedVideo = (uri = 'file:///picked/clip.mp4') => fs.__files.set(uri, 'VIDEO-BYTES');
const analysisFixture = {
  handedness: 'right',
  club: 'iron',
  fps: { capture: 240, effective: 240, factor: 8, approximate: false },
  main: { fault: 'early_extension' },
  counts: { green: 5, yellow: 3, red: 2, unknown: 4 },
};

beforeEach(async () => {
  fs.__files.clear();
  fs.__dirs.clear();
  store._resetForTests();
  await AsyncStorage.clear();
  seedVideo();
});

describe('defaultSwingName (D13)', () => {
  it('formats the capture date as "Sat 11 Oct · 18:42"', () => {
    expect(store.defaultSwingName(new Date(2026, 9, 11, 18, 42))).toBe('Sun 11 Oct · 18:42');
    expect(store.defaultSwingName(new Date(2026, 9, 10, 7, 5))).toBe('Sat 10 Oct · 07:05');
  });
});

describe('createSwing', () => {
  it('copies the clip, adds a pending row named after the date, and persists the index', async () => {
    const row = await store.createSwing({ videoUri: 'file:///picked/clip.mp4', createdAt: new Date(2026, 9, 10, 18, 42) });
    expect(row).toMatchObject({ status: 'pending', source: 'import', name: 'Sat 10 Oct · 18:42' });
    expect(fs.__files.get(store.swingVideoUri(row.id))).toBe('VIDEO-BYTES');
    expect(fs.__files.get('file:///picked/clip.mp4')).toBe('VIDEO-BYTES'); // original untouched
    expect(store.getSwings()).toHaveLength(1);
    const saved = JSON.parse(await AsyncStorage.getItem('golf_swings.v1'));
    expect(saved[0].id).toBe(row.id);
  });

  it('removes the half-made folder and adds no row when the copy fails', async () => {
    await expect(store.createSwing({ videoUri: 'file:///nope.mp4' })).rejects.toThrow();
    expect(store.getSwings()).toHaveLength(0);
    expect([...fs.__dirs].filter((d) => d.includes('/swings/'))).toHaveLength(0);
  });

  it('lists newest first and notifies subscribers', async () => {
    const cb = jest.fn();
    store.subscribeSwings(cb);
    const a = await store.createSwing({ videoUri: 'file:///picked/clip.mp4', createdAt: new Date(2026, 9, 1) });
    const b = await store.createSwing({ videoUri: 'file:///picked/clip.mp4', createdAt: new Date(2026, 9, 5) });
    expect(store.getSwings().map((s) => s.id)).toEqual([b.id, a.id]);
    expect(cb).toHaveBeenCalled();
    expect(store.getSwingsVersion()).toBeGreaterThan(0);
  });
});

describe('saveAnalysis / marks', () => {
  it('writes analysis.json and seeds marks.json, filling the row for the list', async () => {
    const row = await store.createSwing({ videoUri: 'file:///picked/clip.mp4' });
    await store.saveAnalysis(row.id, analysisFixture, { pose: { video: { width: 478, height: 850, fps: 29.97 } } });
    const got = store.getSwing(row.id);
    expect(got).toMatchObject({
      status: 'ready', club: 'iron', mainFault: 'early_extension',
      counts: { green: 5, yellow: 3, red: 2 }, fps: { capture: 240, factor: 8 },
    });
    expect(got.bytes).toBeGreaterThan(0);
    expect((await store.readAnalysis(row.id)).swingId).toBe(row.id);
    const marks = await store.readMarks(row.id);
    expect(marks.schema).toBe('swing-club-labels/1');
    expect(marks.video.width).toBe(478);
  });

  it('keeps existing marks when the analysis is re-saved, and round-trips saveMarks', async () => {
    const row = await store.createSwing({ videoUri: 'file:///picked/clip.mp4' });
    await store.saveAnalysis(row.id, analysisFixture);
    const edited = { ...emptyMarks({ swingId: row.id }), ball: { proposed: [0.5, 0.6, 0.01], final: [0.51, 0.6, 0.01], corrected: true } };
    await store.saveMarks(row.id, edited);
    await store.saveAnalysis(row.id, analysisFixture);
    expect((await store.readMarks(row.id)).ball.corrected).toBe(true);
  });

  it('readMarks returns null for a corrupt or foreign file', async () => {
    const row = await store.createSwing({ videoUri: 'file:///picked/clip.mp4' });
    fs.__files.set(`file:///doc/swings/${row.id}/marks.json`, '{not json');
    expect(await store.readMarks(row.id)).toBeNull();
  });

  it('markSwingFailed records the D12 error', async () => {
    const row = await store.createSwing({ videoUri: 'file:///picked/clip.mp4' });
    await store.markSwingFailed(row.id, 'no_pose');
    expect(store.getSwing(row.id)).toMatchObject({ status: 'error', error: 'no_pose' });
  });
});

describe('rename and delete', () => {
  it('renames, ignoring blank names', async () => {
    const row = await store.createSwing({ videoUri: 'file:///picked/clip.mp4' });
    await store.renameSwing(row.id, '  Range, 7 iron  ');
    expect(store.getSwing(row.id).name).toBe('Range, 7 iron');
    await store.renameSwing(row.id, '   ');
    expect(store.getSwing(row.id).name).toBe('Range, 7 iron');
  });

  it('delete removes the row, the index entry and every file of the swing', async () => {
    const row = await store.createSwing({ videoUri: 'file:///picked/clip.mp4' });
    await store.saveAnalysis(row.id, analysisFixture);
    await store.deleteSwing(row.id);
    expect(store.getSwings()).toHaveLength(0);
    expect(JSON.parse(await AsyncStorage.getItem('golf_swings.v1'))).toEqual([]);
    expect([...fs.__files.keys()].filter((k) => k.includes(row.id))).toHaveLength(0);
  });

  it('pruneOrphanSwingDirs removes folders with no row', async () => {
    const keep = await store.createSwing({ videoUri: 'file:///picked/clip.mp4' });
    fs.__dirs.add('file:///doc/swings/orphan');
    fs.__files.set('file:///doc/swings/orphan/video.mp4', 'x');
    expect(store.pruneOrphanSwingDirs()).toBe(1);
    expect(fs.__files.has(store.swingVideoUri(keep.id))).toBe(true);
    expect(fs.__files.has('file:///doc/swings/orphan/video.mp4')).toBe(false);
  });
});

describe('profile (D5, D6)', () => {
  it('defaults to right-handed with no height, persists, and hydrates back', async () => {
    expect(store.getSwingProfile()).toEqual({ heightCm: null, handedness: 'right', asked: false });
    await store.setSwingProfile({ heightCm: 176, handedness: 'left' });
    expect(store.getSwingProfile()).toEqual({ heightCm: 176, handedness: 'left', asked: true });
    store._resetForTests();
    await store.hydrateSwings();
    expect(store.getSwingProfile()).toEqual({ heightCm: 176, handedness: 'left', asked: true });
  });

  it('keeps the height when only handedness changes', async () => {
    await store.setSwingProfile({ heightCm: 180 });
    await store.setSwingProfile({ handedness: 'left' });
    expect(store.getSwingProfile().heightCm).toBe(180);
  });
});

describe('hydrate', () => {
  it('restores the index from AsyncStorage and survives a corrupt value', async () => {
    const row = await store.createSwing({ videoUri: 'file:///picked/clip.mp4' });
    store._resetForTests();
    await store.hydrateSwings();
    expect(store.getSwings().map((s) => s.id)).toEqual([row.id]);
    await AsyncStorage.setItem('golf_swings.v1', '{broken');
    store._resetForTests();
    await expect(store.hydrateSwings()).resolves.toBeUndefined();
    expect(store.getSwings()).toEqual([]);
  });
});

describe('storage and export (D18)', () => {
  it('sums bytes across swings', async () => {
    const a = await store.createSwing({ videoUri: 'file:///picked/clip.mp4' });
    await store.saveAnalysis(a.id, analysisFixture);
    expect(store.storageBytes()).toBe(store.getSwing(a.id).bytes);
    expect(store.overStorageWarning()).toBe(false);
  });

  it('exportSwing writes a folder with swing.json, the video and the stills', async () => {
    const row = await store.createSwing({ videoUri: 'file:///picked/clip.mp4' });
    await store.saveAnalysis(row.id, analysisFixture);
    fs.__dirs.add(`file:///doc/swings/${row.id}/frames`);
    fs.__files.set(`file:///doc/swings/${row.id}/frames/556.jpg`, 'JPEG');
    const out = await store.exportSwing(row.id);
    expect(out.dir).toBe(`file:///cache/swing-export/${row.id}`);
    const json = JSON.parse(fs.__files.get(out.jsonUri));
    expect(json.schema).toBe('swing-export/1');
    expect(json.swing.id).toBe(row.id);
    expect(json.analysis.main.fault).toBe('early_extension');
    expect(json.marks.schema).toBe('swing-club-labels/1');
    expect(fs.__files.get(out.videoUri)).toBe('VIDEO-BYTES');
    expect(fs.__files.get(`${out.dir}/frames/556.jpg`)).toBe('JPEG');
  });

  it('exportSwing rejects an unknown id', async () => {
    await expect(store.exportSwing('nope')).rejects.toThrow('Swing not found');
  });
});
