// Browser-only video thumbnail generator.
// expo-video-thumbnails is native-only; on web we seek a hidden <video>
// element to a target time and paint the frame to a canvas.
//
// The <video> element decodes its own private copy of the source (fetched
// fresh from `uri` and wrapped in a new object URL) rather than pointing
// straight at the caller's `uri`. That lets this function revoke the object
// URL it created as soon as the frame is captured, without invalidating the
// caller's `uri` — which is still needed afterwards to upload the original
// file. The <video> element itself is never appended to the document, but
// setting `.src` still ties it to decoder resources, so its src is cleared
// and the element is removed in a `finally` on every exit path (success or
// error) to avoid leaking a detached, still-decoding <video>.
export async function generateVideoThumbWeb(uri, { timeSeconds = 0.5, quality = 0.7 } = {}) {
  if (typeof document === 'undefined') {
    throw new Error('videoThumbWeb called outside of a browser environment');
  }

  const sourceRes = await fetch(uri);
  if (!sourceRes.ok) throw new Error('No se pudo leer el video para generar thumbnail');
  const sourceBlob = await sourceRes.blob();
  const sourceUrl = URL.createObjectURL(sourceBlob);

  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = sourceUrl;

  try {
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

    // Caller (mediaUpload.js/processUpload) owns this URL from here: it
    // uploads the thumbnail and must revoke it once that upload completes.
    return URL.createObjectURL(blob);
  } finally {
    video.removeAttribute('src');
    if (typeof video.load === 'function') video.load();
    if (typeof video.remove === 'function') video.remove();
    URL.revokeObjectURL(sourceUrl);
  }
}
