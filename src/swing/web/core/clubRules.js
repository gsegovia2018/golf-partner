// Post-rules on the club detector's boxes, ported from modules/golf-swing ClubRules.kt.

import { ClubDecode, byScoreDesc } from './clubDecode';

/** The clubhead one frame's boxes propose: `source` 'model' (head box centre) or 'model-shaft' (shaft-box corner). */
export const clubHead = (x, y, source, score) => ({ x, y, source, score });

const round3 = (v) => Math.round(v * 1000) / 1000;

/** The most confident box of `cls` (the first on a tie, like Python's max). */
function best(boxes, cls) {
  let b = null;
  for (const r of boxes) if (r.cls === cls && (b == null || r.score > b.score)) b = r;
  return b;
}

const mapValues = (m, fn) => new Map([...m].map(([k, v]) => [k, fn(v, k)]));

/**
 * Post-rules on the detector's boxes (plan 2026-10-16 §4.1, §4.2.3), ported from
 * tools/swing-lab/eval_yolo.py `drop_static` (`--frames checkpoints`) and `head_track` (with the
 * pose grip as the anchor). Display px throughout. Frame-keyed inputs are `Map`s with number keys.
 */
export const ClubRules = {
  /**
   * A box present at ≥ this share of the checkpoint places is scenery (a spare club, a pole). 0.3,
   * not the lab's dense 0.5: on the 11 places L1 found 0.5 left part of a spare club on one clip,
   * 0.3 drops it and no true head (the swung head holds 2 places: address, impact).
   */
  STATIC_FRAC: 0.3,
  STATIC_IOU: 0.5,
  /** A head box farther than this from the grip is impossible (the shaft is ~105 cm). */
  MAX_HEAD_CM: 150,
  /** Boxes per frame in the pass-2 output (most confident first). */
  MAX_BOXES: 10,
  /** Scenery representatives stored per swing (`pass2.club.scenery`). */
  MAX_SCENERY: 20,

  /** The place a checkpoint votes for: the head sits still around impact, so preImpact / impact / postImpact are one. */
  place(key) {
    return key === 'preImpact' || key === 'postImpact' ? 'impact' : key;
  },

  /**
   * Drops scenery: a box whose place (same class, IoU ≥ `minIou`) is occupied at ≥ `frac` of the
   * distinct places is not the swung club. Only the frames in `places` (frame → place) vote;
   * `hands` boxes are never dropped.
   */
  dropStatic(dets, places, frac = ClubRules.STATIC_FRAC, minIou = ClubRules.STATIC_IOU) {
    return ClubRules.splitStatic(dets, places, frac, minIou)[0];
  },

  /**
   * dropStatic that also returns what it removed: [kept, dropped], both frame → boxes, every
   * frame of `dets` in each (plan on demand §3.2: the dropped ones become `club.scenery`).
   */
  splitStatic(dets, places, frac = ClubRules.STATIC_FRAC, minIou = ClubRules.STATIC_IOU) {
    const ref = [...places].filter(([f]) => dets.has(f));
    const n = new Set(ref.map(([, p]) => p)).size;
    if (n === 0) return [dets, mapValues(dets, () => [])];
    const all = ref.flatMap(([f, p]) => dets.get(f).map((b) => [p, b]));
    const isStatic = (r) => new Set(all.filter(([, o]) => o.cls === r.cls && ClubDecode.iou(o, r) >= minIou).map(([p]) => p)).size >= frac * n;
    const split = mapValues(dets, (rows) => {
      const kept = [];
      const dropped = [];
      for (const b of rows) (b.cls === ClubDecode.HANDS || !isStatic(b) ? kept : dropped).push(b);
      return [kept, dropped];
    });
    return [mapValues(split, (v) => v[0]), mapValues(split, (v) => v[1])];
  },

  /**
   * The scenery one swing's static vote found, for frames that cannot vote (on demand §3.2): the
   * `dropped` boxes clustered (same class, IoU ≥ `minIou` with a kept representative → the same
   * thing; the highest score represents it), `hands` ignored, at most `max`, most confident first.
   */
  scenery(dropped, minIou = ClubRules.STATIC_IOU, max = ClubRules.MAX_SCENERY) {
    const reps = [];
    for (const b of byScoreDesc([...dropped].filter((x) => x.cls !== ClubDecode.HANDS))) {
      if (reps.length >= max) break;
      if (!reps.some((r) => r.cls === b.cls && ClubDecode.iou(r, b) >= minIou)) reps.push(b);
    }
    return reps;
  },

  /** One frame's boxes without those matching a `scenery` box (same class, IoU ≥ `minIou`); `hands` always kept. */
  dropScenery(boxes, scenery, minIou = ClubRules.STATIC_IOU) {
    if (!scenery.length) return boxes;
    return boxes.filter((b) => b.cls === ClubDecode.HANDS || !scenery.some((s) => s.cls === b.cls && ClubDecode.iou(s, b) >= minIou));
  },

  /**
   * The clubhead from one frame's (static-dropped) boxes. Anchor = the pose `grip` ({x, y}), else
   * the most confident `hands` box. With an anchor and `pxPerCm`, head boxes beyond MAX_HEAD_CM
   * are ignored. Head = centre of the most confident remaining `head` box; else the corner of the
   * most confident `shaft` box farthest from the anchor (the grip sits at the other end of its
   * diagonal); without an anchor no corner can be told from the grip, so none.
   */
  head(boxes, grip, pxPerCm) {
    let anchor = null;
    if (grip != null) anchor = [grip.x, grip.y];
    else {
      const h = best(boxes, ClubDecode.HANDS);
      if (h) anchor = [h.cx, h.cy];
    }
    const heads = boxes.filter((b) => b.cls === ClubDecode.HEAD
      && (anchor == null || pxPerCm == null || Math.hypot(b.cx - anchor[0], b.cy - anchor[1]) <= ClubRules.MAX_HEAD_CM * pxPerCm));
    const hb = best(heads, ClubDecode.HEAD);
    if (hb) return clubHead(hb.cx, hb.cy, 'model', hb.score);
    const s = best(boxes, ClubDecode.SHAFT);
    if (s == null || anchor == null) return null;
    const corners = [[s.x1, s.y1], [s.x2, s.y1], [s.x1, s.y2], [s.x2, s.y2]];
    let far = corners[0];
    for (const c of corners) {
      if (Math.hypot(c[0] - anchor[0], c[1] - anchor[1]) > Math.hypot(far[0] - anchor[0], far[1] - anchor[1])) far = c;
    }
    return clubHead(far[0], far[1], 'model-shaft', s.score);
  },

  /**
   * Pass-2 `shaft` entries (frame string → entry), best source first (§4.2.4): a model head, else a
   * shaft-box corner, else the `base` entry (today's `edge` at address / impact, `prior`
   * elsewhere). `dets` = frame → display-px boxes after dropStatic (a Map), null when the detector
   * did not run (a failure never fails pass 2): then `base` as it is. Every frame the detector ran
   * on carries its boxes (≤ MAX_BOXES) so the lab can re-score the phone without the phone.
   * `grips` = frame → the pose grip of that frame's checkpoint (a Map).
   */
  merge(base, dets, grips, pxPerCm) {
    if (dets == null) return base;
    const out = { ...base };
    for (const [f, boxes] of dets) {
      const k = String(f);
      const e = ClubRules.frameEntry(boxes, grips.get(f) ?? null, pxPerCm);
      if (e.source != null) out[k] = e;
      else if (out[k] != null) out[k] = { ...out[k], boxes: e.boxes };
    }
    return out;
  },

  /**
   * One frame's entry from its display-px boxes (pass 2's merge and on demand):
   * `{ head: [x, y] | null, hidden: false, conf, source: 'model' | 'model-shaft' | null, boxes }`;
   * conf and source are null when head finds nothing. `boxes` ≤ MAX_BOXES, as given.
   */
  frameEntry(boxes, grip, pxPerCm) {
    const h = ClubRules.head(boxes, grip, pxPerCm);
    return {
      head: h ? [h.x, h.y] : null,
      hidden: false,
      conf: h ? round3(h.score) : null,
      source: h ? h.source : null,
      boxes: ClubRules.boxJson(boxes.slice(0, ClubRules.MAX_BOXES)),
    };
  },

  /** `[{ cls: 'shaft' | 'head' | 'hands', score, box: [x1, y1, x2, y2] }]`: pass 2's `boxes` and `club.scenery`. */
  boxJson(boxes) {
    return boxes.map((b) => ({ cls: ClubDecode.NAMES[b.cls], score: round3(b.score), box: [b.x1, b.y1, b.x2, b.y2] }));
  },
};
