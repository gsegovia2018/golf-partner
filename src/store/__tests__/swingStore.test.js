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
    async bytes() {
      const v = files.get(this.uri);
      return typeof v === 'string' ? Uint8Array.from(v, (c) => c.charCodeAt(0)) : v;
    }
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

  it('puts the consequences and the analysis-time handedness on the index row (coach swing link)', async () => {
    const row = await store.createSwing({ videoUri: 'file:///picked/clip.mp4' });
    await store.saveAnalysis(row.id, { ...analysisFixture, handedness: 'left', main: { fault: 'over_the_top', consequences: ['early_extension'] } });
    expect(store.getSwing(row.id)).toMatchObject({ consequences: ['early_extension'], handedness: 'left' });
    expect(JSON.parse(await AsyncStorage.getItem('golf_swings.v1'))[0]).toMatchObject({ consequences: ['early_extension'], handedness: 'left' });
  });

  it('defaults consequences to [] and handedness to the profile when the analysis lacks them', async () => {
    await store.setSwingProfile({ handedness: 'left' });
    const row = await store.createSwing({ videoUri: 'file:///picked/clip.mp4' });
    const { handedness, ...noHand } = analysisFixture;
    await store.saveAnalysis(row.id, noHand);
    expect(store.getSwing(row.id)).toMatchObject({ consequences: [], handedness: 'left' });
  });

  it('rows saved before the fields existed hydrate untouched', async () => {
    await AsyncStorage.setItem('golf_swings.v1', JSON.stringify([
      { id: '1', createdAt: '2026-10-01T10:00:00.000Z', name: '1', status: 'ready', source: 'import', club: 'driver', mainFault: 'flip', marked: { state: 'none', count: 0 } },
    ]));
    await store.hydrateSwings();
    const r = store.getSwing('1');
    expect(r.mainFault).toBe('flip');
    expect(r.consequences).toBeUndefined();
    expect(r.handedness).toBeUndefined();
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

  it('delete sweeps the folder again after a cancelled pass 2 could still write into it', async () => {
    const row = await store.createSwing({ videoUri: 'file:///picked/clip.mp4' });
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'queueMicrotask', 'nextTick'] });
    try {
      await store.deleteSwing(row.id);
      // a proxy encoder finishing after the delete recreates the folder
      fs.__dirs.add(`file:///doc/swings/${row.id}`);
      fs.__dirs.add(`file:///doc/swings/${row.id}/proxy`);
      fs.__files.set(`file:///doc/swings/${row.id}/proxy/400.jpg`, 'x');
      jest.advanceTimersByTime(store.DELETE_RESWEEP_MS);
      expect([...fs.__files.keys()].filter((k) => k.includes(row.id))).toHaveLength(0);
      expect(fs.__dirs.has(`file:///doc/swings/${row.id}`)).toBe(false);
    } finally {
      jest.useRealTimers();
    }
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
  it('D24: remembers whether the practice card is open', async () => {
    store._resetForTests();
    expect(store.getSwingProfile().practiceOpen).toBe(false);
    await store.setPracticeOpen(true);
    store._resetForTests();
    await store.hydrateSwings();
    expect(store.getSwingProfile()).toMatchObject({ practiceOpen: true, asked: false });
    await store.setPracticeOpen(false);
  });

  it('defaults to right-handed with no height, persists, and hydrates back', async () => {
    expect(store.getSwingProfile()).toEqual({
      heightCm: null, handedness: 'right', asked: false, lastClub: 'iron', practiceOpen: false,
    });
    await store.setSwingProfile({ heightCm: 176, handedness: 'left' });
    expect(store.getSwingProfile()).toEqual({
      heightCm: 176, handedness: 'left', asked: true, lastClub: 'iron', practiceOpen: false,
    });
    store._resetForTests();
    await store.hydrateSwings();
    expect(store.getSwingProfile()).toEqual({
      heightCm: 176, handedness: 'left', asked: true, lastClub: 'iron', practiceOpen: false,
    });
  });

  it('keeps the height when only handedness changes', async () => {
    await store.setSwingProfile({ heightCm: 180 });
    await store.setSwingProfile({ handedness: 'left' });
    expect(store.getSwingProfile().heightCm).toBe(180);
  });
});

describe('hydrateSwingProfile (miss-reasons naming)', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('reads a stored handedness into getSwingProfile()', async () => {
    await AsyncStorage.setItem('golf_swing_profile.v1', JSON.stringify({ heightCm: 170, handedness: 'left', asked: true }));
    await store.hydrateSwingProfile();
    expect(store.getSwingProfile()).toMatchObject({ handedness: 'left', heightCm: 170 });
  });

  it('does not read the swing index key', async () => {
    await AsyncStorage.setItem('golf_swings.v1', JSON.stringify([{ id: '1', createdAt: '2026-10-01', status: 'ready' }]));
    const spy = jest.spyOn(AsyncStorage, 'getItem');
    spy.mockClear();
    await store.hydrateSwingProfile();
    const keys = spy.mock.calls.map(([k]) => k);
    expect(keys).toEqual(['golf_swing_profile.v1']);
    expect(store.getSwings()).toHaveLength(0);
  });

  it('repeated calls are harmless', async () => {
    await AsyncStorage.setItem('golf_swing_profile.v1', JSON.stringify({ handedness: 'left' }));
    await store.hydrateSwingProfile();
    await expect(store.hydrateSwingProfile()).resolves.toBeUndefined();
    await store.hydrateSwingProfile();
    expect(store.getSwingProfile()).toMatchObject({ handedness: 'left', asked: false, lastClub: 'iron' });
  });

  it('corrupt stored JSON keeps the default right-handed profile', async () => {
    await AsyncStorage.setItem('golf_swing_profile.v1', '{not json');
    await expect(store.hydrateSwingProfile()).resolves.toBeUndefined();
    expect(store.getSwingProfile().handedness).toBe('right');
  });
});

describe('club (D19)', () => {
  it('a new swing is an iron swing unless told otherwise; junk reads as iron', async () => {
    expect((await store.createSwing({ videoUri: 'file:///picked/clip.mp4' })).club).toBe('iron');
    expect((await store.createSwing({ videoUri: 'file:///picked/clip.mp4', club: 'driver' })).club).toBe('driver');
    expect((await store.createSwing({ videoUri: 'file:///picked/clip.mp4', club: 'wedge' })).club).toBe('iron');
  });

  it('rows saved before the picker (no club, or null) hydrate as iron and are re-saved lazily', async () => {
    const old = (id, extra = {}) => ({ id, createdAt: `2026-10-0${id}T10:00:00.000Z`, name: id, status: 'ready', source: 'import', ...extra });
    await AsyncStorage.setItem('golf_swings.v1', JSON.stringify([old('1'), old('2', { club: null }), old('3', { club: 'driver' })]));
    await store.hydrateSwings();
    expect(Object.fromEntries(store.getSwings().map((r) => [r.id, r.club]))).toEqual({ 1: 'iron', 2: 'iron', 3: 'driver' });
  });

  it('setSwingClub saves the choice to the row and the index', async () => {
    const row = await store.createSwing({ videoUri: 'file:///picked/clip.mp4' });
    await store.setSwingClub(row.id, 'driver');
    expect(store.getSwing(row.id).club).toBe('driver');
    expect(JSON.parse(await AsyncStorage.getItem('golf_swings.v1'))[0].club).toBe('driver');
    expect(await store.setSwingClub('nope', 'driver')).toBeNull();
  });

  it('saveAnalysis takes the club from the analysis (the Results picker re-saves this way)', async () => {
    const row = await store.createSwing({ videoUri: 'file:///picked/clip.mp4' });
    await store.saveAnalysis(row.id, { ...analysisFixture, club: 'driver' });
    expect(store.getSwing(row.id).club).toBe('driver');
  });

  it('remembers the last club chosen on Home without counting as the first-run answer', async () => {
    expect(store.getSwingProfile().lastClub).toBe('iron');
    await store.setLastSwingClub('driver');
    expect(store.getSwingProfile()).toMatchObject({ lastClub: 'driver', asked: false });
    store._resetForTests();
    await store.hydrateSwings();
    expect(store.getSwingProfile().lastClub).toBe('driver');
    await store.setLastSwingClub('putter');
    expect(store.getSwingProfile().lastClub).toBe('iron');
  });
});

describe('the marking pass on the row (D26) and the club per video (D27)', () => {
  const frame = (checkpoint, extra) => ({
    i: 1, checkpoint, iProposed: 1, hands: { proposed: [0, 0], final: [0, 0] }, head: { proposed: null, final: null }, corrected: false, ...extra,
  });

  it('a new swing starts unmarked, with the last club chosen as its club', async () => {
    await store.setLastSwingClub('driver');
    const row = await store.createSwing({ videoUri: 'file:///picked/clip.mp4' });
    expect(row).toMatchObject({ club: 'driver', marked: { state: 'none', count: 0 } });
    await store.saveAnalysis(row.id, { ...analysisFixture, club: 'driver' });
    expect(store.getSwing(row.id).marked).toEqual({ state: 'none', count: 0 });
    expect((await store.readMarks(row.id)).pass).toEqual({ state: 'none', skipped: [] });
  });

  it('a first save while pass 2 still runs keeps the swing pending (not resumable); the final save makes it ready', async () => {
    const row = await store.createSwing({ videoUri: 'file:///picked/clip.mp4' });
    await store.saveAnalysis(row.id, analysisFixture, { status: 'pending' });
    expect(store.getSwing(row.id)).toMatchObject({ status: 'pending', marked: { state: 'none', count: 0 } });
    await store.saveAnalysis(row.id, analysisFixture);
    expect(store.getSwing(row.id).status).toBe('ready');
  });

  it('saveMarks mirrors the pass into the index: partial with its count, then done', async () => {
    const row = await store.createSwing({ videoUri: 'file:///picked/clip.mp4' });
    await store.saveAnalysis(row.id, analysisFixture);
    const marks = (state, keys) => ({
      ...emptyMarks({ swingId: row.id }), frames: keys.map((k) => frame(k, { confirmed: true })), pass: { state, skipped: [] },
    });
    await store.saveMarks(row.id, marks('partial', ['address', 'leadArm']));
    expect(store.getSwing(row.id).marked).toEqual({ state: 'partial', count: 2 });
    await store.saveMarks(row.id, marks('done', ['address', 'leadArm', 'top']));
    expect(store.getSwing(row.id).marked).toEqual({ state: 'done', count: 3 });
    expect(JSON.parse(await AsyncStorage.getItem('golf_swings.v1'))[0].marked).toEqual({ state: 'done', count: 3 });
    expect((await store.readMarks(row.id)).frames[0].confirmed).toBe(true);
  });

  it('existing swings still open: a row from before D26 gets its state from marks.json on hydrate', async () => {
    const old = (id) => ({ id, createdAt: `2026-10-0${id}T10:00:00.000Z`, name: id, status: 'ready', source: 'import', club: 'iron' });
    await AsyncStorage.setItem('golf_swings.v1', JSON.stringify([old('1'), old('2'), { ...old('3'), status: 'error' }]));
    // swing 1 had three positions corrected in the old Edit marks; swing 2 every one of the six
    const legacy = (keys) => JSON.stringify({ ...emptyMarks({ swingId: 'x' }), frames: keys.map((k) => frame(k, { corrected: true })) });
    fs.__files.set('file:///doc/swings/1/marks.json', legacy(['address', 'top', 'takeaway', 'impact']));
    fs.__files.set('file:///doc/swings/2/marks.json', legacy(['address', 'leadArm', 'top', 'shaftDown', 'impact', 'shaftThrough']));
    await store.hydrateSwings();
    expect(store.getSwing('1').marked).toEqual({ state: 'partial', count: 3 });
    expect(store.getSwing('2').marked).toEqual({ state: 'done', count: 6 });
    expect(store.getSwing('3').marked).toBeUndefined(); // a failed analysis has nothing to mark
    expect(JSON.parse(await AsyncStorage.getItem('golf_swings.v1')).find((r) => r.id === '1').marked).toEqual({ state: 'partial', count: 3 });
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

  // Read the stored-zip entries back by walking the local headers.
  const unzip = (bytes) => {
    const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const dec = (u) => String.fromCharCode(...u);
    const out = {};
    let p = 0;
    while (d.getUint32(p, true) === 0x04034b50) {
      const size = d.getUint32(p + 18, true);
      const nameLen = d.getUint16(p + 26, true);
      const name = dec(bytes.slice(p + 30, p + 30 + nameLen));
      out[name] = dec(bytes.slice(p + 30 + nameLen, p + 30 + nameLen + size));
      p += 30 + nameLen + size;
    }
    return out;
  };

  it('exportSwing writes ONE .swing.zip holding the video, analysis, marks and swing.json', async () => {
    const row = await store.createSwing({ videoUri: 'file:///picked/clip.mp4' });
    await store.saveAnalysis(row.id, analysisFixture);
    fs.__files.set(`file:///doc/swings/${row.id}/probe.json`, JSON.stringify({
      width: 478, height: 850, frameCount: 1297, containerFps: 29.97, captureFps: 240,
    }));
    const out = await store.exportSwing(row.id);
    expect(out.dir).toBe(`file:///cache/swing-export/${row.id}`);
    expect(out.zipUri.startsWith(`${out.dir}/`)).toBe(true);
    expect(out.zipUri).toMatch(/\.swing\.zip$/);
    const entries = unzip(fs.__files.get(out.zipUri));
    expect(Object.keys(entries).sort()).toEqual(['analysis.json', 'marks.json', 'swing.json', 'video.mp4']);
    expect(entries['video.mp4']).toBe('VIDEO-BYTES');
    const meta = JSON.parse(entries['swing.json']);
    expect(meta).toMatchObject({
      schema: 'swing-export/1',
      handedness: 'right',
      video: { width: 478, height: 850, frameCount: 1297, containerFps: 29.97, captureFps: 240 },
    });
    expect(meta.swing.id).toBe(row.id);
    expect(meta.club).toBe('iron');
    expect(JSON.parse(entries['analysis.json']).main.fault).toBe('early_extension');
    expect(JSON.parse(entries['marks.json']).schema).toBe('swing-club-labels/1');
  });

  it('exportSwing rejects an unknown id', async () => {
    await expect(store.exportSwing('nope')).rejects.toThrow('Swing not found');
  });
});
