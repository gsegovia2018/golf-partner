# Game / Tournament Terminology Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the invite/join flow use wording consistent with what the recipient is joining (a casual game vs a multi-round tournament), and route every game-vs-tournament label through shared helpers so the logic exists once.

**Architecture:** Add three pure label helpers to `src/store/tournamentStore.js`. Fix the inconsistent copy in the three join-flow screens (using neutral wording where a screen cannot yet know the `kind`). Refactor the existing, already-correct inline label ternaries across `HomeScreen`, `FeedScreen`, and `RoundSummaryScreen` to call the new helpers.

**Tech Stack:** React Native 0.81 / React 19 (Expo SDK 54), plain JS store modules, Jest (jest-expo) for tests, ESLint 9 flat config.

**Background:** A casual game is stored as a `tournaments` record with `kind: 'game'`; multi-round tournaments have `kind` of `'casual'`, `'official'`, etc. The discriminator is `kind === 'game'` → game, anything else → tournament. See `docs/superpowers/specs/2026-05-22-game-tournament-terminology-consistency-design.md`.

---

### Task 1: Add label helpers to `tournamentStore.js`

**Files:**
- Modify: `src/store/tournamentStore.js` (insert after `findClaimedSlot`, ~line 1333)
- Test: `src/store/__tests__/tournamentStore.test.js`

- [ ] **Step 1: Write the failing tests**

In `src/store/__tests__/tournamentStore.test.js`, change the import on line 1 from:

```js
import { rowToTournament, reTeeRound } from '../tournamentStore';
```

to:

```js
import {
  rowToTournament, reTeeRound,
  tournamentNoun, tournamentNounCapitalized, formatRoundLabel,
} from '../tournamentStore';
```

Then append these three `describe` blocks to the end of the file:

```js
describe('tournamentNoun', () => {
  test('casual game kind returns "game"', () => {
    expect(tournamentNoun({ kind: 'game' })).toBe('game');
  });
  test('non-game kinds return "tournament"', () => {
    expect(tournamentNoun({ kind: 'casual' })).toBe('tournament');
    expect(tournamentNoun({ kind: 'official' })).toBe('tournament');
  });
  test('missing tournament returns "tournament"', () => {
    expect(tournamentNoun(null)).toBe('tournament');
    expect(tournamentNoun(undefined)).toBe('tournament');
  });
});

describe('tournamentNounCapitalized', () => {
  test('casual game kind returns "Game"', () => {
    expect(tournamentNounCapitalized({ kind: 'game' })).toBe('Game');
  });
  test('non-game kinds return "Tournament"', () => {
    expect(tournamentNounCapitalized({ kind: 'casual' })).toBe('Tournament');
    expect(tournamentNounCapitalized(null)).toBe('Tournament');
  });
});

describe('formatRoundLabel', () => {
  test('game with a course name shows the course name', () => {
    expect(formatRoundLabel({ kind: 'game', courseName: 'Pebble Beach', roundIndex: 0 }))
      .toBe('Pebble Beach');
  });
  test('game without a course name falls back to "Round"', () => {
    expect(formatRoundLabel({ kind: 'game', courseName: '', roundIndex: 0 }))
      .toBe('Round');
    expect(formatRoundLabel({ kind: 'game', roundIndex: 0 }))
      .toBe('Round');
  });
  test('non-game shows "Round N" with a 1-based index', () => {
    expect(formatRoundLabel({ kind: 'casual', courseName: 'Ignored', roundIndex: 0 }))
      .toBe('Round 1');
    expect(formatRoundLabel({ kind: 'official', roundIndex: 2 }))
      .toBe('Round 3');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tournamentStore.test.js`
Expected: FAIL — the new tests error because `tournamentNoun`, `tournamentNounCapitalized`, and `formatRoundLabel` are not exported (`TypeError: ... is not a function`).

- [ ] **Step 3: Implement the helpers**

In `src/store/tournamentStore.js`, find `findClaimedSlot` (~line 1330):

```js
// Find the player slot already bound to a given user id, if any. Used to
// auto-match a joiner (a friend the creator added from their friends list,
// whose slot carries their user_id) so they skip the "which player?" picker.
export function findClaimedSlot(players, userId) {
  if (!userId || !Array.isArray(players)) return null;
  return players.find((p) => p && p.user_id === userId) ?? null;
}
```

Immediately after that function's closing `}`, insert:

```js

// User-facing noun for a tournament record: 'game' for a casual single round
// (kind === 'game'), 'tournament' for everything else. One place so screen
// copy cannot drift.
export function tournamentNoun(tournament) {
  return tournament?.kind === 'game' ? 'game' : 'tournament';
}

// Capitalized variant of tournamentNoun, for headers and titles.
export function tournamentNounCapitalized(tournament) {
  return tournament?.kind === 'game' ? 'Game' : 'Tournament';
}

// Round display label: the course name for a casual game, "Round N" for a
// multi-round tournament. Takes a plain { kind, courseName, roundIndex }
// object so it serves both full tournament objects and the flattened
// feed-item shape. roundIndex is zero-based; the label shows roundIndex + 1.
export function formatRoundLabel({ kind, courseName, roundIndex }) {
  return kind === 'game' ? (courseName || 'Round') : `Round ${roundIndex + 1}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tournamentStore.test.js`
Expected: PASS — all `tournamentStore.test.js` tests green, including the three new `describe` blocks.

- [ ] **Step 5: Commit**

```bash
git add src/store/tournamentStore.js src/store/__tests__/tournamentStore.test.js
git commit -m "feat: add tournamentNoun and formatRoundLabel label helpers"
```

---

### Task 2: Fix `JoinTournamentLinkScreen` copy

**Files:**
- Modify: `src/screens/JoinTournamentLinkScreen.js:49-53`

This screen renders pre-session, before the invite code is redeemed, so it cannot know whether the invite is to a game or a tournament. Use neutral wording.

- [ ] **Step 1: Replace the title and subtitle**

Find (lines 49-53):

```jsx
        <Text style={s.title}>You're invited to a round</Text>
        <Text style={s.subtitle}>
          Join the tournament to enter scores. Log in if you already have a
          Golf Partner account, or jump straight in as a guest.
        </Text>
```

Replace with:

```jsx
        <Text style={s.title}>You're invited to play</Text>
        <Text style={s.subtitle}>
          Join to enter scores. Log in if you already have a
          Golf Partner account, or jump straight in as a guest.
        </Text>
```

- [ ] **Step 2: Run the linter**

Run: `npm run lint`
Expected: PASS — no new errors or warnings.

- [ ] **Step 3: Commit**

```bash
git add src/screens/JoinTournamentLinkScreen.js
git commit -m "fix: neutral invite-link copy (not always a tournament)"
```

---

### Task 3: Fix `JoinTournamentScreen` copy

**Files:**
- Modify: `src/screens/JoinTournamentScreen.js` — lines 51, 73, 80, 88

All of this copy renders before the code is redeemed (`kind` unknown at display time), so use neutral wording.

- [ ] **Step 1: Fix the error fallback (line 51)**

Find:

```js
      Alert.alert('Error', err.message ?? 'Could not join tournament');
```

Replace with:

```js
      Alert.alert('Error', err.message ?? 'Could not join');
```

- [ ] **Step 2: Fix the header title (line 73)**

Find:

```jsx
        <Text style={s.headerTitle}>Join Tournament</Text>
```

Replace with:

```jsx
        <Text style={s.headerTitle}>Join</Text>
```

- [ ] **Step 3: Fix the loading spinner caption (line 80)**

Find:

```jsx
          <Text style={[s.subtitle, { marginTop: 16 }]}>Joining tournament…</Text>
```

Replace with:

```jsx
          <Text style={[s.subtitle, { marginTop: 16 }]}>Joining…</Text>
```

- [ ] **Step 4: Fix the code-prompt subtitle (line 88)**

Find:

```jsx
          <Text style={s.subtitle}>Ask the tournament owner for their invite code.</Text>
```

Replace with:

```jsx
          <Text style={s.subtitle}>Ask the organiser for their invite code.</Text>
```

- [ ] **Step 5: Run the linter**

Run: `npm run lint`
Expected: PASS — no new errors or warnings.

- [ ] **Step 6: Commit**

```bash
git add src/screens/JoinTournamentScreen.js
git commit -m "fix: neutral join-screen copy (not always a tournament)"
```

---

### Task 4: Fix `ClaimPlayerScreen` — use the helper and close the two leaks

**Files:**
- Modify: `src/screens/ClaimPlayerScreen.js` — import block (lines 10-13), lines 52, 125, 265-268

- [ ] **Step 1: Add `tournamentNoun` to the import**

Find (lines 10-13):

```js
import {
  getTournament, addPlayerRoundPatches, claimTournamentPlayer,
  refreshTournamentFromRemote,
} from '../store/tournamentStore';
```

Replace with:

```js
import {
  getTournament, addPlayerRoundPatches, claimTournamentPlayer,
  refreshTournamentFromRemote, tournamentNoun,
} from '../store/tournamentStore';
```

- [ ] **Step 2: Fix the load-failure error (line 52)**

This runs when the tournament failed to load, so `kind` is unknown — use neutral wording.

Find:

```js
        if (!cancelled) Alert.alert('Error', err.message ?? 'Could not load tournament');
```

Replace with:

```js
        if (!cancelled) Alert.alert('Error', err.message ?? 'Could not load');
```

- [ ] **Step 3: Use the helper for `noun` (line 125)**

Find:

```js
  const noun = tournament?.kind === 'game' ? 'game' : 'tournament';
```

Replace with:

```js
  const noun = tournamentNoun(tournament);
```

- [ ] **Step 4: Close the hardcoded "tournament" leak (lines 265-268)**

`noun` is defined at the top of the component body (Step 3) and is in scope here.

Find:

```jsx
              <Text style={s.saveAccountText}>
                You're playing as a guest. Add an email in your profile so you
                keep this tournament if you switch devices.
              </Text>
```

Replace with:

```jsx
              <Text style={s.saveAccountText}>
                You're playing as a guest. Add an email in your profile so you
                keep this {noun} if you switch devices.
              </Text>
```

- [ ] **Step 5: Run the linter**

Run: `npm run lint`
Expected: PASS — no new errors or warnings (in particular, no unused-import warning for `tournamentNoun`).

- [ ] **Step 6: Commit**

```bash
git add src/screens/ClaimPlayerScreen.js
git commit -m "fix: route ClaimPlayer copy through tournamentNoun helper"
```

---

### Task 5: Refactor `HomeScreen` label sites to the helpers

**Files:**
- Modify: `src/screens/HomeScreen.js` — import block (~line 27), lines 1458, 1607, 1691

- [ ] **Step 1: Add the helpers to the import**

Find (the end of the `from '../store/tournamentStore'` import, ~lines 27-28):

```js
  setScoringModeRoundPatches,
} from '../store/tournamentStore';
```

Replace with:

```js
  setScoringModeRoundPatches,
  tournamentNoun, tournamentNounCapitalized,
} from '../store/tournamentStore';
```

- [ ] **Step 2: Use `tournamentNoun` for the invite-subtitle noun (line 1458)**

Find:

```js
              const noun = tournament?.kind === 'game' ? 'game' : 'tournament';
```

Replace with:

```js
              const noun = tournamentNoun(tournament);
```

- [ ] **Step 3: Use `tournamentNounCapitalized` for the settings-modal title (line 1607)**

Find:

```jsx
          <Text style={s.modalTitle}>{tournament.kind === 'game' ? 'Game Settings' : 'Tournament Settings'}</Text>
```

Replace with:

```jsx
          <Text style={s.modalTitle}>{`${tournamentNounCapitalized(tournament)} Settings`}</Text>
```

- [ ] **Step 4: Use `tournamentNounCapitalized` for `kindLabel` (line 1691)**

`kindLabel` is used at lines 1700 and 1712 (`Reopen {kindLabel}` / `Finish {kindLabel}`) — keep the variable name so those usages are unchanged.

Find:

```js
            const kindLabel = tournament.kind === 'game' ? 'Game' : 'Tournament';
```

Replace with:

```js
            const kindLabel = tournamentNounCapitalized(tournament);
```

- [ ] **Step 5: Run the linter**

Run: `npm run lint`
Expected: PASS — no new errors or warnings (both new imports are used).

- [ ] **Step 6: Commit**

```bash
git add src/screens/HomeScreen.js
git commit -m "refactor: route HomeScreen labels through tournamentNoun helpers"
```

---

### Task 6: Refactor `FeedScreen` and `RoundSummaryScreen` to `formatRoundLabel`

**Files:**
- Modify: `src/screens/FeedScreen.js` — line 15, lines 358-360
- Modify: `src/screens/RoundSummaryScreen.js` — line 12, lines 79-81

- [ ] **Step 1: Add `formatRoundLabel` to the `FeedScreen` import (line 15)**

Find:

```js
import { subscribeTournamentChanges } from '../store/tournamentStore';
```

Replace with:

```js
import { subscribeTournamentChanges, formatRoundLabel } from '../store/tournamentStore';
```

- [ ] **Step 2: Use `formatRoundLabel` in `FeedScreen` (lines 358-360)**

Find:

```js
    const roundLabel = item.tournamentKind === 'game'
      ? (item.courseName || 'Round')
      : `Round ${item.roundIndex + 1}`;
```

Replace with:

```js
    const roundLabel = formatRoundLabel({
      kind: item.tournamentKind,
      courseName: item.courseName,
      roundIndex: item.roundIndex,
    });
```

- [ ] **Step 3: Add `formatRoundLabel` to the `RoundSummaryScreen` import (line 12)**

Find:

```js
import { readLocal, roundTotals, setActiveTournament } from '../store/tournamentStore';
```

Replace with:

```js
import { readLocal, roundTotals, setActiveTournament, formatRoundLabel } from '../store/tournamentStore';
```

- [ ] **Step 4: Use `formatRoundLabel` in `RoundSummaryScreen` (lines 79-81)**

Find:

```js
  const roundLabel = tournament?.kind === 'game'
    ? (round?.courseName || 'Round')
    : `Round ${roundIndex + 1}`;
```

Replace with:

```js
  const roundLabel = formatRoundLabel({
    kind: tournament?.kind,
    courseName: round?.courseName,
    roundIndex,
  });
```

- [ ] **Step 5: Run the linter**

Run: `npm run lint`
Expected: PASS — no new errors or warnings (both new imports are used; the local `roundLabel` const is distinct from the imported `formatRoundLabel`).

- [ ] **Step 6: Commit**

```bash
git add src/screens/FeedScreen.js src/screens/RoundSummaryScreen.js
git commit -m "refactor: route round labels through formatRoundLabel helper"
```

---

### Task 7: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full linter**

Run: `npm run lint`
Expected: PASS — clean, no errors or warnings (CI-blocking gate).

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS — all ~330 tests green, including the three new helper `describe` blocks. No regressions.

- [ ] **Step 3: Confirm no stray hardcoded copy remains in the join flow**

Run: `grep -rn "tournament" src/screens/JoinTournamentLinkScreen.js src/screens/JoinTournamentScreen.js`
Expected: only import/identifier references remain (`JoinTournament`, `joinTournamentByCode`, `tournamentId`, `getTournament`, `setActiveTournament`, route names) — no user-facing copy strings containing the word "tournament".
