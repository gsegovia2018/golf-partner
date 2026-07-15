# Round summary Photos tab: floating add-photo button — design spec

**Date:** 2026-07-16
**Status:** Approved (brainstorm follow-up to 2026-07-15 feed-photo-upload-wheel-attach)

## Problem

Clicking a round in the feed opens `RoundSummaryScreen` (tabs: Scorecard |
Photos | Comments). The Photos tab is view-only — a photo grid or "No photos
for this round." — with no way to add a photo from there. The user wants a
floating **+** button in that photo section.

## Scope (user-confirmed)

- ONE new affordance: a floating + FAB on `RoundSummaryScreen`, bottom-right,
  above the floating nav bar, visible only while the **Photos tab is active**.
- The feed card itself does NOT change (its action-row "Add photo" chip from
  the previous feature stays as the card-level entry point).

## Behavior

- **Gating:** rendered only when `iAmPlaying` (the viewer is one of the
  round's players, `players.some(p => p.user_id === me)`) AND
  `activeTab === 'photos'` AND the round loaded. Friends' rounds stay
  read-only — consistent with the feed chip's `withMe || isMine` gating.
- **Flow:** tap + → `useMediaAttachFlow({ tournament, defaultRoundIndex:
  roundIndex, onAttached: load })` — capture menu → picker → wheel attach
  sheet pre-targeted at this round (round wheel still shown for multi-round
  tournaments) → save → `onAttached` re-runs the screen's `load()`, so
  `loadRoundMedia` refreshes the grid (empty state replaced once the upload
  syncs).
- **Style:** same FAB recipe as GalleryScreen's (56 px circle,
  `theme.accent.primary`, white Feather `plus`, shadow), positioned to clear
  the floating tab bar. `accessibilityLabel="Add photo"`.
- Batch uploads allowed (hook default `allowBatch: true` — library
  multi-select lands in the batch sheet, same as the Gallery).

## Non-goals / unchanged

- No FeedRoundCard/FeedScreen changes.
- No new components, stores, or schema; everything reuses
  `useMediaAttachFlow` and the existing sheets.
- Comments/Scorecard tabs unchanged (no FAB there).

## Testing

Extend `src/screens/__tests__/RoundSummaryScreen.test.js` (mock
`useMediaAttachFlow` to observe `openCaptureMenu`):
- FAB visible on Photos tab when the viewer plays in the round.
- FAB absent on the Scorecard tab, and absent on Photos for a non-player.
- Tapping the FAB calls `openCaptureMenu`.
- `useMediaAttachFlow` receives the correct `defaultRoundIndex` for the
  opened round.
