import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';
import { makeZip, utf8 } from '../swing/zip';
import {
  listShotSenseSessions, readShotSenseEvents, shotSenseDir, sessionFolder,
} from '../lib/shotSense';
import { PROPOSALS_PREFIX } from './shotProposalStore';
import { soundIndex, soundLevel } from './shotSound';

// "Export shot sound data" (Settings): the newest EXPORT_ROUNDS listened
// rounds in one zip, through the share sheet. The only way the sound data
// leaves the phone. Per round, `<folder>/round.json` (the detected stops with
// my answers and their sound level, and every event) and the strike clips
// `<folder>/<t>.wav`. scripts/analyzeShotSound.mjs reads it.

export const EXPORT_ROUNDS = 3;
export const SOUND_EXPORT_SCHEMA = 1;

// Pure: one round's round.json. `stops`: the stored proposals (status is my
// answer: 'added' / 'dismissed' / 'open').
export function soundExportRound({ session, stops, events }) {
  const idx = soundIndex(events);
  return {
    schema: SOUND_EXPORT_SCHEMA,
    session,
    stops: (stops ?? []).map((s) => ({ ...s, sound: soundLevel(s, idx) })),
    events: events ?? [],
  };
}

// The newest kept sessions, each with its proposal key when this phone still
// has the round's proposals (the folder name is the key made file-safe).
async function newestSessions() {
  const sessions = (await listShotSenseSessions()).slice(0, EXPORT_ROUNDS);
  let keys = [];
  try { keys = await AsyncStorage.getAllKeys(); } catch { /* none */ }
  const byFolder = new Map(keys
    .filter((k) => k.startsWith(PROPOSALS_PREFIX))
    .map((k) => k.slice(PROPOSALS_PREFIX.length))
    .map((key) => [sessionFolder(key), key]));
  return sessions.map((s) => ({ ...s, key: byFolder.get(s.name) ?? null }));
}

// For the Settings row: { count, bytes } of what an export would hold.
export async function shotSoundExportSummary() {
  const sessions = await newestSessions();
  return { count: sessions.length, bytes: sessions.reduce((n, s) => n + (s.bytes || 0), 0) };
}

// Builds the zip in the cache. Resolves to { uri, name, bytes }, or null when
// there is nothing to export.
export async function buildShotSoundExport() {
  const sessions = await newestSessions();
  if (!sessions.length) return null;
  const entries = [];
  for (const s of sessions) {
    let stops = [];
    if (s.key) {
      try { stops = JSON.parse((await AsyncStorage.getItem(PROPOSALS_PREFIX + s.key)) ?? '[]'); } catch { stops = []; }
    }
    const events = await readShotSenseEvents(s.key ?? s.name);
    const body = soundExportRound({ session: s.key ?? s.name, stops, events });
    entries.push({ name: `${s.name}/round.json`, data: utf8(JSON.stringify(body)) });
    const dir = shotSenseDir(s.key ?? s.name);
    for (const clip of s.clips ?? []) {
      const f = new File(dir, clip);
      if (f.exists) entries.push({ name: `${s.name}/${clip}`, data: await f.bytes() });
    }
  }
  const zip = makeZip(entries);
  const out = new Directory(Paths.cache, 'shot-sound-export');
  if (out.exists) out.delete();
  out.create({ intermediates: true, idempotent: true });
  const name = `shot-sound-${new Date().toISOString().slice(0, 10)}.zip`;
  const file = new File(out, name);
  file.create({ intermediates: true });
  file.write(zip);
  return { uri: file.uri, name, bytes: zip.length };
}

// Builds and shares. Resolves to 'shared' | 'empty' | 'unavailable'; rejects
// when the file could not be built.
export async function shareShotSoundExport(dialogTitle) {
  const built = await buildShotSoundExport();
  if (!built) return 'empty';
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  await Sharing.shareAsync(built.uri, { mimeType: 'application/zip', dialogTitle });
  return 'shared';
}
