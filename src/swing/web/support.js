// Can this browser run the web swing analyzer: canvas, wasm, and a way to decode a video
// (WebCodecs, or a <video> element to seek). Read by availability.js and native.web.js.
export function browserCanAnalyse() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (typeof WebAssembly === 'undefined') return false;
  if (typeof Blob === 'undefined' || typeof URL?.createObjectURL !== 'function') return false;
  try {
    if (!document.createElement('canvas').getContext('2d')) return false;
  } catch {
    return false;
  }
  return typeof VideoDecoder !== 'undefined' || typeof HTMLVideoElement !== 'undefined';
}
