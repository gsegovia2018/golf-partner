import { Platform } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { File as FsFile } from 'expo-file-system';
import { supabase } from './supabase';
import { insertMediaRow } from '../store/mediaStore';
import { generateVideoThumbWeb } from './videoThumbWeb';
import { MAX_VIDEO_UPLOAD_BYTES, MAX_VIDEO_UPLOAD_LABEL } from './mediaLimits';

const BUCKET = 'tournament-media';

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
//
// The size cap is normally enforced up-front in mediaCapture.js before an
// item is ever enqueued, but that guard can't see every path an item might
// take to get here (e.g. a queued retry from before this check existed).
// Re-checking the Blob's actual byte size here — the only reliable size on
// web, since picker-reported fileSize can be missing — is a last line of
// defense against loading a huge file into memory for upload.
async function uriToBody(uri, { kind } = {}) {
  if (Platform.OS === 'web') {
    const res = await fetch(uri);
    if (!res.ok) throw new Error(`Failed to read media (${res.status})`);
    const blob = await res.blob();
    if (kind === 'video' && blob.size > MAX_VIDEO_UPLOAD_BYTES) {
      throw new Error(`Los vídeos deben ser de ${MAX_VIDEO_UPLOAD_LABEL} o menos.`);
    }
    return blob;
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
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
  );
  return result.uri;
}

// The "thumbnail" is what the feed, memory cards, and round summary actually
// render — and those cards span the full device width. At 400px it was being
// upscaled ~3x on a retina phone and looked blurry. 1080px covers a full-width
// retina card sharply; the storage/bandwidth cost of the larger thumb is
// negligible for this app's scale.
async function makeThumbnail(uri, kind) {
  if (kind === 'photo') {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1080 } }],
      { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG },
    );
    return result.uri;
  }
  const thumbUri = Platform.OS === 'web'
    ? await generateVideoThumbWeb(uri, { timeSeconds: 0.5, quality: 0.8 })
    : (await VideoThumbnails.getThumbnailAsync(uri, { time: 500 })).uri;
  // ImageManipulator supports web too, but re-encoding an already-compressed
  // canvas JPEG offers little; on web we ship the canvas output directly.
  if (Platform.OS === 'web') return thumbUri;
  const resized = await ImageManipulator.manipulateAsync(
    thumbUri,
    [{ resize: { width: 1080 } }],
    { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG },
  );
  return resized.uri;
}

async function uploadFile(path, uri, contentType, { kind } = {}) {
  const body = await uriToBody(uri, { kind });
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

  // Thumbnail generation is best-effort: an unsupported codec, a null
  // canvas.toBlob() on web, or any other decode failure must not block the
  // original photo/video from uploading. Fall back to a placeholder rather
  // than losing the whole item after retries are exhausted.
  let thumbUri = null;
  try {
    thumbUri = await makeThumbnail(localUri, kind);
  } catch (err) {
    console.warn('[mediaUpload] thumbnail generation failed; uploading original as the thumbnail placeholder', err);
    thumbUri = null;
  }

  // generateVideoThumbWeb hands back a blob: URL it created via
  // canvas.toBlob(); once nothing downstream needs it any more it must be
  // revoked or every web video attach leaks that blob permanently. This
  // wraps the *entire* rest of the upload (not just the thumb's own upload
  // call) so the blob is still released even if e.g. the original video's
  // upload fails after the thumbnail step already succeeded. Native
  // thumbUris are file:// paths (or a data URI for photos) — nothing to
  // revoke there.
  try {
    await uploadFile(storagePath, finalUri, contentType, { kind });

    // tournament_media.thumb_path is NOT NULL, and consumers render thumbUrl
    // directly with no original-url fallback (e.g. MemoryCard). When the
    // thumbnail failed, point thumb_path at the original we just uploaded:
    // this satisfies the constraint and shows the full image instead of a
    // broken one, rather than passing null (which would 23502 on insert and
    // lose the media through retries — the very bug this fix prevents).
    let finalThumbPath;
    if (thumbUri) {
      await uploadFile(thumbPath, thumbUri, 'image/jpeg');
      finalThumbPath = thumbPath;
    } else {
      finalThumbPath = storagePath;
    }

    await insertMediaRow({
      id, tournamentId, roundId, holeIndex, kind,
      storagePath, thumbPath: finalThumbPath, durationS, caption, uploaderLabel,
    });

    return { storagePath, thumbPath: finalThumbPath };
  } finally {
    if (Platform.OS === 'web' && kind === 'video' && thumbUri) {
      URL.revokeObjectURL(thumbUri);
    }
  }
}
