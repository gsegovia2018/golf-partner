# Tournament Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the 4 friends attach photos and short videos to a round, optionally tagging a hole, and browse them per round, per tournament, and across the full gallery — with optimistic offline-tolerant uploads.

**Architecture:** Supabase Storage (public bucket) for blobs, new `tournament_media` table for metadata, separate from the existing `tournaments` JSON document. Client mirrors the existing subscribe-pattern stores (`tournamentStore.js`); offline queue persists pending uploads in AsyncStorage and drains via background worker driven by NetInfo + app foreground. UI: header camera button on `ScorecardScreen`, inline `RoundMediaStrip` below the scorecard, "Recuerdos" section in the tournament view, and a new `GalleryScreen` for filtered browsing. Shared `MediaLightbox` for full-screen view.

**Tech Stack:** React Native + Expo SDK 54, Supabase JS v2, AsyncStorage, `expo-image-picker`, `expo-image-manipulator`, `expo-video-thumbnails`, `expo-file-system`, `expo-av`, `@react-native-community/netinfo`, `expo-image`, existing `expo-sharing`. No test framework exists in the project — verification is manual via `expo start --web` and Expo Go on Android. Each task ends with a manual smoke check + commit.

**Spec:** `docs/superpowers/specs/2026-04-19-tournament-media-design.md`

---

## Task 1: Supabase migration — bucket + table

**Files:**
- Create: `supabase/migrations/20260419120000_tournament_media.sql`

- [ ] **Step 1: Create the migration directory if absent**

```bash
mkdir -p supabase/migrations
```

- [ ] **Step 2: Write the migration SQL**

Create `supabase/migrations/20260419120000_tournament_media.sql`:

```sql
-- Bucket for tournament photos and short videos. Public-read so the
-- existing anon-key client can show media without signed URLs. The 4
-- friends share the anon key; if real auth is added later, switch to
-- signed URLs and RLS in a follow-up migration.
insert into storage.buckets (id, name, public)
values ('tournament-media', 'tournament-media', true)
on conflict (id) do nothing;

-- Permissive storage policies for the anon role on this bucket only.
create policy "tournament-media public read"
on storage.objects for select
using (bucket_id = 'tournament-media');

create policy "tournament-media anon insert"
on storage.objects for insert
with check (bucket_id = 'tournament-media');

create policy "tournament-media anon delete"
on storage.objects for delete
using (bucket_id = 'tournament-media');

-- Metadata table.
create table if not exists public.tournament_media (
  id              uuid primary key,
  tournament_id   text not null,
  round_id        text not null,
  hole_index      int,
  kind            text not null check (kind in ('photo', 'video')),
  storage_path    text not null,
  thumb_path      text not null,
  duration_s      numeric,
  caption         text,
  uploader_label  text,
  created_at      timestamptz not null default now()
);

create index if not exists tournament_media_tournament_idx
  on public.tournament_media (tournament_id, created_at desc);

create index if not exists tournament_media_round_idx
  on public.tournament_media (round_id, created_at desc);

-- RLS off to mirror the existing tournaments table (no auth in this app yet).
alter table public.tournament_media disable row level security;
```

- [ ] **Step 3: Apply the migration to the linked Supabase project**

The project ref is `cxqugzmgbcknlxfipfse`. Use the access token from `.env` (`ACCESS_TOKEN_SUPABASE`).

```bash
SUPABASE_ACCESS_TOKEN=$(grep '^ACCESS_TOKEN_SUPABASE=' .env | cut -d= -f2) \
  supabase link --project-ref cxqugzmgbcknlxfipfse
SUPABASE_ACCESS_TOKEN=$(grep '^ACCESS_TOKEN_SUPABASE=' .env | cut -d= -f2) \
  supabase db push
```

Expected: `Applying migration 20260419120000_tournament_media.sql...` followed by success.

- [ ] **Step 4: Verify the bucket and table exist**

```bash
SUPABASE_ACCESS_TOKEN=$(grep '^ACCESS_TOKEN_SUPABASE=' .env | cut -d= -f2) \
  supabase db dump --schema public --data-only=false | grep tournament_media
```

Expected: SQL DDL for `tournament_media` table appears in the dump.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260419120000_tournament_media.sql
git commit -m "feat: add tournament_media table and storage bucket"
```

---

## Task 2: Install required Expo dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the picker, manipulator, video, file, netinfo, image, and av packages with versions matched to Expo SDK 54**

```bash
npx expo install expo-image-picker expo-image-manipulator expo-video-thumbnails expo-file-system expo-av expo-image @react-native-community/netinfo
```

Expected: each package added to `dependencies` with a version compatible with `expo: ~54.0.33`.

- [ ] **Step 2: Add iOS/Android permission strings to `app.json`**

Open `app.json` and add a `plugins` entry for `expo-image-picker` with photo and camera usage descriptions in Spanish:

```json
{
  "expo": {
    "plugins": [
      [
        "expo-image-picker",
        {
          "photosPermission": "Necesitamos acceder a tu galería para añadir fotos a la ronda.",
          "cameraPermission": "Necesitamos acceder a la cámara para capturar fotos durante la ronda.",
          "microphonePermission": "Necesitamos acceder al micrófono para grabar el audio de los videos."
        }
      ]
    ]
  }
}
```

If `app.json` already has a `plugins` array, append the entry instead of replacing.

- [ ] **Step 3: Smoke check that the app still boots**

```bash
npx expo start --web --no-dev --clear
```

Open the printed URL in a browser. Confirm the home screen renders without runtime errors. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json app.json
git commit -m "chore: add expo media deps and picker permission strings"
```

---

## Task 3: Media store — Supabase CRUD + subscriptions

**Files:**
- Create: `src/store/mediaStore.js`

This module mirrors the patterns in `src/store/tournamentStore.js`: a module-level `_subs` Set, `_emitChange()`, and async functions that read/write Supabase.

- [ ] **Step 1: Create `src/store/mediaStore.js`**

```js
import { supabase } from '../lib/supabase';

const _subs = new Set();
function _emitChange() {
  _subs.forEach((fn) => { try { fn(); } catch (_) {} });
}

export function subscribeMediaChanges(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

function rowToMedia(row) {
  const { data: originalUrl } = supabase.storage
    .from('tournament-media')
    .getPublicUrl(row.storage_path);
  const { data: thumbUrl } = supabase.storage
    .from('tournament-media')
    .getPublicUrl(row.thumb_path);
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    roundId: row.round_id,
    holeIndex: row.hole_index,
    kind: row.kind,
    storagePath: row.storage_path,
    thumbPath: row.thumb_path,
    durationS: row.duration_s,
    caption: row.caption,
    uploaderLabel: row.uploader_label,
    createdAt: row.created_at,
    url: originalUrl.publicUrl,
    thumbUrl: thumbUrl.publicUrl,
    status: 'uploaded',
  };
}

export async function loadTournamentMedia(tournamentId) {
  const { data, error } = await supabase
    .from('tournament_media')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(rowToMedia);
}

export async function loadRoundMedia(roundId) {
  const { data, error } = await supabase
    .from('tournament_media')
    .select('*')
    .eq('round_id', roundId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(rowToMedia);
}

export async function insertMediaRow({
  id, tournamentId, roundId, holeIndex, kind,
  storagePath, thumbPath, durationS, caption, uploaderLabel,
}) {
  const { error } = await supabase.from('tournament_media').insert({
    id,
    tournament_id: tournamentId,
    round_id: roundId,
    hole_index: holeIndex ?? null,
    kind,
    storage_path: storagePath,
    thumb_path: thumbPath,
    duration_s: durationS ?? null,
    caption: caption ?? null,
    uploader_label: uploaderLabel ?? null,
  });
  if (error) throw error;
  _emitChange();
}

export async function deleteMedia(media) {
  const paths = [media.storagePath, media.thumbPath].filter(Boolean);
  await supabase.storage.from('tournament-media').remove(paths);
  const { error } = await supabase.from('tournament_media').delete().eq('id', media.id);
  if (error) throw error;
  _emitChange();
}

export function notifyMediaChange() {
  _emitChange();
}
```

- [ ] **Step 2: Manually verify the module loads**

```bash
node -e "import('./src/store/mediaStore.js').then(m => console.log(Object.keys(m)))"
```

Expected output includes `subscribeMediaChanges`, `loadTournamentMedia`, `loadRoundMedia`, `insertMediaRow`, `deleteMedia`, `notifyMediaChange`.

If Node fails on ESM imports, skip this and rely on the next task's smoke test which will exercise the module from inside the app bundle.

- [ ] **Step 3: Commit**

```bash
git add src/store/mediaStore.js
git commit -m "feat: add mediaStore with Supabase CRUD and subscriptions"
```

---

## Task 4: Offline upload queue

**Files:**
- Create: `src/store/mediaQueue.js`

Persists pending uploads across app launches. Each entry tracks status, attempts, and last error. The queue itself does not perform uploads — that's the worker's job (Task 6). This module is just persistence + observation.

- [ ] **Step 1: Create `src/store/mediaQueue.js`**

```js
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@golf_media_queue';

const _subs = new Set();
function _emit() { _subs.forEach((fn) => { try { fn(); } catch (_) {} }); }

export function subscribeQueueChanges(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

let _cache = null;
async function read() {
  if (_cache) return _cache;
  const raw = await AsyncStorage.getItem(KEY);
  _cache = raw ? JSON.parse(raw) : [];
  return _cache;
}

async function write(items) {
  _cache = items;
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
  _emit();
}

export async function listQueue() {
  return [...(await read())];
}

export async function listQueueForTournament(tournamentId) {
  return (await read()).filter((e) => e.tournamentId === tournamentId);
}

export async function listQueueForRound(roundId) {
  return (await read()).filter((e) => e.roundId === roundId);
}

export async function enqueueMedia(entry) {
  const items = await read();
  const next = [...items, {
    ...entry,
    status: 'pending',
    attempts: 0,
    lastError: null,
    enqueuedAt: new Date().toISOString(),
  }];
  await write(next);
}

export async function updateQueueEntry(id, patch) {
  const items = await read();
  const next = items.map((e) => (e.id === id ? { ...e, ...patch } : e));
  await write(next);
}

export async function removeQueueEntry(id) {
  const items = await read();
  await write(items.filter((e) => e.id !== id));
}

export async function clearQueue() {
  await write([]);
}
```

- [ ] **Step 2: Smoke check inside the running app**

Add a one-time temporary log in `App.js` (we'll remove it before commit):

```js
import { listQueue } from './src/store/mediaQueue';
listQueue().then((q) => console.log('[mediaQueue] startup size:', q.length));
```

Run `npx expo start --web --clear`, confirm the console prints `[mediaQueue] startup size: 0`. Remove the temporary log.

- [ ] **Step 3: Commit**

```bash
git add src/store/mediaQueue.js
git commit -m "feat: add mediaQueue persisted in AsyncStorage"
```

---

## Task 5: Upload pipeline — compress, derive thumbnail, upload

**Files:**
- Create: `src/lib/mediaUpload.js`

Single-item, idempotent on `mediaId`. Assumes the caller has already enqueued; on success it inserts the row and removes the queue entry.

- [ ] **Step 1: Create `src/lib/mediaUpload.js`**

```js
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { supabase } from './supabase';
import { insertMediaRow } from '../store/mediaStore';

const BUCKET = 'tournament-media';

function extFromUri(uri, fallback) {
  const m = uri.match(/\.([a-z0-9]+)(\?|#|$)/i);
  return (m ? m[1] : fallback).toLowerCase();
}

async function uriToArrayBuffer(uri) {
  // expo-file-system returns base64; convert to ArrayBuffer for Supabase upload.
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function compressPhoto(uri) {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1920 } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
  );
  return result.uri;
}

async function makeThumbnail(uri, kind) {
  if (kind === 'photo') {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 400 } }],
      { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG },
    );
    return result.uri;
  }
  // video
  const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(uri, { time: 500 });
  const resized = await ImageManipulator.manipulateAsync(
    thumbUri,
    [{ resize: { width: 400 } }],
    { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG },
  );
  return resized.uri;
}

async function uploadFile(path, uri, contentType) {
  const body = await uriToArrayBuffer(uri);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, body, { contentType, upsert: true });
  if (error) throw error;
}

export async function processUpload(entry) {
  const { id, tournamentId, roundId, holeIndex, kind, localUri, durationS,
          caption, uploaderLabel } = entry;

  const ext = kind === 'photo' ? 'jpg' : extFromUri(localUri, 'mp4');
  const storagePath = `${tournamentId}/${roundId}/${id}.${ext}`;
  const thumbPath = `${tournamentId}/${roundId}/thumbs/${id}.jpg`;

  const finalUri = kind === 'photo' ? await compressPhoto(localUri) : localUri;
  const thumbUri = await makeThumbnail(localUri, kind);

  const contentType = kind === 'photo' ? 'image/jpeg' : `video/${ext === 'mov' ? 'quicktime' : ext}`;
  await uploadFile(storagePath, finalUri, contentType);
  await uploadFile(thumbPath, thumbUri, 'image/jpeg');

  await insertMediaRow({
    id, tournamentId, roundId, holeIndex, kind,
    storagePath, thumbPath, durationS, caption, uploaderLabel,
  });

  return { storagePath, thumbPath };
}
```

- [ ] **Step 2: Verify compile by running the dev server**

```bash
npx expo start --web --clear
```

Open the home screen. No runtime errors should occur (the module is unused so far; this just verifies syntax). Stop the server.

- [ ] **Step 3: Commit**

```bash
git add src/lib/mediaUpload.js
git commit -m "feat: add upload pipeline with compression and thumbnail derivation"
```

---

## Task 6: Background upload worker

**Files:**
- Create: `src/lib/uploadWorker.js`
- Modify: `App.js` (start the worker once on mount)

The worker drains the queue using exponential backoff. It runs on app foreground and on `NetInfo` connectivity gain. Idempotent: safe to call `startUploadWorker` multiple times.

- [ ] **Step 1: Create `src/lib/uploadWorker.js`**

```js
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { listQueue, updateQueueEntry, removeQueueEntry } from '../store/mediaQueue';
import { processUpload } from './mediaUpload';

const BACKOFF_MS = [1_000, 4_000, 15_000, 60_000, 300_000];
let _running = false;
let _started = false;
let _scheduled = null;

async function drain() {
  if (_running) return;
  _running = true;
  try {
    const queue = await listQueue();
    for (const entry of queue) {
      if (entry.status === 'failed') continue;
      try {
        await updateQueueEntry(entry.id, { status: 'uploading' });
        await processUpload(entry);
        await removeQueueEntry(entry.id);
      } catch (err) {
        const attempts = (entry.attempts ?? 0) + 1;
        const max = BACKOFF_MS.length;
        const status = attempts >= max ? 'failed' : 'pending';
        await updateQueueEntry(entry.id, {
          status,
          attempts,
          lastError: String(err?.message ?? err),
        });
        if (status === 'pending') {
          schedule(BACKOFF_MS[Math.min(attempts, max - 1)]);
        }
        // Move on to next entry; don't let one bad item block the queue.
      }
    }
  } finally {
    _running = false;
  }
}

function schedule(ms) {
  if (_scheduled) clearTimeout(_scheduled);
  _scheduled = setTimeout(() => { _scheduled = null; drain(); }, ms);
}

export function kickUploadWorker() {
  drain();
}

export function startUploadWorker() {
  if (_started) return;
  _started = true;

  drain();

  NetInfo.addEventListener((state) => {
    if (state.isConnected) drain();
  });

  AppState.addEventListener('change', (next) => {
    if (next === 'active') drain();
  });
}

export async function retryFailedEntry(id) {
  await updateQueueEntry(id, { status: 'pending', attempts: 0, lastError: null });
  drain();
}
```

- [ ] **Step 2: Start the worker from `App.js`**

Open `App.js`. After the existing imports, add:

```js
import { startUploadWorker } from './src/lib/uploadWorker';
```

Inside the `App` function component (after the `useFonts` line), add:

```js
  React.useEffect(() => { startUploadWorker(); }, []);
```

If `React` is not already imported as a default name, use the existing imported `useEffect` instead.

- [ ] **Step 3: Boot the app and confirm no errors**

```bash
npx expo start --web --clear
```

Open the home screen. Check the browser console — no errors from `uploadWorker` (queue is empty so it's a no-op). Stop the server.

- [ ] **Step 4: Commit**

```bash
git add src/lib/uploadWorker.js App.js
git commit -m "feat: add background upload worker driven by NetInfo and AppState"
```

---

## Task 7: Hooks — `useRoundMedia` and `useTournamentMedia`

**Files:**
- Create: `src/hooks/useRoundMedia.js`
- Create: `src/hooks/useTournamentMedia.js`

These merge persisted media (from `mediaStore`) with pending queue entries (from `mediaQueue`) so the UI sees a unified list. Pending entries surface as items with a `localUri` instead of a remote URL and `status: 'uploading' | 'failed'`.

- [ ] **Step 1: Create `src/hooks/useRoundMedia.js`**

```js
import { useEffect, useState, useCallback } from 'react';
import { loadRoundMedia, subscribeMediaChanges } from '../store/mediaStore';
import { listQueueForRound, subscribeQueueChanges } from '../store/mediaQueue';

function pendingToItem(e) {
  return {
    id: e.id,
    tournamentId: e.tournamentId,
    roundId: e.roundId,
    holeIndex: e.holeIndex ?? null,
    kind: e.kind,
    caption: e.caption ?? null,
    uploaderLabel: e.uploaderLabel ?? null,
    createdAt: e.enqueuedAt,
    url: e.localUri,
    thumbUrl: e.localUri,
    status: e.status === 'failed' ? 'failed' : 'uploading',
  };
}

export function useRoundMedia(roundId) {
  const [items, setItems] = useState([]);

  const refresh = useCallback(async () => {
    if (!roundId) { setItems([]); return; }
    const [remote, pending] = await Promise.all([
      loadRoundMedia(roundId),
      listQueueForRound(roundId),
    ]);
    const pendingItems = pending.map(pendingToItem);
    setItems([...pendingItems, ...remote]);
  }, [roundId]);

  useEffect(() => {
    refresh();
    const off1 = subscribeMediaChanges(refresh);
    const off2 = subscribeQueueChanges(refresh);
    return () => { off1(); off2(); };
  }, [refresh]);

  return { items, refresh };
}
```

- [ ] **Step 2: Create `src/hooks/useTournamentMedia.js`**

```js
import { useEffect, useState, useCallback } from 'react';
import { loadTournamentMedia, subscribeMediaChanges } from '../store/mediaStore';
import { listQueueForTournament, subscribeQueueChanges } from '../store/mediaQueue';

function pendingToItem(e) {
  return {
    id: e.id,
    tournamentId: e.tournamentId,
    roundId: e.roundId,
    holeIndex: e.holeIndex ?? null,
    kind: e.kind,
    caption: e.caption ?? null,
    uploaderLabel: e.uploaderLabel ?? null,
    createdAt: e.enqueuedAt,
    url: e.localUri,
    thumbUrl: e.localUri,
    status: e.status === 'failed' ? 'failed' : 'uploading',
  };
}

export function useTournamentMedia(tournamentId) {
  const [items, setItems] = useState([]);

  const refresh = useCallback(async () => {
    if (!tournamentId) { setItems([]); return; }
    const [remote, pending] = await Promise.all([
      loadTournamentMedia(tournamentId),
      listQueueForTournament(tournamentId),
    ]);
    const pendingItems = pending.map(pendingToItem);
    setItems([...pendingItems, ...remote]);
  }, [tournamentId]);

  useEffect(() => {
    refresh();
    const off1 = subscribeMediaChanges(refresh);
    const off2 = subscribeQueueChanges(refresh);
    return () => { off1(); off2(); };
  }, [refresh]);

  return { items, refresh };
}
```

- [ ] **Step 3: Compile check**

```bash
npx expo start --web --clear
```

No errors expected. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useRoundMedia.js src/hooks/useTournamentMedia.js
git commit -m "feat: add useRoundMedia and useTournamentMedia hooks"
```

---

## Task 8: Capture helper — picker and enqueue

**Files:**
- Create: `src/lib/mediaCapture.js`

Wraps `expo-image-picker` so the UI doesn't have to know about platform quirks, generates the `mediaId`, and enqueues the entry. Returns the entry so the UI can show optimistic state.

- [ ] **Step 1: Create `src/lib/mediaCapture.js`**

```js
import * as ImagePicker from 'expo-image-picker';
import { enqueueMedia } from '../store/mediaQueue';
import { kickUploadWorker } from './uploadWorker';

function uuid() {
  // RFC4122 v4-ish; good enough for client ids.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function ensurePermissions(source) {
  if (source === 'camera') {
    const cam = await ImagePicker.requestCameraPermissionsAsync();
    if (!cam.granted) throw new Error('Permiso de cámara denegado.');
  } else {
    const lib = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!lib.granted) throw new Error('Permiso de galería denegado.');
  }
}

export async function pickMedia({ source, mediaTypes }) {
  await ensurePermissions(source);

  const opts = {
    mediaTypes: mediaTypes === 'video'
      ? ImagePicker.MediaTypeOptions.Videos
      : mediaTypes === 'photo'
        ? ImagePicker.MediaTypeOptions.Images
        : ImagePicker.MediaTypeOptions.All,
    quality: 0.7,
    videoMaxDuration: 20,
    allowsEditing: false,
  };

  const result = source === 'camera'
    ? await ImagePicker.launchCameraAsync(opts)
    : await ImagePicker.launchImageLibraryAsync(opts);

  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  return {
    localUri: asset.uri,
    kind: asset.type === 'video' ? 'video' : 'photo',
    durationS: asset.duration ? asset.duration / 1000 : null,
  };
}

export async function attachMedia({
  tournamentId, roundId, holeIndex, kind, localUri,
  durationS, caption, uploaderLabel,
}) {
  const id = uuid();
  await enqueueMedia({
    id, tournamentId, roundId, holeIndex, kind, localUri,
    durationS, caption, uploaderLabel,
  });
  kickUploadWorker();
  return { id };
}
```

- [ ] **Step 2: Compile check**

```bash
npx expo start --web --clear
```

No runtime errors expected. Stop the server.

- [ ] **Step 3: Commit**

```bash
git add src/lib/mediaCapture.js
git commit -m "feat: add mediaCapture helper for picker + enqueue"
```

---

## Task 9: `AttachMediaSheet` modal component

**Files:**
- Create: `src/components/AttachMediaSheet.js`

A bottom sheet shown after a media asset has been picked. Lets the user pick a hole tag, add an optional caption, and confirm. The uploader label persists across captures via AsyncStorage (`@golf_uploader_label`).

- [ ] **Step 1: Create `src/components/AttachMediaSheet.js`**

```js
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, TextInput, ScrollView, Image, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

const UPLOADER_KEY = '@golf_uploader_label';

export default function AttachMediaSheet({ visible, asset, holes, defaultHoleIndex, onCancel, onConfirm }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const [holeIndex, setHoleIndex] = useState(defaultHoleIndex ?? null);
  const [caption, setCaption] = useState('');
  const [uploader, setUploader] = useState('');

  useEffect(() => {
    if (!visible) return;
    setHoleIndex(defaultHoleIndex ?? null);
    setCaption('');
    AsyncStorage.getItem(UPLOADER_KEY).then((v) => setUploader(v ?? ''));
  }, [visible, defaultHoleIndex]);

  if (!visible || !asset) return null;

  const submit = async () => {
    if (uploader) await AsyncStorage.setItem(UPLOADER_KEY, uploader);
    onConfirm({
      holeIndex,
      caption: caption.trim() || null,
      uploaderLabel: uploader.trim() || null,
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.header}>
            <Text style={s.title}>Adjuntar a la ronda</Text>
            <TouchableOpacity onPress={onCancel} accessibilityLabel="Cancelar">
              <Feather name="x" size={22} color={theme.text.muted} />
            </TouchableOpacity>
          </View>

          {asset.kind === 'photo' ? (
            <Image source={{ uri: asset.localUri }} style={s.preview} resizeMode="cover" />
          ) : (
            <View style={[s.preview, s.videoPreview]}>
              <Feather name="video" size={32} color={theme.text.muted} />
              <Text style={s.videoLabel}>Video {asset.durationS ? `· ${Math.round(asset.durationS)}s` : ''}</Text>
            </View>
          )}

          <Text style={s.sectionLabel}>Hoyo</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipsRow}>
            <Chip label="Sin hoyo" active={holeIndex == null} onPress={() => setHoleIndex(null)} theme={theme} />
            {holes.map((_, i) => (
              <Chip
                key={i}
                label={String(i + 1)}
                active={holeIndex === i}
                onPress={() => setHoleIndex(i)}
                theme={theme}
              />
            ))}
          </ScrollView>

          <Text style={s.sectionLabel}>Comentario (opcional)</Text>
          <TextInput
            style={s.input}
            value={caption}
            onChangeText={setCaption}
            placeholder="Ej. Bunker dramático del 7"
            placeholderTextColor={theme.text.muted}
          />

          <Text style={s.sectionLabel}>Tu nombre (opcional)</Text>
          <TextInput
            style={s.input}
            value={uploader}
            onChangeText={setUploader}
            placeholder="Ej. Noé"
            placeholderTextColor={theme.text.muted}
          />

          <TouchableOpacity style={s.saveBtn} onPress={submit}>
            <Text style={s.saveLabel}>Guardar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function Chip({ label, active, onPress, theme }) {
  const s = makeChipStyles(theme, active);
  return (
    <TouchableOpacity style={s.chip} onPress={onPress}>
      <Text style={s.label}>{label}</Text>
    </TouchableOpacity>
  );
}

const makeChipStyles = (theme, active) => StyleSheet.create({
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: active ? theme.accent.primary : theme.bg.secondary,
    marginRight: 6,
  },
  label: {
    color: active ? theme.text.inverse : theme.text.primary,
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13,
  },
});

const makeStyles = (theme) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.bg.primary, padding: 20,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingBottom: 36,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: theme.text.primary },
  preview: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: theme.bg.secondary, marginBottom: 16 },
  videoPreview: { alignItems: 'center', justifyContent: 'center' },
  videoLabel: { marginTop: 6, color: theme.text.muted, fontFamily: 'PlusJakartaSans-Medium' },
  sectionLabel: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: theme.text.muted, marginTop: 12, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  chipsRow: { paddingVertical: 4 },
  input: {
    borderWidth: 1, borderColor: theme.border.subtle, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    color: theme.text.primary, fontFamily: 'PlusJakartaSans-Regular',
  },
  saveBtn: { marginTop: 20, backgroundColor: theme.accent.primary, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  saveLabel: { color: theme.text.inverse, fontFamily: 'PlusJakartaSans-Bold', fontSize: 16 },
});
```

- [ ] **Step 2: Verify the file's theme references match the project's actual `ThemeContext` shape**

Open `src/theme/ThemeContext.js` and `src/theme/tokens.js`. Confirm these tokens exist:
- `theme.bg.primary`, `theme.bg.secondary`
- `theme.text.primary`, `theme.text.muted`, `theme.text.inverse`
- `theme.accent.primary`
- `theme.border.subtle`

If any token name differs, adjust the component to match (e.g., `theme.colors.background` if that's the convention). Do not invent tokens.

- [ ] **Step 3: Compile check**

```bash
npx expo start --web --clear
```

The component is unused so far; this only verifies syntax. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add src/components/AttachMediaSheet.js
git commit -m "feat: add AttachMediaSheet for hole tag and caption entry"
```

---

## Task 10: `RoundMediaStrip` component

**Files:**
- Create: `src/components/RoundMediaStrip.js`

Horizontal scroll of thumbnails for the active round, with a "+" tile that triggers capture. Tap on a thumbnail opens the lightbox at that index. Failed items show a warning icon and retry on tap.

- [ ] **Step 1: Create `src/components/RoundMediaStrip.js`**

```js
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Image, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useRoundMedia } from '../hooks/useRoundMedia';
import { retryFailedEntry } from '../lib/uploadWorker';

const TILE = 88;

export default function RoundMediaStrip({ roundId, onAdd, onOpenLightbox }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const { items } = useRoundMedia(roundId);

  return (
    <View style={s.wrap}>
      <Text style={s.title}>Recuerdos de esta ronda</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
        <TouchableOpacity style={[s.tile, s.addTile]} onPress={onAdd} accessibilityLabel="Añadir recuerdo">
          <Feather name="plus" size={28} color={theme.accent.primary} />
        </TouchableOpacity>
        {items.map((m, i) => (
          <TouchableOpacity
            key={m.id}
            style={s.tile}
            onPress={() => {
              if (m.status === 'failed') return retryFailedEntry(m.id);
              onOpenLightbox(items, i);
            }}
            accessibilityLabel={`Recuerdo ${i + 1}`}
          >
            <Image source={{ uri: m.thumbUrl }} style={s.thumb} />
            {m.kind === 'video' && (
              <View style={s.videoBadge}><Feather name="play" size={12} color="#fff" /></View>
            )}
            {m.status === 'uploading' && (
              <View style={s.overlay}><ActivityIndicator color="#fff" /></View>
            )}
            {m.status === 'failed' && (
              <View style={s.overlay}>
                <Feather name="alert-triangle" size={20} color="#fff" />
              </View>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  wrap: { paddingVertical: 12 },
  title: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted,
           fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5,
           paddingHorizontal: 16, marginBottom: 8 },
  row: { paddingHorizontal: 16 },
  tile: { width: TILE, height: TILE, borderRadius: 10, marginRight: 8,
          overflow: 'hidden', backgroundColor: theme.bg.secondary },
  addTile: { alignItems: 'center', justifyContent: 'center',
             borderWidth: 1, borderStyle: 'dashed', borderColor: theme.accent.primary },
  thumb: { width: '100%', height: '100%' },
  videoBadge: { position: 'absolute', bottom: 4, right: 4,
                backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 999, padding: 4 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)',
             alignItems: 'center', justifyContent: 'center' },
});
```

- [ ] **Step 2: Compile check**

```bash
npx expo start --web --clear
```

No errors. Stop the server.

- [ ] **Step 3: Commit**

```bash
git add src/components/RoundMediaStrip.js
git commit -m "feat: add RoundMediaStrip with add tile and pending/failed states"
```

---

## Task 11: `MediaLightbox` component

**Files:**
- Create: `src/components/MediaLightbox.js`

Full-screen modal with horizontal swipe between items. Photos use `expo-image`; videos use `expo-av`. Footer shows hole tag, caption, date, uploader. Top bar has share, delete, and close.

- [ ] **Step 1: Create `src/components/MediaLightbox.js`**

```js
import React, { useState, useRef, useEffect } from 'react';
import { Modal, View, Text, TouchableOpacity, Dimensions, FlatList, Alert, StyleSheet, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { Video, ResizeMode } from 'expo-av';
import * as Sharing from 'expo-sharing';
import { useTheme } from '../theme/ThemeContext';
import { deleteMedia } from '../store/mediaStore';
import { removeQueueEntry } from '../store/mediaQueue';

const { width, height } = Dimensions.get('window');

export default function MediaLightbox({ visible, items, initialIndex, onClose }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const listRef = useRef(null);
  const [index, setIndex] = useState(initialIndex ?? 0);

  useEffect(() => { if (visible) setIndex(initialIndex ?? 0); }, [visible, initialIndex]);

  const current = items?.[index];
  if (!visible || !current) return null;

  const onShare = async () => {
    if (!(await Sharing.isAvailableAsync())) return;
    await Sharing.shareAsync(current.url);
  };

  const onDelete = () => {
    const proceed = async () => {
      try {
        if (current.status === 'uploading' || current.status === 'failed') {
          await removeQueueEntry(current.id);
        } else {
          await deleteMedia(current);
        }
        onClose();
      } catch (e) {
        Alert.alert('Error', String(e?.message ?? e));
      }
    };
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (window.confirm('¿Borrar este recuerdo? No se puede deshacer.')) proceed();
    } else {
      Alert.alert('Borrar recuerdo', 'No se puede deshacer.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Borrar', style: 'destructive', onPress: proceed },
      ]);
    }
  };

  const formatHole = (i) => (i == null ? null : `Hoyo ${i + 1}`);
  const formatDate = (iso) => new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={s.container}>
        <FlatList
          ref={listRef}
          data={items}
          horizontal
          pagingEnabled
          initialScrollIndex={initialIndex}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          keyExtractor={(item) => item.id}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => {
            const i = Math.round(e.nativeEvent.contentOffset.x / width);
            setIndex(i);
          }}
          renderItem={({ item }) => (
            <View style={{ width, height }}>
              {item.kind === 'photo' ? (
                <ExpoImage source={{ uri: item.url }} style={s.media} contentFit="contain" />
              ) : (
                <Video
                  source={{ uri: item.url }}
                  style={s.media}
                  useNativeControls
                  resizeMode={ResizeMode.CONTAIN}
                />
              )}
            </View>
          )}
        />

        <View style={s.topBar}>
          <TouchableOpacity onPress={onClose} style={s.iconBtn} accessibilityLabel="Cerrar">
            <Feather name="x" size={24} color="#fff" />
          </TouchableOpacity>
          <View style={s.topActions}>
            {current.status === 'uploaded' && (
              <TouchableOpacity onPress={onShare} style={s.iconBtn} accessibilityLabel="Compartir">
                <Feather name="share" size={22} color="#fff" />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onDelete} style={s.iconBtn} accessibilityLabel="Borrar">
              <Feather name="trash-2" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.footer}>
          {formatHole(current.holeIndex) && <Text style={s.hole}>{formatHole(current.holeIndex)}</Text>}
          {current.caption && <Text style={s.caption}>{current.caption}</Text>}
          <Text style={s.meta}>
            {formatDate(current.createdAt)}
            {current.uploaderLabel ? ` · ${current.uploaderLabel}` : ''}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = () => StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  media: { width: '100%', height: '100%' },
  topBar: { position: 'absolute', top: 40, left: 0, right: 0, paddingHorizontal: 16,
            flexDirection: 'row', justifyContent: 'space-between' },
  topActions: { flexDirection: 'row', gap: 8 },
  iconBtn: { padding: 8, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 999 },
  footer: { position: 'absolute', bottom: 32, left: 16, right: 16,
            backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12, padding: 12 },
  hole: { color: '#fff', fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, marginBottom: 4 },
  caption: { color: '#fff', fontFamily: 'PlusJakartaSans-Regular', fontSize: 15, marginBottom: 4 },
  meta: { color: 'rgba(255,255,255,0.7)', fontFamily: 'PlusJakartaSans-Regular', fontSize: 12 },
});
```

- [ ] **Step 2: Compile check**

```bash
npx expo start --web --clear
```

No errors. Stop the server.

- [ ] **Step 3: Commit**

```bash
git add src/components/MediaLightbox.js
git commit -m "feat: add MediaLightbox with swipe, share, and delete"
```

---

## Task 12: Wire camera button + capture flow into `ScorecardScreen`

**Files:**
- Modify: `src/screens/ScorecardScreen.js`

Adds a camera icon to the header next to the existing toggle pill, opens an action sheet for capture source, then shows `AttachMediaSheet`. After confirm, calls `attachMedia()`. Also renders `RoundMediaStrip` below the existing scorecard content and a `MediaLightbox` overlay.

- [ ] **Step 1: Read the current `ScorecardScreen.js` header block**

Use the editor to inspect lines 1-100 (imports, state) and 296-360 (the header JSX that currently has back button, title, and toggle pill). You'll add:
- New imports: `Alert`, `ActionSheetIOS`, `Platform`, the new components, `pickMedia`, `attachMedia`.
- New state: `pickerAsset`, `lightboxItems`, `lightboxIndex`, `lightboxVisible`.
- New camera icon button in the header to the right of the title (or to the right of the toggle pill).
- `RoundMediaStrip` under the main scorecard content (look for the closing `</ScrollView>` or similar of the current view; insert just before).
- `<AttachMediaSheet>` and `<MediaLightbox>` mounted inside the `SafeAreaView` at the bottom.

- [ ] **Step 2: Add the imports at the top of `ScorecardScreen.js`**

Open `src/screens/ScorecardScreen.js`. Find the existing import block (lines 1-30) and add:

```js
import { ActionSheetIOS, Platform, Alert } from 'react-native';
import RoundMediaStrip from '../components/RoundMediaStrip';
import MediaLightbox from '../components/MediaLightbox';
import AttachMediaSheet from '../components/AttachMediaSheet';
import { pickMedia, attachMedia } from '../lib/mediaCapture';
```

(If `Platform` or `Alert` is already imported elsewhere, dedupe.)

- [ ] **Step 3: Add state and handlers inside the component**

Locate the top of the `ScorecardScreen` component body (after existing `useState` calls). Add:

```js
const [pickerAsset, setPickerAsset] = useState(null);
const [lightboxItems, setLightboxItems] = useState([]);
const [lightboxIndex, setLightboxIndex] = useState(0);
const [lightboxVisible, setLightboxVisible] = useState(false);

const openCapturePicker = async () => {
  const choose = (source, mediaTypes) => async () => {
    try {
      const asset = await pickMedia({ source, mediaTypes });
      if (asset) setPickerAsset(asset);
    } catch (e) {
      Alert.alert('No se pudo capturar', String(e?.message ?? e));
    }
  };

  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['Cancelar', 'Tomar foto', 'Grabar video', 'Elegir de galería'], cancelButtonIndex: 0 },
      (i) => {
        if (i === 1) choose('camera', 'photo')();
        if (i === 2) choose('camera', 'video')();
        if (i === 3) choose('library', 'all')();
      },
    );
  } else {
    Alert.alert('Adjuntar recuerdo', undefined, [
      { text: 'Tomar foto', onPress: choose('camera', 'photo') },
      { text: 'Grabar video', onPress: choose('camera', 'video') },
      { text: 'Elegir de galería', onPress: choose('library', 'all') },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  }
};

const onAttachConfirm = async ({ holeIndex, caption, uploaderLabel }) => {
  const asset = pickerAsset;
  setPickerAsset(null);
  if (!asset) return;
  try {
    await attachMedia({
      tournamentId: tournament.id,
      roundId: round.id,
      holeIndex,
      kind: asset.kind,
      localUri: asset.localUri,
      durationS: asset.durationS,
      caption,
      uploaderLabel,
    });
  } catch (e) {
    Alert.alert('No se pudo adjuntar', String(e?.message ?? e));
  }
};
```

The `tournament` and `round` variables already exist in scope. Rounds have `id` fields of the form `'r0'`, `'r1'`, `'r2'` (set in `SetupScreen.js`), so `round.id` is a stable string identifier.

- [ ] **Step 4: Add the camera button to the header**

Inside the existing `<View style={s.header}>` block (around line 299-328), add a new `TouchableOpacity` after the toggle pill `</View>` closing tag:

```jsx
<TouchableOpacity onPress={openCapturePicker} style={s.cameraBtn} accessibilityLabel="Adjuntar recuerdo">
  <Feather name="camera" size={20} color={theme.accent.primary} />
</TouchableOpacity>
```

Add a `cameraBtn` style next to the existing header styles (around line 1251):

```js
cameraBtn: { padding: 6, marginLeft: 8 },
```

- [ ] **Step 5: Render the strip under the scorecard content**

Find the bottom of the main scorecard scroll/view (just before the closing `</SafeAreaView>`). Insert:

```jsx
<RoundMediaStrip
  roundId={round.id}
  onAdd={openCapturePicker}
  onOpenLightbox={(items, i) => {
    setLightboxItems(items);
    setLightboxIndex(i);
    setLightboxVisible(true);
  }}
/>
```

If the layout is heavily structured with `HoleView` / grid view sub-renders, place the strip in the parent screen so it appears in both view modes.

- [ ] **Step 6: Mount the modals at the bottom of the SafeAreaView**

Just before the closing `</SafeAreaView>`, add:

```jsx
<AttachMediaSheet
  visible={!!pickerAsset}
  asset={pickerAsset}
  holes={round.holes ?? []}
  defaultHoleIndex={typeof currentHole === 'number' ? currentHole : null}
  onCancel={() => setPickerAsset(null)}
  onConfirm={onAttachConfirm}
/>
<MediaLightbox
  visible={lightboxVisible}
  items={lightboxItems}
  initialIndex={lightboxIndex}
  onClose={() => setLightboxVisible(false)}
/>
```

If `currentHole` doesn't exist with that exact name, use whichever variable tracks the active hole index in this screen (search for `currentHole` or `holeIdx` near the top of the component).

- [ ] **Step 7: Manual smoke test**

```bash
npx expo start --web --clear
```

In the browser:
1. Open an active tournament → enter the Scorecard for any round.
2. Click the camera icon → action sheet appears (web shows the Alert dialog with options).
3. Choose "Elegir de galería" → file picker opens.
4. Pick a photo → `AttachMediaSheet` shows the preview, hole chips, caption, name fields.
5. Click Guardar → modal closes, thumbnail appears in the strip with a spinner, then the spinner disappears once upload completes.
6. Tap the thumbnail → lightbox opens with the photo, footer shows hole/caption/date.
7. Close lightbox.

Stop the server.

- [ ] **Step 8: Commit**

```bash
git add src/screens/ScorecardScreen.js
git commit -m "feat: wire capture flow into Scorecard with strip and lightbox"
```

---

## Task 13: "Recuerdos" section in tournament view

**Files:**
- Create: `src/components/TournamentMemoriesSection.js`
- Modify: `src/screens/HomeScreen.js`

Shows up to 9 most-recent thumbnails in a 3-column grid with a "Ver todos los N" footer button that navigates to `GalleryScreen`. Empty state for tournaments with no media.

- [ ] **Step 1: Create `src/components/TournamentMemoriesSection.js`**

```js
import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useTournamentMedia } from '../hooks/useTournamentMedia';

const { width } = Dimensions.get('window');
const GAP = 4;
const HORIZONTAL_PAD = 16;
const TILE = (width - HORIZONTAL_PAD * 2 - GAP * 2) / 3;

export default function TournamentMemoriesSection({ tournamentId, onOpenGallery, onOpenLightbox }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const { items } = useTournamentMedia(tournamentId);
  const visible = items.slice(0, 9);

  return (
    <View style={s.wrap}>
      <Text style={s.title}>Recuerdos</Text>
      {visible.length === 0 ? (
        <View style={s.empty}>
          <Feather name="image" size={28} color={theme.text.muted} />
          <Text style={s.emptyText}>Aún no hay recuerdos. Adjunta fotos o videos desde la ronda.</Text>
        </View>
      ) : (
        <>
          <View style={s.grid}>
            {visible.map((m, i) => (
              <TouchableOpacity
                key={m.id}
                style={[s.tile, (i + 1) % 3 === 0 ? null : s.tileGap]}
                onPress={() => onOpenLightbox(items, i)}
              >
                <Image source={{ uri: m.thumbUrl }} style={s.thumb} />
                {m.kind === 'video' && (
                  <View style={s.videoBadge}><Feather name="play" size={12} color="#fff" /></View>
                )}
              </TouchableOpacity>
            ))}
          </View>
          {items.length > 9 && (
            <TouchableOpacity style={s.more} onPress={onOpenGallery}>
              <Text style={s.moreLabel}>Ver todos los {items.length}</Text>
              <Feather name="chevron-right" size={16} color={theme.accent.primary} />
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  wrap: { paddingHorizontal: HORIZONTAL_PAD, paddingVertical: 16 },
  title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 18, color: theme.text.primary, marginBottom: 12 },
  empty: { padding: 20, alignItems: 'center', backgroundColor: theme.bg.secondary, borderRadius: 12 },
  emptyText: { color: theme.text.muted, fontFamily: 'PlusJakartaSans-Regular', textAlign: 'center', marginTop: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: GAP },
  tile: { width: TILE, height: TILE, borderRadius: 8, overflow: 'hidden', backgroundColor: theme.bg.secondary },
  tileGap: { marginRight: GAP },
  thumb: { width: '100%', height: '100%' },
  videoBadge: { position: 'absolute', bottom: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 999, padding: 4 },
  more: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
          marginTop: 12, paddingVertical: 8 },
  moreLabel: { color: theme.accent.primary, fontFamily: 'PlusJakartaSans-SemiBold', marginRight: 4 },
});
```

- [ ] **Step 2: Mount the section + lightbox in `HomeScreen` tournament mode**

Open `src/screens/HomeScreen.js`. At the top, add imports:

```js
import TournamentMemoriesSection from '../components/TournamentMemoriesSection';
import MediaLightbox from '../components/MediaLightbox';
```

Inside the component body, add:

```js
const [memLightboxItems, setMemLightboxItems] = useState([]);
const [memLightboxIndex, setMemLightboxIndex] = useState(0);
const [memLightboxVisible, setMemLightboxVisible] = useState(false);
```

Find where the tournament view renders the leaderboard (search for "leaderboard" or "Leaderboard" — the JSX block that's only rendered when `viewMode === 'tournament'`). After the leaderboard JSX, insert:

```jsx
{tournament && (
  <TournamentMemoriesSection
    tournamentId={tournament.id}
    onOpenGallery={() => navigation.navigate('Gallery', { tournamentId: tournament.id })}
    onOpenLightbox={(items, i) => {
      setMemLightboxItems(items);
      setMemLightboxIndex(i);
      setMemLightboxVisible(true);
    }}
  />
)}
```

At the bottom of the screen JSX (just before the outermost closing tag), add:

```jsx
<MediaLightbox
  visible={memLightboxVisible}
  items={memLightboxItems}
  initialIndex={memLightboxIndex}
  onClose={() => setMemLightboxVisible(false)}
/>
```

Note: `Gallery` route doesn't exist yet — Task 14 adds it. Until then the "Ver todos" button will throw on press; ignore for this task's smoke test.

- [ ] **Step 3: Manual smoke test**

```bash
npx expo start --web --clear
```

1. Open an active tournament with at least one media item attached during Task 12's smoke test.
2. The "Recuerdos" section appears under the leaderboard with a thumbnail.
3. Tap the thumbnail → lightbox opens.
4. For tournaments with no media, the empty state appears.

- [ ] **Step 4: Commit**

```bash
git add src/components/TournamentMemoriesSection.js src/screens/HomeScreen.js
git commit -m "feat: add Recuerdos section to tournament view"
```

---

## Task 14: `GalleryScreen` with filters

**Files:**
- Create: `src/screens/GalleryScreen.js`
- Modify: `App.js` (register the route)

Filter chips: "Todo" | "R1" | "R2" | "R3" | "Por hoyo". 3-column grid with the same tile sizing as `TournamentMemoriesSection`. Tap → lightbox.

- [ ] **Step 1: Create `src/screens/GalleryScreen.js`**

```js
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image, FlatList, Dimensions, StyleSheet, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useTournamentMedia } from '../hooks/useTournamentMedia';
import { loadTournament } from '../store/tournamentStore';
import MediaLightbox from '../components/MediaLightbox';

const { width } = Dimensions.get('window');
const GAP = 4;
const PAD = 12;
const TILE = (width - PAD * 2 - GAP * 2) / 3;

export default function GalleryScreen({ route, navigation }) {
  const { tournamentId } = route.params ?? {};
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const { items } = useTournamentMedia(tournamentId);
  const [tournament, setTournament] = useState(null);
  const [filter, setFilter] = useState({ kind: 'all' }); // {kind:'all'} | {kind:'round', roundIndex:n} | {kind:'hole', hole:n}
  const [holePickerVisible, setHolePickerVisible] = useState(false);
  const [lightbox, setLightbox] = useState({ visible: false, index: 0 });

  useEffect(() => { loadTournament().then(setTournament); }, []);

  const filtered = useMemo(() => {
    if (!tournament) return items;
    return items.filter((m) => {
      if (filter.kind === 'all') return true;
      if (filter.kind === 'round') {
        const round = tournament.rounds?.[filter.roundIndex];
        return round && m.roundId === round.id;
      }
      if (filter.kind === 'hole') return m.holeIndex === filter.hole;
      return true;
    });
  }, [items, filter, tournament]);

  const roundsCount = tournament?.rounds?.length ?? 3;
  const maxHoles = Math.max(...(tournament?.rounds?.map((r) => r.holes?.length ?? 18) ?? [18]));

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.title}>Recuerdos</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipsRow}>
        <Chip label="Todo" active={filter.kind === 'all'} onPress={() => setFilter({ kind: 'all' })} theme={theme} />
        {Array.from({ length: roundsCount }).map((_, i) => (
          <Chip
            key={i}
            label={`R${i + 1}`}
            active={filter.kind === 'round' && filter.roundIndex === i}
            onPress={() => setFilter({ kind: 'round', roundIndex: i })}
            theme={theme}
          />
        ))}
        <Chip
          label={filter.kind === 'hole' ? `Hoyo ${filter.hole + 1}` : 'Por hoyo'}
          active={filter.kind === 'hole'}
          onPress={() => setHolePickerVisible(true)}
          theme={theme}
        />
      </ScrollView>

      <FlatList
        data={filtered}
        keyExtractor={(m) => m.id}
        numColumns={3}
        contentContainerStyle={s.grid}
        columnWrapperStyle={{ gap: GAP }}
        ItemSeparatorComponent={() => <View style={{ height: GAP }} />}
        renderItem={({ item, index }) => (
          <TouchableOpacity style={s.tile} onPress={() => setLightbox({ visible: true, index })}>
            <Image source={{ uri: item.thumbUrl }} style={s.thumb} />
            {item.kind === 'video' && (
              <View style={s.videoBadge}><Feather name="play" size={12} color="#fff" /></View>
            )}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={s.empty}>
            <Feather name="image" size={32} color={theme.text.muted} />
            <Text style={s.emptyText}>Sin recuerdos para este filtro.</Text>
          </View>
        }
      />

      <Modal visible={holePickerVisible} transparent animationType="slide" onRequestClose={() => setHolePickerVisible(false)}>
        <View style={s.modalBackdrop}>
          <View style={s.modalSheet}>
            <Text style={s.modalTitle}>Filtrar por hoyo</Text>
            <ScrollView contentContainerStyle={s.holeGrid}>
              {Array.from({ length: maxHoles }).map((_, i) => (
                <TouchableOpacity
                  key={i}
                  style={s.holeBtn}
                  onPress={() => {
                    setFilter({ kind: 'hole', hole: i });
                    setHolePickerVisible(false);
                  }}
                >
                  <Text style={s.holeBtnLabel}>{i + 1}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={s.modalCancel} onPress={() => setHolePickerVisible(false)}>
              <Text style={s.modalCancelLabel}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <MediaLightbox
        visible={lightbox.visible}
        items={filtered}
        initialIndex={lightbox.index}
        onClose={() => setLightbox({ visible: false, index: 0 })}
      />
    </SafeAreaView>
  );
}

function Chip({ label, active, onPress, theme }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
        backgroundColor: active ? theme.accent.primary : theme.bg.secondary,
        marginRight: 6,
      }}
    >
      <Text style={{
        color: active ? theme.text.inverse : theme.text.primary,
        fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13,
      }}>{label}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg.primary },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: 16, paddingVertical: 10 },
  backBtn: { padding: 4 },
  title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: theme.text.primary },
  chipsRow: { paddingHorizontal: 12, paddingVertical: 8 },
  grid: { padding: PAD },
  tile: { width: TILE, height: TILE, borderRadius: 8, overflow: 'hidden', backgroundColor: theme.bg.secondary },
  thumb: { width: '100%', height: '100%' },
  videoBadge: { position: 'absolute', bottom: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 999, padding: 4 },
  empty: { paddingVertical: 60, alignItems: 'center' },
  emptyText: { marginTop: 8, color: theme.text.muted, fontFamily: 'PlusJakartaSans-Regular' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: theme.bg.primary, padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 32 },
  modalTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 18, color: theme.text.primary, marginBottom: 12 },
  holeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  holeBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg.secondary },
  holeBtnLabel: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary },
  modalCancel: { marginTop: 16, paddingVertical: 12, alignItems: 'center' },
  modalCancelLabel: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.accent.primary },
});
```

- [ ] **Step 2: Register the route in `App.js`**

Open `App.js`. Add the import:

```js
import GalleryScreen from './src/screens/GalleryScreen';
```

Inside the `Stack.Navigator`, add the screen entry near the others:

```jsx
<Stack.Screen name="Gallery" component={GalleryScreen} />
```

- [ ] **Step 3: Manual smoke test**

```bash
npx expo start --web --clear
```

1. Open the tournament view → "Recuerdos" section → tap "Ver todos los N" (only appears with >9 items; otherwise navigate manually using the dev menu, or attach 10 items first).
2. `GalleryScreen` appears with chips at the top.
3. Tap "R1" → only round-1 items show.
4. Tap "Por hoyo" → modal with hole numbers; pick one → grid filters.
5. Tap any thumbnail → lightbox opens with swipe through filtered set.

If you have fewer than 9 items, temporarily remove the `items.length > 9` guard in `TournamentMemoriesSection.js` for the duration of testing, then restore it.

- [ ] **Step 4: Commit**

```bash
git add src/screens/GalleryScreen.js App.js
git commit -m "feat: add GalleryScreen with round and hole filters"
```

---

## Task 15: End-to-end manual verification + cleanup

**Files:** none

Final pass that exercises every surface end-to-end on both web and Android (Expo Go), confirms offline behavior, and cleans up any stray temporary code.

- [ ] **Step 1: Web smoke test**

```bash
npx expo start --web --clear
```

Run through the full flow:
1. Open an active tournament.
2. Enter Scorecard for round 1.
3. Camera button → upload a photo → confirm in `AttachMediaSheet` with hole 7 + caption.
4. Strip thumbnail appears immediately with spinner, then resolves.
5. Open Tournament view → "Recuerdos" shows the new item.
6. Open Gallery → filter by R1 → item appears. Filter by hoyo 7 → item appears. Filter by hoyo 8 → empty state.
7. Open lightbox → footer shows "Hoyo 7", caption, date, name.
8. Delete the item from lightbox → confirm dialog → item disappears from all three surfaces.

- [ ] **Step 2: Android smoke test (Expo Go)**

```bash
npx expo start --clear
```

Scan the QR with Expo Go on an Android device. Repeat the flow from Step 1, plus:
- Capture a photo from the camera (not library).
- Capture a video, confirm it plays in the lightbox with native controls.

- [ ] **Step 3: Offline test**

Still in Expo Go on Android:
1. Turn on airplane mode.
2. Capture a photo → it appears immediately in the strip with a spinner overlay.
3. Wait ~30 seconds → spinner persists; eventually shows a warning icon (failure after 5 retries) OR remains spinning depending on backoff state.
4. Turn airplane mode off → within ~10 seconds the worker drains and the spinner disappears.
5. Verify the item now appears in the tournament Recuerdos section.

If failure persists after connectivity returns, tap the warning icon → it should retry and succeed.

- [ ] **Step 4: Search for and remove any leftover debug logs**

```bash
grep -rn 'console.log' src/store/mediaQueue.js src/lib/uploadWorker.js src/lib/mediaUpload.js src/lib/mediaCapture.js src/components/AttachMediaSheet.js src/components/RoundMediaStrip.js src/components/MediaLightbox.js src/screens/GalleryScreen.js src/components/TournamentMemoriesSection.js
```

If any are intentional (e.g., error logging in the worker), keep them. Remove any that were left from manual debugging.

- [ ] **Step 5: Commit any cleanup**

```bash
git add -u
git diff --cached
git commit -m "chore: clean up leftover debug logs from media feature" || true
```

(`|| true` because the commit is a no-op if there's nothing to clean.)

- [ ] **Step 6: Final summary commit (optional)**

```bash
git log --oneline -20
```

Confirm the commit history reads as a coherent feature build. No further commit needed unless a doc update is required.
