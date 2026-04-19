import * as ImagePicker from 'expo-image-picker';
import { enqueueMedia } from '../store/mediaQueue';
import { kickUploadWorker } from './uploadWorker';

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

export async function pickMedia({ source, mediaTypes, multi = false, selectionLimit = 20 }) {
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
    allowsMultipleSelection: multi && source === 'library',
    selectionLimit: multi && source === 'library' ? selectionLimit : 1,
  };

  const result = source === 'camera'
    ? await ImagePicker.launchCameraAsync(opts)
    : await ImagePicker.launchImageLibraryAsync(opts);

  if (result.canceled || !result.assets?.length) return multi ? [] : null;

  const mapped = result.assets.map((asset) => ({
    localUri: asset.uri,
    kind: asset.type === 'video' ? 'video' : 'photo',
    durationS: asset.duration ? asset.duration / 1000 : null,
  }));

  return multi ? mapped : mapped[0];
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
    });
    ids.push(id);
  }
  return ids;
}
