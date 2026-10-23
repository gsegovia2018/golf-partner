// Port of the Grip / Probe parts of GripAndFrameTest.kt (the YuvFrame tests are the decoder's).

import {
  Grip, Lm, PoseSample, pt,
} from '../geom';
import { Probe } from '../probe';

function sample(frame, lWr, lEl, lVis, rWr, rEl, rVis) {
  const lm = Float32Array.from({ length: Lm.COUNT * 3 }, (_, i) => (i % 3 === 2 ? 1 : 0));
  const set = (j, p, v) => {
    lm[3 * j] = p.x;
    lm[3 * j + 1] = p.y;
    lm[3 * j + 2] = v;
  };
  set(Lm.L_WR, lWr, lVis);
  set(Lm.L_EL, lEl, 1);
  set(Lm.R_WR, rWr, rVis);
  set(Lm.R_EL, rEl, 1);
  return new PoseSample(frame, 0, lm);
}

describe('Grip', () => {
  it('is the wrist plus 0.35 forearm', () => {
    const s = sample(0, pt(100, 200), pt(100, 100), 1, pt(120, 200), pt(120, 100), 1);
    const g = Grip.point(s);
    expect(g.x).toBeCloseTo(110, 4);
    expect(g.y).toBeCloseTo(235, 4);
  });

  it('drops a hidden wrist when the other is visible', () => {
    const s = sample(0, pt(100, 200), pt(100, 100), 0.2, pt(140, 200), pt(140, 100), 0.9);
    expect(Grip.point(s).x).toBeCloseTo(140, 4);
  });

  it('rejects a jump of a hidden wrist in the gated series and interpolates', () => {
    const ok = (f) => sample(f, pt(100, 200), pt(100, 100), 0.3, pt(100, 200), pt(100, 100), 0.3);
    // frame 1: both wrists hidden and 200 px away (> 1.5 forearm): rejected, interpolated
    const bad = sample(1, pt(300, 200), pt(300, 100), 0.2, pt(300, 200), pt(300, 100), 0.2);
    const g = Grip.gatedSeries([ok(0), bad, ok(2)]);
    expect(g[1].x).toBeCloseTo(100, 4);
    expect(g[1].y).toBeCloseTo(235, 4);
  });
});

describe('Probe.duplicateRatio', () => {
  it('spots frame doubling', () => {
    const doubled = Float32Array.from({ length: 80 }, (_, i) => (i % 2 === 0 ? 6 : 0.1));
    expect(Probe.duplicateRatio(doubled)).toBeCloseTo(0.5, 9);
    expect(Probe.duplicateRatio(Float32Array.from({ length: 80 }, (_, i) => 5 + (i % 3)))).toBeCloseTo(0.0, 9);
    expect(Probe.duplicateRatio(Float32Array.from({ length: 80 }, () => 0.1))).toBeCloseTo(0.0, 9);
  });

  it('averages absolute differences', () => {
    expect(Probe.meanAbsDiff([1, 2, 3], [2, 2, 1])).toBeCloseTo(1, 9);
  });
});
