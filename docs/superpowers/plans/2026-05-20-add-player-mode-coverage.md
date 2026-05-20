# Add-Player Mode Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `addPlayerRoundPatches` so adding a player to a matchplay, sindicato, or bestball round produces a coherent state via a store-level auto-fallback, with a caller-driven prompt so the user picks the new mode.

**Architecture:** `addPlayerRoundPatches` is rewritten to return `{ patches, nextScoringMode }`. Mode resolution: caller override (if valid) → current mode (if still valid) → `fallbackScoringMode(newCount)`. Pair construction collapses into one branch keyed on `scoringModeUsesTeams`. The `tournament.addPlayer` mutation gains an optional `nextScoringMode` field so roster and settings update atomically. `HomeScreen.applyAddPlayers` becomes a two-pass flow (pre-flight detects mode break → prompts user → commits). `ScorecardScreen` shows a transient banner when the mode just changed.

**Tech Stack:** Expo SDK 54, React Native 0.81, Jest (jest-expo), Supabase sync queue.

**Spec:** `docs/superpowers/specs/2026-05-20-add-player-mode-coverage-design.md`

---

## File Structure

**Created:**
- `src/store/__tests__/addPlayerRoundPatches.test.js` — unit tests for the rewritten store function (no existing tests for it).
- `src/store/__tests__/addPlayerMutation.test.js` — focused tests for `tournament.addPlayer` mutation paths + apply behavior (no existing `mutate.js` tests).
- `src/components/ScoringModeChangeSheet.js` — modal sheet listing the modes valid for a given player count, with Continue/Cancel actions.
- `src/components/ScoringModeChangeBanner.js` — transient banner that surfaces a `fallbackNoticeText` and opens the sheet on tap.

**Modified:**
- `src/store/tournamentStore.js` — rewrite `addPlayerRoundPatches`; add internal `buildPairsForAddedPlayer` helper.
- `src/store/mutate.js` — extend `pathsForMutation` and `applyToTournament` for the optional `nextScoringMode` field on `tournament.addPlayer`.
- `src/screens/HomeScreen.js` — rewire `applyAddPlayers` to a two-pass flow; show `ScoringModeChangeSheet` when a mode break is detected.
- `src/screens/ClaimPlayerScreen.js` — destructure the new `{ patches }` return shape; never pass `nextScoringMode`.
- `src/screens/ScorecardScreen.js` — render `ScoringModeChangeBanner` using `usePrevious` to detect a mode change.

---

## Task 1: Rewrite return shape and update callers

**Goal:** Move from `[patches]` to `{ patches, nextScoringMode }` without changing any behavior. Both call sites destructure. Build stays green.

**Files:**
- Modify: `src/store/tournamentStore.js:597-623`
- Modify: `src/screens/HomeScreen.js:216`
- Modify: `src/screens/ClaimPlayerScreen.js:111`
- Create: `src/store/__tests__/addPlayerRoundPatches.test.js`

- [ ] **Step 1: Create the test file with one failing test for the new shape**

Create `src/store/__tests__/addPlayerRoundPatches.test.js`:

```js
import { addPlayerRoundPatches } from '../tournamentStore';

function makeTournament({ players, mode, rounds, currentRound = 0 }) {
  return {
    id: 't1',
    players,
    rounds,
    currentRound,
    settings: { scoringMode: mode, bestBallValue: 1, worstBallValue: 1 },
  };
}

function makeRound({ id = 'r1', revealed = false, pairs = [], playerTees = {} } = {}) {
  return {
    id,
    holes: [],
    pairs,
    revealed,
    playerTees,
    playerHandicaps: {},
    manualHandicaps: {},
    scores: {},
  };
}

const A = { id: 'a', name: 'A', handicap: 10 };
const B = { id: 'b', name: 'B', handicap: 12 };
const C = { id: 'c', name: 'C', handicap: 8 };

describe('addPlayerRoundPatches return shape', () => {
  test('returns { patches, nextScoringMode }', () => {
    const t = makeTournament({
      players: [A, B],
      mode: 'individual',
      rounds: [makeRound({ pairs: [[A], [B]] })],
    });
    const result = addPlayerRoundPatches(t, C);
    expect(result).toEqual(expect.objectContaining({
      patches: expect.any(Array),
      nextScoringMode: expect.any(String),
    }));
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx jest src/store/__tests__/addPlayerRoundPatches.test.js -t "returns { patches, nextScoringMode }"`

Expected: FAIL — current function returns an array; `expect.objectContaining` on an array fails.

- [ ] **Step 3: Rewrite the function to return the new shape (minimal change, no other logic yet)**

In `src/store/tournamentStore.js`, replace lines 597-623 with:

```js
// Build the per-round patches for adding `player` to an in-progress
// tournament. The player joins `currentRound` and every later round;
// already-played earlier rounds are left untouched. Returns the patches
// plus the resolved scoring mode after the add — equal to the current
// mode when it stays valid for the new roster, or the auto-fallback
// otherwise. Pass { mode } to override (used by the prompt UX).
export function addPlayerRoundPatches(tournament, player, { mode } = {}) {
  const oldMode = tournament?.settings?.scoringMode ?? 'stableford';
  const currentRound = tournament?.currentRound ?? 0;
  const roster = [...(tournament?.players ?? []), player];
  const nextScoringMode = oldMode; // mode resolution lands in Task 2
  const patches = [];
  (tournament?.rounds ?? []).forEach((round, idx) => {
    if (idx < currentRound) return;
    const playerHandicap = deriveRoundPlayingHandicap(player.handicap, round);
    let pairs = null;
    if (oldMode === 'individual') {
      pairs = [...(round.pairs ?? []), [player]];
    } else if (oldMode === 'stableford') {
      const revealed = round.revealed || idx <= currentRound;
      if (!revealed) {
        pairs = randomPairs(roster);
      } else {
        const next = (round.pairs ?? []).map((pr) => [...pr]);
        const short = next.find((pr) => pr.length < 2);
        if (short) short.push(player);
        else next.push([player]);
        pairs = next;
      }
    }
    patches.push({ roundId: round.id, playerHandicap, pairs });
  });
  return { patches, nextScoringMode };
}
```

- [ ] **Step 4: Update HomeScreen caller**

In `src/screens/HomeScreen.js:216`, change:

```js
const roundPatches = addPlayerRoundPatches(t, player);
```

to:

```js
const { patches: roundPatches } = addPlayerRoundPatches(t, player);
```

- [ ] **Step 5: Update ClaimPlayerScreen caller**

In `src/screens/ClaimPlayerScreen.js:111`, change:

```js
const roundPatches = addPlayerRoundPatches(tournament, player);
```

to:

```js
const { patches: roundPatches } = addPlayerRoundPatches(tournament, player);
```

- [ ] **Step 6: Run the test and the full suite**

Run: `npx jest src/store/__tests__/addPlayerRoundPatches.test.js`
Expected: PASS

Run: `npm test -- --silent`
Expected: All existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src/store/tournamentStore.js src/screens/HomeScreen.js src/screens/ClaimPlayerScreen.js src/store/__tests__/addPlayerRoundPatches.test.js
git commit -m "refactor(tournamentStore): addPlayerRoundPatches returns { patches, nextScoringMode }"
```

---

## Task 2: Mode resolution (current vs override vs fallback)

**Goal:** `addPlayerRoundPatches` picks a valid mode for the new roster: caller override (if valid), else current mode (if valid), else `fallbackScoringMode(newCount)`.

**Files:**
- Modify: `src/store/tournamentStore.js` — `addPlayerRoundPatches`
- Modify: `src/store/__tests__/addPlayerRoundPatches.test.js`

- [ ] **Step 1: Ensure helpers are imported**

`isScoringModeAllowed` and `fallbackScoringMode` are already re-exported from `ScoringModePicker` and imported at the top of `tournamentStore.js` (line 17). Confirm with:

```bash
grep -n "isScoringModeAllowed\|fallbackScoringMode" src/store/tournamentStore.js
```

If both names appear in an import line, no change needed. Otherwise add:

```js
import { isScoringModeAllowed, fallbackScoringMode } from '../components/ScoringModePicker';
```

- [ ] **Step 2: Add failing tests for mode resolution**

Append to `src/store/__tests__/addPlayerRoundPatches.test.js`:

```js
describe('addPlayerRoundPatches mode resolution', () => {
  test('matchplay 2→3 with no override falls back to stableford', () => {
    const t = makeTournament({
      players: [A, B],
      mode: 'matchplay',
      rounds: [makeRound({ pairs: [[A], [B]] })],
    });
    const { nextScoringMode } = addPlayerRoundPatches(t, C);
    expect(nextScoringMode).toBe('stableford');
  });

  test('sindicato 3→4 with no override falls back to stableford', () => {
    const D = { id: 'd', name: 'D', handicap: 4 };
    const t = makeTournament({
      players: [A, B, C],
      mode: 'sindicato',
      rounds: [makeRound({ pairs: [[A], [B], [C]] })],
    });
    const { nextScoringMode } = addPlayerRoundPatches(t, D);
    expect(nextScoringMode).toBe('stableford');
  });

  test('matchplay 2→3 honors a valid { mode } override', () => {
    const t = makeTournament({
      players: [A, B],
      mode: 'matchplay',
      rounds: [makeRound({ pairs: [[A], [B]] })],
    });
    const { nextScoringMode } = addPlayerRoundPatches(t, C, { mode: 'sindicato' });
    expect(nextScoringMode).toBe('sindicato');
  });

  test('invalid override falls back when the override is not allowed for the new count', () => {
    const t = makeTournament({
      players: [A, B],
      mode: 'matchplay',
      rounds: [makeRound({ pairs: [[A], [B]] })],
    });
    // matchplay needs exactly 2 — at count 3 it is invalid even as an override
    const { nextScoringMode } = addPlayerRoundPatches(t, C, { mode: 'matchplay' });
    expect(nextScoringMode).toBe('stableford');
  });

  test('current mode is kept when still valid for new count', () => {
    const D = { id: 'd', name: 'D', handicap: 4 };
    const t = makeTournament({
      players: [A, B, C],
      mode: 'stableford', // valid at 3 and at 4
      rounds: [makeRound({ pairs: [[A, B], [C]] })],
    });
    const { nextScoringMode } = addPlayerRoundPatches(t, D);
    expect(nextScoringMode).toBe('stableford');
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

Run: `npx jest src/store/__tests__/addPlayerRoundPatches.test.js`
Expected: 4 of the new tests fail (they say `nextScoringMode` is `matchplay`/`sindicato`); 1 passes (current-mode-kept case).

- [ ] **Step 4: Implement mode resolution**

In `src/store/tournamentStore.js`, inside `addPlayerRoundPatches`, replace the line:

```js
const nextScoringMode = oldMode; // mode resolution lands in Task 2
```

with:

```js
const newCount = roster.length;
const nextScoringMode =
  mode && isScoringModeAllowed(mode, newCount) ? mode
    : isScoringModeAllowed(oldMode, newCount) ? oldMode
    : fallbackScoringMode(newCount);
```

- [ ] **Step 5: Run the tests**

Run: `npx jest src/store/__tests__/addPlayerRoundPatches.test.js`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/store/tournamentStore.js src/store/__tests__/addPlayerRoundPatches.test.js
git commit -m "feat(tournamentStore): addPlayerRoundPatches resolves next scoring mode on roster grow"
```

---

## Task 3: Collapse pair construction into `buildPairsForAddedPlayer`

**Goal:** Replace the per-mode if/else ladder with one branch keyed on `scoringModeUsesTeams`. Produces valid pairs for every reachable combination of (old mode, new mode).

**Files:**
- Modify: `src/store/tournamentStore.js`
- Modify: `src/store/__tests__/addPlayerRoundPatches.test.js`

- [ ] **Step 1: Verify `scoringModeUsesTeams` is imported**

`scoringModeUsesTeams` is imported from `'../components/scoringModes'` at the top of `tournamentStore.js` (line 19). Confirm with:

```bash
grep -n "scoringModeUsesTeams" src/store/tournamentStore.js
```

If absent, add to the existing scoringModes import.

- [ ] **Step 2: Add failing pair-construction tests**

Append to `src/store/__tests__/addPlayerRoundPatches.test.js`:

```js
describe('addPlayerRoundPatches pair construction', () => {
  test('non-team new mode: every player becomes their own group', () => {
    const t = makeTournament({
      players: [A, B],
      mode: 'matchplay',
      rounds: [makeRound({ revealed: true, pairs: [[A], [B]] })],
    });
    const { patches } = addPlayerRoundPatches(t, C, { mode: 'individual' });
    expect(patches[0].pairs).toEqual([[A], [B], [C]]);
  });

  test('matchplay 2→3 with sindicato override produces solo pairs', () => {
    const t = makeTournament({
      players: [A, B],
      mode: 'matchplay',
      rounds: [makeRound({ revealed: true, pairs: [[A], [B]] })],
    });
    const { patches } = addPlayerRoundPatches(t, C, { mode: 'sindicato' });
    expect(patches[0].pairs).toEqual([[A], [B], [C]]);
  });

  test('team→team with revealed pairs: preserves existing pairs, new player joins as solo group', () => {
    const D = { id: 'd', name: 'D', handicap: 4 };
    const t = makeTournament({
      players: [A, B, C],
      mode: 'stableford',
      rounds: [makeRound({ revealed: true, pairs: [[A, B], [C]] })],
    });
    const { patches } = addPlayerRoundPatches(t, D);
    expect(patches[0].pairs).toEqual([[A, B], [C], [D]]);
  });

  test('team mode but not-yet-revealed round: randomizes fresh', () => {
    const D = { id: 'd', name: 'D', handicap: 4 };
    const t = makeTournament({
      players: [A, B, C],
      mode: 'stableford',
      rounds: [makeRound({ revealed: false, pairs: [] })],
    });
    const { patches } = addPlayerRoundPatches(t, D);
    const flat = patches[0].pairs.flat();
    expect(flat).toHaveLength(4);
    expect(flat.map((p) => p.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  test('non-team old + team new: randomizes fresh (matchplay 2→3 fallback to stableford)', () => {
    const t = makeTournament({
      players: [A, B],
      mode: 'matchplay',
      rounds: [makeRound({ revealed: true, pairs: [[A], [B]] })],
    });
    const { patches } = addPlayerRoundPatches(t, C);
    const flat = patches[0].pairs.flat();
    expect(flat).toHaveLength(3);
    expect(flat.map((p) => p.id).sort()).toEqual(['a', 'b', 'c']);
    // randomPairs(3) → [[x, y], [z]] (one pair + one solo)
    expect(patches[0].pairs.length).toBe(2);
  });

  test('non-team old + team new (sindicato 3→4 fallback to stableford): randomizes fresh', () => {
    const D = { id: 'd', name: 'D', handicap: 4 };
    const t = makeTournament({
      players: [A, B, C],
      mode: 'sindicato',
      rounds: [makeRound({ revealed: true, pairs: [[A], [B], [C]] })],
    });
    const { patches } = addPlayerRoundPatches(t, D);
    const flat = patches[0].pairs.flat();
    expect(flat).toHaveLength(4);
    expect(flat.map((p) => p.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    // randomPairs(4) → [[x, y], [z, w]]
    expect(patches[0].pairs.length).toBe(2);
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

Run: `npx jest src/store/__tests__/addPlayerRoundPatches.test.js -t "pair construction"`
Expected: failures on the matchplay→sindicato override and matchplay/sindicato fallback cases (the ladder leaves `pairs = null` for non-individual/non-stableford old modes, and the `mode` override is not honored for pair construction).

- [ ] **Step 4: Add `buildPairsForAddedPlayer` and wire it in**

In `src/store/tournamentStore.js`, just above `export function addPlayerRoundPatches`, insert:

```js
// Pair construction for a round after a player is added. Closed over all
// modes via scoringModeUsesTeams — no per-mode ladder.
// - Non-team new mode (individual / matchplay / sindicato) → every player
//   is their own group.
// - Team new mode AND old mode also used teams AND existing pairs were
//   revealed → keep the existing partnerships, the new player joins as a
//   solo group.
// - Otherwise → fresh randomPairs(roster).
function buildPairsForAddedPlayer({ roster, newMode, oldMode, existingPairs, newPlayer, revealed }) {
  if (!scoringModeUsesTeams(newMode)) {
    return roster.map((p) => [p]);
  }
  const oldWasTeams = scoringModeUsesTeams(oldMode, roster.length - 1);
  if (oldWasTeams && existingPairs?.length && revealed) {
    return [...existingPairs.map((pr) => [...pr]), [newPlayer]];
  }
  return randomPairs(roster);
}
```

Then replace the body of `addPlayerRoundPatches` (the part inside `forEach`) so the full function reads:

```js
export function addPlayerRoundPatches(tournament, player, { mode } = {}) {
  const oldMode = tournament?.settings?.scoringMode ?? 'stableford';
  const currentRound = tournament?.currentRound ?? 0;
  const roster = [...(tournament?.players ?? []), player];
  const newCount = roster.length;
  const nextScoringMode =
    mode && isScoringModeAllowed(mode, newCount) ? mode
      : isScoringModeAllowed(oldMode, newCount) ? oldMode
      : fallbackScoringMode(newCount);
  const patches = [];
  (tournament?.rounds ?? []).forEach((round, idx) => {
    if (idx < currentRound) return;
    const playerHandicap = deriveRoundPlayingHandicap(player.handicap, round);
    const pairs = buildPairsForAddedPlayer({
      roster,
      newMode: nextScoringMode,
      oldMode,
      existingPairs: round.pairs,
      newPlayer: player,
      revealed: Boolean(round.revealed),
    });
    patches.push({ roundId: round.id, playerHandicap, pairs });
  });
  return { patches, nextScoringMode };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx jest src/store/__tests__/addPlayerRoundPatches.test.js`
Expected: All tests pass.

- [ ] **Step 6: Run the full suite to catch regressions**

Run: `npm test -- --silent`
Expected: all green. If a previously-passing test now fails because the new code returns pairs where the old code returned `null`, investigate — `mutate.js` is guarded by `if (patch.pairs)` so writing valid pairs is strictly better, but a test may have asserted on the null shape directly.

- [ ] **Step 7: Commit**

```bash
git add src/store/tournamentStore.js src/store/__tests__/addPlayerRoundPatches.test.js
git commit -m "feat(tournamentStore): collapse pair construction into buildPairsForAddedPlayer"
```

---

## Task 4: Multi-round regression coverage

**Goal:** Confirm only `currentRound` and later rounds are patched, and confirm `playerHandicap` is derived per round.

**Files:**
- Modify: `src/store/__tests__/addPlayerRoundPatches.test.js`

- [ ] **Step 1: Add multi-round regression tests**

Append to `src/store/__tests__/addPlayerRoundPatches.test.js`:

```js
describe('addPlayerRoundPatches multi-round behavior', () => {
  test('rounds before currentRound are not patched', () => {
    const D = { id: 'd', name: 'D', handicap: 4 };
    const t = makeTournament({
      players: [A, B, C],
      mode: 'stableford',
      currentRound: 1,
      rounds: [
        makeRound({ id: 'r0', revealed: true, pairs: [[A, B], [C]] }),
        makeRound({ id: 'r1', revealed: true, pairs: [[A, C], [B]] }),
        makeRound({ id: 'r2', revealed: false, pairs: [] }),
      ],
    });
    const { patches } = addPlayerRoundPatches(t, D);
    const ids = patches.map((p) => p.roundId);
    expect(ids).toEqual(['r1', 'r2']);
  });

  test('each patch carries a derived playerHandicap', () => {
    const D = { id: 'd', name: 'D', handicap: 7 };
    const t = makeTournament({
      players: [A, B, C],
      mode: 'stableford',
      rounds: [makeRound({ revealed: true, pairs: [[A, B], [C]] })],
    });
    const { patches } = addPlayerRoundPatches(t, D);
    expect(patches[0].playerHandicap).toEqual(expect.any(Number));
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx jest src/store/__tests__/addPlayerRoundPatches.test.js`
Expected: All tests pass (these confirm existing behavior — implementation should not need changes).

- [ ] **Step 3: Commit (test-only)**

```bash
git add src/store/__tests__/addPlayerRoundPatches.test.js
git commit -m "test(tournamentStore): multi-round regression coverage for addPlayerRoundPatches"
```

---

## Task 5: Extend `tournament.addPlayer` mutation for `nextScoringMode`

**Goal:** When `nextScoringMode` is provided, the mutation also updates `settings.scoringMode` and stamps that path. Backward-compatible: absent field is a no-op for settings.

**Files:**
- Modify: `src/store/mutate.js`
- Create: `src/store/__tests__/addPlayerMutation.test.js`

- [ ] **Step 1: Inspect existing mutation tests for the mock setup pattern**

Run:

```bash
grep -rn "mutate(" src/store/__tests__/*.js | head -10
ls src/store/__tests__/
```

If a test already exercises `mutate()` end-to-end (e.g. in `merge.test.js`), open that file briefly to learn the mock setup (likely an `AsyncStorage` and/or Supabase shim). Replicate any required mocks at the top of the new test file. If no existing test exercises `mutate()`, the simpler `applyToTournament` is also exported from `mutate.js` — switch the tests to call it directly. Confirm with:

```bash
grep -n "export" src/store/mutate.js
```

If `applyToTournament` is not exported, use `mutate()` and add the minimal mock setup. If it is exported, prefer it for these tests (avoids touching persistence).

- [ ] **Step 2: Create the mutation test file with failing tests**

Create `src/store/__tests__/addPlayerMutation.test.js`. The example below assumes `mutate()` is exercised; switch to `applyToTournament(t, m)` if that path is simpler in this codebase.

```js
import { mutate } from '../mutate';

function baseTournament() {
  return {
    id: 't1',
    players: [
      { id: 'a', name: 'A', handicap: 10 },
      { id: 'b', name: 'B', handicap: 12 },
    ],
    rounds: [
      {
        id: 'r1',
        holes: [],
        pairs: [[{ id: 'a' }], [{ id: 'b' }]],
        revealed: true,
        playerHandicaps: {},
        scores: {},
      },
    ],
    currentRound: 0,
    settings: { scoringMode: 'matchplay', bestBallValue: 1, worstBallValue: 1 },
  };
}

describe('tournament.addPlayer mutation', () => {
  test('applies nextScoringMode to settings.scoringMode when provided', async () => {
    const t = baseTournament();
    const player = { id: 'c', name: 'C', handicap: 8 };
    const next = await mutate(t, {
      type: 'tournament.addPlayer',
      player,
      roundPatches: [{
        roundId: 'r1',
        playerHandicap: 8,
        pairs: [[{ id: 'a' }], [{ id: 'b' }], [{ id: 'c' }]],
      }],
      nextScoringMode: 'stableford',
    });
    expect(next.settings.scoringMode).toBe('stableford');
    expect(next.players.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  test('leaves settings unchanged when nextScoringMode is absent', async () => {
    const t = baseTournament();
    const player = { id: 'c', name: 'C', handicap: 8 };
    const next = await mutate(t, {
      type: 'tournament.addPlayer',
      player,
      roundPatches: [{
        roundId: 'r1',
        playerHandicap: 8,
        pairs: [[{ id: 'a' }], [{ id: 'b' }], [{ id: 'c' }]],
      }],
    });
    expect(next.settings.scoringMode).toBe('matchplay');
    expect(next.players.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
});
```

If `mutate()` requires `AsyncStorage` / Supabase mocks that aren't trivially supplied, fall back to importing `applyToTournament` directly (export it from `mutate.js` if needed for testing; add a brief comment marking it as test-only). Update the tests to:

```js
import { applyToTournament } from '../mutate';

// ...
const t = baseTournament();
applyToTournament(t, { type: 'tournament.addPlayer', player, roundPatches, nextScoringMode: 'stableford' });
expect(t.settings.scoringMode).toBe('stableford');
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `npx jest src/store/__tests__/addPlayerMutation.test.js`
Expected: first test fails (`settings.scoringMode` is `'matchplay'`, not `'stableford'`). Second test passes.

- [ ] **Step 4: Update `pathsForMutation` to stamp `settings.scoringMode`**

In `src/store/mutate.js`, the `tournament.addPlayer` branch in `pathsForMutation` (around lines 26-33) is:

```js
case 'tournament.addPlayer': {
  const paths = ['players'];
  for (const patch of (m.roundPatches ?? [])) {
    paths.push(`rounds.${patch.roundId}.playerHandicaps.${m.player.id}`);
    if (patch.pairs) paths.push(`rounds.${patch.roundId}.pairs`);
  }
  return paths;
}
```

Replace with:

```js
case 'tournament.addPlayer': {
  const paths = ['players'];
  for (const patch of (m.roundPatches ?? [])) {
    paths.push(`rounds.${patch.roundId}.playerHandicaps.${m.player.id}`);
    if (patch.pairs) paths.push(`rounds.${patch.roundId}.pairs`);
  }
  if (m.nextScoringMode) paths.push('settings.scoringMode');
  return paths;
}
```

- [ ] **Step 5: Update `applyToTournament` to apply the mode change**

In `src/store/mutate.js`, the `tournament.addPlayer` branch in `applyToTournament` (around lines 94-106) is:

```js
case 'tournament.addPlayer': {
  t.players = [...(t.players ?? []), m.player];
  for (const patch of (m.roundPatches ?? [])) {
    const round = t.rounds?.find((r) => r.id === patch.roundId);
    if (!round) continue;
    round.playerHandicaps = {
      ...(round.playerHandicaps ?? {}),
      [m.player.id]: patch.playerHandicap,
    };
    if (patch.pairs) round.pairs = patch.pairs;
  }
  break;
}
```

Replace with:

```js
case 'tournament.addPlayer': {
  t.players = [...(t.players ?? []), m.player];
  for (const patch of (m.roundPatches ?? [])) {
    const round = t.rounds?.find((r) => r.id === patch.roundId);
    if (!round) continue;
    round.playerHandicaps = {
      ...(round.playerHandicaps ?? {}),
      [m.player.id]: patch.playerHandicap,
    };
    if (patch.pairs) round.pairs = patch.pairs;
  }
  if (m.nextScoringMode) {
    t.settings = { ...(t.settings ?? {}), scoringMode: m.nextScoringMode };
  }
  break;
}
```

- [ ] **Step 6: Run the mutation tests**

Run: `npx jest src/store/__tests__/addPlayerMutation.test.js`
Expected: both tests pass.

- [ ] **Step 7: Run the full suite**

Run: `npm test -- --silent`
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/store/mutate.js src/store/__tests__/addPlayerMutation.test.js
git commit -m "feat(mutate): tournament.addPlayer applies nextScoringMode atomically"
```

---

## Task 6: ScoringModeChangeSheet component

**Goal:** A reusable modal sheet listing modes valid for a given player count, with Continue/Cancel. Used by HomeScreen and ScorecardScreen banner.

**Files:**
- Create: `src/components/ScoringModeChangeSheet.js`

- [ ] **Step 1: Verify the theme import pattern**

Run:

```bash
grep -n "from '../theme'\|useTheme" src/components/ScoringModePicker.js
grep -n "theme.surface\|theme.text\|theme.accent" src/components/ScoringModePicker.js | head -10
```

Note the import path and the property names accessed on the theme object (`theme.surface.primary`, `theme.text.primary`, `theme.accent.primary`, etc.). Use these exact names in the new component.

- [ ] **Step 2: Create the sheet component**

Create `src/components/ScoringModeChangeSheet.js`:

```js
// Bottom-sheet modal for picking a scoring mode after the player count
// makes the current mode invalid. Lists only the modes valid for the
// supplied count, with `defaultMode` pre-selected. Parent controls the
// `visible` state and receives the user's choice via `onConfirm(modeKey)`,
// or `onCancel()` if dismissed.
import React, { useState, useEffect } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { SCORING_MODES, isScoringModeAllowed } from './scoringModes';

export default function ScoringModeChangeSheet({
  visible,
  playerCount,
  defaultMode,
  onConfirm,
  onCancel,
  title = 'Choose a scoring mode',
  subtitle,
}) {
  const theme = useTheme();
  const s = makeStyles(theme);
  const [selected, setSelected] = useState(defaultMode);

  useEffect(() => {
    if (visible) setSelected(defaultMode);
  }, [visible, defaultMode]);

  const allowed = SCORING_MODES.filter((m) => isScoringModeAllowed(m.key, playerCount));

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={s.backdrop}>
        <SafeAreaView style={s.sheet}>
          <Text style={s.title}>{title}</Text>
          {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
          <View style={s.list}>
            {allowed.map((mode) => {
              const isSelected = mode.key === selected;
              return (
                <TouchableOpacity
                  key={mode.key}
                  style={[s.row, isSelected && s.rowSelected]}
                  onPress={() => setSelected(mode.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                >
                  <Feather name={mode.icon} size={20} color={theme.accent.primary} />
                  <View style={s.rowText}>
                    <Text style={s.rowLabel}>{mode.label}</Text>
                    <Text style={s.rowSubtitle}>{mode.subtitle}</Text>
                  </View>
                  {isSelected ? (
                    <Feather name="check" size={20} color={theme.accent.primary} />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={s.actions}>
            <TouchableOpacity style={s.cancelBtn} onPress={onCancel}>
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.confirmBtn, !selected && s.confirmBtnDisabled]}
              onPress={() => selected && onConfirm(selected)}
              disabled={!selected}
            >
              <Text style={s.confirmText}>Continue</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
    sheet: {
      backgroundColor: theme.surface.primary,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      padding: 16,
    },
    title: { fontSize: 18, fontWeight: '600', color: theme.text.primary, marginBottom: 4 },
    subtitle: { fontSize: 13, color: theme.text.secondary, marginBottom: 12 },
    list: { marginBottom: 16 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      borderRadius: 8,
      marginBottom: 4,
    },
    rowSelected: { backgroundColor: theme.surface.secondary },
    rowText: { flex: 1, marginLeft: 12 },
    rowLabel: { fontSize: 15, fontWeight: '500', color: theme.text.primary },
    rowSubtitle: { fontSize: 12, color: theme.text.secondary, marginTop: 2 },
    actions: { flexDirection: 'row', gap: 12 },
    cancelBtn: {
      flex: 1, padding: 12, alignItems: 'center',
      borderRadius: 8, backgroundColor: theme.surface.secondary,
    },
    cancelText: { color: theme.text.primary, fontWeight: '500' },
    confirmBtn: {
      flex: 1, padding: 12, alignItems: 'center',
      borderRadius: 8, backgroundColor: theme.accent.primary,
    },
    confirmBtnDisabled: { opacity: 0.5 },
    confirmText: { color: '#fff', fontWeight: '600' },
  });
}
```

If the theme shape used by other components is different (e.g. `theme.colors.surface` instead of `theme.surface.primary`), update the style names to match. Inspect `ScoringModePicker.js`'s `makeStyles` function for the exact property names this project uses.

- [ ] **Step 3: Commit**

```bash
git add src/components/ScoringModeChangeSheet.js
git commit -m "feat(components): ScoringModeChangeSheet for mid-round mode picking"
```

---

## Task 7: HomeScreen two-pass `applyAddPlayers`

**Goal:** Detect mode break in pre-flight, prompt via `ScoringModeChangeSheet`, then commit adds with the chosen mode. Cancel aborts all adds.

**Files:**
- Modify: `src/screens/HomeScreen.js`

- [ ] **Step 1: Read the current imports and the `applyAddPlayers` function**

Run:

```bash
sed -n '1,30p' src/screens/HomeScreen.js
sed -n '200,230p' src/screens/HomeScreen.js
```

Note the existing imports (`addPlayerRoundPatches`, `mutate`, `loadTournament`, `setTournament`).

- [ ] **Step 2: Add imports**

Near the existing import block in `src/screens/HomeScreen.js`, add:

```js
import ScoringModeChangeSheet from '../components/ScoringModeChangeSheet';
import { isScoringModeAllowed, fallbackScoringMode, getScoringMode } from '../components/scoringModes';
```

- [ ] **Step 3: Add modal state and rewire `applyAddPlayers`**

Inside the `HomeScreen` function component, add (placing the `useState` near other `useState` calls and the callbacks near the existing `applyAddPlayers`):

```js
const [modePrompt, setModePrompt] = useState(null);
// modePrompt: { picked, newCount, defaultMode, prevMode } when prompting, null otherwise

const commitAdds = useCallback(async (picked, initialChosenMode) => {
  let t = await loadTournament();
  if (!t) return;
  let chosenMode = initialChosenMode;
  for (const p of picked) {
    if ((t.players ?? []).length >= 4) break;
    if ((t.players ?? []).some((x) => x.id === p.id)) continue;
    const player = { id: p.id, name: p.name, handicap: parseInt(p.handicap, 10) || 0 };
    const { patches: roundPatches, nextScoringMode } = addPlayerRoundPatches(t, player, { mode: chosenMode });
    const modeChanged = nextScoringMode !== (t.settings?.scoringMode ?? 'stableford');
    t = await mutate(t, {
      type: 'tournament.addPlayer',
      player,
      roundPatches,
      ...(modeChanged ? { nextScoringMode } : {}),
    });
    // Subsequent adds inherit the new mode via the loaded `t`; clear the
    // override so further picks don't keep re-applying the user's first-pick.
    chosenMode = undefined;
  }
  setTournament(t);
}, []);

const applyAddPlayers = useCallback(async (picked) => {
  const t = await loadTournament();
  if (!t) return;
  const currentMode = t.settings?.scoringMode ?? 'stableford';
  const existingIds = new Set((t.players ?? []).map((p) => p.id));
  let simulatedCount = (t.players ?? []).length;
  for (const p of picked) {
    if (simulatedCount >= 4) break;
    if (existingIds.has(p.id)) continue;
    simulatedCount += 1;
  }
  if (simulatedCount === (t.players ?? []).length) return; // nothing to add
  if (isScoringModeAllowed(currentMode, simulatedCount)) {
    await commitAdds(picked, undefined);
    return;
  }
  setModePrompt({
    picked,
    newCount: simulatedCount,
    defaultMode: fallbackScoringMode(simulatedCount),
    prevMode: currentMode,
  });
}, [commitAdds]);
```

If `applyAddPlayers` was previously a `useCallback` that called `mutate` inline, replace its entire body with the new version above.

- [ ] **Step 4: Render the prompt sheet**

In the JSX returned by `HomeScreen`, near the bottom (alongside any other modals), add:

```jsx
<ScoringModeChangeSheet
  visible={!!modePrompt}
  playerCount={modePrompt?.newCount ?? 0}
  defaultMode={modePrompt?.defaultMode}
  title="Pick a new scoring mode"
  subtitle={
    modePrompt
      ? `Adding this player makes ${getScoringMode(modePrompt.prevMode).label} invalid (${getScoringMode(modePrompt.prevMode).requirement.toLowerCase()}). Pick a mode for ${modePrompt.newCount} players.`
      : undefined
  }
  onConfirm={async (chosenMode) => {
    const picked = modePrompt.picked;
    setModePrompt(null);
    await commitAdds(picked, chosenMode);
  }}
  onCancel={() => setModePrompt(null)}
/>
```

- [ ] **Step 5: Start the dev server and smoke-test**

Run: `npm run web`

In the browser:
1. Create a casual game with 2 players and mode `matchplay`.
2. Navigate to PlayerPicker via the existing UI and pick a 3rd player.
3. Returning to HomeScreen, the prompt sheet should appear with the subtitle *"Adding this player makes Match Play invalid (requires exactly 2 players). Pick a mode for 3 players."* and `Stableford with Partners` pre-selected.
4. Tap "Continue" → player is added, `settings.scoringMode` becomes `stableford`, scorecard shows 3-player layout.
5. Repeat the flow but tap "Cancel" → no player added, mode remains `matchplay`.

If anything misbehaves, stop and diagnose before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/screens/HomeScreen.js
git commit -m "feat(HomeScreen): prompt for new scoring mode when adding a player breaks current mode"
```

---

## Task 8: ScorecardScreen mode-change notice banner

**Goal:** When `settings.scoringMode` changes, a transient banner appears at the top of ScorecardScreen using `fallbackNoticeText`. Tap reopens the picker so the user can pick again.

**Files:**
- Create: `src/components/ScoringModeChangeBanner.js`
- Modify: `src/screens/ScorecardScreen.js`
- Modify (if needed): `src/store/mutate.js`, `src/store/__tests__/addPlayerMutation.test.js`

- [ ] **Step 1: Create the banner component**

Create `src/components/ScoringModeChangeBanner.js`:

```js
// Transient banner shown on ScorecardScreen when the tournament's scoring
// mode just changed. Auto-dismisses after ~5s. Tap-to-reopen lets the
// user change the mode again via the supplied callback.
import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme';

export default function ScoringModeChangeBanner({ message, onPress, onDismiss }) {
  const theme = useTheme();
  const s = makeStyles(theme);

  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <TouchableOpacity style={s.banner} onPress={onPress} activeOpacity={0.85}>
      <Feather name="info" size={16} color={theme.text.primary} />
      <Text style={s.text} numberOfLines={2}>{message}</Text>
      <Text style={s.cta}>Change</Text>
    </TouchableOpacity>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 10,
      marginHorizontal: 12,
      marginTop: 8,
      borderRadius: 8,
      backgroundColor: theme.surface.secondary,
      gap: 8,
    },
    text: { flex: 1, fontSize: 13, color: theme.text.primary },
    cta: { fontSize: 13, color: theme.accent.primary, fontWeight: '600' },
  });
}
```

Match theme shape to the project convention (see Task 6 Step 1 — use whatever property names `ScoringModePicker.js` uses).

- [ ] **Step 2: Check whether a `tournament.setScoringMode` mutation already exists**

Run:

```bash
grep -n "setScoringMode\|settings.scoringMode" src/store/mutate.js
```

If a `tournament.setScoringMode` case is already present in `pathsForMutation` and `applyToTournament`, skip Step 3.

- [ ] **Step 3: Add a `tournament.setScoringMode` mutation if absent**

In `src/store/mutate.js`, add to `pathsForMutation`:

```js
case 'tournament.setScoringMode': return 'settings.scoringMode';
```

And to `applyToTournament`:

```js
case 'tournament.setScoringMode': {
  t.settings = { ...(t.settings ?? {}), scoringMode: m.scoringMode };
  break;
}
```

Add a test to `src/store/__tests__/addPlayerMutation.test.js`:

```js
describe('tournament.setScoringMode mutation', () => {
  test('updates settings.scoringMode and leaves players unchanged', async () => {
    const t = baseTournament();
    const next = await mutate(t, {
      type: 'tournament.setScoringMode',
      scoringMode: 'individual',
    });
    expect(next.settings.scoringMode).toBe('individual');
    expect(next.players.map((p) => p.id)).toEqual(['a', 'b']);
  });
});
```

Run: `npx jest src/store/__tests__/addPlayerMutation.test.js`
Expected: all tests pass.

- [ ] **Step 4: Add a `usePrevious` hook to ScorecardScreen**

Run: `grep -rn "usePrevious" src/`

If a shared helper exists, import it. Otherwise add an inline helper at the top of `src/screens/ScorecardScreen.js` (after imports):

```js
function usePrevious(value) {
  const ref = useRef(value);
  useEffect(() => { ref.current = value; }, [value]);
  return ref.current;
}
```

Add `useRef` to the React import line if it's not already there.

- [ ] **Step 5: Wire the banner into ScorecardScreen**

At the top of `src/screens/ScorecardScreen.js`, add imports (alongside existing imports):

```js
import ScoringModeChangeBanner from '../components/ScoringModeChangeBanner';
import ScoringModeChangeSheet from '../components/ScoringModeChangeSheet';
import { fallbackNoticeText } from '../components/scoringModes';
```

Inside the component body, locate the area where the tournament data is read. Add:

```js
const currentMode = tournament?.settings?.scoringMode ?? 'stableford';
const prevMode = usePrevious(currentMode);
const [noticeMessage, setNoticeMessage] = useState(null);
const [reopenPrompt, setReopenPrompt] = useState(false);

useEffect(() => {
  if (prevMode && prevMode !== currentMode) {
    setNoticeMessage(fallbackNoticeText(prevMode, currentMode));
  }
}, [prevMode, currentMode]);
```

Render the banner and sheet near the top of the screen's main JSX container (just inside whichever wrapping `View` is at the root of the rendered screen):

```jsx
<ScoringModeChangeBanner
  message={noticeMessage}
  onPress={() => setReopenPrompt(true)}
  onDismiss={() => setNoticeMessage(null)}
/>
<ScoringModeChangeSheet
  visible={reopenPrompt}
  playerCount={(tournament?.players ?? []).length}
  defaultMode={currentMode}
  title="Change scoring mode"
  onConfirm={async (chosenMode) => {
    setReopenPrompt(false);
    if (chosenMode === currentMode) return;
    await mutate(tournament, {
      type: 'tournament.setScoringMode',
      scoringMode: chosenMode,
    });
  }}
  onCancel={() => setReopenPrompt(false)}
/>
```

- [ ] **Step 6: Smoke-test the full UX flow**

Run: `npm run web`

1. Create a 2-player matchplay game.
2. Add a 3rd player via PlayerPicker, accept the `stableford` fallback in the prompt.
3. Land on ScorecardScreen — banner reads *"Match Play needs exactly 2 players — switched to Stableford with Partners."* and disappears after 5s.
4. Within 5s, tap "Change" on the banner — sheet reopens. Pick a different valid mode (e.g. `individual`). Confirm.
5. ScorecardScreen re-renders with the new mode active. A second banner appears reading the new fallback notice text (e.g. *"Stableford with Partners needs 3+ players — switched to Stableford."* — verify exact text via `fallbackNoticeText`).

Note: the banner appears on *any* mode change because that's the simplest signal. If the broader spec ever needs to distinguish forced from user-initiated changes, gate the `setNoticeMessage` call on a flag — but for this plan's scope, every change in scope is forced.

- [ ] **Step 7: Run the full test suite**

Run: `npm test -- --silent`
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/ScoringModeChangeBanner.js src/screens/ScorecardScreen.js src/store/mutate.js src/store/__tests__/addPlayerMutation.test.js
git commit -m "feat(ScorecardScreen): mode-change banner + tap-to-reopen picker"
```

---

## Task 9: Final verification

**Goal:** End-to-end smoke + lint + push.

**Files:** None modified — verification only.

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: no errors. Fix anything flagged from earlier tasks before continuing.

- [ ] **Step 2: Full test suite**

Run: `npm test -- --silent`
Expected: all green.

- [ ] **Step 3: Manual smoke matrix**

Walk through each scenario in `npm run web`:

| Start mode | Players | Action | Expected |
|---|---|---|---|
| matchplay | 2 | Add 3rd → prompt → pick stableford | Banner; 2 random pairs (one solo); mode = stableford |
| matchplay | 2 | Add 3rd → prompt → pick individual | Banner; 3 solo pairs; mode = individual |
| matchplay | 2 | Add 3rd → prompt → Cancel | No add; mode unchanged; no banner |
| sindicato | 3 | Add 4th → prompt → pick bestball | Banner; 2 random pairs of 2; mode = bestball |
| sindicato | 3 | Add 4th → prompt → pick stableford | Banner; 2 random pairs of 2; mode = stableford |
| stableford (revealed) | 3 | Add 4th → no prompt | Existing pairs preserved + 4th as solo group; mode unchanged |
| individual | 2 | Add 3rd → no prompt | New solo pair appended; mode unchanged |

If any row misbehaves, stop and fix before pushing.

- [ ] **Step 4: Push the branch**

```bash
git push origin feature/strokes-gained-spec
```

---

## Self-review summary

Coverage map vs. the spec:

- Store: rewrite + new return shape — Tasks 1, 2, 3.
- Mode resolution rules — Task 2.
- Pair construction rules — Task 3.
- Multi-round behavior — Task 4 (regression-only).
- Mutation `nextScoringMode` — Task 5.
- Atomic player + settings update — Task 5.
- HomeScreen prompt flow — Task 7.
- ScorecardScreen banner + tap-to-reopen — Task 8.
- Picker reuse component — Task 6.
- Open question on `HomeScreen >= 4` cap — left untouched per spec.
- Open question on ClaimPlayerScreen — never passes `{ mode }`, addressed in Task 1's destructure-only edit.
- Open question on backward-compat with queued mutations — addressed in Task 5 (absent `nextScoringMode` is a no-op).
