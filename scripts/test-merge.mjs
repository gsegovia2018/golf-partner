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

// The paths mutate.js emits don't address the tournament blob 1:1:
//   - `rounds` is an array, but paths use the round's `id`.
//   - Score paths encode hole numbers as `h<N>`, not the bare number.
// getAtPath/setAtPath must transparently resolve both. Without this, the
// LWW merge silently drops local-wins on any round-scoped path — which
// was wiping scores the moment the user typed them.

test('getAtPath navigates rounds array by id', () => {
  const t = { rounds: [{ id: 'r1', scores: { p7: { 5: 4 } } }] };
  assert.equal(getAtPath(t, 'rounds.r1.scores.p7.5'), 4);
});

test('getAtPath resolves h-prefixed hole keys', () => {
  const t = { rounds: [{ id: 'r1', scores: { p7: { 5: 4 } } }] };
  assert.equal(getAtPath(t, 'rounds.r1.scores.p7.h5'), 4);
});

test('setAtPath writes through rounds-by-id + h-prefix', () => {
  const t = { rounds: [{ id: 'r1', scores: {} }] };
  setAtPath(t, 'rounds.r1.scores.p7.h5', 4);
  assert.equal(t.rounds[0].scores.p7[5], 4);
  // No garbage `r1` property on the rounds array.
  assert.deepEqual(Object.keys(t.rounds).filter((k) => !/^\d+$/.test(k)), []);
});

test('LWW merge preserves local score at round-scoped path', () => {
  // Regression for the "typed score vanishes on next refresh" bug: the
  // loadTournament background refresh LWW-merged remote into local, but
  // the helpers couldn't navigate `rounds.<id>.scores.<pid>.h<N>` so
  // setAtPath wrote garbage and the score was lost.
  const local = {
    id: 't1',
    rounds: [{ id: 'r1', scores: { p7: { 5: 4 } } }],
    _meta: { 'rounds.r1.scores.p7.h5': 1000 },
  };
  const remote = {
    id: 't1',
    rounds: [{ id: 'r1', scores: {} }],
    _meta: {},
  };
  const { merged } = mergeTournaments(local, remote);
  assert.equal(merged.rounds[0].scores.p7[5], 4);
  // Survives serialization — non-index array properties would be lost
  // here, so the assertion catches the old broken behavior too.
  const roundtrip = JSON.parse(JSON.stringify(merged));
  assert.equal(roundtrip.rounds[0].scores.p7[5], 4);
});

test('LWW merge: remote wins on same round-scoped path reports conflict', () => {
  const local = {
    id: 't1',
    rounds: [{ id: 'r1', scores: { p7: { 5: 3 } } }],
    _meta: { 'rounds.r1.scores.p7.h5': 500 },
  };
  const remote = {
    id: 't1',
    rounds: [{ id: 'r1', scores: { p7: { 5: 6 } } }],
    _meta: { 'rounds.r1.scores.p7.h5': 1500 },
  };
  const { merged, conflicts } = mergeTournaments(local, remote);
  assert.equal(merged.rounds[0].scores.p7[5], 6);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].losingValue, 3);
  assert.equal(conflicts[0].winnerValue, 6);
});

test('LWW merge preserves local pairs array on round-scoped path', () => {
  const local = {
    id: 't1',
    rounds: [{ id: 'r1', pairs: [[{ id: 'a' }, { id: 'b' }]] }],
    _meta: { 'rounds.r1.pairs': 1000 },
  };
  const remote = {
    id: 't1',
    rounds: [{ id: 'r1', pairs: [] }],
    _meta: {},
  };
  const { merged } = mergeTournaments(local, remote);
  assert.deepEqual(merged.rounds[0].pairs, [[{ id: 'a' }, { id: 'b' }]]);
});
