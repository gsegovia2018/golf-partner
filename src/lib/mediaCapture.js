import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { enqueueMedia } from '../store/mediaQueue';
import { kickUploadWorker } from './uploadWorker';
import { MAX_VIDEO_UPLOAD_BYTES, MAX_VIDEO_UPLOAD_LABEL } from './mediaLimits';

const PHOTO_PICKER_QUALITY = 0.9;
const VIDEO_PICKER_QUALITY = 0.7;
const VIDEO_EXPORT_PRESET = ImagePicker.VideoExportPreset?.H264_1280x720;
const VIDEO_QUALITY = ImagePicker.UIImagePickerControllerQualityType?.IFrame1280x720
  ?? ImagePicker.UIImagePickerControllerQualityType?.Medium;

function uuid() {
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

function sizeErrorMessage(source) {
  if (source === 'library') return `Los vídeos de galería deben ser de ${MAX_VIDEO_UPLOAD_LABEL} o menos.`;
  if (source === 'camera') return `Los vídeos grabados con la cámara deben ser de ${MAX_VIDEO_UPLOAD_LABEL} o menos.`;
  return `Los vídeos deben ser de ${MAX_VIDEO_UPLOAD_LABEL} o menos.`;
}

// The web picker (and, in principle, any future picker) can omit fileSize —
// derive it from the actual Blob so oversized web videos don't slip past
// the cap and get loaded whole into memory by the upload path.
async function deriveWebVideoSize(uri) {
  try {
    const res = await fetch(uri);
    const blob = await res.blob();
    return blob.size;
  } catch {
    return null;
  }
}

// Applies to every source — library, camera, and web — not just gallery
// picks. Camera-recorded clips and web picks were previously never
// size-checked (fileSize is frequently absent from the web picker).
async function assertVideoSize(asset, source) {
  if (asset?.type !== 'video') return;
  let size = typeof asset.fileSize === 'number' ? asset.fileSize : null;
  if (size == null && Platform.OS === 'web' && typeof asset.uri === 'string') {
    size = await deriveWebVideoSize(asset.uri);
  }
  if (size == null || size <= MAX_VIDEO_UPLOAD_BYTES) return;
  throw new Error(sizeErrorMessage(source));
}

export async function pickMedia({ source, mediaTypes, multi = false, selectionLimit = 20 }) {
  await ensurePermissions(source);

  const videoOnly = mediaTypes === 'video';
  const acceptsVideo = videoOnly || mediaTypes === 'all';
  const opts = {
    mediaTypes: mediaTypes === 'video'
      ? ImagePicker.MediaTypeOptions.Videos
      : mediaTypes === 'photo'
        ? ImagePicker.MediaTypeOptions.Images
        : ImagePicker.MediaTypeOptions.All,
    // Keep photos high because the upload pipeline re-encodes them. Explicit
    // video capture gets lower quality so short clips stay under the storage cap.
    quality: videoOnly ? VIDEO_PICKER_QUALITY : PHOTO_PICKER_QUALITY,
    videoMaxDuration: 20,
    allowsEditing: false,
    allowsMultipleSelection: multi && source === 'library',
    selectionLimit: multi && source === 'library' ? selectionLimit : 1,
  };
  if (acceptsVideo && VIDEO_QUALITY != null) opts.videoQuality = VIDEO_QUALITY;
  if (acceptsVideo && VIDEO_EXPORT_PRESET != null) opts.videoExportPreset = VIDEO_EXPORT_PRESET;

  const result = source === 'camera'
    ? await ImagePicker.launchCameraAsync(opts)
    : await ImagePicker.launchImageLibraryAsync(opts);

  if (result.canceled || !result.assets?.length) return multi ? [] : null;

  // Each asset must be validated before any are enqueued; the sequential
  // await keeps failure order deterministic and readable.
  for (const asset of result.assets) {
    await assertVideoSize(asset, source);
  }

  const mapped = result.assets.map((asset) => ({
    localUri: asset.uri,
    kind: asset.type === 'video' ? 'video' : 'photo',
    durationS: asset.duration ? asset.duration / 1000 : null,
    mimeType: asset.mimeType ?? null,
    fileName: asset.fileName ?? null,
    fileSize: asset.fileSize ?? null,
  }));

  return multi ? mapped : mapped[0];
}

export async function attachMedia({
  tournamentId, roundId, holeIndex, kind, localUri,
  durationS, caption, uploaderLabel, mimeType, fileName, fileSize,
}) {
  const id = uuid();
  await enqueueMedia({
    id, tournamentId, roundId, holeIndex, kind, localUri,
    durationS, caption, uploaderLabel, mimeType, fileName, fileSize,
  });
  kickUploadWorker();
  return { id };
}

export async function attachManyMedia({ tournamentId, items }) {
  // items: [{ asset, roundId, holeIndex, caption, uploaderLabel }]
  const ids = [];
  for (const it of items) {
    const { id } = await attachMedia({
      tournamentId,
      roundId: it.roundId,
      holeIndex: it.holeIndex,
      kind: it.asset.kind,
      localUri: it.asset.localUri,
      durationS: it.asset.durationS,
      caption: it.caption,
      uploaderLabel: it.uploaderLabel,
      mimeType: it.asset.mimeType,
      fileName: it.asset.fileName,
      fileSize: it.asset.fileSize,
    });
    ids.push(id);
  }
  return ids;
}
