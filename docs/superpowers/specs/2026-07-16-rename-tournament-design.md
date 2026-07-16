# Rename Tournament / Game After Creation (Including Finished) — Design

**Date:** 2026-07-16
**Status:** Approved

## Problem

A tournament's (or single-round game's) `name` is set once at creation and can
never be changed afterwards — no screen edits it. Users want to rename a
tournament or round at any time, including after it is finished.

Rounds have no name field of their own: everywhere in the app a round is
labeled "Round N" plus its `courseName`, and `courseName` is already editable
on the Edit Tournament screen — including for finished rounds. Renaming a
round therefore needs no new work.

## Scope

- **In:** casual tournaments and single-round games (`kind: 'tournament' | 'game'`).
- **Out:** official tournaments (separate code path, admin via `created_by`;
  can be added later), a dedicated per-round `name` field.

## Design

### UI

`src/screens/EditTournamentScreen.js` gets a name field at the top of the
ScrollView, above the per-round cards:

- Label: "Tournament name" for tournaments, "Game name" for games (derive
  from `tournament.kind`).
- Styled like the screen's existing inputs; participates in the existing
  autosave flow (debounced 400 ms, "Saving…/Saved" pill).
- Local state `name`, seeded from the loaded tournament's `name` in
  `initialLoad`. `mergeLoad` does **not** overwrite in-flight edits (same
  policy as round notes), but re-seeds the dedup baseline (below).

### Save path

The debounced save effect already emits `tournament.updateProfile` with the
settings patch. The name joins that same patch with two guards:

1. **Non-empty only:** the trimmed name is included only when non-empty.
   `mutate.js` and the server both treat a null name as "skip, never clear";
   an empty string would be written verbatim, so the UI must never emit one.
2. **Dedup via last-emitted ref** (`lastEmittedNameRef`, mirroring
   `lastEmittedNotesRef`): the name is included only when it differs from the
   last value emitted or seeded from a load, so unrelated edits don't re-push
   an unchanged name on every autosave.

`name` is added to the save effect's dependency array.

### Why no store/sync/schema changes

`tournament.updateProfile { name }` is already fully wired:
`mutate.js:384` applies it locally, `mutationWrites.js:301` →
`repo.patchTournament` → Supabase RPC `patch_game_tournament` writes the
`tournaments.name` column. Nothing gates the mutation on `finishedAt`, and
the Edit Tournament screen is already reachable for finished tournaments
(History → tournament → settings sheet → Edit). "Even when finished" works
with zero unblocking.

### Error handling

Covered by the screen's existing autosave error path (status pill turns to
"Save failed" + alert). No new failure modes: the name rides an existing
mutation type through the existing offline queue.

## Testing

Extend `src/screens/__tests__/EditTournamentScreen.test.js`:

1. Editing the name field emits `tournament.updateProfile` whose patch
   includes the new name.
2. Clearing the field to empty/whitespace does not emit a `name` key in the
   patch (settings may still be patched).
3. The field renders pre-filled and saves for a finished tournament
   (`finishedAt` set).
4. An unrelated edit (e.g. a course name change) after the name was saved
   does not re-emit the name (dedup).
