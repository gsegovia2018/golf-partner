import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuidv4 } from 'uuid';
import { Paths, Directory, File } from 'expo-file-system';
import { emptyMarks, parseMarks } from '../swing/labels';

// Local swing library (plan 7). Same shape as shotStore.js (module state, a
// version counter for useSyncExternalStore, an AsyncStorage mirror) with no
// Supabase: a swing never leaves the phone except through exportSwing.
//
// AsyncStorage holds the small index; the heavy files live under
// Paths.document/swings/<id>/ (video.mp4, pose.json, analysis.json, marks.json,
// probe.json, thumb.jpg, frames/<i>.jpg).

const INDEX_KEY = 'golf_swings.v1';
const PROFILE_KEY = 'golf_swing_profile.v1';
export const STORAGE_WARN_BYTES = 1024 * 1024 * 1024; // soft cap, plan 7.4

const DEFAULT_PROFILE = { heightCm: null, handedness: 'right', asked: false };

let SWINGS = []; // [{ id, createdAt, name, club, source, status, fps, mainFault, counts, thumb, bytes }]
let PROFILE = { ...DEFAULT_PROFILE };
let version = 0;
const listeners = new Set();

function emit() { version += 1; listeners.forEach((l) => l()); }
export function subscribeSwings(cb) { listeners.add(cb); return () => listeners.delete(cb); }
export function getSwingsVersion() { return version; }
/** Newest first. Stable reference between emits. */
export function getSwings() { return SWINGS; }
export function getSwing(id) { return SWINGS.find((s) => s.id === id) ?? null; }
export function getSwingProfile() { return PROFILE; }

async function persistIndex() {
  try { await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(SWINGS)); } catch { /* ignore */ }
}
async function persistProfile() {
  try { await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(PROFILE)); } catch { /* ignore */ }
}

const sortNewest = (rows) => [...rows].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

// Call once at app boot (or on first Swing home focus). Never throws.
export async function hydrateSwings() {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    if (raw) { const rows = JSON.parse(raw); if (Array.isArray(rows)) SWINGS = sortNewest(rows); }
  } catch { /* corrupt index: start empty */ }
  try {
    const raw = await AsyncStorage.getItem(PROFILE_KEY);
    if (raw) PROFILE = { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  emit();
}

// --- Profile (D5, D6): height and handedness, local only ---------------------

export async function setSwingProfile({ heightCm, handedness }) {
  PROFILE = {
    heightCm: heightCm === undefined ? PROFILE.heightCm : heightCm,
    handedness: handedness ?? PROFILE.handedness,
    asked: true,
  };
  emit();
  await persistProfile();
  return PROFILE;
}

// --- Names (D13) -------------------------------------------------------------

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');

/** "Sat 11 Oct · 18:42" in the device's local time. */
export function defaultSwingName(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} · ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// --- Files -------------------------------------------------------------------

function swingDir(id) { return new Directory(Paths.document, 'swings', id); }
function swingFile(id, name) { return new File(Paths.document, 'swings', id, name); }

function writeJson(id, name, value) {
  const f = swingFile(id, name);
  if (!f.exists) f.create({ intermediates: true });
  f.write(JSON.stringify(value));
}

async function readJson(id, name) {
  try {
    const f = swingFile(id, name);
    if (!f.exists) return null;
    return JSON.parse(await f.text());
  } catch {
    return null;
  }
}

export const readAnalysis = (id) => readJson(id, 'analysis.json');
export const readPose = (id) => readJson(id, 'pose.json');
export const readProbe = (id) => readJson(id, 'probe.json');
export async function readMarks(id) { return parseMarks(await readJson(id, 'marks.json')); }

export function swingVideoUri(id) { return swingFile(id, 'video.mp4').uri; }

function dirBytes(id) {
  try { return swingDir(id).size ?? 0; } catch { return 0; }
}

function patchRow(id, patch) {
  const i = SWINGS.findIndex((s) => s.id === id);
  if (i < 0) return null;
  const row = { ...SWINGS[i], ...patch };
  SWINGS = SWINGS.map((s, k) => (k === i ? row : s));
  return row;
}

// --- CRUD --------------------------------------------------------------------

/**
 * Copy a clip into the swing directory and add a row in `pending` state. The
 * source file is never modified (plan 7.1). Returns the row.
 */
export async function createSwing({ videoUri, source = 'import', createdAt = new Date(), club = null }) {
  const id = uuidv4();
  const when = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const dir = swingDir(id);
  dir.create({ intermediates: true, idempotent: true });
  try {
    new File(videoUri).copy(swingFile(id, 'video.mp4'));
  } catch (e) {
    try { dir.delete(); } catch { /* nothing to clean */ }
    throw e;
  }
  const row = {
    id,
    createdAt: when.toISOString(),
    name: defaultSwingName(when),
    club,
    source,
    status: 'pending',
    fps: null,
    mainFault: null,
    counts: null,
    thumb: null,
    bytes: dirBytes(id),
  };
  SWINGS = sortNewest([...SWINGS, row]);
  emit();
  await persistIndex();
  return row;
}

/**
 * Store a finished analysis: writes analysis.json (+ pose.json / probe.json when
 * given), seeds marks.json once, and fills in the index row used by the list.
 */
export async function saveAnalysis(id, analysis, { pose = null, probe = null, thumb = null } = {}) {
  const row = getSwing(id);
  if (!row) return null;
  const full = { ...analysis, swingId: id, createdAt: row.createdAt };
  writeJson(id, 'analysis.json', full);
  if (pose) writeJson(id, 'pose.json', pose);
  if (probe) writeJson(id, 'probe.json', probe);
  if (!swingFile(id, 'marks.json').exists) {
    writeJson(id, 'marks.json', emptyMarks({ swingId: id, video: pose?.video ?? null, handedness: analysis.handedness }));
  }
  const next = patchRow(id, {
    status: 'ready',
    error: undefined,
    club: analysis.club ?? row.club,
    fps: analysis.fps
      ? { capture: analysis.fps.capture, effective: analysis.fps.effective, factor: analysis.fps.factor, approximate: !!analysis.fps.approximate }
      : null,
    mainFault: analysis.main?.fault ?? null,
    counts: analysis.counts ? { green: analysis.counts.green, yellow: analysis.counts.yellow, red: analysis.counts.red } : null,
    thumb: thumb ?? row.thumb,
    bytes: dirBytes(id),
  });
  emit();
  await persistIndex();
  return next;
}

/** Mark a swing whose analysis failed (D12 error code) so the list can say so. */
export async function markSwingFailed(id, error) {
  const next = patchRow(id, { status: 'error', error });
  if (!next) return null;
  emit();
  await persistIndex();
  return next;
}

/** Persist marks.json (the corrected labels) and refresh the size. */
export async function saveMarks(id, marks) {
  if (!getSwing(id)) return null;
  writeJson(id, 'marks.json', marks);
  patchRow(id, { bytes: dirBytes(id) });
  emit();
  await persistIndex();
  return marks;
}

export async function renameSwing(id, name) {
  const clean = String(name ?? '').trim();
  const row = getSwing(id);
  if (!row || !clean) return row;
  const next = patchRow(id, { name: clean });
  emit();
  await persistIndex();
  return next;
}

export async function setSwingClub(id, club) {
  const next = patchRow(id, { club });
  if (!next) return null;
  emit();
  await persistIndex();
  return next;
}

/** Remove the row and the whole directory (video included). */
export async function deleteSwing(id) {
  if (!getSwing(id)) return;
  SWINGS = SWINGS.filter((s) => s.id !== id);
  emit();
  await persistIndex();
  try {
    const dir = swingDir(id);
    if (dir.exists) dir.delete();
  } catch { /* the row is gone; an orphaned folder is swept by pruneOrphanSwingDirs */ }
}

/** Delete folders that have no index row (a crash between copy and index write). */
export function pruneOrphanSwingDirs() {
  try {
    const root = new Directory(Paths.document, 'swings');
    if (!root.exists) return 0;
    const known = new Set(SWINGS.map((s) => s.id));
    let n = 0;
    root.list().forEach((e) => {
      if (e instanceof Directory && !known.has(e.name)) { e.delete(); n += 1; }
    });
    return n;
  } catch { return 0; }
}

export function storageBytes() { return SWINGS.reduce((sum, s) => sum + (s.bytes || 0), 0); }
export function overStorageWarning() { return storageBytes() >= STORAGE_WARN_BYTES; }

// --- Export (D18) ------------------------------------------------------------

export const EXPORT_SCHEMA = 'swing-export/1';

/**
 * Write a self-contained folder under Paths.cache/swing-export/<id>/ for the
 * user-initiated share: swing.json (index row + analysis + marks), the original
 * video and the checkpoint stills. No zip library is bundled (adding one would
 * need a native change), so the folder is the unit; a later PR zips it or shares
 * the files. Returns { dir, jsonUri, videoUri }.
 */
export async function exportSwing(id) {
  const row = getSwing(id);
  if (!row) throw new Error('Swing not found.');
  const out = new Directory(Paths.cache, 'swing-export', id);
  if (out.exists) out.delete();
  out.create({ intermediates: true, idempotent: true });
  const analysis = await readAnalysis(id);
  const marks = await readMarks(id);
  const json = new File(out, 'swing.json');
  json.create({ intermediates: true });
  json.write(JSON.stringify({
    schema: EXPORT_SCHEMA,
    exportedAt: new Date().toISOString(),
    swing: row,
    analysis,
    marks,
    files: { video: 'video.mp4', frames: 'frames/' },
  }));
  const video = swingFile(id, 'video.mp4');
  const videoOut = new File(out, 'video.mp4');
  if (video.exists) video.copy(videoOut);
  const frames = new Directory(Paths.document, 'swings', id, 'frames');
  if (frames.exists) frames.copy(new Directory(out, 'frames'));
  return { dir: out.uri, jsonUri: json.uri, videoUri: videoOut.uri };
}

export function _resetForTests() {
  SWINGS = [];
  PROFILE = { ...DEFAULT_PROFILE };
  version = 0;
  listeners.clear();
}
