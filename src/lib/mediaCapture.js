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

function assertGalleryVideoSize(asset, source) {
  if (source !== 'library' || asset?.type !== 'video') return;
  if (typeof asset.fileSize !== 'number' || asset.fileSize <= MAX_VIDEO_UPLOAD_BYTES) return;
  throw new Error(`Los vídeos de galería deben ser de ${MAX_VIDEO_UPLOAD_LABEL} o menos.`);
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

  result.assets.forEach((asset) => assertGalleryVideoSize(asset, source));

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
