# Scorecard conflict resolution — design

**Date:** 2026-05-21
**Status:** Approved (brainstorm) — ready for implementation plan
**Scope:** Casual rounds (`kind: 'tournament'` / `'game'`). Official tournaments already
have their own discrepancy flow and are out of scope.

## Problem

Casual scorecards sync through a Last-Write-Wins (LWW) merge (`store/merge.js`). When two
phones record a **different score for the same player on the same hole**, the merge keeps
the value with the newer edit timestamp and silently discards the other. The losing value
is only recorded in a device-local "Cambios sobrescritos" log inside `SyncStatusSheet` —
which nobody looks at.

In real tournaments scores are entered "mixed" — anyone enters anyone's score — so
same-cell conflicts are not rare. A wrong score can be silently overwritten and never
noticed, and a round can be finished with a score the group never agreed on.

## Goals

- Never silently discard a conflicting score. Detect it and **flag the hole** so the
  group can see and fix it.
- Make the flag **visible to every device**, not just whoever happened to sync second.
- Let **anyone** resolve a conflict by picking the correct value.
- **Block finishing a round** while any hole still has an unresolved conflict — every
  hole must end on one agreed score.

## Non-goals

- No ownership/priority rule ("my score wins"). With mixed entry there is no stable owner
  per row, so ownership cannot decide a winner. Resolution is always an explicit choice.
- No change to official-tournament scoring (it already has `DiscrepancySheet`).
- No editor identity ("who entered which value"). We show *when* each value was entered,
  not *by whom*. Identity can be added later if wanted.
- No warning for genuinely blank holes (a skipped or picked-up hole). The finish gate is
  scoped to conflicts only.

## Background — current behaviour (unchanged pieces)

- A score edit runs through `mutate()` (`store/mutate.js`): it stamps a timestamp into
  `tournament._meta` at the dotted path `rounds.<rid>.scores.<pid>.h<hole>`, saves
  locally, and enqueues a `score.set` mutation.
- The sync worker (`store/syncWorker.js`) fetches the remote blob, calls
  `mergeTournaments(local, remote)`, saves and pushes the merged result.
- `mergeTournaments` (`store/merge.js`) is per-path LWW keyed on `_meta` timestamps.
- The provisional (LWW-winning) value continues to drive all scoring math; a conflict
  marker is metadata only. No scoring code changes.

## Design overview

Five pieces. Only the data plumbing is genuinely new — the UI borrows official mode's
existing discrepancy pattern.

1. **Detect** — `mergeTournaments` flags a hole when two devices wrote it with
   *genuinely different* values.
2. **Mark** — the losing value is written into a **conflict marker stored in the synced
   blob**, so every device sees the same flag.
3. **Flag** — the conflicted `PlayerCard` turns amber with an alert icon and becomes
   tappable (mirroring official mode's discrepancy card); the "Go to hole" grid shows an
   amber dot.
4. **Resolve** — tapping opens a bottom sheet modelled on `DiscrepancySheet`; picking a
   value writes a fresh score and clears the marker for everyone.
5. **Finish gate** — `handleFinish` refuses to finish a round that still has any
   unresolved conflict.

## 1. Data model — the conflict marker

A new per-round map, parallel to `round.scores` and `round.shotDetails`:

```js
round.scoreConflicts = {
  [playerId]: {
    [holeNumber]: {
      candidates: [            // 2+ entries, one per distinct competing value
        { value: <int>, ts: <ms-epoch> },
        { value: <int>, ts: <ms-epoch> },
      ],
      detectedAt: <ms-epoch>,  // when the merge first detected this conflict
    },
  },
}
```

- `round.scores[pid][hole]` always holds the LWW winner — the candidate with the highest
  `ts`. The marker carries every competing value so the resolution sheet is
  self-contained.
- A cell with no conflict has **no key** in `scoreConflicts` (absent, not `null`).
- Two-device conflict is the norm (`candidates.length === 2`); the list shape also covers
  a rare 3-way conflict without special-casing.

The marker is part of the tournament blob, so it syncs and LWW-merges like any other
field. Its `_meta` path is `rounds.<rid>.scoreConflicts.<pid>.h<hole>`.

## 2. Detection — `store/merge.js`

In `mergeTournaments`, the per-path LWW loop already identifies the case "remote wins and
both sides had stamped this path." Extend it: when that path is a **score path**
(`rounds.<rid>.scores.<pid>.h<hole>`) **and the two values genuinely differ**, write a
conflict marker into `merged`:

- Build `candidates` from the two competing `{ value, ts }` pairs (winner = remote,
  loser = local), newest `ts` first.
- If `merged` already has a marker for that cell (a prior unresolved conflict), union the
  new value(s) into `candidates` rather than replacing.
- Set `merged.scoreConflicts[pid][hole] = { candidates, detectedAt: Date.now() }`.
- Stamp `merged._meta['rounds.<rid>.scoreConflicts.<pid>.h<hole>'] = detectedAt`.

Rules:

- **Equal values never flag.** If both devices wrote the same number, it is a plain LWW
  no-op, not a conflict.
- The marker only propagates from the device that detected it; once written it rides
  normal LWW so every other device picks it up on its next merge.
- The existing device-local `conflicts` return array / `_appendConflicts` log is **left
  untouched** — the in-blob marker is additive. (Removing the old log is out of scope.)
- The new conflict-marker logic must not itself emit entries into the `conflicts` array,
  and `scoreConflicts.*` paths must be excluded from same-cell conflict detection.

## 3. Resolution — mutation + sheet

### Mutation: `conflict.resolve`

A new mutation type in `store/mutate.js`:

```js
{ type: 'conflict.resolve', roundId, playerId, hole, value, ts }
```

- `applyToTournament`: set `round.scores[pid][hole] = value`; delete
  `round.scoreConflicts[pid][hole]`.
- `metaPathFor`: returns **both** paths so each LWW-merges correctly —
  `rounds.<rid>.scores.<pid>.h<hole>` (the chosen value wins over any stale score) and
  `rounds.<rid>.scoreConflicts.<pid>.h<hole>` (the cleared marker wins over a stale
  still-conflicted marker on another device).

Because the cleared marker is addressed by an exact `_meta` path, a plain delete is
enough — no structural tombstone is needed (unlike round deletion). A device that
resolved at `ts=T2` beats a device still showing the marker at `ts=T1 < T2`.

`tournament.removePlayer` must also delete the removed player's `scoreConflicts[pid]`
slice, alongside the `scores` / `shotDetails` slices it already clears.

### Component: `ScoreConflictSheet` (new)

A bottom sheet in `src/components/ScoreConflictSheet.js`, visually consistent with
`DiscrepancySheet` (same handle, alert-icon title, side-by-side value cards) but with
**pick** semantics instead of self/marker editing.

Props: `visible`, `onClose`, `hole`, `subjectName`, `candidates` (`[{value, ts}]`),
`currentValue`, `onResolve(value)`.

Content:

- Title: `Resolve hole <n>` with an amber `alert-circle` icon.
- Subtitle: `Two phones recorded a different score for <name>. Pick the correct one.`
- One tappable card per candidate value: the value, a label
  (`Current score` for the LWW winner, `Other entry` otherwise), and a relative-time hint
  (`entered 6 min ago`) derived from the candidate `ts`.
- A "or enter a different score" stepper for a manual correction.
- A confirm button → `onResolve(value)`, which dispatches `conflict.resolve`.

A new component (rather than extending `DiscrepancySheet`) keeps official mode's
self/marker logic uncoupled from casual pick logic. Shared visual styles may be lifted if
convenient.

## 4. UI — flagging on the real scorecard

### Flagged `PlayerCard` (`src/components/scorecard/PlayerCard.js`)

New props: `conflict` (the marker for this player+hole, or `null`) and
`onOpenConflict(playerId, holeNumber)`.

When `conflict` is set, mirror the official-mode discrepancy treatment, in amber:

- Amber `alert-circle` icon next to the player name (official mode uses a red one for
  `officialState === 'discrepancy'`).
- Amber card border + faint amber background tint.
- The whole card becomes a `Pressable` → `onOpenConflict`. **Steppers and the pickup
  toggle are suppressed while conflicted** — the only action on a conflicted card is
  open-to-resolve. They return after resolution. (A conflicted cell is therefore never
  the target of a plain `score.set`.)
- The score numeral renders amber with a `TAP TO RESOLVE` label (mirrors the existing
  label swap to `HOLD TO CLEAR`).

### `HolePage` (`src/components/scorecard/HolePage.js`)

- Look up `round.scoreConflicts?.[player.id]?.[pageHole.number]` per player and pass it to
  `PlayerCard` as `conflict`; pass `onOpenConflict` through.
- Extend `holePagePropsEqual`: compare the per-hole `scoreConflicts` slice (like `scores`
  and `shotDetails`) and include `onOpenConflict` in the structural prop list.

### `HoleView` (`src/components/scorecard/HoleView.js`)

- Host `ScoreConflictSheet` the way it already hosts `DiscrepancySheet`: a
  `conflictTarget` state (`{ hole, playerId } | null`) and a stable `openConflict`
  callback (`useCallback`, so it does not defeat `holePagePropsEqual`).
- "Go to hole" grid: draw an amber dot on holes that have any conflict, reusing the
  `holePickerNoteDot` slot already used for official discrepancies.

### `ScorecardScreen` (`src/screens/ScorecardScreen.js`)

- Wire the `conflict.resolve` mutation dispatch.
- Pass `scoreConflicts` data into `HoleView`.
- Add the finish gate (below).

## 5. Finish-round gate — `handleFinish`

A pure helper `roundHasConflicts(round)` (in `store/scoring.js`) returns whether any cell
in `round.scoreConflicts` still has a marker.

In `handleFinish` (`ScorecardScreen.js`), before the round-complete celebration:

- If the round has unresolved conflicts, show a **blocking** native alert
  (`Alert.alert` on native, `window.confirm`-style on web — consistent with the existing
  finish-flow alerts) and **do not finish**:
  - Title: `Resolve conflict to finish`
  - Message: one conflict → `Hole <n> still has a conflicting score for <name>. Every
    hole needs one agreed score before this round can finish.` Multiple → count them.
  - Buttons: **Not now** (dismiss, round stays open) and **Review conflict** (navigate to
    the first conflicted hole; the resolution sheet opens there).
  - There is no "finish anyway".
- If there are no conflicts, `handleFinish` proceeds exactly as today.

"Review conflict" navigates to the conflicted hole via the existing `onGoToHole`, and
`HoleView` opens `ScoreConflictSheet` for that hole/player (e.g. via an optional
`focusConflict` prop set by `ScorecardScreen`).

## Reused vs. new

| Piece | Reused | New |
|---|---|---|
| Flagged card (alert icon, tappable card) | Official-mode discrepancy card pattern in `PlayerCard` | Amber palette; suppress steppers while conflicted |
| Resolution sheet | `DiscrepancySheet` layout/structure | `ScoreConflictSheet` with pick semantics |
| "Go to hole" dot | `holePickerNoteDot` discrepancy slot | Amber color for casual conflicts |
| Finish gate | Existing `handleFinish` + `Alert.alert` finish-flow pattern | The conflict check itself |
| Conflict marker in blob | LWW merge + `_meta` path machinery | `round.scoreConflicts` field, detection, `conflict.resolve` mutation |

## Edge cases

- **Identical values** — never flagged; plain LWW.
- **3-way conflict** — `candidates` holds all distinct values; the sheet lists them all.
- **Conflict detected after a round is finished** (a late sync) — the flag still shows if
  the scorecard is reopened and can still be resolved; the round is not re-gated. Rare;
  acceptable for v1.
- **Resolve vs. stale remote** — handled by stamping the `scoreConflicts` `_meta` path in
  `conflict.resolve`; the newer resolve wins LWW over an older still-conflicted marker.
- **Player removed mid-round** — `tournament.removePlayer` also drops their
  `scoreConflicts` slice.
- **Offline** — both competing values are already in the blob by the time a marker
  exists, so resolution always works offline (it is a local pick).

## Testing

- `merge.js`: marker written when values differ; **not** written when values are equal;
  marker propagates to a device that did not detect it; a resolve survives a merge against
  a stale still-conflicted remote; `scoreConflicts` paths excluded from same-cell conflict
  detection.
- `mutate.js`: `conflict.resolve` sets the score, deletes the marker, and stamps both
  `_meta` paths; `tournament.removePlayer` drops `scoreConflicts[pid]`.
- `scoring.js`: `roundHasConflicts` true/false cases.
- Components: `PlayerCard` renders the conflict treatment and suppresses steppers;
  `ScoreConflictSheet` pick + confirm calls `onResolve`; `holePagePropsEqual` reacts to a
  `scoreConflicts` slice change; the finish gate blocks and the clean path passes.

## Files touched

- `src/store/merge.js` — detect differing-value conflicts, write the marker.
- `src/store/mutate.js` — `conflict.resolve` mutation; `removePlayer` clears `scoreConflicts`.
- `src/store/scoring.js` — `roundHasConflicts` helper.
- `src/components/ScoreConflictSheet.js` — **new** resolution sheet.
- `src/components/scorecard/PlayerCard.js` — conflict flagging on the card.
- `src/components/scorecard/HolePage.js` — pass conflict data; extend `holePagePropsEqual`.
- `src/components/scorecard/HoleView.js` — host the sheet; "Go to hole" amber dot.
- `src/components/scorecard/styles.js` — conflict card styles.
- `src/screens/ScorecardScreen.js` — wire the mutation; finish gate.

## Out of scope

- Editor identity on conflict values.
- Removing or reworking the existing `SyncStatusSheet` "Cambios sobrescritos" log.
- Conflict handling for non-score paths (notes, pairs, handicaps) — they keep current LWW.
- Re-gating a round that was already finished before a late conflict arrived.
