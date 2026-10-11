import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECKPOINTS } from './checks.js';
import { CHECKPOINT_DEFS, cueFor } from './checkpoints.js';

test('9 definitions in CONTRACT order with full fields', () => {
  assert.deepEqual(CHECKPOINT_DEFS.map((d) => d.key), CHECKPOINTS);
  assert.equal(CHECKPOINT_DEFS.length, 9);
  assert.deepEqual(CHECKPOINT_DEFS.map((d) => d.p), ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P9', 'P10']);
  for (const d of CHECKPOINT_DEFS) for (const f of ['name', 'what', 'stopWhen', 'markTips']) assert.ok(d[f] && typeof d[f] === 'string', `${d.key}.${f}`);
});

test('left-handed cues mirror left/right', () => {
  assert.match(cueFor('leadArm', 'left').what, /Right arm/);
  assert.match(cueFor('trailArm', 'left').what, /Left arm/);
  assert.match(cueFor('leadArm', 'right').what, /Left arm/);
});
