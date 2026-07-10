# Round Summary Redesign — Design

**Date:** 2026-07-10
**Screen:** `src/screens/RoundSummaryScreen.js` (the feed's drill-in target for a round)

## Problem

The round page reached from the feed looks like a different app. Concretely:

1. **Scorecard tab** renders a bespoke table (`components/roundSummary/RoundScorecardTables.js`):
   strokes only — no Stableford points anywhere, no birdie/eagle/bogey score shapes, no
   stroke-index row, no handicap "extra shot" pips, horizontal scrolling, flat radius-8 cells.
   The real scorecard (`ScorecardTable` inside `components/scorecard/GridView.js`) already
   solves all of this and fits the viewport without horizontal scrolling.
2. **Leaderboard tab** is bespoke rows; the app's canonical round scoreboard is
   `RoundScoreboard` inside `HomeScreen.js` (player cards with Points / Strokes / vs Par
   stat cells, holes-played progress bar, glowing HOLE badges when live).
3. **Recap panel** (`RoundRecapPanel`) is flat gray radius-8 tiles — off-theme next to the
   feed card the user just tapped (pills, ExtraBold titles, accent tiles).
4. **Photos tab** shows non-tappable thumbnails — a dead end. The feed opens the Gallery.
5. **Comments tab** is read-only. Comments can be posted from the feed (`CommentsSheet`)
   but not from the round page itself.
6. **No refresh path while LIVE** — data loads only on screen focus.

## Goals

- The page uses the exact same scorecard UI as the live scorecard, read-only.
- The leaderboard uses the same player-card scoreboard as the Home screen, ranked.
- Theme consistency with the feed/home visual language.
- Fix the dead ends: tappable photos, postable comments, refreshable live data.

Non-goals: editing scores from this page (the "Open in scorecard" CTA stays), reactions,
share/export cards, changing the feed itself.

## Design

### 1. Reusable read-only scorecard

- Export `ScorecardTable` from `components/scorecard/GridView.js` and extract GridView's
  mode-resolution + scramble-unit mapping (raw mode → engine mode, `scrambleUnits` row
  players, handicap override, effective meId) into a small exported helper
  `resolveScorecardRows({ round, settings, players, meId, isBestBall })` used by both
  `GridView` and the summary screen. No visual change to the live scorecard.
- Scorecard tab renders `ScorecardTable` with `editable={() => false}` and a no-op
  `onSetScore`. This brings: Strokes/Points toggle, score-shape chips, Par + SI rows,
  extra-shot pips, OUT/IN totals, the multi-player totals card, side-by-side nines on
  wide screens, and mode-aware rendering (scramble / match play) — identical to live.
- `components/roundSummary/RoundScorecardTables.js` and its test are deleted, along
  with `roundSummaryModel.buildScorecardSections` and the screen's `liveByPlayer`
  derivation — the shared RoundScoreboard computes per-player holes-played and
  current-hole from `round.scores` itself. `buildRoundRecap` stays.

### 2. Shared RoundScoreboard for the leaderboard tab

- Extract `RoundScoreboard` (and only its styles) from `HomeScreen.js` into
  `src/components/RoundScoreboard.js`. HomeScreen imports it — zero visual change there.
- New optional props for summary use: `ranked` (sort by Stableford points, show a rank
  badge, tint the leader row like the feed's lead tile) and `teeLabels`
  (`round.playerTees` badges). Live rounds keep the progress bar + HOLE badges;
  finished rounds show final Points / Strokes / vs Par.

### 3. Recap panel restyle + highlights

- `RoundRecapPanel` keeps its data contract but adopts the feed-card language:
  radius-10 card, status pills (LIVE pill already exists in the header — winner pill
  becomes an accent `statusPill`), stat tiles styled like HomeScreen's `gameStatsRow`.
- New **highlights row**: chips counting eagles / birdies / pars / bogeys / doubles+
  across all players (per-player when solo), computed with `classifyHoleResult` from
  `components/scorecard/constants.js`, colored with `theme.scoreColor` — the same
  semantic palette as the score shapes. Hidden when there are no scores.

### 4. Photos tab

- Thumbnails become tappable and navigate to the Gallery exactly like the feed:
  `navigation.navigate('Gallery', { tournamentId, mediaId: media.id })`.
- Layout: 3-column grid (wraps) instead of one horizontal strip, with the feed's
  photo-badge treatment for videos.

### 5. Comments tab

- Extract the thread UI (comment row + composer + optimistic post/delete + error
  states) from `CommentsSheet.js` into `src/components/CommentThread.js`.
  `CommentsSheet` becomes a thin BottomSheet wrapper around it — no visual change.
- The Comments tab renders `CommentThread` inline for `round:<tournamentId>:<roundId>`,
  so users can post and delete their own comments from the round page.
- Round/hole notes keep their current read-only section below the thread.

### 6. Live data freshness

- Content wraps in `PullToRefresh` (shared component, already used by GridView).
- While `live`, the screen re-runs `load()` every 45s (interval cleared on blur/unmount).

## Data flow

Unchanged: `fetchTournament` (Supabase, falls back to local cache) + `loadRoundMedia` +
`loadComments`. `roundTotals` from `tournamentStore` keeps feeding the ranked list.
The scorecard tab consumes `round` + `players` + `round.scores` directly via
`resolveScorecardRows`, the same inputs the live scorecard uses.

## Error handling

- Missing round: existing "no longer available" state stays.
- Comment post failure (offline / table missing): same inline error as CommentsSheet
  (extracted with the thread).
- Photos with missing thumb fall back to `url` (existing behavior).

## Testing

- Update `RoundSummaryScreen.test.js`: scorecard tab now asserts the shared table
  (points toggle present, par/SI rows), leaderboard tab asserts RoundScoreboard cards,
  comments tab asserts the composer renders and posts via mocked feedStore.
- New `RoundScoreboard.test.js`: renders rows, ranked mode ordering, HOLE badge logic.
- New `CommentThread.test.js`: optimistic add, delete own comment, error state.
- `resolveScorecardRows` unit test: stableford vs scramble mapping.
- Delete `RoundScorecardTables.test.js` with its component.
- Full suite (`npm test`) and `npm run lint` must pass.
