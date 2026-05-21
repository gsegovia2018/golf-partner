# Remove Player Mid-Round — Design

**Date:** 2026-05-21
**Scope:** Casual tournaments only. Official tournaments out of scope.
**Sibling feature:** `2026-05-20-add-player-mode-coverage-design.md` — this is the symmetric remove-side counterpart.

## Problem

A user can add players mid-round (with an auto-fallback + mode prompt when the
new count breaks the current mode), but there is no way to remove a player
once a game is underway. If a player leaves, the round is stuck with them on
the scorecard and leaderboard.

## Goals

1. Remove one player at a time from an in-progress casual game via the
   `HomeScreen` settings sheet.
2. The removed player's per-round data is dropped entirely (scores, shot
   details, playing handicap) — as if they never played.
3. When the smaller roster makes the current scoring mode invalid, prompt the
   user to pick a new mode (reusing the existing `ScoringModeChangeSheet`).
4. The roster change and any mode change land in a single atomic mutation.
5. A game can never be reduced below 2 players.

## Non-Goals

- Removing the current user themselves (`tournament.meId` is never removable).
- "Withdrew at hole N" / partial-scorecard semantics — removal is a full drop.
- Multi-select removal — one player per action.
- Official tournaments.
- Per-round roster (roster stays tournament-level; removal affects the current
  round and every later round, matching the add-player model).

## Design

### Store: `removePlayerRoundPatches`

Mirror of `addPlayerRoundPatches`. New export in `src/store/tournamentStore.js`:

```js
removePlayerRoundPatches(tournament, playerId, { mode } = {})
  → { patches, nextScoringMode }
```

`mode` is optional. When omitted the store resolves the mode; when provided
(by the prompt UX) the store honors it if valid for the new count.

**Mode resolution**, in order (identical ladder to the add side):

1. If `mode` is provided AND `isScoringModeAllowed(mode, newCount)` → use `mode`.
2. Else if `isScoringModeAllowed(currentMode, newCount)` → keep `currentMode`.
3. Else → `fallbackScoringMode(newCount)`.

`newCount` is `tournament.players.length - 1`.

**Pair construction** per round, one branch keyed on `scoringModeUsesTeams`
(reuses the same shape as the add side's `buildPairsForAddedPlayer`; a new
sibling helper `buildPairsForRemovedPlayer` is added):

```js
function buildPairsForRemovedPlayer({ survivors, newMode, oldMode, existingPairs, removedId, revealed }) {
  if (!scoringModeUsesTeams(newMode)) {
    return survivors.map((p) => [p]);
  }
  const oldWasTeams = scoringModeUsesTeams(oldMode, survivors.length + 1);
  if (oldWasTeams && existingPairs?.length && revealed) {
    return existingPairs
      .map((pr) => pr.filter((p) => p.id !== removedId))
      .filter((pr) => pr.length > 0);
  }
  return randomPairs(survivors);
}
```

- Non-team new mode → every survivor is their own group.
- Team new mode AND old mode also team AND round revealed → keep existing
  pairs, drop the removed player from whichever pair holds them (an emptied
  pair is discarded; a half-emptied pair becomes a 1-member group).
- Otherwise → fresh `randomPairs(survivors)`.

`revealed` is preserved per round. Rounds before `tournament.currentRound` are
untouched. Each patch carries `{ roundId, pairs }` and the function returns
`{ patches, nextScoringMode }`.

### Mutation: `tournament.removePlayer`

New mutation type in `src/store/mutate.js`.

Payload: `{ type: 'tournament.removePlayer', playerId, roundPatches, nextScoringMode? }`.

`applyToTournament`:
- `t.players = t.players.filter((p) => p.id !== m.playerId)`.
- For each patch: find the round; delete `round.playerHandicaps[playerId]`,
  `round.scores[playerId]`, `round.shotDetails[playerId]`; set `round.pairs`
  to the patch's `pairs`. Use immutable copy-then-delete so callers' objects
  are not mutated in place (consistent with the existing `applyToTournament`
  cases).
- If `m.nextScoringMode` is present, set
  `t.settings = { ...(t.settings ?? {}), scoringMode: m.nextScoringMode }`.

`metaPathFor` (the LWW path-list function) stamps:
- `'players'`
- per patch: `rounds.<roundId>.playerHandicaps.<playerId>`,
  `rounds.<roundId>.scores.<playerId>`,
  `rounds.<roundId>.shotDetails.<playerId>`,
  `rounds.<roundId>.pairs`
- `'settings.scoringMode'` only when `nextScoringMode` is present.

### UI: PlayerRemoveSheet component

New `src/components/PlayerRemoveSheet.js` — a bottom-sheet modal:
- Props: `{ visible, players, onSelect, onCancel }`.
- `players` is the already-filtered removable list (caller excludes `meId`).
- Renders one `TouchableOpacity` row per player (name + handicap), a Cancel
  button. Tapping a row calls `onSelect(playerId)`.
- Matches the visual treatment of `ScoringModeChangeSheet` (theme tokens
  `theme.bg.*`, `theme.text.*`, `theme.accent.*`, `theme.border.subtle`;
  project fonts).

### HomeScreen wiring

Settings sheet: add a **"Remove Player"** menu item directly under
"Add Player", shown when `!isViewer && tournament.players.length > 2`. The
`> 2` gate (symmetric with Add Player's `< 4`) means the item never appears
when removal is impossible — a 2-player game shows no Remove item rather than
a button that always fails. Tapping it closes the settings sheet and opens
`PlayerRemoveSheet` with the roster minus `tournament.meId`.

New callbacks on `HomeScreen`:

```js
const commitRemove = useCallback(async (playerId, chosenMode) => {
  let t = await loadTournament();
  if (!t) return;
  const { patches: roundPatches, nextScoringMode } =
    removePlayerRoundPatches(t, playerId, { mode: chosenMode });
  const modeChanged = nextScoringMode !== (t.settings?.scoringMode ?? 'stableford');
  t = await mutate(t, {
    type: 'tournament.removePlayer',
    playerId,
    roundPatches,
    ...(modeChanged ? { nextScoringMode } : {}),
  });
  setTournament(t);
}, []);

const applyRemovePlayer = useCallback(async (playerId) => {
  const t = await loadTournament();
  if (!t) return;
  const newCount = (t.players ?? []).length - 1;
  if (newCount < 2) {
    Alert.alert('Cannot remove', 'A game needs at least 2 players.');
    return;
  }
  const currentMode = t.settings?.scoringMode ?? 'stableford';
  if (isScoringModeAllowed(currentMode, newCount)) {
    await commitRemove(playerId, undefined);
    return;
  }
  setRemoveModePrompt({
    playerId,
    newCount,
    defaultMode: fallbackScoringMode(newCount),
    prevMode: currentMode,
  });
}, [commitRemove]);
```

`PlayerRemoveSheet`'s `onSelect` closes the sheet then calls
`applyRemovePlayer(playerId)`. When a mode break is detected, the existing
`ScoringModeChangeSheet` is reused (a second instance, driven by
`removeModePrompt` state) — `onConfirm` calls `commitRemove(playerId, chosenMode)`,
`onCancel` aborts the removal.

The "< 2 players" floor is also enforced in `applyRemovePlayer` as a
defensive guard before any sheet opens — even though the menu item's `> 2`
gate normally prevents reaching it, the tournament is re-read from
`loadTournament()` and the count could differ from render time.
`fallbackScoringMode(1)` would return `individual`, which is itself invalid
at 1 player, so the prompt must never be reached for that case.

### Banner

The existing `ScorecardScreen` mode-change banner already fires on any
`settings.scoringMode` change, so a removal-driven mode switch surfaces the
notice with no extra work.

## Testing

### Unit — `src/store/__tests__/removePlayerRoundPatches.test.js` (new)

- `individual` 4→3, 3→2 → survivors as solo pairs; mode unchanged.
- `bestball` 4→3 with no override → `nextScoringMode` is the fallback
  (`stableford`); pairs rebuilt.
- `bestball` 4→3 with `{ mode: 'sindicato' }` → `nextScoringMode === 'sindicato'`,
  survivors as solo pairs.
- `sindicato` 3→2 with no override → fallback to a 2-valid mode
  (`individual`, since `stableford` needs 3+); survivors as solo pairs.
- `stableford` (revealed) 4→3 → removed player dropped from their pair, other
  pair preserved, half-emptied pair becomes a 1-member group; mode unchanged.
- `stableford` revealed where removal empties a pair entirely → that pair is
  discarded, not left as `[]`.
- `stableford` unrevealed future round → fresh `randomPairs(survivors)`.
- Invalid override (e.g. `{ mode: 'bestball' }` at 3 players) → ignored;
  auto-fallback applies.
- Multi-round: rounds before `currentRound` are not patched.

### Mutation — extend `src/store/__tests__/addPlayerMutation.test.js`

- `tournament.removePlayer` removes the player from `players`.
- Deletes the player's `scores`, `shotDetails`, `playerHandicaps` entries for
  each patched round.
- Applies `nextScoringMode` to `settings.scoringMode` when present; leaves
  settings untouched when absent.
- Sets `round.pairs` from the patch.

### Manual smoke

- 4-player bestball → Remove Player → pick a player → prompt (bestball invalid
  at 3) → pick stableford → 3-player layout, removed player's scores gone,
  banner shows.
- 3-player sindicato → Remove Player → prompt (sindicato invalid at 2) → pick
  individual → 2-player layout.
- 3-player stableford → Remove Player → prompt fires (stableford needs 3+, so
  3→2 breaks it) → pick individual.
- 4-player stableford → Remove Player → no prompt (stableford valid at 3) →
  surviving pairs preserved, removed player dropped from their pair.
- 2-player game → Remove Player menu item does not appear (gate is
  `players.length > 2`).
- The `meId` player never appears in `PlayerRemoveSheet`.

## Risks & Open Questions

- **Multi-round casual tournaments:** removing a player also drops them from
  already-played earlier rounds' visibility (they leave `tournament.players`,
  which the leaderboard iterates). Their old `round.scores` entries remain in
  storage but are no longer rendered. This is acceptable under the
  "drop entirely" decision; earlier rounds' `pairs` are intentionally NOT
  patched (the `currentRound` gate), so a stale player reference may remain in
  an earlier round's `pairs` — harmless because the leaderboard keys off
  `tournament.players`, but worth noting.
- **`removePlayerRoundPatches` and `buildPairsForRemovedPlayer`** are close
  cousins of the add-side helpers. They are kept as separate functions rather
  than over-generalized into one — the add/remove pair-rebuild rules differ
  enough (append-solo vs filter-out) that a merged helper would be less clear.
- **HomeScreen growth:** `HomeScreen.js` is already large. The remove flow
  adds ~2 callbacks + 1 state + 2 rendered sheets. Acceptable; no extraction
  needed for this increment.
