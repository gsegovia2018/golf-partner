import * as ImageManipulator from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { supabase } from './supabase';
import { insertMediaRow } from '../store/mediaStore';

const BUCKET = 'tournament-media';

function extFromUri(uri, fallback) {
  const m = uri.match(/\.([a-z0-9]+)(\?|#|$)/i);
  return (m ? m[1] : fallback).toLowerCase();
}

async function uriToBody(uri) {
  // fetch() works for file://, blob:, data:, and http(s) URIs on both web
  // and native, so we use it as the single path to get a Blob for upload.
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`Failed to read media (${res.status})`);
  return res.blob();
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
  const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(uri, { time: 500 });
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
