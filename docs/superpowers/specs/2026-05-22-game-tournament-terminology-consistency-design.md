# Game / Tournament Terminology Consistency — Design

**Date:** 2026-05-22
**Status:** Approved (design)

## Problem

An invite link can be to a casual **game** (a single round, stored as a
`tournaments` record with `kind: 'game'`) or to a multi-round **tournament**
(`kind` unset / not `'game'`). The user-facing copy does not consistently
reflect which one the recipient is joining.

In the invite/join flow a guest joining a casual game currently sees:

1. `JoinTournamentLinkScreen` — "You're invited to a **round**" then
   "Join the **tournament** to enter scores" (two different nouns, one screen).
2. `JoinTournamentScreen` — header "Join **Tournament**", "Ask the
   **tournament** owner…", spinner "Joining **tournament**…", error fallback
   "Could not join **tournament**".
3. `ClaimPlayerScreen` — mostly correct (computes a dynamic `noun`), but leaks
   a hardcoded "tournament" at `:267` and "Could not load tournament" at `:52`.

Separately, the `kind === 'game' ? … : …` label ternary is copy-pasted across
the codebase with no shared helper, so the logic drifts and is easy to get
wrong (the root cause of the inconsistency above).

## Goals

- The invite/join flow uses wording consistent with what the recipient is
  actually joining (a game vs a tournament), or neutral wording where the
  screen genuinely cannot know.
- The game-vs-tournament label decision lives in one place (a store helper),
  so screens cannot drift again.
- The identical "round label" computation duplicated between `FeedScreen` and
  `RoundSummaryScreen` is also de-duplicated.

## Non-Goals

- No change to boolean `kind === 'game'` uses that drive *logic* (list
  filtering, `isGame` flags) in `HomeScreen`, `FinishedScreen`,
  `HistoryScreen`, `SetupScreen`, `personalStats.js`. Those are correct.
- No change to navigation route names (`JoinTournament`, `ClaimPlayer`,
  `Tournament`) — internal, not user-facing.
- No new server-side lookup to let pre-session screens discover `kind`.
  Screens that cannot know `kind` use neutral wording instead.

## Approach

Add label helpers to `src/store/tournamentStore.js` (domain logic belongs in
stores, per CLAUDE.md) and route every label site through them. Screens that
render copy before `kind` is known use neutral wording.

Alternatives considered and rejected: inline string fixes with no helper
(re-creates the duplication this work removes); a dedicated constants/map
module (overkill for two words).

## Component 1 — Helpers in `src/store/tournamentStore.js`

```js
// 'game' for a casual single round, 'tournament' otherwise.
export function tournamentNoun(tournament) {
  return tournament?.kind === 'game' ? 'game' : 'tournament';
}

// Capitalized variant for headers / titles: 'Game' / 'Tournament'.
export function tournamentNounCapitalized(tournament) {
  return tournament?.kind === 'game' ? 'Game' : 'Tournament';
}

// Round display label: course name for a casual game, "Round N" otherwise.
// Takes a plain object so it serves both full tournament objects and the
// flattened feed-item shape.
export function roundLabel({ kind, courseName, roundIndex }) {
  return kind === 'game' ? (courseName || 'Round') : `Round ${roundIndex + 1}`;
}
```

Contract:
- `tournamentNoun` / `tournamentNounCapitalized` accept a tournament object or
  `null`/`undefined`; a missing object yields the `'tournament'` / `'Tournament'`
  default (matching today's `tournament?.kind === 'game'` behavior).
- `roundLabel` accepts a plain `{ kind, courseName, roundIndex }` object.
  `roundIndex` is zero-based; the label shows `roundIndex + 1`.

## Component 2 — Join-flow copy fixes (the bug)

### `src/screens/JoinTournamentLinkScreen.js`
Pre-session screen; the code is not yet redeemed, so `kind` is unknowable.
Use neutral wording:
- Title `:49` "You're invited to a round" → **"You're invited to play"**
- Subtitle `:51` "Join the tournament to enter scores. Log in if you already
  have a Golf Partner account, or jump straight in as a guest." →
  **"Join to enter scores. Log in if you already have a Golf Partner account,
  or jump straight in as a guest."**

### `src/screens/JoinTournamentScreen.js`
Copy renders before the code is redeemed, so `kind` is unknowable at display
time. Use neutral wording:
- Header `:73` "Join Tournament" → **"Join"**
- Subtitle `:88` "Ask the tournament owner for their invite code." →
  **"Ask the organiser for their invite code."**
- Spinner `:80` "Joining tournament…" → **"Joining…"**
- Error fallback `:51` "Could not join tournament" → **"Could not join"**

### `src/screens/ClaimPlayerScreen.js`
This screen has the tournament loaded and already computes `noun` (`:125`).
Two leaks remain:
- `:267` guest save-account copy "…you keep this **tournament** if you switch
  devices." → use `noun` (`tournamentNoun`): "…you keep this {noun}…".
- `:52` load-failure error "Could not load tournament" → neutral
  **"Could not load"** — this path runs when the tournament failed to load,
  so `kind` is unknown.

After this change `ClaimPlayerScreen` uses the helper instead of its inline
`tournament?.kind === 'game' ? 'game' : 'tournament'` at `:125`.

## Component 3 — DRY refactor of existing (correct) label sites

These already branch correctly; they are routed through the new helpers so the
logic exists once.

| Site | Current | After |
|---|---|---|
| `HomeScreen.js:1458` | `tournament?.kind === 'game' ? 'game' : 'tournament'` | `tournamentNoun(tournament)` |
| `HomeScreen.js:1607` | `tournament.kind === 'game' ? 'Game Settings' : 'Tournament Settings'` | `` `${tournamentNounCapitalized(tournament)} Settings` `` |
| `HomeScreen.js:1691` | `tournament.kind === 'game' ? 'Game' : 'Tournament'` | `tournamentNounCapitalized(tournament)` |
| `FeedScreen.js:359` | inline `roundLabel` ternary on `item.tournamentKind` | `roundLabel({ kind: item.tournamentKind, courseName: item.courseName, roundIndex: item.roundIndex })` |
| `RoundSummaryScreen.js:79` | inline `roundLabel` ternary on `tournament?.kind` | `roundLabel({ kind: tournament?.kind, courseName: round?.courseName, roundIndex })` |

Boolean uses of `kind === 'game'` (filters, `isGame` flags in
Home/Finished/History/Setup/personalStats) are **not** touched — they are
logic, not labels.

## Error Handling

No new failure modes. Helpers are pure and total — they never throw and handle
`null`/`undefined` input by returning the `tournament` default. Behavior is
unchanged for every input the current inline ternaries already handle.

## Testing

Unit tests for the three helpers, added to the existing
`src/store/__tests__/tournamentStore.test.js`:

- `tournamentNoun`: `kind: 'game'` → `'game'`; other `kind` → `'tournament'`;
  `null`/`undefined` tournament → `'tournament'`.
- `tournamentNounCapitalized`: same matrix → `'Game'` / `'Tournament'`.
- `roundLabel`: `kind: 'game'` with `courseName` → course name; `kind: 'game'`
  without `courseName` → `'Round'`; non-game `kind` → `'Round N'` with
  `roundIndex + 1`.

Screen copy changes are static strings — no UI test needed. Run `npm run lint`
and `npm test` (the existing ~330-test suite) to confirm no regressions.

## Files Touched

- `src/store/tournamentStore.js` — add three exported helpers.
- `src/screens/JoinTournamentLinkScreen.js` — neutral copy.
- `src/screens/JoinTournamentScreen.js` — neutral copy.
- `src/screens/ClaimPlayerScreen.js` — use helper; fix two leaks.
- `src/screens/HomeScreen.js` — route three label sites through helpers.
- `src/screens/FeedScreen.js` — use `roundLabel`.
- `src/screens/RoundSummaryScreen.js` — use `roundLabel`.
- `src/store/__tests__/tournamentStore.test.js` — helper tests.
