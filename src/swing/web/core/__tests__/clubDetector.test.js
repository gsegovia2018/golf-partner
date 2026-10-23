// Port of the pure parts of modules/golf-swing ClubDetectorTest.kt: decode + NMS against the lab's
// golden fixtures (written by tools/swing-lab/export_tflite.py from the TFLite model's own raw
// output), the input tensor layout, the post-rules and detectClub with a fake detector.

import fs from 'fs';
import path from 'path';
import { pt } from '../geom';
import { ClubBox, ClubDecode } from '../clubDecode';
import { ClubRules } from '../clubRules';
import { ClubOnDemand } from '../clubOnDemand';
import { ClubWarm } from '../framePlan';

const FIXTURES = path.join(__dirname, '../../../../../modules/golf-swing/android/src/test/resources/club');
const clips = ['marcos-2026-10-10-556', 'swing-2026-10-13-88125330-557', 'swing-2026-10-14-b5e60f31-650'];

const bytes = (name) => fs.readFileSync(path.join(FIXTURES, name));

function raw(clip) {
  const b = bytes(`${clip}.raw.bin`);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = new Float32Array(b.byteLength / 4);
  for (let i = 0; i < out.length; i += 1) out[i] = dv.getFloat32(4 * i, true);
  return out;
}

const json = (clip) => JSON.parse(bytes(`${clip}.boxes.json`).toString('utf8'));
const expected = (clip, array) => json(clip)[array].map((b) => new ClubBox(b.cls, b.score, b.x1, b.y1, b.x2, b.y2));

function expectBoxes(want, got) {
  expect(got.length).toBe(want.length);
  want.forEach((w, i) => {
    const g = got[i];
    expect(g.cls).toBe(w.cls);
    expect(Math.abs(g.score - w.score)).toBeLessThanOrEqual(1e-3);
    expect(Math.abs(g.x1 - w.x1)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(g.y1 - w.y1)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(g.x2 - w.x2)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(g.y2 - w.y2)).toBeLessThanOrEqual(0.5);
  });
}

describe('ClubDecode', () => {
  test.each(clips)('decode and NMS match the lab on the golden frame %s', (clip) => {
    const r = raw(clip);
    expect(r.length).toBe(ClubDecode.ROWS * ClubDecode.COLS);
    const got = ClubDecode.boxes(r);
    expectBoxes(expected(clip, 'boxes640'), got);
    // display px: x by frameW / 640, y by frameH / 640 (what Checkpoints hands to the rules)
    const sx = json(clip).frameW / 640;
    const sy = json(clip).frameH / 640;
    expectBoxes(expected(clip, 'boxesDisplay'), got.map((b) => b.scaled(sx, sy)));
  });

  test('NMS is per class and keeps the best of an overlap', () => {
    const row = (cx, cy, w, h, obj, shaft, head, hands) => [cx, cy, w, h, obj, shaft, head, hands];
    const rawRows = Float32Array.from([
      ...row(100, 100, 20, 20, 0.9, 0.1, 0.9, 0.1), // head 0.81
      ...row(102, 100, 20, 20, 0.8, 0.1, 0.8, 0.1), // head 0.64, IoU 0.82: suppressed
      ...row(101, 100, 20, 20, 0.7, 0.9, 0.1, 0.1), // shaft 0.63 on the same spot: another class, kept
      ...row(300, 300, 20, 20, 0.1, 0.1, 0.2, 0.1), // head 0.02 < 0.03: dropped
    ]);
    const b = ClubDecode.boxes(rawRows, 4);
    expect(b.map((x) => x.cls)).toEqual([ClubDecode.HEAD, ClubDecode.SHAFT]);
    expect(b[0].score).toBeCloseTo(0.81, 6);
    expect(b[0].x1).toBeCloseTo(90, 6);
    expect(b[0].y2).toBeCloseTo(110, 6);
  });

  test("the input tensor is the lab's BGR bytes as floats", () => {
    // input.bin is the uint8 HWC BGR tensor the lab fed; the RGB still gives R, G, B
    const bgr = bytes(`${clips[0]}.input.bin`);
    const px = ClubDecode.SIZE * ClubDecode.SIZE;
    expect(bgr.length).toBe(px * 3);
    const rgb = new Uint8Array(bgr.length);
    for (let p = 0; p < px; p += 1) {
      rgb[3 * p] = bgr[3 * p + 2];
      rgb[3 * p + 1] = bgr[3 * p + 1];
      rgb[3 * p + 2] = bgr[3 * p];
    }
    const nhwc = new Float32Array(px * 3);
    ClubDecode.fill(rgb, nhwc, false);
    for (let i = 0; i < bgr.length; i += 997) expect(nhwc[i]).toBe(bgr[i]);
    const nchw = new Float32Array(px * 3);
    ClubDecode.fill(rgb, nchw, true);
    for (let p = 0; p < px; p += 991) for (let c = 0; c < 3; c += 1) expect(nchw[c * px + p]).toBe(bgr[3 * p + c]);
  });
});

// --- post-rules -----------------------------------------------------------------------------

/** The 13 pass-2 checkpoints at frames 100, 110, … (runAnalysis.js PASS2_KEYS order). */
const keys = [
  'address', 'takeaway', 'leadArm', 'top', 'transition', 'shaftDown', 'impact', 'shaftThrough', 'trailArm', 'finish',
  'lateBackswing', 'preImpact', 'postImpact',
];
const frameOf = new Map(keys.map((k, i) => [k, 100 + 10 * i]));
const places = new Map(keys.map((k) => [frameOf.get(k), ClubRules.place(k)]));
const frames = [...frameOf.values()];

const box = (cls, x, y, half = 10, score = 0.5) => new ClubBox(cls, score, x - half, y - half, x + half, y + half);
const associateWith = (list, fn) => new Map(list.map((f) => [f, fn(f)]));
const total = (m) => [...m.values()].reduce((s, r) => s + r.length, 0);

describe('ClubRules', () => {
  test('thirteen checkpoints are eleven places', () => {
    expect(new Set(places.values()).size).toBe(11);
    expect(ClubRules.place('preImpact')).toBe('impact');
    expect(ClubRules.place('postImpact')).toBe('impact');
    expect(ClubRules.place('top')).toBe('top');
  });

  test('a box that holds its place at four of eleven places is scenery', () => {
    const spare = box(ClubDecode.HEAD, 50, 800);
    const at = new Set(['takeaway', 'top', 'shaftDown', 'finish'].map((k) => frameOf.get(k)));
    const dets = associateWith(frames, (f) => (at.has(f) ? [spare] : []));
    const kept = ClubRules.dropStatic(dets, places);
    expect([...kept.values()].every((r) => r.length === 0)).toBe(true);
    // at three places it is still a candidate (3 < 0.3 × 11)
    const three = associateWith(frames, (f) => (at.has(f) && f !== frameOf.get('finish') ? [spare] : []));
    expect(total(ClubRules.dropStatic(three, places))).toBe(3);
  });

  test('the swung head still at address and impact is kept because the impact trio is one place', () => {
    const head = box(ClubDecode.HEAD, 400, 900);
    const still = new Set(['address', 'preImpact', 'impact', 'postImpact'].map((k) => frameOf.get(k)));
    const dets = associateWith(frames, (f) => (still.has(f) ? [head] : []));
    expect(total(ClubRules.dropStatic(dets, places))).toBe(4);
    // counted per frame (4 of 13 = 31 %) the same head would have been dropped
    const perFrame = associateWith(frames, (f) => String(f));
    expect(total(ClubRules.dropStatic(dets, perFrame))).toBe(0);
  });

  test('hands boxes are never dropped and other classes do not vote', () => {
    const hands = box(ClubDecode.HANDS, 300, 500);
    const shaft = box(ClubDecode.SHAFT, 300, 500);
    const dets = associateWith(frames, () => [hands]);
    dets.set(frameOf.get('top'), [hands, shaft]);
    const kept = ClubRules.dropStatic(dets, places);
    expect([...kept.values()].reduce((s, r) => s + r.filter((b) => b.cls === ClubDecode.HANDS).length, 0)).toBe(13);
    expect([...kept.values()].reduce((s, r) => s + r.filter((b) => b.cls === ClubDecode.SHAFT).length, 0)).toBe(1);
  });

  test('a head box beyond 150 cm of the grip is ignored', () => {
    const grip = pt(500, 500);
    const pxPerCm = 2.0; // 150 cm = 300 px
    const near = box(ClubDecode.HEAD, 500, 790, 10, 0.3);
    const far = box(ClubDecode.HEAD, 500, 810, 10, 0.9);
    const h = ClubRules.head([far, near], grip, pxPerCm);
    expect(h.source).toBe('model');
    expect(h.y).toBeCloseTo(790, 9);
    expect(h.score).toBeCloseTo(0.3, 9);
    // only the far one: no head, and no shaft box to fall back on
    expect(ClubRules.head([far], grip, pxPerCm)).toBeNull();
    // without a scale the rule cannot apply
    expect(ClubRules.head([far, near], grip, null).y).toBeCloseTo(810, 9);
  });

  test('no head box falls back to the shaft corner farthest from the grip', () => {
    const shaft = new ClubBox(ClubDecode.SHAFT, 0.7, 300, 400, 360, 600);
    const weak = new ClubBox(ClubDecode.SHAFT, 0.2, 0, 0, 20, 20);
    const fromTopLeft = ClubRules.head([weak, shaft], pt(305, 405), 2.0);
    expect(fromTopLeft.source).toBe('model-shaft');
    expect([fromTopLeft.x, fromTopLeft.y]).toEqual([360, 600]);
    expect(fromTopLeft.score).toBeCloseTo(0.7, 9);
    // a left-hander's (or a mirrored) shaft: grip at the top right, head at the bottom left
    const fromTopRight = ClubRules.head([shaft], pt(358, 402), 2.0);
    expect([fromTopRight.x, fromTopRight.y]).toEqual([300, 600]);
  });

  test('without a pose grip the hands box is the anchor', () => {
    const shaft = new ClubBox(ClubDecode.SHAFT, 0.7, 300, 400, 360, 600);
    const hands = box(ClubDecode.HANDS, 355, 405); // the grip at the top right
    const h = ClubRules.head([shaft, hands], null, 2.0);
    expect([h.x, h.y]).toEqual([300, 600]);
    // the hands box also anchors the 150 cm rule
    const far = box(ClubDecode.HEAD, 355, 800);
    expect(ClubRules.head([far, shaft, hands], null, 2.0).source).toBe('model-shaft');
    // no anchor at all: a head box is still a head (no distance rule), a shaft corner cannot be chosen
    expect(ClubRules.head([far], null, 2.0).source).toBe('model');
    expect(ClubRules.head([shaft], null, 2.0)).toBeNull();
  });
});

// --- entries --------------------------------------------------------------------------------

const prior = {
  head: null, hidden: false, conf: 0.1, source: 'prior',
};
const edge = {
  head: [410, 905], hidden: false, conf: 0.6, source: 'edge', angleDeg: 80, lengthPx: 200,
};
const base = {
  100: edge, 110: prior, 160: edge, 170: prior,
};
const without = (o, k) => { const c = { ...o }; delete c[k]; return c; };

describe('ClubRules.merge', () => {
  test('a detector that did not run leaves the entries as today', () => {
    expect(ClubRules.merge(base, null, new Map(), 2.0)).toBe(base);
  });

  test('best source first: model, then shaft corner, then edge, then prior', () => {
    const head = box(ClubDecode.HEAD, 400, 900, 10, 0.0456);
    const shaft = new ClubBox(ClubDecode.SHAFT, 0.7, 300, 400, 360, 600);
    const hands = box(ClubDecode.HANDS, 305, 405);
    const grip = pt(305, 405);
    const dets = new Map([[100, [hands]], [110, [shaft]], [160, [head]], [170, []]]);
    const grips = associateWith([...dets.keys()], () => grip);
    grips.set(160, pt(400, 700)); // impact: the head 100 cm below the grip
    const out = ClubRules.merge(base, dets, grips, 2.0);
    expect(Object.keys(out)).toEqual(['100', '110', '160', '170']);
    // address: nothing but hands → today's edge entry, plus the boxes
    expect(without(out['100'], 'boxes')).toEqual(edge);
    expect(out['100'].boxes).toEqual([{ cls: 'hands', score: 0.5, box: [295, 395, 315, 415] }]);
    // a shaft box alone: its far corner
    expect(out['110'].source).toBe('model-shaft');
    expect(out['110'].head).toEqual([360, 600]);
    // a head box beats the edge heuristic; conf is the detector's score
    const imp = out['160'];
    expect(imp.source).toBe('model');
    expect(imp.head).toEqual([400, 900]);
    expect(imp.hidden).toBe(false);
    expect(imp.conf).toBe(0.046);
    expect(imp.angleDeg).toBeUndefined();
    // the detector ran and found nothing: prior, with an empty box list
    expect(out['170']).toEqual({ ...prior, boxes: [] });
    expect(out['170'].boxes).not.toBeNull();
  });

  test('at most ten boxes per frame, most confident first', () => {
    const many = Array.from({ length: 14 }, (_, i) => box(ClubDecode.HANDS, 100 * i, 100, 10, 0.9 - 0.05 * i));
    const out = ClubRules.merge(base, new Map([[170, many]]), new Map(), null);
    const shown = out['170'].boxes;
    expect(shown.length).toBe(ClubRules.MAX_BOXES);
    expect(shown[0].score).toBe(0.9);
  });

  test('pass 2 still merges through the shared frame entry', () => {
    const head = box(ClubDecode.HEAD, 400, 900, 10, 0.5);
    const out = ClubRules.merge(base, new Map([[160, [head]]]), new Map([[160, pt(400, 700)]]), 2.0);
    expect(out['160']).toEqual(ClubRules.frameEntry([head], pt(400, 700), 2.0));
  });
});

// --- scenery (on demand, plan 2026-10-16 on demand §3.2) -------------------------------------

describe('scenery', () => {
  test('splitStatic returns exactly what dropStatic removes', () => {
    const spare = box(ClubDecode.HEAD, 50, 800, 10, 0.4);
    const pole = box(ClubDecode.SHAFT, 900, 300, 40, 0.6);
    const head = box(ClubDecode.HEAD, 400, 900, 10, 0.7);
    const hands = box(ClubDecode.HANDS, 50, 800);
    const dets = associateWith(frames, (f) => [spare, pole, hands, ...(f === frameOf.get('impact') ? [head] : [])]);
    const [kept, dropped] = ClubRules.splitStatic(dets, places);
    expect(kept).toEqual(ClubRules.dropStatic(dets, places));
    expect(new Set(dropped.keys())).toEqual(new Set(dets.keys()));
    for (const f of dets.keys()) {
      expect(new Set([...kept.get(f), ...dropped.get(f)])).toEqual(new Set(dets.get(f)));
      expect(dropped.get(f)).toEqual([spare, pole]);
    }
    expect(new Set(kept.get(frameOf.get('impact')))).toEqual(new Set([head, hands]));
    // nothing votes: everything kept, nothing dropped
    const [k0, d0] = ClubRules.splitStatic(dets, new Map());
    expect(k0).toBe(dets);
    expect([...d0.values()].every((r) => r.length === 0)).toBe(true);
  });

  test('scenery clusters same-class overlaps into the best score, ignores hands and caps at twenty', () => {
    const a1 = box(ClubDecode.HEAD, 50, 800, 10, 0.3);
    const a2 = box(ClubDecode.HEAD, 52, 801, 10, 0.5); // IoU ≈ 0.75 with a1: the same spare club
    const a3 = box(ClubDecode.SHAFT, 51, 800, 10, 0.9); // same place, another class: its own entry
    const far = box(ClubDecode.HEAD, 60, 800, 10, 0.2); // IoU 0.33: another thing
    const hands = box(ClubDecode.HANDS, 50, 800, 10, 0.99);
    const s = ClubRules.scenery([a1, a3, a2, far, hands]);
    expect(s).toEqual([a3, a2, far]);
    expect(s[0]).toBe(a3);
    const many = Array.from({ length: 30 }, (_, i) => box(ClubDecode.SHAFT, 100 * i, 100, 10, 0.01 * i));
    const capped = ClubRules.scenery(many);
    expect(capped.length).toBe(ClubRules.MAX_SCENERY);
    expect(capped[0].score).toBeCloseTo(0.29, 9);
    expect(ClubRules.scenery([])).toEqual([]);
  });

  test('dropScenery drops a same-class match, keeps other classes and hands, then head finds the swung one', () => {
    const spare = box(ClubDecode.HEAD, 50, 800);
    const scenery = [spare, box(ClubDecode.HANDS, 400, 500)];
    const spareHere = box(ClubDecode.HEAD, 53, 801, 10, 0.9); // IoU ≈ 0.68 with the stored spare
    const edgeCase = new ClubBox(ClubDecode.HEAD, 0.8, 40, 790, 60, 810 + 20 / 3); // IoU exactly 0.75 ≥ 0.5 too
    const shaftHere = box(ClubDecode.SHAFT, 50, 800); // same place, other class
    const hands = box(ClubDecode.HANDS, 400, 500);
    const swung = box(ClubDecode.HEAD, 420, 760, 10, 0.2);
    const kept = ClubRules.dropScenery([spareHere, edgeCase, shaftHere, hands, swung], scenery);
    expect(kept).toEqual([shaftHere, hands, swung]);
    // IoU just under 0.5 survives
    const half = box(ClubDecode.HEAD, 50 + 20 / 3 + 0.1, 800); // IoU < 0.5
    expect(ClubDecode.iou(half, spare)).toBeLessThan(0.5);
    expect(ClubRules.dropScenery([half], scenery)).toEqual([half]);
    // the head is the swung one, not the (more confident) spare club
    const grip = pt(400, 500);
    expect(ClubRules.head([spareHere, swung], grip, null).x).toBeCloseTo(53, 9); // unfiltered: the spare club
    const h = ClubRules.head(kept, grip, 2.0);
    expect([h.x, h.y]).toEqual([420, 760]);
    // no scenery: the same list back
    const all = [spareHere, swung];
    expect(ClubRules.dropScenery(all, [])).toBe(all);
  });
});

// --- on demand entries --------------------------------------------------------------------

describe('ClubOnDemand', () => {
  test('an on-demand entry is in display px with scenery dropped and the same shape as pass 2', () => {
    // 1080 × 1920 portrait: 640 units → x × 1.6875, y × 3
    const sx = 1080 / 640;
    const sy = 1920 / 640;
    const head640 = new ClubBox(ClubDecode.HEAD, 0.61234, 300, 300, 310, 310); // centre (305, 305) → (514.6875, 915)
    const spare640 = new ClubBox(ClubDecode.HEAD, 0.9, 20, 260, 30, 270);
    const spareDisp = spare640.scaled(sx, sy);
    const e = ClubOnDemand.entry([spare640, head640], sx, sy, pt(540, 700), 2.0, [spareDisp]);
    expect(new Set(Object.keys(e))).toEqual(new Set(['head', 'hidden', 'conf', 'source', 'boxes']));
    expect(e.source).toBe('model');
    expect(e.hidden).toBe(false);
    expect(e.conf).toBe(0.612);
    expect(e.head[0]).toBeCloseTo(305 * sx, 9);
    expect(e.head[1]).toBeCloseTo(305 * sy, 9);
    expect(e.boxes.length).toBe(1);
    expect(e.boxes[0].cls).toBe('head');
    expect(e.boxes[0].box).toEqual([300 * sx, 300 * sy, 310 * sx, 310 * sy]);
    // without the scenery the more confident spare club wins (swings analysed before apiVersion 5)
    const unfiltered = ClubOnDemand.entry([spare640, head640], sx, sy, pt(540, 700), null, []);
    expect(unfiltered.head[0]).toBeCloseTo(25 * sx, 9);
    // nothing found: no head, null source and conf, the boxes still there
    const none = ClubOnDemand.entry([new ClubBox(ClubDecode.HANDS, 0.5, 0, 0, 10, 10)], sx, sy, null, null, []);
    expect(without(none, 'boxes')).toEqual({
      head: null, hidden: false, conf: null, source: null,
    });
    expect(none.boxes.length).toBe(1);
    // a pass-2 entry from the same boxes is the same map
    expect(ClubOnDemand.entry([head640], sx, sy, pt(540, 700), 2.0, [])).toEqual(ClubRules.frameEntry([head640.scaled(sx, sy)], pt(540, 700), 2.0));
  });

  test('scenery from the JS is parsed and malformed ones are skipped', () => {
    expect(ClubOnDemand.sceneryBox('shaft', [1, 2, 3, 4], 0.4)).toEqual(new ClubBox(ClubDecode.SHAFT, 0.4, 1, 2, 3, 4));
    expect(ClubOnDemand.sceneryBox('head', [1, 2, 3, 4], null).score).toBe(0);
    expect(ClubOnDemand.sceneryBox('ball', [1, 2, 3, 4], 0.4)).toBeNull();
    expect(ClubOnDemand.sceneryBox('head', [1, 2, 3], 0.4)).toBeNull();
    expect(ClubOnDemand.sceneryBox('head', [1, NaN, 3, 4], 0.4)).toBeNull();
  });

  class FakeModel {
    constructor(boxes) {
      this.boxes = boxes;
      this.delegate = 'gpu';
      this.closed = false;
    }

    detect(rgb) { return this.boxes(rgb); }

    close() { this.closed = true; }
  }

  const noIdle = { schedule: () => () => {} };

  test('detectClub answers per frame; a failed frame carries its error and the others still answer', async () => {
    let opens = 0;
    const warm = new ClubWarm(() => {
      opens += 1;
      return new FakeModel((rgb) => {
        if (rgb[0] === 1) throw new Error('interpreter');
        return [new ClubBox(ClubDecode.HEAD, 0.5, 300, 300, 310, 310)];
      });
    }, noIdle);
    const stills = {
      'file:///s/10.jpg': { rgb: new Uint8Array(3).fill(0), width: 540, height: 960 }, // a decimated still: its size does not matter
      'file:///s/11.jpg': { rgb: new Uint8Array(3).fill(1), width: 1080, height: 1920 },
    };
    const req = {
      frames: [
        { frame: 10, still: 'file:///s/10.jpg', grip: pt(0.5, 0.4) },
        { frame: 11, still: 'file:///s/11.jpg', grip: null },
        { frame: 12, still: 'file:///s/12.jpg', grip: null },
      ],
      width: 1080,
      height: 1920,
      pxPerCm: 2.0,
      scenery: [],
    };
    let now = 0;
    const decode = async (uri) => {
      if (!stills[uri]) throw new Error(`no still at ${uri}`);
      return stills[uri];
    };
    const out = await ClubOnDemand.run(req, warm, decode, () => { now += 5; return now; });
    expect(new Set(Object.keys(out))).toEqual(new Set(['frames', 'timings']));
    const fr = out.frames;
    expect(Object.keys(fr)).toEqual(['10', '11', '12']);
    expect(fr['10'].source).toBe('model');
    expect(fr['10'].head).toEqual([(305 * 1080) / 640, (305 * 1920) / 640]);
    expect(fr['10'].error).toBeUndefined();
    for (const [k, why] of [['11', 'interpreter'], ['12', 'no still at file:///s/12.jpg']]) {
      const e = fr[k];
      expect(e.error).toBe(why);
      expect(e.head).toBeNull();
      expect(e.source).toBeNull();
      expect(e.hidden).toBe(false);
      expect(e.boxes).toEqual([]);
    }
    const t = out.timings;
    expect(new Set(Object.keys(t))).toEqual(new Set(['openMs', 'inferMs', 'decodeMs', 'delegate', 'warm']));
    expect(t.delegate).toBe('gpu');
    expect(t.warm).toBe(false);
    // the second call: warm, nothing opened again; frames [] only warms
    const again = await ClubOnDemand.run({
      frames: [], width: 1, height: 1, pxPerCm: null, scenery: [],
    }, warm, () => { throw new Error('unused'); }, () => 0);
    expect(again.frames).toEqual({});
    expect(again.timings.warm).toBe(true);
    expect(opens).toBe(1);
  });

  test('a detector that cannot open throws once and leaves nothing open', async () => {
    const warm = new ClubWarm(() => { throw new Error('no libtensorflowlite_jni'); }, noIdle);
    const req = {
      frames: [{ frame: 1, still: 'x', grip: null }], width: 10, height: 10, pxPerCm: null, scenery: [],
    };
    await expect(ClubOnDemand.run(req, warm, () => { throw new Error('unused'); }, () => 0)).rejects.toThrow('no libtensorflowlite_jni');
    expect(warm.isOpen).toBe(false);
  });
});
