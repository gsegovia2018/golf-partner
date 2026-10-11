import * as ImagePicker from 'expo-image-picker';

// Pick one video from the gallery for analysis. Unlike pickMedia (memories) this
// must not re-encode or downscale: the frame rate and resolution of the original
// slow-motion clip are the whole point, and nothing is uploaded so the memories
// size cap does not apply. Returns { uri, durationS, fileName } or null.
export async function pickSwingVideo() {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    allowsEditing: false,
    allowsMultipleSelection: false,
    quality: 1,
    videoExportPreset: ImagePicker.VideoExportPreset?.Passthrough,
  });
  if (result.canceled || !result.assets?.length) return null;
  const a = result.assets[0];
  return { uri: a.uri, durationS: a.duration ? a.duration / 1000 : null, fileName: a.fileName ?? null };
}
