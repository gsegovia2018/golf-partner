import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTournaments, setAtPath, getAtPath } from '../src/store/merge.js';

test('remote-only blob returns unchanged', () => {
  const remote = { id: 't1', name: 'A', _meta: { name: 10 } };
  assert.deepEqual(mergeTournaments(null, remote), remote);
});

test('local-only blob returns unchanged', () => {
  const local = { id: 't1', name: 'A', _meta: { name: 10 } };
  assert.deepEqual(mergeTournaments(local, null), local);
});

test('disjoint paths are both preserved', () => {
  const local  = { a: 1, b: 0, _meta: { a: 20 } };
  const remote = { a: 0, b: 2, _meta: { b: 15 } };
  const out = mergeTournaments(local, remote);
  assert.equal(out.a, 1);
  assert.equal(out.b, 2);
  assert.equal(out._meta.a, 20);
  assert.equal(out._meta.b, 15);
});

test('same path: higher ts wins', () => {
  const local  = { v: 'L', _meta: { v: 10 } };
  const remote = { v: 'R', _meta: { v: 20 } };
  assert.equal(mergeTournaments(local, remote).v, 'R');
});

test('tie on ts: local wins', () => {
  const local  = { v: 'L', _meta: { v: 10 } };
  const remote = { v: 'R', _meta: { v: 10 } };
  assert.equal(mergeTournaments(local, remote).v, 'L');
});

test('legacy blob without _meta: local wins on any set path', () => {
  const local  = { v: 'L', _meta: { v: 1 } };
  const remote = { v: 'R' };
  assert.equal(mergeTournaments(local, remote).v, 'L');
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
