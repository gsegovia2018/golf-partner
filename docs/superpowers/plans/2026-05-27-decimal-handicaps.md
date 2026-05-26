# Decimal Handicaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow player handicap index to be entered to one decimal place (e.g., 12.4) across every screen and persistence boundary; keep per-round course handicap integer per WHS.

**Architecture:** One shared helper (`src/lib/handicap.js`) parses and validates handicap-index strings. Five screens and three stores switch from `parseInt` to that helper. One line in `src/store/scoring.js` switches from `parseInt` to `parseFloat` so the decimal index participates in slope adjustment before the final `Math.round` to integer course handicap. No data migration.

**Tech Stack:** React Native (Expo SDK 54), Jest, plain JS (no TS).

**Spec:** `docs/superpowers/specs/2026-05-27-decimal-handicaps-design.md`

> **Spec amendment:** While preparing this plan I found three additional `parseInt(handicap, ...)` sites in the store layer (`src/store/libraryStore.js:70`, `src/store/tournamentStore.js:525`, `src/store/profileStore.js:53`). Without updating these, decimals would be stripped on the persistence boundary even though every screen passes them through. Task 3 covers them. This is a strict extension of the spec's "shared validation helper" principle — same helper, same data shape, more call sites than the spec enumerated.

---

## File Structure

**New files:**
- `src/lib/handicap.js` — shared `parseHandicapIndex` helper (one exported function)
- `src/lib/__tests__/handicap.test.js` — unit tests for the helper

**Modified files:**
- `src/store/scoring.js` — `calcPlayingHandicap` uses `parseFloat` instead of `parseInt` on the index input
- `src/store/__tests__/scoring.test.js` — add decimal-index cases for `calcPlayingHandicap`
- `src/store/libraryStore.js` — `upsertPlayer` uses helper
- `src/store/tournamentStore.js` — `propagatePlayerToTournaments` uses helper
- `src/store/profileStore.js` — `upsertProfile` uses helper
- `src/screens/PlayersLibraryScreen.js` — helper + `decimal-pad`
- `src/screens/ProfileScreen.js` — helper + `decimal-pad` + updated alert text
- `src/screens/OfficialSetupScreen.js` — helper + `decimal-pad`
- `src/screens/ClaimPlayerScreen.js` — helper + `decimal-pad`
- `src/screens/EditTournamentScreen.js` — helper on the player-index column only; per-round playing-handicap column stays integer

---

## Task 1: Shared `parseHandicapIndex` helper (TDD)

**Files:**
- Create: `src/lib/handicap.js`
- Test: `src/lib/__tests__/handicap.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/handicap.test.js`:

```js
import { parseHandicapIndex } from '../handicap';

describe('parseHandicapIndex', () => {
  it('accepts integer strings', () => {
    expect(parseHandicapIndex('0')).toEqual({ ok: true, value: 0 });
    expect(parseHandicapIndex('12')).toEqual({ ok: true, value: 12 });
    expect(parseHandicapIndex('54')).toEqual({ ok: true, value: 54 });
  });

  it('accepts one-decimal strings', () => {
    expect(parseHandicapIndex('12.4')).toEqual({ ok: true, value: 12.4 });
    expect(parseHandicapIndex('0.5')).toEqual({ ok: true, value: 0.5 });
  });

  it('trims surrounding whitespace', () => {
    expect(parseHandicapIndex('  12.4 ')).toEqual({ ok: true, value: 12.4 });
  });

  it('rejects empty input', () => {
    expect(parseHandicapIndex('')).toEqual({ ok: false, reason: 'required' });
    expect(parseHandicapIndex('   ')).toEqual({ ok: false, reason: 'required' });
  });

  it('rejects non-numeric strings', () => {
    expect(parseHandicapIndex('abc').ok).toBe(false);
    expect(parseHandicapIndex('12abc').ok).toBe(false);
  });

  it('rejects negative numbers', () => {
    expect(parseHandicapIndex('-1').ok).toBe(false);
  });

  it('rejects values above 54', () => {
    expect(parseHandicapIndex('55').ok).toBe(false);
    expect(parseHandicapIndex('100').ok).toBe(false);
  });

  it('rejects two or more decimal places', () => {
    expect(parseHandicapIndex('12.45').ok).toBe(false);
    expect(parseHandicapIndex('12.456').ok).toBe(false);
  });

  it('rejects trailing dot', () => {
    expect(parseHandicapIndex('12.').ok).toBe(false);
  });

  it('rejects a leading dot (no integer part)', () => {
    expect(parseHandicapIndex('.5').ok).toBe(false);
  });

  it('returns a number, not a string', () => {
    const result = parseHandicapIndex('12.4');
    expect(typeof result.value).toBe('number');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/lib/__tests__/handicap.test.js`
Expected: FAIL — `Cannot find module '../handicap'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/handicap.js`:

```js
// Parse a handicap-index string (WHS allows 0–54 to one decimal place).
// Returns { ok: true, value: number } or { ok: false, reason: string }.
// Callers may treat `reason: 'required'` differently from 'invalid' (e.g.,
// coerce empty input to 0 in optional fields).
export function parseHandicapIndex(input) {
  const trimmed = String(input ?? '').trim();
  if (trimmed === '') return { ok: false, reason: 'required' };
  if (!/^\d+(\.\d)?$/.test(trimmed)) return { ok: false, reason: 'invalid' };
  const value = parseFloat(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > 54) {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true, value };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/lib/__tests__/handicap.test.js`
Expected: PASS — all 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/handicap.js src/lib/__tests__/handicap.test.js
git commit -m "feat: add parseHandicapIndex helper for decimal handicaps"
```

---

## Task 2: `calcPlayingHandicap` honors decimal index (TDD)

**Files:**
- Modify: `src/store/scoring.js:26-35`
- Test: `src/store/__tests__/scoring.test.js`

- [ ] **Step 1: Add failing tests to `src/store/__tests__/scoring.test.js`**

Append this block to the end of the file:

```js
describe('calcPlayingHandicap with decimal index', () => {
  it('honors a decimal index that crosses an integer band (slope-neutral)', () => {
    // 12.5 × 113/113 = 12.5 → Math.round = 13 (today's parseInt drops to 12 → 12)
    expect(calcPlayingHandicap(12.5, 113, 72, 72)).toBe(13);
  });

  it('honors a decimal index that crosses an integer band (slope 130)', () => {
    // 14.5 × 130/113 ≈ 16.681 → 17 (today: 14 × 130/113 ≈ 16.106 → 16)
    expect(calcPlayingHandicap(14.5, 130, 72, 72)).toBe(17);
  });

  it('matches the integer result when index is whole', () => {
    expect(calcPlayingHandicap(12, 130, 72, 72)).toBe(14);
    expect(calcPlayingHandicap(12.0, 130, 72, 72)).toBe(14);
  });

  it('accepts a string decimal (UI passes strings through)', () => {
    expect(calcPlayingHandicap('12.5', 113, 72, 72)).toBe(13);
  });

  it('falls back to 0 on garbage input', () => {
    expect(calcPlayingHandicap('abc', 113, 72, 72)).toBe(0);
    expect(calcPlayingHandicap(undefined, 113, 72, 72)).toBe(0);
  });

  it('returns raw decimal index when slope is missing (slope=0 fallback)', () => {
    expect(calcPlayingHandicap(12.4, 0, 72, 72)).toBe(12.4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/store/__tests__/scoring.test.js -t "with decimal index"`
Expected: FAIL — the two "honors a decimal index..." tests fail with received `12` and `16` respectively.

- [ ] **Step 3: Update `src/store/scoring.js`**

Replace lines 26–35 with:

```js
// WHS course handicap: HI × (slope/113) + (CR − par), rounded.
// No slope → raw index (can't compute either term meaningfully).
// Missing CR or par → slope-only fallback.
export function calcPlayingHandicap(index, slope, rating, par) {
  const parsed = parseFloat(index);
  const idx = Number.isFinite(parsed) ? parsed : 0;
  const sv = parseInt(slope, 10) || 0;
  if (sv <= 0) return idx;
  const slopeAdj = idx * (sv / STANDARD_SLOPE);
  const cr = parseFloat(rating);
  const pv = parseInt(par, 10) || 0;
  const crAdj = (Number.isFinite(cr) && pv > 0) ? (cr - pv) : 0;
  return Math.round(slopeAdj + crAdj);
}
```

Note: when slope ≤ 0 the function returns `idx` directly, which is now possibly a non-integer. That is intentional — the slope-missing fallback returns the raw index, and per the spec the index *is* allowed to be decimal. The test "returns raw decimal index when slope is missing" pins this behavior.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/store/__tests__/scoring.test.js`
Expected: PASS — all existing tests + the 6 new ones green.

- [ ] **Step 5: Commit**

```bash
git add src/store/scoring.js src/store/__tests__/scoring.test.js
git commit -m "fix(scoring): calcPlayingHandicap honors decimal handicap index"
```

---

## Task 3: Store-layer parsing uses the helper

**Files:**
- Modify: `src/store/libraryStore.js:70`
- Modify: `src/store/tournamentStore.js:525`
- Modify: `src/store/profileStore.js:53`

No new tests — these stores are exercised by `libraryStore.test.js`, `tournamentStore.test.js`, and `profileStore.test.js`, which must stay green after the swap.

- [ ] **Step 1: Run the affected test suites first to capture baseline**

Run: `npx jest src/store/__tests__/libraryStore.test.js src/store/__tests__/tournamentStore.test.js src/store/__tests__/profileStore.test.js`
Expected: PASS — all green. Note the test count for comparison after.

- [ ] **Step 2: Update `src/store/libraryStore.js`**

At the top of the file, add the import alongside existing imports:

```js
import { parseHandicapIndex } from '../lib/handicap';
```

Replace line 70:

```js
// before
const row = { name, handicap: parseInt(handicap, 10) || 0 };
// after
const parsed = parseHandicapIndex(handicap);
const row = { name, handicap: parsed.ok ? parsed.value : 0 };
```

- [ ] **Step 3: Update `src/store/tournamentStore.js`**

At the top of the file, add the import alongside existing imports:

```js
import { parseHandicapIndex } from '../lib/handicap';
```

Replace line 525:

```js
// before
const parsedIndex = parseInt(handicap, 10) || 0;
// after
const result = parseHandicapIndex(handicap);
const parsedIndex = result.ok ? result.value : 0;
```

- [ ] **Step 4: Update `src/store/profileStore.js`**

First, read lines 48–58 to confirm the surrounding ternary. The original block looks like:

```js
handicap: fields.handicap == null || fields.handicap === ''
  ? null
  : parseInt(fields.handicap, 10),
```

Add the import:

```js
import { parseHandicapIndex } from '../lib/handicap';
```

Replace the ternary:

```js
handicap: (() => {
  if (fields.handicap == null || fields.handicap === '') return null;
  const r = parseHandicapIndex(fields.handicap);
  return r.ok ? r.value : null;
})(),
```

If the surrounding code uses `parseInt` in a slightly different shape (e.g., as a standalone statement), apply the same principle: route through `parseHandicapIndex` and fall back to the same sentinel the existing code uses on parse failure (`null` here).

- [ ] **Step 5: Re-run the store tests**

Run: `npx jest src/store/__tests__/libraryStore.test.js src/store/__tests__/tournamentStore.test.js src/store/__tests__/profileStore.test.js`
Expected: PASS — same green count as Step 1.

- [ ] **Step 6: Run the full test suite to catch any cross-store regressions**

Run: `npm test`
Expected: PASS — all ~330 tests green.

- [ ] **Step 7: Commit**

```bash
git add src/store/libraryStore.js src/store/tournamentStore.js src/store/profileStore.js
git commit -m "refactor(store): route handicap parsing through parseHandicapIndex helper"
```

---

## Task 4: PlayersLibraryScreen — input accepts decimals

**Files:**
- Modify: `src/screens/PlayersLibraryScreen.js:69,130`

- [ ] **Step 1: Add import at the top of the file**

```js
import { parseHandicapIndex } from '../lib/handicap';
```

- [ ] **Step 2: Replace line 69 in the `save()` function's create branch**

```js
// before
const hcp = parseInt(handicap, 10) || 0;
// after
const parsed = parseHandicapIndex(handicap);
const hcp = parsed.ok ? parsed.value : 0;
```

- [ ] **Step 3: Replace `keyboardType` on line 130 (the handicap `<TextInput>`)**

```jsx
// before
keyboardType="numeric"
// after
keyboardType="decimal-pad"
```

- [ ] **Step 4: Manual smoke test**

Run: `npm run web` (or `npm start` and open in a browser)
1. Open the Players library.
2. Add a new player "TestDecimal" with handicap `12.4` and tap save.
3. Confirm the row renders "HCP 12.4" (no rounding to 12).
4. Edit the same row, change handicap to `8.7`, save, reload. Confirm persists as `8.7`.
5. Try entering `12.45` — saving falls back to `0` (rejected by helper). Acceptable for this iteration; no inline validation UI in this plan.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS — all green.

- [ ] **Step 6: Commit**

```bash
git add src/screens/PlayersLibraryScreen.js
git commit -m "feat(library): accept decimal handicap input"
```

---

## Task 5: ProfileScreen — input accepts decimals, alert text updated

**Files:**
- Modify: `src/screens/ProfileScreen.js:114-119,297`

- [ ] **Step 1: Add import at the top of the file**

```js
import { parseHandicapIndex } from '../lib/handicap';
```

- [ ] **Step 2: Replace the integer validation block on lines 114–119**

```js
// before
if (handicap.trim() !== '') {
  const n = parseInt(handicap, 10);
  if (!Number.isFinite(n) || n < 0 || n > 54) {
    Alert.alert('Invalid handicap', 'Handicap must be a whole number between 0 and 54.');
    return;
  }
}
// after
if (handicap.trim() !== '') {
  const parsed = parseHandicapIndex(handicap);
  if (!parsed.ok) {
    Alert.alert('Invalid handicap', 'Handicap must be between 0 and 54, with up to one decimal place.');
    return;
  }
}
```

- [ ] **Step 3: Replace `keyboardType` on line 297**

```jsx
// before
keyboardType="numeric"
// after
keyboardType="decimal-pad"
```

- [ ] **Step 4: Manual smoke test**

Run: `npm run web`
1. Open Profile.
2. Set handicap to `12.4`, save, reload — confirm persists.
3. Set handicap to `12.45` — alert "Handicap must be between 0 and 54, with up to one decimal place." appears; save aborted.
4. Set handicap to `100` — same alert.
5. Set handicap to `0` and `54` — both save successfully.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/screens/ProfileScreen.js
git commit -m "feat(profile): accept decimal handicap with updated validation"
```

---

## Task 6: OfficialSetupScreen — input accepts decimals

**Files:**
- Modify: `src/screens/OfficialSetupScreen.js:150,368`

- [ ] **Step 1: Add import at the top of the file**

```js
import { parseHandicapIndex } from '../lib/handicap';
```

- [ ] **Step 2: Replace line 150 inside `handleAddPlayer`**

Original:

```js
const row = await addRosterPlayer(tournamentId, {
  displayName: trimmed,
  handicap: parseInt(newHandicap, 10) || 0,
});
```

After:

```js
const parsedHcp = parseHandicapIndex(newHandicap);
const row = await addRosterPlayer(tournamentId, {
  displayName: trimmed,
  handicap: parsedHcp.ok ? parsedHcp.value : 0,
});
```

- [ ] **Step 3: Replace `keyboardType` on line 368**

```jsx
// before
keyboardType="numeric"
// after
keyboardType="decimal-pad"
```

- [ ] **Step 4: Manual smoke test**

Run: `npm run web`
1. Open an official tournament setup.
2. Add a player with handicap `9.3` — confirm row renders `Handicap 9.3`.
3. Add a player with handicap `12` — renders `Handicap 12`.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/screens/OfficialSetupScreen.js
git commit -m "feat(official): accept decimal handicap input on roster add"
```

---

## Task 7: ClaimPlayerScreen — input accepts decimals

**Files:**
- Modify: `src/screens/ClaimPlayerScreen.js:108,230`

- [ ] **Step 1: Add import at the top of the file**

```js
import { parseHandicapIndex } from '../lib/handicap';
```

- [ ] **Step 2: Replace line 108 inside the "add new player" save path**

Original:

```js
const player = {
  id: playerId,
  name,
  handicap: parseInt(newHcp, 10) || 0,
  user_id: profile.userId,
};
```

After:

```js
const parsedHcp = parseHandicapIndex(newHcp);
const player = {
  id: playerId,
  name,
  handicap: parsedHcp.ok ? parsedHcp.value : 0,
  user_id: profile.userId,
};
```

- [ ] **Step 3: Replace `keyboardType` on line 230**

```jsx
// before
keyboardType="number-pad"
// after
keyboardType="decimal-pad"
```

- [ ] **Step 4: Manual smoke test**

Run: `npm run web`
1. Open a tournament invite link in an incognito window (or as a different user).
2. Choose "Add a new player" and enter handicap `15.6`.
3. Claim the player and confirm the tournament row renders `Hcp 15.6`.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/screens/ClaimPlayerScreen.js
git commit -m "feat(claim): accept decimal handicap when joining via invite"
```

---

## Task 8: EditTournamentScreen — player index column accepts decimals (per-round column unchanged)

**Files:**
- Modify: `src/screens/EditTournamentScreen.js:170` (player handicap **index** column)
- Do **NOT** modify: `src/screens/EditTournamentScreen.js:118` (per-round playing-handicap column — stays integer per spec)

- [ ] **Step 1: Add import at the top of the file**

```js
import { parseHandicapIndex } from '../lib/handicap';
```

- [ ] **Step 2: Replace line 170 inside `addRound`**

```js
// before
const builtPlayers = players.map((p) => ({ ...p, handicap: parseInt(p.handicap, 10) || 0 }));
// after
const builtPlayers = players.map((p) => {
  const r = parseHandicapIndex(p.handicap);
  return { ...p, handicap: r.ok ? r.value : 0 };
});
```

- [ ] **Step 3: Audit the save path for the same pattern**

`grep -n "parseInt(p.handicap" src/screens/EditTournamentScreen.js` — if any other occurrence of `parseInt(p.handicap, 10) || 0` exists (e.g., in the main save handler), apply the same helper-based replacement. The save logic also calls `String(p.handicap)` when writing `playerHandicaps` for a new round — that line stays unchanged because the *playing* handicap is still derived integer-side via existing logic.

- [ ] **Step 4: Verify the per-round column stays integer**

Confirm line ~118 still parses with `parseInt`:

```js
Object.entries(r.playerHandicaps).map(([id, v]) => [id, parseInt(v, 10) || 0]),
```

If accidentally changed, revert it. The per-round `playerHandicaps` value is the integer course handicap.

- [ ] **Step 5: Manual smoke test**

Run: `npm run web`
1. Open Edit Tournament for a tournament with one or more players.
2. Edit a player's index to `11.6`. Save.
3. Reload the tournament. Confirm the player row shows `11.6` as the index.
4. Confirm per-round playing handicaps (the per-round column) remain integers (e.g., `13` not `13.345`).

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: PASS — all ~330 tests green.

- [ ] **Step 7: Commit**

```bash
git add src/screens/EditTournamentScreen.js
git commit -m "feat(edit-tournament): accept decimal handicap index, keep per-round integer"
```

---

## Final verification

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: PASS (no new warnings introduced).

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: PASS — all green, including 11 new helper tests and 6 new `calcPlayingHandicap` tests.

- [ ] **Step 3: Smoke flow on web**

Run: `npm run web`
1. Create a fresh player with handicap `12.4`.
2. Start a new tournament including that player.
3. Pick a tee with slope 130 — confirm the derived playing handicap shows as integer (e.g., 14).
4. Score a hole — confirm Stableford points compute normally with the integer course handicap.
5. Edit the player's index to `8.7` in the library — confirm it propagates and the per-round playing handicap re-derives.

- [ ] **Step 4: Final commit (if any cleanups)**

Only if cleanups are needed. Otherwise the task-by-task commits stand on their own.
