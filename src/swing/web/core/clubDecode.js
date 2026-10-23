// The club detector's pre- and post-processing, ported from modules/golf-swing ClubDecode.kt.

/** One detector box: `cls` = ClubDecode.SHAFT / HEAD / HANDS, corners in the caller's units. */
export class ClubBox {
  constructor(cls, score, x1, y1, x2, y2) {
    this.cls = cls;
    this.score = score;
    this.x1 = x1;
    this.y1 = y1;
    this.x2 = x2;
    this.y2 = y2;
  }

  get cx() { return (this.x1 + this.x2) / 2; }

  get cy() { return (this.y1 + this.y2) / 2; }

  scaled(sx, sy) { return new ClubBox(this.cls, this.score, this.x1 * sx, this.y1 * sy, this.x2 * sx, this.y2 * sy); }
}

/**
 * The club detector's pre- and post-processing (plan 2026-10-16 §3.4), ported from
 * tools/swing-lab/export_tflite.py `decode_nms` (= YOLOX `postprocess`). The graph already
 * decodes and sigmoids: ROWS × COLS floats per frame = cx, cy, w, h, obj, shaft, head, hands
 * in 640-px model units; NMS is ours.
 */
export const ClubDecode = {
  SHAFT: 0,
  HEAD: 1,
  HANDS: 2,
  NAMES: ['shaft', 'head', 'hands'],

  /** Model input side: the frame is stretched (not letterboxed) to SIZE × SIZE, like cv2.resize in training. */
  SIZE: 640,
  ROWS: 8400,
  COLS: 8,
  CONF: 0.03,
  NMS_IOU: 0.45,

  /**
   * Boxes of one raw output (a flat Float32Array, ROWS × COLS): x1 = cx − w/2 …, cls = argmax,
   * score = obj × max class, kept at score ≥ `conf`; greedy NMS per class at `nmsIou`
   * (torchvision batched_nms: class-wise, not agnostic). Sorted by score, highest first.
   */
  boxes(raw, n = ClubDecode.ROWS, conf = ClubDecode.CONF, nmsIou = ClubDecode.NMS_IOU) {
    const { COLS, NAMES } = ClubDecode;
    const byClass = NAMES.map(() => []);
    for (let i = 0; i < n; i += 1) {
      const o = i * COLS;
      let cls = 0;
      for (let c = 1; c < NAMES.length; c += 1) if (raw[o + 5 + c] > raw[o + 5 + cls]) cls = c;
      const score = raw[o + 4] * raw[o + 5 + cls];
      if (score < conf) continue;
      const cx = raw[o];
      const cy = raw[o + 1];
      const w = raw[o + 2];
      const h = raw[o + 3];
      byClass[cls].push(new ClubBox(cls, score, cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2));
    }
    const out = [];
    for (const rows of byClass) {
      const sorted = byScoreDesc(rows); // stable: ties keep row order, like the lab
      const alive = sorted.map(() => true);
      for (let i = 0; i < sorted.length; i += 1) {
        if (!alive[i]) continue;
        const a = sorted[i];
        out.push(a);
        const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
        for (let j = i + 1; j < sorted.length; j += 1) {
          if (!alive[j]) continue;
          const b = sorted[j];
          const inter = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
          const union = areaA + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
          if (inter / Math.max(union, 1e-12) > nmsIou) alive[j] = false;
        }
      }
    }
    return byScoreDesc(out);
  },

  /** IoU without the +1 pixel (eval_yolo.py `iou`); 0 for empty boxes. */
  iou(a, b) {
    const inter = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
    const union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
    return union > 0 ? inter / union : 0;
  },

  /**
   * The model input from `rgb` (SIZE × SIZE × 3 bytes, R, G, B; a Uint8Array) into `dst` (a
   * Float32Array of SIZE × SIZE × 3): floats 0–255 in **B, G, R** order (the lab feeds OpenCV's
   * BGR), no normalisation; NHWC, or NCHW when `nchw` (read from the input tensor's shape, plan §3.2).
   */
  fill(rgb, dst, nchw) {
    const px = ClubDecode.SIZE * ClubDecode.SIZE;
    let q = 0;
    if (nchw) {
      for (let c = 0; c < 3; c += 1) {
        const k = 2 - c;
        for (let p = 0; p < px; p += 1) dst[q++] = rgb[3 * p + k] & 0xff;
      }
    } else {
      for (let p = 0; p < px; p += 1) {
        const o = 3 * p;
        dst[q++] = rgb[o + 2] & 0xff;
        dst[q++] = rgb[o + 1] & 0xff;
        dst[q++] = rgb[o] & 0xff;
      }
    }
  },
};

/** Kotlin `sortedByDescending { it.score }`: a stable copy. */
export const byScoreDesc = (boxes) => [...boxes].sort((a, b) => (a.score < b.score ? 1 : a.score > b.score ? -1 : 0));
