# Quick Start Favorite Courses Design

**Date:** 2026-06-01
**Status:** Proposed
**Surface:** `HomeScreen` Play list

## Goal

Let a player start a single-round game from a favorited course with fewer taps:
pick a favorite course from Play, choose who is playing, and start the game
with the course, holes, tees, playing handicaps, scoring settings, and name
filled automatically.

## Chosen UX

Use **Option A: Favorite Course Rail**.

On the Play list, below the existing `Start playing` tiles and before active
games/tournaments, add a `Quick start` section. The section is a horizontal
rail of favorited course cards. Each card shows:

- Course name.
- Compact metadata: `Par 72 · 4 tees` where data is available.
- Favorite star.
- A small `Start` affordance.

Tapping a course opens a bottom sheet. The course is fixed in the sheet; the
only required choice is who is playing. The sheet contains:

- Course name and compact metadata.
- Read-only tee note: tees are auto-assigned.
- Player selection chips/cards from the same player library scope used by the
  setup flow.
- Primary action: `Start game`.
- Secondary action: `Edit details`.

No tee picker appears in quick start. Tee changes happen only through
`Edit details`, which opens the normal setup wizard with the quick-start course
and selected players prefilled.

## Tee Defaulting Rule

For the selected course and selected players:

1. Resolve each selected player's last-used tee on that exact `courseId`.
2. A player with a valid last-used tee keeps that tee.
3. A player with no tee history inherits the group's default tee when at least
   one selected player has history.
4. The group default tee is the most common valid last-used tee among selected
   players. Ties break by the signed-in user's last-used tee when the signed-in
   user is selected, then by the course tee order.
5. If no selected player has valid tee history, use the course's middle tee.
6. If the course has no named tees, leave `playerTees` empty and rely on the
   existing raw-index fallback.

Playing handicaps are derived from the resolved tee snapshots with the existing
`deriveRoundPlayingHandicap` / `calcPlayingHandicap` math. Quick start creates
no manual handicap overrides.

## Game Defaults

Quick start creates a casual `kind: 'game'` tournament with one round.

- **Name:** same format as setup games, `Course Name · D Mon`.
- **Course:** concrete favorited course layout, not a club-level placeholder.
- **Holes:** course holes when there are 18; otherwise `defaultHoles()`, matching
  the course picker's defensive behavior.
- **Tees:** course tee list copied into the round.
- **Players:** selected player snapshots from the scoped player library.
- **Me:** resolved from the signed-in user's `user_id`, as setup does today.
- **Scoring mode:** use the existing settings default, then apply the existing
  player-count fallback rules before creating pairs.
- **Pairs:** team modes use `randomPairs(players)`; solo modes use one singleton
  pair per player, matching `SetupScreen.handleStart()`.
- **Destination:** after save, route directly to the new game's scorecard with
  the tournament screen beneath it, same as setup games.

If a multiplayer quick-start game includes unlinked guest players, keep the same
post-create editor invite behavior as setup games.

## Architecture

Avoid growing `HomeScreen` with setup-specific creation logic.

### New Quick Start Model

Add a small pure/helper module, `src/lib/quickStartGame.js`, to own:

- `buildQuickStartGameName(courseName, date)`.
- `courseToQuickStartRound(course)`.
- `resolveQuickStartPlayerTees({ course, players, currentUserId, lastTeeByPlayer })`.
- `buildQuickStartTournamentDraft({ course, players, playerTees, settings, userId })`.

The async wrapper that calls `lastTeeForPlayerOnCourse(courseId, playerId)` can
live next to these helpers, but the defaulting algorithm itself should remain
pure and unit-testable.

Add a presentational component, `src/components/QuickStartCourses.js`, for the
rail and sheet. `HomeScreen` should own data loading and navigation callbacks,
while the component owns layout, selection state, loading/error presentation,
and button enablement.

### Home Screen

`HomeScreen` list view loads quick-start courses from `loadCourseLibrary()` and
filters to courses whose ids are in `favorites`. Favorited concrete course
layouts render in the rail; club rows do not appear because the favorite table
stores course ids.

The quick-start sheet fetches selectable players with `fetchMyPlayers()`, the
same scope as setup/player picker: own app-user player, own guest players, and
friends' app-user rows. The signed-in user's player row is preselected when
available.

Starting from the sheet calls the shared quick-start builder, saves the created
game with `saveTournament()`, then follows the same post-create route and invite
logic used by setup games.

### Edit Details

`Edit details` opens `SetupScreen` in game mode with:

- The selected course already applied to round 1.
- The currently selected players already added.
- The quick-start tee defaults already applied.
- Initial step set to `tees`, so tee review/change is one tap away.

Setup remains authoritative for changing tees, handicaps, scoring mode, course
holes, course selection, and game review.

## Empty And Error States

- If there are no favorited courses, hide the quick-start rail. The normal
  `Game` tile and course library remain the discovery paths.
- If favorite courses are available only from cache, the rail can still render.
- If a favorited course no longer exists in the course library, omit it.
- If player loading fails in the sheet, show a compact error with retry and keep
  `Edit details` available.
- If save fails, show the same platform alert behavior as setup game creation.
- If the course has no named tees, omit tee labels from player chips and rely on
  existing playing-handicap fallback behavior.

## Out Of Scope

- Saved presets that remember usual players or scoring modes.
- Quick start for multi-round casual tournaments.
- Quick start for official tournaments.
- Inline tee editing inside the quick-start sheet.
- New database tables. Existing `favorite_courses` and tournament storage are
  enough for this version.

## Testing

Add focused tests around pure behavior first:

- Quick-start tee resolver:
  - Player with own last-used tee keeps it.
  - Player without history inherits the group's only used tee.
  - Player without history inherits the most common tee when histories differ.
  - Tie uses the signed-in user's tee when available.
  - No selected player has history, falls back to `middleTee`.
  - Course with no named tees returns no `playerTees`.
- Quick-start round builder:
  - Copies course holes and tees without mutating the library course.
  - Falls back to `defaultHoles()` when the course has incomplete holes.
- Quick-start game draft:
  - Produces one game round with resolved `playerTees`, `playerHandicaps`,
    default settings, and correct pairs for solo/team scoring modes.
- Setup prefill:
  - `Edit details` opens game setup with course, players, tee defaults, and the
    `tees` step selected.

Run the focused Jest tests for the new helper module, then `npm test` or the
relevant screen/store suites if the implementation touches shared setup logic.
