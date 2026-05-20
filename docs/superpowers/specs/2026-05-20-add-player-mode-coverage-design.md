# Add-Player Mode Coverage — Design

**Date:** 2026-05-20
**Scope:** Casual tournaments only. Official tournaments out of scope.

## Problem

`addPlayerRoundPatches` in `src/store/tournamentStore.js:597-623` only branches on
two of five scoring modes:

| Mode | Handled? | Behavior |
|---|---|---|
| `individual` | yes | Appends new player as a solo pair. |
| `stableford` (with partners) | yes | Not-yet-revealed rounds reshuffle; revealed rounds slot the player into a short pair, else append solo. |
| `matchplay` | no | Falls through the `if/else if` chain; `pairs` stays `null`. |
| `sindicato` | no | Same. |
| `bestball` | no | Same. |

When `pairs` is `null`, `src/store/mutate.js:103` keeps the old layout
(`if (patch.pairs) round.pairs = patch.pairs;`). The new player gets a
`playerHandicaps` entry but appears in no pair, while `settings.scoringMode` is
now mathematically invalid for the new roster (matchplay requires exactly 2,
sindicato exactly 3, bestball exactly 4).

Reachable from the UI today (`HomeScreen.applyAddPlayers` caps adds at 4 total
players):

- **matchplay 2→3** — silently breaks the round.
- **sindicato 3→4** — silently breaks the round.

`bestball 4→5` is not reachable; the 4-player cap blocks it.

## Goals

1. `addPlayerRoundPatches` produces a coherent round state for every mode — no
   silent broken paths.
2. When the new roster size makes the current mode invalid, the user picks the
   new mode from a prompt at the call site.
3. The store has an auto-fallback as the safety net: any call site that does
   not prompt still produces valid pairs.
4. Roster change and mode change land in a single mutation — the tournament is
   never persisted with a 3-player matchplay (or similar) state.

## Non-Goals

- Removing players mid-round.
- Changing modes mid-round without a roster change.
- Official tournaments.
- Per-round mode (mode stays tournament-level).

## Design

### Store: `addPlayerRoundPatches` rewrite

New signature:

```js
addPlayerRoundPatches(tournament, player, { mode } = {})
  → { patches, nextScoringMode }
```

`mode` is optional. When omitted the store picks the mode; when provided (by
the prompt UX) the store honors it if valid for the new count.

**Mode resolution**, in order:

1. If `mode` is provided AND `isScoringModeAllowed(mode, newCount)` → use `mode`.
2. Else if `isScoringModeAllowed(currentMode, newCount)` → keep `currentMode`.
3. Else → `fallbackScoringMode(newCount)` (`stableford` when count ≥ 3, else
   `individual`).

**Pair construction**, one branch (no per-mode ladder):

```js
function buildPairs({ roster, newMode, oldMode, existingPairs, newPlayer, revealed }) {
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

The "preserve existing pairs and append new player as solo" branch requires
both:

- old AND new mode are team-based (per `scoringModeUsesTeams`), AND
- the round's `revealed` flag is true.

Otherwise pair construction is fresh. Non-team modes (`individual`,
`matchplay`, `sindicato`) all produce `roster.map(p => [p])` — every player is
their own group — which is what the existing `individual` branch produced.

`revealed` is preserved per round (not reset). The old code's heuristic
`round.revealed || idx <= currentRound` is dropped; we read `round.revealed`
directly, which is correctly `false` for not-yet-played future rounds.

Multi-round behavior unchanged: rounds before `tournament.currentRound` are
untouched; current round and later get patches.

### Mutation: `tournament.addPlayer`

The mutation gains one optional field `nextScoringMode`.

`mutate.js` changes:

- **`pathsForMutation`** — when `nextScoringMode` is present, the returned path
  list also includes `'settings.scoringMode'` so the sync queue treats it as a
  touched path (LWW).
- **`applyToTournament`** — when `nextScoringMode` is present, set
  `t.settings = { ...t.settings, scoringMode: nextScoringMode }` alongside the
  existing player append.

When `nextScoringMode` is absent (mode stayed valid), behavior is unchanged —
backward-compatible with any pending mutations already in the offline queue.

### Call site: `HomeScreen.applyAddPlayers`

The function becomes a two-pass:

1. **Pre-flight.** Walk the picked players and simulate the resulting roster
   count. If the final count makes the current mode invalid, open a
   mode-picker bottom sheet showing the modes valid for that count (via
   `isScoringModeAllowed`), with `fallbackScoringMode(newCount)`
   pre-selected. Two actions:
   - **Continue** — `chosenMode` becomes the user's pick.
   - **Cancel** — abort all pending adds (no partial commit).
2. **Commit.** Run the existing serial loop, passing `{ mode: chosenMode }` to
   `addPlayerRoundPatches`. After the first add flips the tournament mode,
   subsequent adds inherit it because the current mode is now valid for the
   running count — no need to re-pass `chosenMode`.

The bottom-sheet picker reuses the existing `ScoringModePicker` component,
filtered to the modes allowed for `newCount`.

### Notice banner on ScorecardScreen

After a forced mode change, `ScorecardScreen` shows a transient banner
(reusing the existing notice pattern from `SetupScreen`) with text from
`fallbackNoticeText(prevKey, nextKey)` — e.g. *"Sindicato needs exactly 3
players — switched to Stableford with Partners."* Tap to reopen the picker.

## Testing

### Unit — `src/store/__tests__/addPlayerRoundPatches.test.js` (new)

Cases:

- `individual` 2→3, 3→4, 4→5 → solo pair appended; `nextScoringMode === 'individual'`.
- `stableford` (revealed) 3→4 → existing pairs preserved, new player appended
  as solo group; mode unchanged.
- `stableford` (unrevealed future round in a multi-round tournament) → fresh
  `randomPairs` for that round; mode unchanged.
- `matchplay` 2→3 with no override → `nextScoringMode === 'stableford'`,
  `randomPairs(roster)`.
- `matchplay` 2→3 with `{ mode: 'individual' }` → `nextScoringMode === 'individual'`,
  solo pairs.
- `matchplay` 2→3 with `{ mode: 'sindicato' }` → `nextScoringMode === 'sindicato'`,
  solo pairs.
- `sindicato` 3→4 with no override → `nextScoringMode === 'stableford'`,
  `randomPairs(roster)`.
- `sindicato` 3→4 with `{ mode: 'bestball' }` → `nextScoringMode === 'bestball'`,
  `randomPairs(roster)`.
- Invalid override (`{ mode: 'matchplay' }` at 3 players) → ignored; auto-fallback applies.
- Multi-round: only `currentRound` and later rounds patched; earlier rounds
  untouched.
- `playerHandicap` derived correctly per round (regression check).

### Mutation — extend existing `merge.test.js` / `tournamentStore.test.js`

- `tournament.addPlayer` with `nextScoringMode` updates `settings.scoringMode`
  and stamps the path.
- `tournament.addPlayer` without `nextScoringMode` leaves `settings.scoringMode`
  untouched.

### Manual smoke

- 2-player matchplay → add 3rd → prompt → pick `stableford` → scorecard shows
  2 groups (one solo), banner with fallback text.
- Same flow, cancel the prompt → no players added, no mode change, no banner.
- 3-player sindicato → add 4th → prompt → pick `bestball` → 2 pairs of 2.

## Risks & Open Questions

- **HomeScreen `>= 4` cap.** Today `applyAddPlayers` caps adds at 4 players.
  With the new logic the store handles 5+ via `individual` or `stableford`
  fallback. Decision: keep the 4-cap for this fix (the broader mid-round
  feature can revisit it), so this spec doesn't touch that line.
- **Sindicato leaderboard math.** `sindicatoHolePoints` requires exactly 3
  players. After the fallback flips the mode, no UI path should still call
  `sindicatoRoundTally`. Confirm during implementation that the leaderboard
  selection is driven by `tournament.settings.scoringMode` and re-renders
  after the mutation lands.
- **Caller call sites.** `addPlayerRoundPatches` is called from
  `HomeScreen.applyAddPlayers` and `ClaimPlayerScreen` (line 111). Only
  HomeScreen needs the prompt UX; ClaimPlayerScreen joins a claiming user to
  an existing tournament and should default to auto-fallback (the joiner can't
  meaningfully pick the mode for someone else's game). Implementation must
  pass `{ mode }` only from HomeScreen.
- **Pending offline mutations.** Any `tournament.addPlayer` mutation already
  serialized to the sync queue before this change ships will lack
  `nextScoringMode`. The new `mutate.js` handles absent `nextScoringMode` as a
  no-op for settings — safe.
