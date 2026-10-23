// MediaPipe Pose Landmarker in the browser: the same release (tasks 1.1.0) and model file
// (pose_landmarker_full.task) the Android module runs, VIDEO mode, GPU first with CPU fallback.
// Wasm and model come from the app's own origin (public/swing-web, scripts/copySwingWebAssets.mjs).
//
// A back-fill re-runs earlier frames, which VIDEO mode cannot take (timestamps must increase and it
// tracks between calls), so it switches to a fresh instance: the spare, built while the current
// one infers (PoseAnalyzer.PoseWorker).

import { assetUrl } from './assets';

let filesetPromise = null;
let modulePromise = null;

// The package's ESM bundle is served as a file (public/swing-web/mediapipe) and imported at run
// time: Metro cannot transform it (it holds an `import()` of a computed URL), and this keeps it out
// of the app bundle until a swing is analysed. `new Function` hides the import from Metro.
const importUrl = new Function('url', 'return import(url)');

const mediapipe = () => {
  if (!modulePromise) {
    const url = new URL(assetUrl('mediapipe/vision_bundle.js'), window.location.href).href;
    modulePromise = importUrl(url).catch((e) => { modulePromise = null; throw e; });
  }
  return modulePromise;
};

async function fileset() {
  const { FilesetResolver } = await mediapipe();
  if (!filesetPromise) filesetPromise = FilesetResolver.forVisionTasks(assetUrl('mediapipe'));
  return filesetPromise;
}

const LANDMARKS = 33;

export class PoseRunner {
  constructor({ model = 'full' } = {}) {
    this.model = model;
    this.delegate = 'GPU';
    this.current = null;
    this.spare = null;
    this.lastTs = -Infinity;
    this.inferences = 0;
    this.inferMs = 0;
    this.createMs = 0;
  }

  async create() {
    const { PoseLandmarker } = await mediapipe();
    const vision = await fileset();
    const build = (delegate) => PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: assetUrl(`pose_landmarker_${this.model}.task`), delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
    if (this.delegate === 'GPU') {
      try {
        return await build('GPU');
      } catch (e) {
        console.warn('[swing] GPU pose delegate unavailable, using CPU', e);
        this.delegate = 'CPU';
      }
    }
    return build('CPU');
  }

  /** Builds the first instance and starts the spare. */
  async start() {
    const t = Date.now();
    this.current = await this.create();
    this.createMs += Date.now() - t;
    this.startSpare();
  }

  startSpare() {
    if (!this.spare) this.spare = this.create().catch((e) => { this.spare = null; throw e; });
  }

  /** Switches to a fresh instance (the spare, or a new one) for a back-fill; starts the next spare. */
  async fresh() {
    const t = Date.now();
    const next = this.spare ? await this.spare : await this.create();
    this.spare = null;
    try { this.current?.close(); } catch { /* already closed */ }
    this.current = next;
    this.lastTs = -Infinity;
    this.createMs += Date.now() - t;
    this.startSpare();
  }

  /**
   * Landmarks of the image (a canvas) at `ptsUs`: Float32Array of 33 × [x, y, visibility],
   * normalised, or null when no pose is found.
   */
  async detect(image, ptsUs) {
    const ts = Math.max(Math.round(ptsUs / 1000), this.lastTs + 1);
    this.lastTs = ts;
    const t = performance.now();
    let res;
    try {
      res = this.current.detectForVideo(image, ts);
    } catch (e) {
      if (this.delegate !== 'GPU') throw e;
      // a GPU that builds but fails to run: start over on the CPU, this frame first
      console.warn('[swing] GPU pose inference failed, switching to CPU', e);
      this.delegate = 'CPU';
      try { this.current?.close(); } catch { /* ignore */ }
      if (this.spare) this.spare.then((s) => s.close(), () => {});
      this.spare = null;
      this.current = await this.create();
      res = this.current.detectForVideo(image, ts);
      this.startSpare();
    }
    this.inferMs += performance.now() - t;
    this.inferences += 1;
    const p = res?.landmarks?.[0];
    if (!p || p.length < LANDMARKS) return null;
    const out = new Float32Array(LANDMARKS * 3);
    for (let k = 0; k < LANDMARKS; k += 1) {
      out[3 * k] = p[k].x;
      out[3 * k + 1] = p[k].y;
      out[3 * k + 2] = p[k].visibility ?? 0;
    }
    return out;
  }

  close() {
    try { this.current?.close(); } catch { /* ignore */ }
    this.current = null;
    if (this.spare) this.spare.then((s) => s.close(), () => {});
    this.spare = null;
  }
}
