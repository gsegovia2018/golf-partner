// Browser-only video thumbnail generator.
// expo-video-thumbnails is native-only; on web we seek a hidden <video>
// element to a target time and paint the frame to a canvas.
export async function generateVideoThumbWeb(uri, { timeSeconds = 0.5, quality = 0.7 } = {}) {
  if (typeof document === 'undefined') {
    throw new Error('videoThumbWeb called outside of a browser environment');
  }

  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = uri;

  await new Promise((resolve, reject) => {
    const onError = () => reject(new Error('No se pudo cargar el video para generar thumbnail'));
    video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    video.addEventListener('error', onError, { once: true });
  });

  const target = Math.min(timeSeconds, Math.max(0, (video.duration || 1) - 0.05));
  await new Promise((resolve, reject) => {
    const onSeeked = () => resolve();
    const onError = () => reject(new Error('No se pudo posicionar el video para el thumbnail'));
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    try { video.currentTime = target; } catch (e) { reject(e); }
  });

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 360;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob devolvió null'))),
      'image/jpeg',
      quality,
    );
  });

  return URL.createObjectURL(blob);
}
