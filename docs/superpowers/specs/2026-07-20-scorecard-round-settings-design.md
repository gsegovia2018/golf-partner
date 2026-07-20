# Scorecard Round Settings — Shared Settings Sheet

**Date:** 2026-07-20
**Status:** Approved

## Goal

Declutter the Scorecard header and give it the same settings menu as the
tournament view. One shared sheet component serves both HomeScreen
(tournament view) and ScorecardScreen, so the two menus can never drift
apart. For single-round games the two sheets are exactly identical; for
multi-round tournaments the scorecard sheet scopes round-level items to
the round being played.

## Scorecard header changes

Remove from the ScorecardScreen header:

- The **sync indicator** pressable (currently opens `SyncStatusSheet`).
- The **eye toggle** (show/hide running score). The preference already
  lives in the Settings screen (`showRunningScore`) and the tournament
  header's eye toggle stays.

Add:

- A **gear button** (`settings` Feather icon, matching HomeScreen) at the
  right end of the header row. It opens the shared settings sheet.
- The gear shows a small **status dot** when sync is `pending`/`error`
  or a local save has failed, so sync trouble stays visible without the
  dedicated indicator.

Unchanged: back button, title, Edit-round pill (view-only mode), view
switch, official leaderboard (award), notes, camera.

## Shared component: `src/components/TournamentSettingsSheet.js`

The menu body currently inlined in HomeScreen's settings `BottomSheet`
moves into a reusable component. Both screens render it inside the
existing `BottomSheet`. Props:

- `visible`, `onClose`
- `tournament` — full object (role read from `tournament._role`)
- `roundIndex` — optional; when present, round-scoped items render for
  that round. HomeScreen passes it only for single-round games
  (preserving today's behavior — multi-round games keep round items in
  the per-round "•••" sheet). ScorecardScreen always passes the round
  being played.
- Action callbacks / navigation handlers (see per-item wiring below).
  Items whose capability the host cannot provide are hidden (e.g. Share
  Leaderboard needs the rendered leaderboard's capture ref).

### Items (same order as today's Home sheet)

| Item | Scope | Gating | Action |
|---|---|---|---|
| Sync *(new, both screens)* | app | always | live status subtitle ("Synced" / "Syncing…" / "Pending" / "Error"); opens `SyncStatusSheet` mounted by host |
| Teams | round | `!isViewer`, `roundIndex` present | existing `renderTeamsMenuItem` flow |
| Share Leaderboard | tournament | ≥2 players, host provides capture ref (Home only for now) | `shareLeaderboard` |
| Statistics | tournament | always | `navigate('Stats', { tournamentId })` |
| Players | tournament | always | `navigate('Players', { tournamentId, tournamentName })` |
| Scoring Mode (current mode subtitle) | round | `!isViewer`, `roundIndex` present | opens `ScoringModeSheet` for that round |
| Point Values | round | `roundIndex` present, mode uses point values | existing `renderPointValuesMenuItem` flow |
| Team Settings / Edit Pairs | tournament | `!isViewer`, team mode active | existing sub-sheet |
| Edit Round / Edit Tournament | tournament | `!isViewer` | `navigate('EditTournament', …)`; label "Edit Round" for single-round games |
| Restore previous scores (n) | round | `roundIndex` present, `resetHistory` non-empty | existing restore sheet |
| Reset Round | round | `!isViewer`, `roundIndex` present | confirm → shared reset action |
| Finish / Reopen game | tournament | `!isViewer` | shared finish action |
| Delete game | tournament | `isOwner` | confirm → `deleteTournament` |

### Official rounds

On the scorecard, official games show only the **Sync** row — players,
scoring mode, and lifecycle are managed through the official admin
screens. The gear still renders so sync status has a home.

## Shared action logic

The behaviors currently inlined in HomeScreen move to a shared module
(`src/store/roundActions.js`) so both screens execute identical code:

- `resetRound(tournament, roundIndex)` — snapshots scores/notes into
  `resetHistory` (capped at 10) when the round has content, then applies
  the `round.resetContent` mutation. Returns whether a snapshot was
  taken so hosts can offer undo.
- `setTournamentFinished(tournament, finished)` — finish/reopen
  mutation.

Host-specific behavior after the shared action runs:

- **Home:** keeps its undo snackbar after reset (as today).
- **Scorecard:** after reset, reloads in place showing the empty card.
  After Finish, navigates back to the tournament view. After Delete,
  navigates to the home list.

Confirm dialogs use each host's existing confirm infrastructure
(HomeScreen `ConfirmModal`; scorecard's cross-platform confirm), with
identical copy.

## Out of scope

- Share Leaderboard from the scorecard (needs a rendered leaderboard to
  capture; can follow later).
- Any change to the per-round "•••" sheet on Home.
- Removing the eye toggle from the tournament header (it stays).

## Testing

- Component tests for `TournamentSettingsSheet`: item visibility by
  role (viewer/player/owner), `roundIndex` presence, official flag,
  capability-based hiding (Share Leaderboard), and action callback
  wiring.
- Shared action tests for `roundActions` (reset snapshot/cap behavior,
  finish/reopen).
- HomeScreen tests keep passing unchanged (sheet swap is behavior-
  preserving, plus the new Sync row).
- ScorecardScreen header tests updated: sync indicator and eye toggle
  gone, gear present, status dot on sync error.
