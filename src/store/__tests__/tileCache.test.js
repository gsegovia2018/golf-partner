import {
  getTileDataUrl, deleteBucket, courseKeyFor,
  _setAdapterForTests, _resetForTests,
} from '../tileCache';

export function fakeAdapter() {
  const store = new Map(); // 'bucket|z/x/y' -> dataUrl
  return {
    store,
    async get(bucket, key) { return store.get(`${bucket}|${key}`) ?? null; },
    async put(bucket, key, dataUrl) { store.set(`${bucket}|${key}`, dataUrl); return dataUrl.length; },
    async deleteBucket(bucket) { [...store.keys()].filter((k) => k.startsWith(`${bucket}|`)).forEach((k) => store.delete(k)); },
  };
}

describe('tileCache', () => {
  let adapter;
  beforeEach(() => {
    adapter = fakeAdapter();
    _resetForTests();
    _setAdapterForTests(adapter);
    global.fetch = jest.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([120]).buffer }));
  });

  it('courseKeyFor normalizes names', () => {
    expect(courseKeyFor('Villaitana Levante')).toBe('villaitana-levante');
  });

  it('serves a local hit without fetching', async () => {
    adapter.store.set('_browse|15/16371/12683', 'data:image/jpeg;base64,AAA');
    const d = await getTileDataUrl({ z: 15, x: 16371, y: 12683, bucket: '_browse' });
    expect(d).toBe('data:image/jpeg;base64,AAA');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fetches, stores, and returns on miss', async () => {
    const d = await getTileDataUrl({ z: 15, x: 1, y: 2, bucket: 'c1' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('/tile/15/2/1'); // z/y/x order!
    expect(d).toMatch(/^data:image\/jpeg;base64,/);
    expect(await adapter.get('c1', '15/1/2')).toBe(d);
  });

  it('negative-caches failures for the session', async () => {
    global.fetch = jest.fn(async () => { throw new Error('offline'); });
    expect(await getTileDataUrl({ z: 15, x: 1, y: 2, bucket: 'c1' })).toBeNull();
    expect(await getTileDataUrl({ z: 15, x: 1, y: 2, bucket: 'c1' })).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('deleteBucket clears only that bucket', async () => {
    adapter.store.set('c1|15/1/2', 'data:a');
    adapter.store.set('c2|15/1/2', 'data:b');
    await deleteBucket('c1');
    expect(await adapter.get('c1', '15/1/2')).toBeNull();
    expect(await adapter.get('c2', '15/1/2')).toBe('data:b');
  });

  it('dedupes concurrent requests for the same tile', async () => {
    const [a, b] = await Promise.all([
      getTileDataUrl({ z: 15, x: 1, y: 2, bucket: 'c1' }),
      getTileDataUrl({ z: 15, x: 1, y: 2, bucket: 'c1' }),
    ]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });
});
