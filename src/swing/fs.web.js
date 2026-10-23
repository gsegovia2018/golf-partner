// The swing library's file system on the web: the subset of expo-file-system's Paths / File /
// Directory that swingStore, frames.js and runAnalysis use, over IndexedDB.
//
// Reads are synchronous on Android (`file.exists`, `dir.size`, `getStill`), so every stored path
// and its Blob are held in an in-memory index, filled once from IndexedDB by fsReady() (Blobs read
// back from IndexedDB are file-backed handles, not bytes in memory). Writes land in the index at
// once and reach IndexedDB in order, in the background.
//
// URIs: a directory is `swingfs:/<path>/`; a file that exists is a `blob:` URL of its Blob (what
// <Image> and <video> load), one that doesn't yet is `swingfs:/<path>`. A blob: URL lives as long as
// the page, so a URI kept across reloads (the list's thumbnail) is stored with storableUri() and
// shown with displayUri().

const SCHEME = 'swingfs:/';
const DB = 'golf-swingfs';
const STORE = 'files';

const files = new Map(); // path -> Blob
const dirs = new Set(); // paths created explicitly (a dir also exists while it holds files)
const urls = new Map(); // path -> blob: URL
const pathOfUrl = new Map(); // blob: URL -> path

let backend = null;
let ready = null;
let chain = Promise.resolve();
let persistAsked = false;

const MIME = {
  mp4: 'video/mp4', mov: 'video/quicktime', jpg: 'image/jpeg', jpeg: 'image/jpeg', json: 'application/json', zip: 'application/zip',
};
const mimeOf = (path) => MIME[path.split('.').pop()?.toLowerCase()] ?? 'application/octet-stream';

// --- IndexedDB -------------------------------------------------------------------

function idbBackend() {
  if (typeof indexedDB === 'undefined') return null;
  let dbp = null;
  const db = () => {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbp;
  };
  const tx = async (mode, fn) => {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const out = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(out?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };
  return {
    async loadAll() {
      const d = await db();
      return new Promise((resolve, reject) => {
        const out = [];
        const req = d.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
        req.onsuccess = () => {
          const c = req.result;
          if (!c) { resolve(out); return; }
          out.push([c.key, c.value]);
          c.continue();
        };
        req.onerror = () => reject(req.error);
      });
    },
    put: (key, value) => tx('readwrite', (s) => s.put(value, key)),
    del: (keys) => tx('readwrite', (s) => { keys.forEach((k) => s.delete(k)); }),
  };
}

/** Tests only: swap the store (an object with loadAll / put / del) and forget everything. */
export function _setBackendForTests(b) {
  backend = b;
  ready = null;
  chain = Promise.resolve();
  files.clear();
  dirs.clear();
  urls.forEach((u) => { try { URL.revokeObjectURL(u); } catch { /* ignore */ } });
  urls.clear();
  pathOfUrl.clear();
}

const store = () => {
  if (backend === null) backend = idbBackend() ?? false;
  return backend || null;
};

function persist(op) {
  const b = store();
  if (!b) return;
  chain = chain.then(op(b)).catch((e) => console.warn('[swingfs] write failed', e));
}

function askPersistence() {
  if (persistAsked) return;
  persistAsked = true;
  // Safari drops a site's storage after 7 days unused unless it is persisted or a home-screen app
  try { navigator.storage?.persist?.().catch(() => {}); } catch { /* not offered */ }
}

/** Loads the index from IndexedDB once. Safe to call often. */
export function fsReady() {
  if (!ready) {
    ready = (async () => {
      const b = store();
      if (!b) return;
      try {
        const rows = await b.loadAll();
        rows.forEach(([key, value]) => {
          if (value?.dir) dirs.add(key);
          else if (value?.blob && !files.has(key)) files.set(key, value.blob);
        });
      } catch (e) {
        console.warn('[swingfs] could not read stored swings', e);
      }
    })();
  }
  return ready;
}

/** Resolves once every queued write reached IndexedDB (tests, and before a reload). */
export const fsFlush = () => chain;

// --- paths ---------------------------------------------------------------------

const clean = (p) => p.split('/').filter((s) => s && s !== '.').join('/');

function joinParts(parts) {
  const segs = [];
  let external = null;
  parts.forEach((p, k) => {
    if (p instanceof Directory || p instanceof File) { segs.push(p.path); return; }
    const s = String(p);
    if (k === 0 && s.startsWith(SCHEME)) { segs.push(s.slice(SCHEME.length)); return; }
    if (k === 0 && pathOfUrl.has(s)) { segs.push(pathOfUrl.get(s)); return; }
    if (k === 0 && /^[a-z][a-z0-9+.-]*:/i.test(s)) { external = s; return; }
    segs.push(s);
  });
  return { path: clean(segs.join('/')), external };
}

function dropUrl(path) {
  const u = urls.get(path);
  if (!u) return;
  urls.delete(path);
  pathOfUrl.delete(u);
  try { URL.revokeObjectURL(u); } catch { /* ignore */ }
}

function setFile(path, blob) {
  dropUrl(path);
  files.set(path, blob);
  askPersistence();
  persist((b) => () => b.put(path, { blob }));
}

function removePaths(paths) {
  if (!paths.length) return;
  paths.forEach((p) => { dropUrl(p); files.delete(p); dirs.delete(p); });
  persist((b) => () => b.del(paths));
}

const under = (path) => (p) => p.startsWith(`${path}/`);

// --- File / Directory ------------------------------------------------------------

export class File {
  constructor(...parts) {
    const { path, external } = joinParts(parts);
    this.path = path;
    this.external = external;
  }

  get name() { return (this.external ?? this.path).split('/').pop(); }

  get exists() { return this.external ? true : files.has(this.path); }

  get size() { return files.get(this.path)?.size ?? 0; }

  get uri() {
    if (this.external) return this.external;
    const blob = files.get(this.path);
    if (!blob) return `${SCHEME}${this.path}`;
    let u = urls.get(this.path);
    if (!u) {
      u = URL.createObjectURL(blob);
      urls.set(this.path, u);
      pathOfUrl.set(u, this.path);
    }
    return u;
  }

  create() {
    if (!files.has(this.path)) setFile(this.path, new Blob([], { type: mimeOf(this.path) }));
  }

  /** String, bytes or a Blob. */
  write(content) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeOf(this.path) });
    setFile(this.path, blob);
  }

  async blob() {
    if (this.external) return (await fetch(this.external)).blob();
    const b = files.get(this.path);
    if (!b) throw new Error(`no such file: ${this.path}`);
    return b;
  }

  async text() { return (await this.blob()).text(); }

  async bytes() { return new Uint8Array(await (await this.blob()).arrayBuffer()); }

  /** Async on the web (the source may be a picked file): await it. */
  async copy(dest) {
    const to = dest instanceof Directory ? new File(dest, this.name) : dest;
    const b = await this.blob();
    to.write(b.type ? b : new Blob([b], { type: mimeOf(to.path) }));
  }

  delete() { removePaths([this.path]); }
}

export class Directory {
  constructor(...parts) {
    this.path = joinParts(parts).path;
  }

  get name() { return this.path.split('/').pop(); }

  get uri() { return `${SCHEME}${this.path}/`; }

  get exists() {
    if (dirs.has(this.path)) return true;
    const inside = under(this.path);
    for (const p of files.keys()) if (inside(p)) return true;
    for (const d of dirs) if (inside(d)) return true;
    return false;
  }

  get size() {
    const inside = under(this.path);
    let n = 0;
    files.forEach((b, p) => { if (inside(p)) n += b.size; });
    return n;
  }

  create() {
    if (dirs.has(this.path)) return;
    dirs.add(this.path);
    persist((b) => () => b.put(this.path, { dir: true }));
  }

  list() {
    const inside = under(this.path);
    const names = new Map();
    const take = (p, isDir) => {
      const rest = p.slice(this.path.length + 1);
      const [head, ...tail] = rest.split('/');
      if (!names.has(head)) names.set(head, isDir || tail.length > 0);
      else if (tail.length > 0 || isDir) names.set(head, true);
    };
    files.forEach((_, p) => { if (inside(p)) take(p, false); });
    dirs.forEach((p) => { if (inside(p)) take(p, true); });
    return [...names].map(([n, isDir]) => (isDir ? new Directory(this, n) : new File(this, n)));
  }

  delete() {
    const inside = under(this.path);
    removePaths([...files.keys(), ...dirs].filter((p) => p === this.path || inside(p)));
  }
}

export const Paths = {
  get document() { return new Directory(`${SCHEME}document`); },
  get cache() { return new Directory(`${SCHEME}cache`); },
};

/** A URI that survives a reload: our blob: URLs become their `swingfs:/` path. */
export const storableUri = (uri) => (uri && pathOfUrl.has(uri) ? `${SCHEME}${pathOfUrl.get(uri)}` : uri);

/** The URI to show for a stored one: a `swingfs:/` path becomes its file's blob: URL (null when gone). */
export function displayUri(uri) {
  if (!uri || !String(uri).startsWith(SCHEME)) return uri;
  const f = new File(uri);
  return f.exists ? f.uri : null;
}

/** The Blob behind one of our URIs (blob: or swingfs:), or a fetched external one. */
export async function blobOf(uri) {
  return new File(uri).blob();
}
