// detectClub, ported from modules/golf-swing ClubOnDemand.kt. Reading the still and running the
// detector are injected: `loadStill(uri)` and the model the ClubWarm opens.

import { pt } from './geom';
import { ClubBox, ClubDecode } from './clubDecode';
import { ClubRules } from './clubRules';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * detectClub (plan 2026-10-16 on demand §3.1): the learned detector on the still JPEGs of frames
 * the golfer chose, through the warm instance of a ClubWarm. Per frame: still → 640 × 640 RGB →
 * boxes → display px → ClubRules.dropScenery → ClubRules.frameEntry (the 150 cm rule from the
 * grip, head or shaft corner). A frame that fails (no still, a bad JPEG, an interpreter error)
 * gets an entry with `error` and no head; only a detector that cannot open (no runtime, no model)
 * throws, which the bridge turns into ERR_CLUB.
 *
 * A request (ClubDemand): `{ frames: [{ frame, still, grip: {x, y} normalised | null }], width,
 * height, pxPerCm | null, scenery: ClubBox[] }`; `width` × `height` = the video's display size,
 * the px space of the answer (like pass 2); `scenery` = `pass2.club.scenery` in that space, empty
 * for swings analysed before apiVersion 5.
 *
 * The model (ClubModel): `{ delegate: 'gpu' | 'cpu' | …, detect(rgb) → ClubBox[] | Promise,
 * close() }`, boxes of one SIZE × SIZE RGB frame in 640-px model units.
 */
export const ClubOnDemand = {
  /**
   * `{ frames: { [frame]: entry }, timings: { openMs, inferMs, decodeMs, delegate, warm } }`.
   * `decode(uri)` → `{ rgb, width, height }` (or a promise of it): the still as the model's
   * input, SIZE × SIZE × 3 bytes R, G, B, and the still's own size. `clock` → ms.
   */
  async run(req, warm, decode, clock = now) {
    const t0 = clock();
    return warm.use(async (d, wasWarm) => {
      const openMs = clock() - t0;
      let inferMs = 0;
      let decodeMs = 0;
      const frames = {};
      for (const f of req.frames) {
        try {
          let t = clock();
          const s = await decode(f.still);
          decodeMs += clock() - t;
          t = clock();
          const boxes = await d.detect(s.rgb);
          inferMs += clock() - t;
          // the boxes cover the whole still, which covers the whole frame: 640 units → display px
          const w = req.width > 0 ? req.width : s.width;
          const h = req.height > 0 ? req.height : s.height;
          const grip = f.grip != null ? pt(Math.fround(f.grip.x * w), Math.fround(f.grip.y * h)) : null;
          frames[String(f.frame)] = ClubOnDemand.entry(boxes, w / ClubDecode.SIZE, h / ClubDecode.SIZE, grip, req.pxPerCm, req.scenery);
        } catch (e) {
          frames[String(f.frame)] = ClubOnDemand.failed(e?.message ?? String(e));
        }
      }
      const timings = {
        openMs: Math.trunc(openMs), inferMs: Math.trunc(inferMs), decodeMs: Math.trunc(decodeMs), delegate: d.delegate, warm: wasWarm,
      };
      return { frames, timings };
    });
  },

  /** One frame's entry from its 640-unit boxes: scaled by (`sx`, `sy`) to display px, scenery dropped, then pass 2's rules. */
  entry(boxes640, sx, sy, grip, pxPerCm, scenery) {
    return ClubRules.frameEntry(ClubRules.dropScenery(boxes640.map((b) => b.scaled(sx, sy)), scenery), grip, pxPerCm);
  },

  /** A frame that could not be read or inferred: no head, no boxes, the reason. */
  failed(message) {
    return { head: null, hidden: false, conf: null, source: null, boxes: [], error: message };
  },

  /** `{ cls, box: [x1, y1, x2, y2] }` from the JS (pass2.club.scenery) as a box; null when malformed. */
  sceneryBox(cls, box, score) {
    const c = ClubDecode.NAMES.indexOf(cls);
    if (c < 0 || box.length < 4 || box.slice(0, 4).some((v) => !Number.isFinite(v))) return null;
    return new ClubBox(c, score != null && Number.isFinite(score) ? score : 0, box[0], box[1], box[2], box[3]);
  },
};
