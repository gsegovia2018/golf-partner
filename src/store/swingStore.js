import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuidv4 } from 'uuid';
import {
  Paths, Directory, File, fsReady, storableUri,
} from '../swing/fs';
import { emptyMarks, parseMarks } from '../swing/labels';
import { makeZip, utf8 } from '../swing/zip';
import { t, formatDate } from '../i18n';
import { normClub, DEFAULT_CLUB } from '../swing/checks';
import { newPass, markedFromMarks } from '../swing/markPass';
import { SCHEMA } from '../swing/analyze';
import { upgradeAnalysis } from '../swing/reanalyze';
import { track } from '../lib/telemetry';

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

const DEFAULT_PROFILE = {
  heightCm: null, handedness: 'right', asked: false, lastClub: DEFAULT_CLUB, // lastClub: the club sheet's last choice (D27)
  practiceOpen: false, // the Results practice card stays as the golfer left it (D24)
};

let SWINGS = []; // [{ id, createdAt, name, club, source, status, fps, mainFault, consequences, handedness, counts, thumb, bytes, marked }]
let PROFILE = { ...DEFAULT_PROFILE };
let PROFILE_LOADED = false; // true once the stored profile has been read (hydrateSwings or hydrateSwingProfile)
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
  await fsReady(); // the web keeps the swing files in IndexedDB: index them before anything reads one
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    if (raw) { const rows = JSON.parse(raw); if (Array.isArray(rows)) SWINGS = sortNewest(rows.map((r) => ({ ...r, club: normClub(r.club) }))); } // rows saved before D19 have no club: they read as iron
  } catch { /* corrupt index: start empty */ }
  await loadStoredProfile();
  emit();
  // Rows analysed before the mark-first flow (D26) have no `marked`: read it from their marks.json.
  const old = SWINGS.filter((r) => r.status === 'ready' && !r.marked);
  if (!old.length) return;
  const got = await Promise.all(old.map((r) => readMarks(r.id)));
  old.forEach((r, k) => patchRow(r.id, { marked: markedFromMarks(got[k]) }));
  emit();
  await persistIndex();
}

// --- Profile (D5, D6): height and handedness, local only ---------------------

// Reads only the stored profile into PROFILE. Never throws; corrupt JSON keeps the defaults.
async function loadStoredProfile() {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_KEY);
    if (raw) PROFILE = { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
  } catch { /* ignore: keep defaults */ }
  PROFILE_LOADED = true;
}

/**
 * Loads only the stored profile (handedness, height), not the swing index or any files.
 * The scorecard's miss-reasons sheet uses it to name shots by handedness.
 * Safe to call repeatedly; a profile already loaded by hydrateSwings is not overwritten.
 */
export async function hydrateSwingProfile() {
  if (PROFILE_LOADED) return;
  await loadStoredProfile();
  emit();
}

export async function setSwingProfile({ heightCm, handedness }) {
  PROFILE = {
    ...PROFILE,
    heightCm: heightCm === undefined ? PROFILE.heightCm : heightCm,
    handedness: handedness ?? PROFILE.handedness,
    asked: true,
  };
  emit();
  await persistProfile();
  return PROFILE;
}

/** Remember the club chosen on the club sheet (D27); does not count as answering the first-run sheet. */
export async function setLastSwingClub(club) {
  PROFILE = { ...PROFILE, lastClub: normClub(club) };
  emit();
  await persistProfile();
  return PROFILE.lastClub;
}

/** Remember whether the Results practice card is open (D24). */
export async function setPracticeOpen(open) {
  PROFILE = { ...PROFILE, practiceOpen: !!open };
  emit();
  await persistProfile();
  return PROFILE.practiceOpen;
}

// --- Names (D13) -------------------------------------------------------------

const pad2 = (n) => String(n).padStart(2, '0');

/** "Sat 11 Oct · 18:42" / "sáb 11 oct · 18:42" in the device's local time. */
export function defaultSwingName(date, lang) {
  const d = date instanceof Date ? date : new Date(date);
  return `${formatDate(d, 'short', lang)} · ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** True when the golfer renamed the swing (the default name in either language is not a name). */
export function hasCustomName(sw) {
  return !!sw?.name && sw.name !== defaultSwingName(sw.createdAt, 'en') && sw.name !== defaultSwingName(sw.createdAt, 'es');
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

export const readPose = (id) => readJson(id, 'pose.json');
export const readProbe = (id) => readJson(id, 'probe.json');
export async function readMarks(id) { return parseMarks(await readJson(id, 'marks.json')); }

// The analysis.json an upgrade replaced, kept beside it: a write cut short (a crash, a full disk)
// leaves an analysis.json that does not parse, and the swing opens from this copy instead.
const ANALYSIS_BACKUP = 'analysis.v1.json';

/**
 * analysis.json at the current schema (swing checks v2, spec §7): an older analysis is re-run
 * from its stored pose / probe / marks (pure JS, milliseconds) and saved with its index row, so
 * every screen that opens a swing gets the v2 rows. A re-run that fails keeps the old analysis;
 * a save that fails still returns the new one (it is re-run on the next open).
 */
export async function readAnalysis(id) {
  const stored = (await readJson(id, 'analysis.json')) ?? (await readJson(id, ANALYSIS_BACKUP));
  if (!stored || stored.error || stored.schema === SCHEMA) return stored;
  const [pose, probe, marks] = await Promise.all([readPose(id), readProbe(id), readMarks(id)]);
  const r = upgradeAnalysis({
    pose, probe, marks, analysis: stored,
  });
  if (!r.upgraded) {
    console.warn(`swing ${id}: analysis ${stored.schema} kept, re-run failed: ${r.error}`);
    return stored;
  }
  const row = getSwing(id);
  if (!row) return r.analysis; // not in the index (yet): use it, save on a later open
  try {
    if (!swingFile(id, ANALYSIS_BACKUP).exists) writeJson(id, ANALYSIS_BACKUP, stored);
    await saveAnalysis(id, r.analysis, { status: row.status === 'pending' ? 'pending' : 'ready' });
  } catch (e) {
    console.warn(`swing ${id}: upgraded analysis not saved: ${e?.message}`);
  }
  return { ...r.analysis, swingId: id, createdAt: row.createdAt };
}

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
export async function createSwing({ videoUri, source = 'import', createdAt = new Date(), club = PROFILE.lastClub }) {
  const id = uuidv4();
  const when = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const dir = swingDir(id);
  dir.create({ intermediates: true, idempotent: true });
  try {
    await new File(videoUri).copy(swingFile(id, 'video.mp4')); // async on the web (the picked file is a Blob)
  } catch (e) {
    try { dir.delete(); } catch { /* nothing to clean */ }
    throw e;
  }
  const row = {
    id,
    createdAt: when.toISOString(),
    name: defaultSwingName(when),
    club: normClub(club),
    source,
    status: 'pending',
    fps: null,
    mainFault: null,
    counts: null,
    thumb: null,
    bytes: dirBytes(id),
    marked: { state: 'none', count: 0 },
  };
  SWINGS = sortNewest([...SWINGS, row]);
  emit();
  track('swing_recorded', { source });
  await persistIndex();
  return row;
}

/**
 * Store a finished analysis: writes analysis.json (+ pose.json / probe.json when
 * given), seeds marks.json once, and fills in the index row used by the list.
 * `status: 'pending'` keeps the row unresumable while pass 2 is still running (D26).
 */
export async function saveAnalysis(id, analysis, {
  pose = null, probe = null, thumb = null, status = 'ready',
} = {}) {
  const row = getSwing(id);
  if (!row) return null;
  const full = { ...analysis, swingId: id, createdAt: row.createdAt };
  writeJson(id, 'analysis.json', full);
  if (pose) writeJson(id, 'pose.json', pose);
  if (probe) writeJson(id, 'probe.json', probe);
  if (!swingFile(id, 'marks.json').exists) {
    writeJson(id, 'marks.json', { ...emptyMarks({ swingId: id, video: pose?.video ?? null, handedness: analysis.handedness }), pass: newPass() });
  }
  const next = patchRow(id, {
    status,
    error: undefined,
    club: normClub(analysis.club ?? row.club),
    fps: analysis.fps
      ? { capture: analysis.fps.capture, effective: analysis.fps.effective, factor: analysis.fps.factor, approximate: !!analysis.fps.approximate }
      : null,
    mainFault: analysis.main?.fault ?? null,
    consequences: analysis.main?.consequences ?? [], // coach v2 swing link; rows saved earlier have neither field
    handedness: analysis.handedness ?? PROFILE.handedness,
    counts: analysis.counts ? { green: analysis.counts.green, yellow: analysis.counts.yellow, red: analysis.counts.red } : null,
    thumb: storableUri(thumb) ?? row.thumb,
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

/** Persist marks.json (the corrected labels) and refresh the size and the pass state (D26). */
export async function saveMarks(id, marks) {
  if (!getSwing(id)) return null;
  writeJson(id, 'marks.json', marks);
  patchRow(id, { bytes: dirBytes(id), marked: markedFromMarks(marks) });
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
  const next = patchRow(id, { club: normClub(club) });
  if (!next) return null;
  emit();
  await persistIndex();
  return next;
}

// A pass 2 cancelled by a delete can still be finishing a still or proxy write: native waits up to
// 2 s for its encoders after a cancel, so the folder is swept once more after that.
export const DELETE_RESWEEP_MS = 2500;

/** Remove the row and the whole directory (video included). */
export async function deleteSwing(id) {
  if (!getSwing(id)) return;
  SWINGS = SWINGS.filter((s) => s.id !== id);
  emit();
  await persistIndex();
  const sweep = () => {
    try {
      const dir = swingDir(id);
      if (dir.exists) dir.delete();
    } catch { /* the row is gone; an orphaned folder is swept by pruneOrphanSwingDirs */ }
  };
  sweep();
  setTimeout(sweep, DELETE_RESWEEP_MS);
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
 * Build the single file the user shares (D18): `<name>.swing.zip` under
 * Paths.cache/swing-export/<id>/ holding video.mp4 (the original clip), analysis.json,
 * marks.json (the corrected labels) and swing.json (the index row, handedness, height and
 * the clip's size). It is a "stored" zip written in JS (src/swing/zip.js), so no native
 * module is needed and `expo-sharing` can hand over exactly one file, which is all its
 * share sheet takes. tools/swing-lab/import_export.py unpacks it.
 * Returns { dir, zipUri, bytes, name }.
 */
export async function exportSwing(id) {
  const row = getSwing(id);
  if (!row) throw new Error(t('misc.swing.notFound'));
  const analysis = await readAnalysis(id);
  const marks = await readMarks(id);
  const probe = await readProbe(id);
  const entries = [];
  const json = (name, value) => entries.push({ name, data: utf8(JSON.stringify(value)) });
  json('swing.json', {
    schema: EXPORT_SCHEMA,
    exportedAt: new Date().toISOString(),
    swing: row,
    club: normClub(row.club),
    handedness: analysis?.handedness ?? PROFILE.handedness,
    heightCm: analysis?.scale?.heightCm ?? PROFILE.heightCm ?? null,
    video: {
      width: probe?.width ?? marks?.video?.width ?? null,
      height: probe?.height ?? marks?.video?.height ?? null,
      frameCount: probe?.frameCount ?? marks?.video?.frameCount ?? null,
      containerFps: probe?.containerFps ?? marks?.video?.containerFps ?? null,
      captureFps: probe?.captureFps ?? analysis?.fps?.capture ?? null,
    },
    files: ['video.mp4', 'analysis.json', 'marks.json'],
  });
  json('analysis.json', analysis);
  json('marks.json', marks);
  const clip = swingFile(id, 'video.mp4');
  if (clip.exists) entries.push({ name: 'video.mp4', data: await clip.bytes() });
  const zip = makeZip(entries);
  const out = new Directory(Paths.cache, 'swing-export', id);
  if (out.exists) out.delete();
  out.create({ intermediates: true, idempotent: true });
  const slug = (row.name || id).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || id;
  const file = new File(out, `${slug}.swing.zip`);
  file.create({ intermediates: true });
  file.write(zip);
  return {
    dir: out.uri, zipUri: file.uri, bytes: zip.length, name: file.name,
  };
}

export function _resetForTests() {
  SWINGS = [];
  PROFILE = { ...DEFAULT_PROFILE };
  PROFILE_LOADED = false;
  version = 0;
  listeners.clear();
}
