# Delete History Rounds Design

## Goal

Users can delete finished scoring history at both levels:

- Whole finished games or tournaments can be deleted from the archive.
- Individual completed rounds inside a multi-round tournament can be deleted.

## Current Behavior

`FinishedScreen` already supports deleting an entire finished tournament or game for owners, but the primary archive surface is `HistoryScreen`, which previously only opened finished cards. `EditTournamentScreen` already removes unfinished rounds through `mutate(..., { type: 'round.remove' })`, which records a `rounds.<roundId>._deleted` metadata tombstone so sync merges do not restore the deleted round. The editor hides this control when a round is complete or the parent tournament has `finishedAt`.

## Approach

Keep the existing whole-tournament delete path on `FinishedScreen` and expose the same delete affordance on owner-owned `HistoryScreen` cards. For individual rounds, expose the existing `removeRound` action in `EditTournamentScreen` for finished rounds as long as the tournament has more than one round. This keeps multi-round deletion in the tournament-management surface and reuses the offline-safe `round.remove` mutation instead of adding a second per-round deletion path in My Stats or Report Card.

If the user tries to delete the only round in a tournament or game, the app will not remove it as an individual round. The user should delete the whole finished item instead.

## User Experience

Completed rounds show the same trash action in the editor as unfinished rounds. The confirmation copy changes when the round is finished:

- It warns that deleting the round permanently removes that round's historical scores and stats.
- It uses the destructive confirmation label `Delete history round`.

Unfinished or partially scored rounds keep the existing score-count warning. Empty setup-stage rounds keep the simpler `Remove` confirmation.

## Data Flow

Deleting a round calls `mutate(tournament, { type: 'round.remove', roundId })`. `mutate` filters the round out locally, stamps `_meta.rounds.<roundId>._deleted`, saves the local blob, queues sync, and emits store changes. History, My Stats, Report Card, stats, and profile summaries derive from `tournament.rounds`, so they naturally drop the deleted round on reload.

## Tests

- Pure helper tests cover delete eligibility and confirmation message selection:
  - completed round in a multi-round tournament can be removed;
  - only round cannot be removed individually;
  - archived tournament rounds are treated as historical deletions;
  - partially scored rounds keep the entered-score warning.
- Existing mutation tests continue to cover that `round.remove` removes the round and stamps a tombstone.

## Out Of Scope

- Soft-delete restore UI.
- Batch deletion from My Stats.
- Official tournament side-table round deletion.
