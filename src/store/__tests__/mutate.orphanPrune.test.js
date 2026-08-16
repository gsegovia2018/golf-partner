// The post-drain reconcile's orphan prune: a cached-local score entry (or
// resolution) that neither the fresh server state nor the still-pending
// queue knows about can never sync — its write was dropped by the drain or
// died before enqueue — and left alone it becomes the phantom author behind
// the 2026-08-16 solo "Someone" conflicts. `pruneOrphansBefore` drops such
// items once they are older than the cutoff; younger ones and anything the
// target knows keep the existing union semantics untouched.
import { preserveLocalConflictState } from '../mutate';

const CUTOFF = 1000_000;
const OLD = CUTOFF - 1;   // older than the grace window -> prunable
const FRESH = CUTOFF + 1; // inside the grace window -> protected

const target = (scoreEntries, scoreResolutions) => ({
  rounds: [{ id: 'r0', scores: {}, ...(scoreEntries ? { scoreEntries } : {}), ...(scoreResolutions ? { scoreResolutions } : {}) }],
});
const source = (scoreEntries, scoreResolutions) => ({
  rounds: [{ id: 'r0', ...(scoreEntries ? { scoreEntries } : {}), ...(scoreResolutions ? { scoreResolutions } : {}) }],
});
const opts = { pruneOrphansBefore: CUTOFF };

test('an old source-only entry is pruned, and its empty buckets with it', () => {
  const out = preserveLocalConflictState(
    target({ p1: { 3: { me: { value: 4, ts: OLD } } } }),
    source({ p1: { 3: { 'dev-x': { value: 5, ts: OLD } }, 7: { 'dev-x': { value: 6, ts: OLD } } } }),
    opts,
  );
  expect(out.rounds[0].scoreEntries).toEqual({ p1: { 3: { me: { value: 4, ts: OLD } } } });
});

test('a fresh source-only entry survives the grace window', () => {
  const out = preserveLocalConflictState(
    target(),
    source({ p1: { 3: { me: { value: 4, ts: FRESH } } } }),
    opts,
  );
  expect(out.rounds[0].scoreEntries.p1[3].me).toEqual({ value: 4, ts: FRESH });
});

test('an entry the target knows is never pruned regardless of age', () => {
  // Target-known covers both "on the server" and "re-created from the
  // pending queue by applyPendingMutations" — the ts-aware union still
  // resolves which copy wins.
  const out = preserveLocalConflictState(
    target({ p1: { 3: { me: { value: 4, ts: 10 } } } }),
    source({ p1: { 3: { me: { value: 5, ts: OLD } } } }),
    opts,
  );
  expect(out.rounds[0].scoreEntries.p1[3].me).toEqual({ value: 5, ts: OLD });
});

test('old source-only resolutions are pruned the same way', () => {
  const out = preserveLocalConflictState(
    target(undefined, { p1: { 5: { value: 4, by: 'me', ts: 10 } } }),
    source(undefined, {
      p1: { 5: { value: 6, by: 'me', ts: OLD }, 9: { value: 3, by: 'me', ts: OLD } },
      p2: { 2: { value: 5, by: 'me', ts: FRESH } },
    }),
    opts,
  );
  // Hole 5 is target-known (union keeps the newer source copy); hole 9 is an
  // old orphan (pruned); p2's is inside the grace window (kept).
  expect(out.rounds[0].scoreResolutions).toEqual({
    p1: { 5: { value: 6, by: 'me', ts: OLD } },
    p2: { 2: { value: 5, by: 'me', ts: FRESH } },
  });
});

test('pruning every source-only item omits the key rather than leaving {}', () => {
  const out = preserveLocalConflictState(
    target(),
    source({ p1: { 3: { 'dev-x': { value: 5, ts: OLD } } } }, { p1: { 3: { value: 5, by: 'dev-x', ts: OLD } } }),
    opts,
  );
  expect(out.rounds[0].scoreEntries).toBeUndefined();
  expect(out.rounds[0].scoreResolutions).toBeUndefined();
});

test('without the option, old source-only entries are preserved (fetch/realtime paths)', () => {
  const out = preserveLocalConflictState(
    target(),
    source({ p1: { 3: { 'dev-x': { value: 5, ts: OLD } } } }),
  );
  expect(out.rounds[0].scoreEntries.p1[3]['dev-x']).toEqual({ value: 5, ts: OLD });
});
