import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTournaments, setAtPath, getAtPath } from '../src/store/merge.js';

test('returns { merged, conflicts } with empty conflicts for remote-only', () => {
  const remote = { id: 't1', name: 'A', _meta: { name: 10 } };
  const out = mergeTournaments(null, remote);
  assert.deepEqual(out.merged, remote);
  assert.deepEqual(out.conflicts, []);
});

test('returns { merged, conflicts } with empty conflicts for local-only', () => {
  const local = { id: 't1', name: 'A', _meta: { name: 10 } };
  const out = mergeTournaments(local, null);
  assert.deepEqual(out.merged, local);
  assert.deepEqual(out.conflicts, []);
});

test('disjoint paths are both preserved with no conflicts', () => {
  const local  = { a: 1, b: 0, _meta: { a: 20 } };
  const remote = { a: 0, b: 2, _meta: { b: 15 } };
  const { merged, conflicts } = mergeTournaments(local, remote);
  assert.equal(merged.a, 1);
  assert.equal(merged.b, 2);
  assert.equal(merged._meta.a, 20);
  assert.equal(merged._meta.b, 15);
  assert.deepEqual(conflicts, []);
});

test('same path, local wins: no conflict reported', () => {
  const local  = { v: 'L', _meta: { v: 20 } };
  const remote = { v: 'R', _meta: { v: 10 } };
  const { merged, conflicts } = mergeTournaments(local, remote);
  assert.equal(merged.v, 'L');
  assert.deepEqual(conflicts, []);
});

test('same path, remote wins: conflict reported with both values', () => {
  const local  = { v: 'L', _meta: { v: 10 } };
  const remote = { id: 't1', v: 'R', _meta: { v: 20 } };
  const { merged, conflicts } = mergeTournaments(local, remote);
  assert.equal(merged.v, 'R');
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].path, 'v');
  assert.equal(conflicts[0].localTs, 10);
  assert.equal(conflicts[0].remoteTs, 20);
  assert.equal(conflicts[0].winnerValue, 'R');
  assert.equal(conflicts[0].losingValue, 'L');
  assert.equal(conflicts[0].tournamentId, 't1');
  assert.equal(typeof conflicts[0].detectedAt, 'number');
});

test('tie on ts: local wins with no conflict (v1 policy)', () => {
  const local  = { v: 'L', _meta: { v: 10 } };
  const remote = { v: 'R', _meta: { v: 10 } };
  const { merged, conflicts } = mergeTournaments(local, remote);
  assert.equal(merged.v, 'L');
  assert.deepEqual(conflicts, []);
});

test('one-sided ts (remote only) is not a conflict even if remote wins', () => {
  const local  = { v: 'L', _meta: {} };
  const remote = { v: 'R', _meta: { v: 5 } };
  const { merged, conflicts } = mergeTournaments(local, remote);
  assert.equal(merged.v, 'R');
  assert.deepEqual(conflicts, []);
});

test('one-sided ts (local only) is not a conflict', () => {
  const local  = { v: 'L', _meta: { v: 5 } };
  const remote = { v: 'R', _meta: {} };
  const { merged, conflicts } = mergeTournaments(local, remote);
  assert.equal(merged.v, 'L');
  assert.deepEqual(conflicts, []);
});

test('multiple paths mix wins and losses; only remote-wins reported', () => {
  const local  = { a: 'La', b: 'Lb', _meta: { a: 100, b: 10 } };
  const remote = { id: 't2', a: 'Ra', b: 'Rb', _meta: { a: 50, b: 20 } };
  const { merged, conflicts } = mergeTournaments(local, remote);
  assert.equal(merged.a, 'La');
  assert.equal(merged.b, 'Rb');
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].path, 'b');
  assert.equal(conflicts[0].losingValue, 'Lb');
  assert.equal(conflicts[0].winnerValue, 'Rb');
});

test('legacy blob without _meta: local wins on any set path with no conflicts', () => {
  const local  = { v: 'L', _meta: { v: 1 } };
  const remote = { v: 'R' };
  const { merged, conflicts } = mergeTournaments(local, remote);
  assert.equal(merged.v, 'L');
  assert.deepEqual(conflicts, []);
});

test('setAtPath creates missing intermediate objects', () => {
  const obj = {};
  setAtPath(obj, 'a.b.c', 7);
  assert.equal(obj.a.b.c, 7);
});

test('getAtPath returns undefined for missing paths', () => {
  assert.equal(getAtPath({}, 'x.y'), undefined);
  assert.equal(getAtPath({ x: { y: 3 } }, 'x.y'), 3);
});
