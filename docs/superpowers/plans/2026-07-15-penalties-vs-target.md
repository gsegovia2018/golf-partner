# Penalties vs Target Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Benchmark the penalties SG category against the target handicap's typical penalty count instead of zero, so all five categories share "vs target" semantics.

**Architecture:** One new baseline helper (`strokesGainedBaseline.js`), a signature extension to `sgPenalties` + its `sgTotal` call site (`statsEngine.js`), one explainer sentence, one action-plan label. Everything downstream (sgSeason, reconciliation, coach routing, UI bars) flows through unchanged.

**Tech Stack:** Plain JS store modules, Jest (jest-expo).

## Global Constraints

- Scratch behavior identical to today: `expectedPenaltiesPerRound(0) === 0`, so every existing test at default target passes unchanged.
- Blend: `expectedPenaltiesPerRound(t) = clamp(hcp/14, 0, 2) × 1.0` per round; per hole = that / 18.
- `sgPenalties` sample semantics unchanged: holes without a shot-detail object stay null (unknown), tracked clean holes contribute `+expectedPerHole`.
- Run tests with `npx jest <path>`; full suite `npm test`; lint `npm run lint`.

---

### Task 1: Penalties benchmarked vs target

**Files:**
- Modify: `src/store/strokesGainedBaseline.js` (append near `benchmarkDriveDistance`)
- Modify: `src/store/statsEngine.js` — `sgPenalties` and its call in `sgTotal`
- Modify: `src/components/mystats/statExplainers.js` — one sentence in `strokesGainedExplainer`
- Modify: `src/store/personalStats.js` — `buildActionPlan` label map gains `penalties: 'Penalties'`
- Test: `src/store/__tests__/strokesGainedBaseline.test.js`, `src/store/__tests__/statsEngine.test.js`

**Interfaces:**
- Consumes: `AMATEUR_ANCHOR_HANDICAP` (14).
- Produces: `expectedPenaltiesPerRound(targetHandicap = 0) → number` (export from strokesGainedBaseline); `sgPenalties(round, playerId, targetHandicap = 0)` (extended signature; same return shape).

- [ ] **Step 1: Write the failing tests**

Append to `strokesGainedBaseline.test.js` (extend its import with `expectedPenaltiesPerRound`):

```js
describe('expectedPenaltiesPerRound', () => {
  test('anchored at 0 (scratch) and 1.0 (14 hcp), clamped at 2.0', () => {
    expect(expectedPenaltiesPerRound(0)).toBe(0);
    expect(expectedPenaltiesPerRound()).toBe(0);
    expect(expectedPenaltiesPerRound(14)).toBeCloseTo(1.0, 10);
    expect(expectedPenaltiesPerRound(25)).toBeCloseTo(25 / 14, 10);
    expect(expectedPenaltiesPerRound(50)).toBeCloseTo(2.0, 10);
  });
});
```

Append to `statsEngine.test.js` (uses the existing `makeRound` fixture; `sgPenalties`/`sgTotal` are already imported):

```js
describe('sgPenalties vs target handicap', () => {
  const clean18 = makeRound(
    Array.from({ length: 18 }, () => ({ par: 4, strokes: 4 })),
    Array.from({ length: 18 }, () => ({ putts: 2 })),
  );
  test('scratch target: identical to raw count (expected 0)', () => {
    const r = sgPenalties(clean18, 'me');
    expect(r.total).toBe(0);
    expect(r.sampleHoles).toBe(18);
  });
  test('a clean 18-hole round gains the full target allowance', () => {
    expect(sgPenalties(clean18, 'me', 14).total).toBeCloseTo(1.0, 10);
    expect(sgPenalties(clean18, 'me', 25).total).toBeCloseTo(25 / 14, 10);
  });
  test('per-hole: allowance minus actual penalties', () => {
    const round = makeRound(
      [{ par: 4, strokes: 7 }, { par: 4, strokes: 4 }],
      [{ putts: 2, teePenalties: 2 }, { putts: 2 }],
    );
    const r = sgPenalties(round, 'me', 14);
    expect(r.perHole[0]).toBeCloseTo(1 / 18 - 2, 10);
    expect(r.perHole[1]).toBeCloseTo(1 / 18, 10);
  });
  test('untracked holes stay null', () => {
    const round = makeRound([{ par: 4, strokes: 4 }], []);
    expect(sgPenalties(round, 'me', 14).perHole[0]).toBeNull();
    expect(sgPenalties(round, 'me', 14).sampleHoles).toBe(0);
  });
  test('sgTotal threads the target into penalties', () => {
    const withPen = makeRound([{ par: 4, strokes: 6 }], [{ putts: 2, teePenalties: 1 }]);
    expect(sgTotal(withPen, 'me', 14).byCategory.penalties).toBeCloseTo(1 / 18 - 1, 10);
    expect(sgTotal(withPen, 'me', 0).byCategory.penalties).toBe(-1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/store/__tests__/strokesGainedBaseline.test.js src/store/__tests__/statsEngine.test.js -t "enalties"`
Expected: FAIL — `expectedPenaltiesPerRound` not exported; the target-aware assertions get raw-count values.

- [ ] **Step 3: Implement**

`strokesGainedBaseline.js`, after `benchmarkDriveDistance`:

```js
// Typical penalty strokes per round for a target handicap. Anchored at 0
// for scratch — so "vs scratch" stays the raw count the app always showed —
// and 1.0/round at the 14-hcp anchor, same linear blend as the tables
// (t clamped to [0, 2] → ~1.79 at a 25 target, 2.0 cap). Approximation,
// stated in the SG explainer.
const AMATEUR_PENALTIES_PER_ROUND = 1.0;

export function expectedPenaltiesPerRound(targetHandicap = 0) {
  const t = Math.max(0, Math.min(2, (targetHandicap ?? 0) / AMATEUR_ANCHOR_HANDICAP));
  return t * AMATEUR_PENALTIES_PER_ROUND;
}
```

`statsEngine.js` — extend the strokesGainedBaseline import with `expectedPenaltiesPerRound`, then:

```js
export function sgPenalties(round, playerId, targetHandicap = 0) {
  const byHole = round?.shotDetails?.[playerId];
  const expectedPerHole = expectedPenaltiesPerRound(targetHandicap) / 18;
  const perHole = (round?.holes ?? []).map((hole) => {
    const d = byHole?.[hole.number];
    // Every tracked hole counts in the sample — a clean one contributes the
    // target's small per-hole allowance so penalty-free rounds gain vs a
    // non-scratch target, matching the other categories' semantics.
    // Untracked holes stay null: no shot detail means we don't know.
    if (!d) return null;
    const penalty = (d.teePenalties ?? 0) + (d.otherPenalties ?? 0);
    return expectedPerHole - penalty;
  });
  const sample = perHole.filter((x) => x != null);
  const total = sample.reduce((a, x) => a + x, 0);
  return { perHole, total, sampleHoles: sample.length };
}
```

In `sgTotal`, change the call to `const penalties = sgPenalties(round, playerId, targetHandicap);`.

`statExplainers.js` — in `strokesGainedExplainer`, replace the clause `penalties count penalty strokes 'directly.'` (end of the "Five categories" paragraph) with: `penalties compare your penalty count with the typical count for ${reference}.`

`personalStats.js` — in `buildActionPlan`'s label map add `penalties: 'Penalties',`.

- [ ] **Step 4: Run the affected suites**

Run: `npx jest src/store/__tests__/ src/components/mystats/__tests__/`
Expected: PASS. If any pre-existing assertion pinned the old raw-count value at a non-zero target, update it to the allowance-adjusted value (do not weaken it).

- [ ] **Step 5: Commit**

```bash
git add src/store/ src/components/mystats/statExplainers.js
git commit -m "feat(sg): penalties benchmarked against the target handicap's typical count"
```

---

### Task 2: Full verification

- [ ] Run `npm test` (all pass; ignore `.worktrees` copies) and `npm run lint` (0 errors), confirm clean tree.
