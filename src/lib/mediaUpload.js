import { Platform } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { File as FsFile } from 'expo-file-system';
import { supabase } from './supabase';
import { insertMediaRow } from '../store/mediaStore';
import { generateVideoThumbWeb } from './videoThumbWeb';

const BUCKET = 'tournament-media';

function extFromUri(uri, fallback) {
  const m = uri.match(/\.([a-z0-9]+)(\?|#|$)/i);
  return (m ? m[1] : fallback).toLowerCase();
}

// On web, fetch() + .blob() handles file://, blob:, and data: URIs uniformly
// and the browser streams the Blob through multipart upload correctly.
//
// On native, the React Native Blob returned by fetch() is a reference object
// backed by a blob-id in the networking layer. When supabase-js wraps that
// Blob in a FormData for a multipart upload, RN's bridge frequently fails
// to serialize the underlying bytes for large payloads (>~5MB) — videos and
// Samsung/Pixel motion photos silently upload 0 bytes or time out. Reading
// the file into an ArrayBuffer via expo-file-system skips that path: the
// raw bytes are sent as the request body directly (no FormData wrapping).
async function uriToBody(uri) {
  if (Platform.OS === 'web') {
    const res = await fetch(uri);
    if (!res.ok) throw new Error(`Failed to read media (${res.status})`);
    return res.blob();
  }
  return new FsFile(uri).arrayBuffer();
}

// Resolve the content-type + storage extension for a video upload.
// Priority:
//   1) mimeType from the picker (most reliable on web)
//   2) extension sniffed from the URI (native file paths)
//   3) mp4 fallback
// Returns { contentType, ext } where ext is used only for the storage path.
function resolveVideoType({ mimeType, fileName, localUri }) {
  const fromMime = (mt) => {
    if (!mt) return null;
    // handles "video/webm", "video/mp4", "video/quicktime", etc.
    const m = mt.match(/^video\/([a-z0-9.+-]+)$/i);
    if (!m) return null;
    const sub = m[1].toLowerCase();
    const extMap = { quicktime: 'mov', 'x-matroska': 'mkv', 'mp2t': 'ts' };
    return { contentType: mt, ext: extMap[sub] ?? sub };
  };
  const fromName = (name) => {
    if (!name) return null;
    const m = name.match(/\.([a-z0-9]+)$/i);
    if (!m) return null;
    const ext = m[1].toLowerCase();
    const typeMap = { mov: 'video/quicktime', mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska' };
    return { contentType: typeMap[ext] ?? `video/${ext}`, ext };
  };
  return fromMime(mimeType)
    ?? fromName(fileName)
    ?? fromName(localUri)
    ?? { contentType: 'video/mp4', ext: 'mp4' };
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
  const thumbUri = Platform.OS === 'web'
    ? await generateVideoThumbWeb(uri, { timeSeconds: 0.5, quality: 0.7 })
    : (await VideoThumbnails.getThumbnailAsync(uri, { time: 500 })).uri;
  // ImageManipulator supports web too, but re-encoding an already-compressed
  // canvas JPEG offers little; on web we ship the canvas output directly.
  if (Platform.OS === 'web') return thumbUri;
  const resized = await ImageManipulator.manipulateAsync(
    thumbUri,
    [{ resize: { width: 400 } }],
    { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG },
  );
  return resized.uri;
}

async function uploadFile(path, uri, contentType) {
  const body = await uriToBody(uri);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, body, { contentType, upsert: true });
  if (error) throw error;
}

export async function processUpload(entry) {
  const { id, tournamentId, roundId, holeIndex, kind, localUri, durationS,
          caption, uploaderLabel, mimeType, fileName } = entry;

  let ext, contentType;
  if (kind === 'photo') {
    ext = 'jpg';
    contentType = 'image/jpeg';
  } else {
    ({ ext, contentType } = resolveVideoType({ mimeType, fileName, localUri }));
  }

  const storagePath = `${tournamentId}/${roundId}/${id}.${ext}`;
  const thumbPath = `${tournamentId}/${roundId}/thumbs/${id}.jpg`;

  const finalUri = kind === 'photo' ? await compressPhoto(localUri) : localUri;
  const thumbUri = await makeThumbnail(localUri, kind);

  await uploadFile(storagePath, finalUri, contentType);
  await uploadFile(thumbPath, thumbUri, 'image/jpeg');

  await insertMediaRow({
    id, tournamentId, roundId, holeIndex, kind,
    storagePath, thumbPath, durationS, caption, uploaderLabel,
  });

  return { storagePath, thumbPath };
}
