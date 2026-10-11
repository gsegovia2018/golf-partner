import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { runChecks, fitRect, videoToView, viewToVideo, mainFault, sideOfLine } from './checks.js';

const truthPath = new URL('./fixtures/seed-truth.json', import.meta.url);
const truth = existsSync(truthPath) ? JSON.parse(readFileSync(truthPath, 'utf8')) : null;
const input = (extra = {}) => ({ ...truth, cmPerPx: 0.5, video: { w: 478, h: 850 }, ...extra });
const byId = (r) => Object.fromEntries(r.checks.map((c) => [c.id, c]));

test('truth.json marks, no pose', { skip: !truth }, () => {
  const r = runChecks(input());
  const c = byId(r);
  assert.equal(c.hands_height_impact.status, 'red');
  assert.equal(Math.round(c.hands_height_impact.value), 10);
  assert.equal(c.shaft_angle_impact.status, 'yellow');
  assert.equal(Math.round(c.shaft_angle_impact.value), 8);
  assert.equal(c.butt_extension.status, 'yellow');
  assert.ok(c.butt_extension.value > 0);
  assert.equal(c.clubhead_vs_plane.status, 'green');
  assert.equal(c.tempo.status, 'yellow');
  assert.equal(c.hands_out_impact.status, 'yellow');
  for (const id of ['spine_loss', 'hip_drift', 'head_drift', 'posture_address', 'hands_between_planes']) {
    assert.equal(c[id].status, 'unknown', id);
    assert.equal(c[id].reason, 'nopose');
  }
  assert.equal(r.main.fault, 'early_extension');
});

test('hidden clubhead makes club checks unknown, never red', { skip: !truth }, () => {
  const t = structuredClone(truth);
  t.checkpoints.impact.hidden = true;
  const c = byId(runChecks(input(t)));
  assert.equal(c.clubhead_vs_plane.status, 'unknown');
  assert.equal(c.clubhead_vs_plane.reason, 'hidden');
  assert.equal(c.shaft_angle_impact.status, 'unknown');
});

test('pose checks: spine loss 32 -> 25 is red', () => {
  const lm = (sh, hip) => {
    const a = Array.from({ length: 33 }, () => [0, 0, 1]);
    a[11] = [sh[0] - 20, sh[1], 1]; a[12] = [sh[0] + 20, sh[1], 1];
    a[23] = [hip[0] - 20, hip[1], 1]; a[24] = [hip[0] + 20, hip[1], 1];
    return a;
  };
  const tilt = (d) => [200 + 200 * Math.tan((d * Math.PI) / 180), 300];
  const t = structuredClone(truth ?? { checkpoints: {}, ball: { x: 273, y: 505 } });
  const pose = { 300: lm(tilt(32), [200, 500]), 556: lm(tilt(25), [200, 500]) };
  // shoulders 200 px above hips: tilt = atan2(dx, 200)
  const c = byId(runChecks({ ...t, pose, cmPerPx: 0.5 }));
  assert.equal(c.spine_loss.status, 'red');
  assert.equal(Math.round(c.spine_loss.value), 7);
  assert.equal(c.posture_address.status, 'green');
});

test('tempo bands', () => {
  const mk = (b, d) => ({ ball: { x: 0, y: 0 }, checkpoints: { takeaway: { frame: 0, hands: { x: 0, y: 0 } }, top: { frame: b, hands: { x: 0, y: 0 } }, impact: { frame: b + d, hands: { x: 0, y: 0 } } }, cmPerPx: 1 });
  const s = (b, d) => byId(runChecks(mk(b, d))).tempo.status;
  assert.equal(s(150, 50), 'green'); // 3.0
  assert.equal(s(100, 50), 'yellow'); // 2.0
  assert.equal(s(70, 50), 'red'); // 1.4
  assert.equal(s(200, 50), 'yellow'); // 4.0
  assert.equal(s(250, 50), 'red'); // 5.0
});

test('main fault: tie goes to the earliest in the chain; none when all green', () => {
  assert.equal(mainFault([{ id: 'tempo', status: 'green' }]), null);
  const m = mainFault([{ id: 'posture_address', status: 'red' }, { id: 'head_drift', status: 'red' }]);
  assert.equal(m.fault, 'posture');
});

test('sideOfLine: outside (toward the ball side) is positive', () => {
  const a = { x: 273, y: 505 }, b = { x: 210, y: 425 };
  assert.ok(sideOfLine({ x: 300, y: 450 }, a, b) > 0);
  assert.ok(sideOfLine({ x: 150, y: 450 }, a, b) < 0);
});

test('fitRect / view<->video conversion (contain and cover)', () => {
  // 478x850 video in a 358x400 box: contain pillarboxes, cover crops top/bottom
  const c = fitRect(358, 400, 478, 850, 'contain');
  assert.ok(Math.abs(c.h - 400) < 1e-9);
  assert.ok(Math.abs(c.w - 478 * (400 / 850)) < 1e-9);
  assert.ok(Math.abs(c.x - (358 - c.w) / 2) < 1e-9 && c.y === 0);
  const k = fitRect(358, 400, 478, 850, 'cover');
  assert.ok(Math.abs(k.w - 358) < 1e-9 && k.h > 400 && k.y < 0);
  for (const mode of ['contain', 'cover']) {
    for (const p of [{ x: 0, y: 0 }, { x: 273, y: 505 }, { x: 478, y: 850 }]) {
      const v = videoToView(p, 358, 400, 478, 850, mode);
      const back = viewToVideo(v, 358, 400, 478, 850, mode);
      assert.ok(Math.abs(back.x - p.x) < 1e-9 && Math.abs(back.y - p.y) < 1e-9);
    }
  }
  // video centre maps to container centre
  const ctr = videoToView({ x: 239, y: 425 }, 358, 400, 478, 850);
  assert.ok(Math.abs(ctr.x - 179) < 1e-9 && Math.abs(ctr.y - 200) < 1e-9);
  // click at the left letterbox edge is negative video x
  assert.ok(viewToVideo({ x: 0, y: 200 }, 358, 400, 478, 850).x < 0);
});
