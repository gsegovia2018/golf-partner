# Decimal handicaps

**Date:** 2026-05-27
**Status:** Approved (pending user review of this spec)

## Problem

Players cannot enter decimal handicaps. The WHS handicap *index* is published to one decimal place (e.g., 12.4), but every input field in the app forces an integer. Existing UX even spells this out: `ProfileScreen` rejects decimals with "Handicap must be a whole number between 0 and 54."

Note that `ProfileScreen` already accepts decimal *target* handicaps (`parseFloat`, `decimal-pad`) — so we are aligning the *primary* handicap field with a pattern that already exists one row above it.

## Goal

Allow up to one decimal place when entering a player's handicap index, across every screen that accepts handicap input. Keep per-round playing handicap (the course handicap derived via slope/CR) as an integer, per WHS standard.

## Non-goals

- Changing scoring math (Stableford, match-play, Sindicato). They keep operating on integer course handicaps.
- Allowing decimals on the per-round playing-handicap override column in `EditTournamentScreen`. Course handicap stays integer.
- Storage migrations. JS numbers handle integers and one-decimal floats identically; existing data round-trips.
- Input-validation tests on screens (none exist today; out of scope).

## Data model

Two distinct concepts, only one of which changes:

| Field | Today | After |
|---|---|---|
| `player.handicap` (profile-level *index*) | integer | number, up to 1 decimal place (0–54) |
| `round.playerHandicaps[playerId]` (per-round *course handicap*) | integer | **unchanged** — integer, derived via `calcPlayingHandicap` which rounds |

`calcExtraShots` (`floor(h/18) + (SI ≤ h%18 ? 1 : 0)`), Stableford, match-play, Sindicato, and tournament leaderboards all keep receiving integer course handicaps. No changes there.

## Scoring math change

One line in `src/store/scoring.js calcPlayingHandicap`: switch the input parse from `parseInt(index, 10)` to `parseFloat(index)`. Today a `12.4` index would be truncated to `12` *before* slope adjustment; after the change it participates in the slope multiplication and only rounds at the end (existing `Math.round(slopeAdj + crAdj)`).

Concretely:

```js
// before
const idx = parseInt(index, 10) || 0;
// after
const parsed = parseFloat(index);
const idx = Number.isFinite(parsed) ? parsed : 0;
```

Behavior (CR = par for simplicity, so `crAdj = 0`):

| Index | Slope | New (`parseFloat`) | Today (`parseInt`) | Shifts? |
|---|---|---|---|---|
| `12` | 113 | `round(12.00) = 12` | `round(12.00) = 12` | no |
| `12.5` | 113 | `round(12.50) = 13` | `round(12.00) = 12` | **+1** |
| `12.4` | 130 | `round(14.265) = 14` | `round(13.805) = 14` | no |
| `12.6` | 130 | `round(14.495) = 14` | `round(13.805) = 14` | no |
| `14.5` | 130 | `round(16.681) = 17` | `round(16.106) = 16` | **+1** |
| `11.6` | 130 | `round(13.345) = 13` | `round(12.655) = 13` | no |

In some bands the integer course handicap shifts by one when the decimal is honored — that *is* the bug being fixed. Most bands land on the same integer, which is also fine.

## Shared validation helper

To avoid five copies of `parseInt(…, 10) || 0` drifting in the screens, add a small helper:

**Location:** `src/lib/handicap.js` (new file; `src/lib` already exists and is the right neighborhood for cross-screen helpers).

```js
// Returns { ok: true, value: number } or { ok: false, reason: string }.
// Accepts integer or one-decimal strings between 0 and 54 inclusive.
export function parseHandicapIndex(input) { … }
```

Rules:
- Trim whitespace.
- Empty string → `{ ok: false, reason: 'required' }` (caller can decide to coerce to 0 instead).
- Must match `/^\d+(\.\d)?$/` (digits, optional single decimal).
- Numeric value in `[0, 54]`.
- Returns the parsed `number`, not a string.

## UI changes

All handicap input sites switch to `keyboardType="decimal-pad"`, parse with the helper, and validate via the helper:

| File | Lines (today) | Change |
|---|---|---|
| `src/screens/PlayersLibraryScreen.js` | 69, 130 | `parseFloat` via helper; `decimal-pad` |
| `src/screens/ProfileScreen.js` | 114-117, 297 | `parseFloat` via helper; alert text → "between 0 and 54 with up to one decimal"; `decimal-pad` |
| `src/screens/OfficialSetupScreen.js` | 150, 368 | `parseFloat` via helper; `decimal-pad` |
| `src/screens/ClaimPlayerScreen.js` | 108, 230 | `parseFloat` via helper; `decimal-pad` |
| `src/screens/EditTournamentScreen.js` | 170 (player *index* column only) | `parseFloat` via helper |
| `src/screens/EditTournamentScreen.js` | 118 (per-round playing-handicap column) | **unchanged** — stays `parseInt` |

Display sites (`HCP {p.handicap}` in PlayersLibrary, SetupScreen, ClaimPlayerScreen, OfficialSetupScreen) need no change. `String(12.4)` renders "12.4"; `String(12)` still renders "12".

## Storage & propagation

- `player.handicap` becomes a `number` that may be non-integer. AsyncStorage and Supabase JSON columns serialize it identically to integers — no schema migration.
- `propagatePlayerToTournaments(id, { handicap })` already pushes the value as-is to all tournaments containing the player; tournament-side `recomputeRoundPlayingHandicaps` re-derives the integer course handicap for every non-manual entry. No change required.
- `manualHandicaps` flag logic in `normalizeRoundHandicaps` and `recomputeRoundPlayingHandicaps` is unchanged. Manual per-round overrides remain integer.

## Tests

1. **`src/store/__tests__/scoring.test.js`** (existing or new):
   - `calcPlayingHandicap(12.4, 113, 72, 72)` → 12 (slope-neutral, no rounding loss).
   - `calcPlayingHandicap(11.6, 130, 72, 72)` → 13 (decimal participates in slope adjustment).
   - `calcPlayingHandicap('12.4', …)` (string input from text fields) → same as numeric.

2. **`src/lib/__tests__/handicap.test.js`** (new):
   - Accepts: `'0'`, `'12'`, `'12.4'`, `'54'`, `'  12.4 '` (with whitespace).
   - Rejects: `''`, `'abc'`, `'-1'`, `'55'`, `'12.45'` (two decimals), `'12.'` (trailing dot), `'.5'` (no integer part — the regex `/^\d+(\.\d)?$/` requires at least one digit before the decimal).
   - Returns `number` type, not string.

3. **Existing scoring/leaderboard tests** stay green unchanged — `calcExtraShots` and downstream consumers still receive integer course handicaps.

## Edge cases & risks

- **Recompute on edit:** A user editing handicap from `12` to `12.4` in PlayersLibrary triggers `recomputeRoundPlayingHandicaps` across in-flight tournaments via `propagatePlayerToTournaments`. Only non-manual entries change. This is the existing flow — not new — but worth flagging.
- **iOS decimal separator:** `decimal-pad` shows `.` on US keyboards and `,` on locales that use comma decimals. `parseFloat` does not accept comma. We do not currently localize numeric input elsewhere in the app, so we will not start here. If a user types `12,4` the helper rejects it.
- **Sync conflicts:** `merge.js` LWW conflict logic operates on equality. `12 !== 12.4` works fine. No change.
- **Backwards compatibility:** Old data with `handicap: 12` (integer) keeps working — `parseFloat('12')` is `12`, `String(12)` is `"12"`.

## Out of scope

- Two-decimal indexes (WHS publishes one decimal; we match WHS).
- Localized decimal separator (`,` vs `.`).
- Decimal per-round playing handicaps.
- New input-validation UI tests for the five screens (none exist today).
