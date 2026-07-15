# Feed photo uploads + wheel-based attach sheet — design spec

**Date:** 2026-07-15
**Status:** Approved (brainstorm with visual companion; user picked wheel design "E")

## Problem

1. Photos can only be added from the Gallery (Memories) screen's FAB or the
   Scorecard's capture flow. From the feed there is no way to add a photo to
   the round/tournament/game a card refers to.
2. Single-photo uploads (`AttachMediaSheet`) silently attach to the
   tournament's *current* round — the user cannot pick the round. Only the
   batch sheet has a round selector.
3. The hole selector is a wrapping grid of 19 tap targets ("Sin hoyo" + 18
   squares): tall, noisy, and context-free. The user explicitly rejected
   grid/chip/stepper redesigns and chose side-by-side scroll wheels.
4. The attach sheets are in Spanish while the rest of the app is English.

## Decisions (from brainstorm)

- **Entry point:** camera action directly on the feed card, next to
  React/Comments.
- **Scope of the button:** only rounds the viewer is part of
  (`item.withMe || item.isMine`). Friends' rounds stay view-only.
- **Selector design:** side-by-side scroll wheels (Round | Hole), native
  date-picker feel. "No hole" is the hole wheel's first entry.
- **Rollout:** the redesigned sheet replaces the old hole selector
  everywhere — feed, Gallery, Scorecard, and the batch sheet's header-level
  round/hole controls.
- **Language:** English labels; also migrate `mediaCapture.js` error strings.
- **Implementation:** custom `WheelPicker` (ScrollView + `snapToInterval`,
  ~100 lines, no new dependency) + a shared `useMediaAttachFlow` hook that
  de-duplicates the capture orchestration across the three screens.

## Components

### `src/components/WheelPicker.js` (new)

Generic snap-scroll wheel.

- Props: `items: [{ key, label, sublabel? }]`, `selectedIndex`,
  `onChange(index)`, optional `testID`.
- Fixed-height `ScrollView` with `snapToInterval` = row height; center
  selection band (accent-tinted background + accent border, matching the
  approved mockup); fade masks top/bottom (overlay `View`s, no gradient
  dependency); rows show `label` with muted `sublabel`.
- Offset→index math (snap + clamp) lives in a pure exported helper for unit
  testing.
- Must work on web (`react-native-web`) and Android identically.

### `src/components/AttachMediaSheet.js` (redesign)

- English labels: title "Add photo", sections "Round & hole",
  "Caption (optional)", "Your name (optional)", button "Save".
- Props change: `holes`/`defaultHoleIndex` → `rounds`, `defaultRoundIndex`,
  `defaultHoleIndex`. Holes derive from the selected round.
- Layout: media preview, then **two wheels side by side** — Round wheel
  (label `R<n>`, sublabel course/day) and Hole wheel ("No hole", then
  "Hole N" with "Par X" sublabel). When `rounds.length === 1` the round
  wheel is hidden and the hole wheel spans full width.
- Switching rounds re-derives the hole wheel; if the previously selected
  hole index is out of range for the new round, selection resets to
  "No hole".
- `onConfirm({ roundIndex, roundId, holeIndex, caption, uploaderLabel })` —
  callers no longer assume the round.
- Uploader-label AsyncStorage persistence unchanged.

### `src/components/BatchAttachSheet.js` (partial redesign)

- Header-level "Ronda" chip row + "Aplicar a todas — hoyo" chip row are
  replaced by the same side-by-side wheels; labels move to English
  ("Attach N memories", "Apply to all", "Save N").
- Per-photo override rows keep their compact chips (a wheel per row is
  unusable); their labels also move to English.

### `src/hooks/useMediaAttachFlow.js` (new)

Extracts the orchestration currently duplicated in GalleryScreen and
ScorecardScreen:

```js
const { openCaptureMenu, sheets } = useMediaAttachFlow({
  tournament,        // full tournament object (rounds + holes)
  defaultRoundIndex, // context round (feed card / scorecard / currentRound)
  defaultHoleIndex,  // scorecard: current hole; others: null
  extraActions,      // CaptureMenuSheet extras (scorecard "view memories")
  onAttached,        // optional callback after a successful attach
});
```

Owns: capture-menu visibility, `pickMedia` invocation (multi only for
library source), single-vs-batch asset routing, `attachMedia` /
`attachManyMedia` calls, and error alerts. `sheets` is a fragment rendering
`CaptureMenuSheet`, `AttachMediaSheet`, and `BatchAttachSheet`; the caller
renders it once.

Consumers: `GalleryScreen`, `ScorecardScreen`, `FeedScreen`. The first two
shed their duplicated wiring; behavior parity is required (Gallery keeps
multi-select from library; Scorecard keeps its current-hole default and
extra "view memories" action).

## Feed integration

- `FeedRoundCard` gains `onAddPhoto` prop; when set, a camera chip
  ("Add photo", Feather `camera`) renders in the action row next to
  React/Comments.
- `FeedScreen` passes `onAddPhoto` only when `item.withMe || item.isMine`.
- Tap → `getTournament(item.tournamentId)` → open capture menu with
  `defaultRoundIndex = item.roundIndex`. Wheels let the user re-aim at any
  round/hole.
- After confirm the upload uses the existing offline queue (`enqueueMedia` →
  upload worker). `onAttached` invalidates the feed cache
  (`invalidateFeedCache()`) and reloads so the card's media strip refreshes
  once the upload syncs.
- Games (`kind` = game, single round): no round wheel, hole wheel only —
  falls out of the `rounds.length === 1` rule.

## Error handling

- Feed: tournament fails to load → alert "Couldn't load this round"; flow
  does not open.
- Round switch with fewer holes → hole selection resets to "No hole".
- Permission / video-size errors: existing alert behavior kept;
  `mediaCapture.js` messages translated to English.
- No schema, storage, or sync changes — `attachMedia` already accepts
  `tournamentId + roundId + holeIndex`.

## Testing

- `WheelPicker`: pure index-math helper tests; render test for selection
  band and `onChange` on snap.
- `AttachMediaSheet`: round wheel hidden when one round, shown for
  multi-round; confirm payload carries picked `roundId`; hole resets on
  round switch to a shorter round.
- `useMediaAttachFlow`: single vs batch routing; attach failure alerts.
- `FeedRoundCard`: camera chip renders only when `onAddPhoto` provided.
- `FeedScreen`: withholds `onAddPhoto` for friends-only rounds.
- Existing GalleryScreen/ScorecardScreen tests updated for the new prop
  shapes; full suite (`npm test`) and `npm run lint` must pass.

## Out of scope

- Wheels for per-photo overrides inside the batch sheet.
- Adding photos to friends' rounds (spectator uploads).
- Any feed-ranking or media-storage changes.
