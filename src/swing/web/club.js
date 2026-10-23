// The learned club detector in the browser (ClubDetector.kt): the same club_yolox_tiny_v1.tflite on
// LiteRT.js, wasm (XNNPACK). Input: one 640 × 640 RGB frame (webFrame.rgb);
// output: ClubDecode boxes in 640-px model units.

import { assetUrl } from './assets';
import { ClubDecode } from './core/clubDecode';

export const MODEL = 'club_yolox_tiny_v1';

let runtime = null;

async function litert() {
  if (!runtime) {
    runtime = (async () => {
      const m = await import('@litertjs/core');
      await m.loadLiteRt(`${assetUrl('litert')}/`);
      return m;
    })().catch((e) => { runtime = null; throw e; });
  }
  return runtime;
}

/** Opens the detector: { delegate: 'gpu' | 'cpu', detect(rgb) → Promise<ClubBox[]>, close() }. */
export async function openClubDetector() {
  const m = await litert();
  const url = assetUrl(`${MODEL}.tflite`);
  // wasm (XNNPACK) only: on WebGPU this model fails inside LiteRT.js (a node "failed to invoke") and
  // run() still resolves, with garbage boxes (desktop Chrome, 2026-10-23). The CPU path is the one
  // that matches the lab's interpreter.
  const model = await m.loadAndCompile(url, { accelerator: 'wasm' });
  const delegate = 'cpu';
  const shape = Array.from(model.getInputDetails()[0].shape);
  const nchw = shape[1] === 3;
  const input = new Float32Array(ClubDecode.SIZE * ClubDecode.SIZE * 3);

  async function infer(rgb) {
    ClubDecode.fill(rgb, input, nchw);
    const t = new m.Tensor(input, shape);
    let outs;
    try {
      outs = await model.run(t);
    } finally {
      t.delete();
    }
    let o = outs[0];
    if (o.accelerator !== 'wasm') o = await o.moveTo('wasm');
    const raw = Float32Array.from(o.toTypedArray());
    o.delete();
    outs.slice(1).forEach((x) => x.delete());
    return raw;
  }

  return {
    delegate,
    async detect(rgb) { return ClubDecode.boxes(await infer(rgb)); },
    close() { try { model.delete(); } catch { /* already gone */ } },
  };
}
