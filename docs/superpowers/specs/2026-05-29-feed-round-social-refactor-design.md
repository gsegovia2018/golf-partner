# Feed and Finished Round Social Refactor Design

## Goal

Refactor the activity feed and the finished-round drill-in so the app feels like a casual clubhouse: users can quickly see what friends have played and what photos were added, then inspect the round scorecard without hunting through a dense summary screen.

The agreed direction is:

- Feed: Social Digest structure, but without the weekly summary card.
- Top rail: round stories, one circle per recent round with photos.
- Finished round: compact recap followed immediately by an easy full scorecard.
- V1 enrichments: round result preview, full front/back scorecard, and scorecard-first tabs.

## Current Context

`src/screens/FeedScreen.js` currently builds a chronological feed from `buildFeed()`, with grouped round cards, grouped photo cards, reactions, comments, filters, and a `RoundSummary` navigation target.

`src/store/feedStore.js` already groups media by `(tournamentId, roundId)` for photo feed items, and it already has enough fields for round stories: `mediaList`, `roundId`, `tournamentId`, `tournamentName`, `createdAt`, `uploaderLabel`, and `uploaderId`.

`src/components/MemoriesStoriesViewer.js` already provides a story-style viewer with segmented progress, photo/video playback, captions, uploader metadata, and tap/long-press/swipe gestures. Its current gallery use case plays through tournament memories across round boundaries; the feed rail needs a round-scoped mode so tapping a round story shows that round's photos only.

`src/screens/RoundSummaryScreen.js` already loads the tournament, the selected round, ranked totals, holes, and round media. Its layout should be reorganized rather than replaced with new domain logic.

## Feed Design

The feed opens with a horizontal "round stories" rail. Each rail item represents a recent round that has at least one uploaded photo or video. The rail label should be the best available round name: course name when present, otherwise formatted round label. The sublabel should show media count, for example `7 photos`, or `3 memories` if mixed media is supported in the label.

Tapping a rail item opens a full-screen story viewer showing all media from that round in chronological order. Each story item must show who uploaded it, its caption when present, and round/hole metadata when available. Playback should not automatically continue into another round from this feed entry point.

Below the rail, the feed remains a chronological activity list. Round cards should lead with the people and round context, then show a compact top-three leaderboard preview. Photo-only feed cards can remain, but they should be quieter than before because the rail now owns the story-browsing workflow.

No weekly summary card is included in v1.

## Feed Components

Add or extract these components from `FeedScreen.js`:

- `RoundStoriesRail`: receives recent round story groups and opens the viewer at the selected group.
- `RoundStoryItem`: circular thumbnail/ring, round label, and media count.
- `FeedRoundCard`: friend-centered activity card with top-three leaderboard preview.
- `FeedPhotoCard`: compact card for photo groups that still appear in the chronological feed.

The existing `ReactionBar`, `PhotoCarousel`, and avatar helpers can remain initially, but `FeedRoundCard` should keep score presentation quieter than the current score tiles.

## Round Story Data

Extend the feed build result with a `roundStories` array derived from the same media grouping already used for photo feed items:

- `key`: `story:${tournamentId}:${roundId ?? 'none'}`
- `tournamentId`
- `tournamentName`
- `roundId`
- `roundIndex`
- `roundLabel`
- `courseName`
- `latestTs`
- `mediaList`: oldest-first for story playback
- `count`
- `uploaderNames`: unique uploader display labels for optional metadata

Sort rail groups newest-first by `latestTs`. Limit the first render to a small practical number, such as 12 groups, so the rail stays fast and compact.

Viewed/unviewed state is local-only in v1. Store by story key and latest media id/timestamp in `AsyncStorage`, so a story becomes "new" again when new media arrives. This state must not sync to Supabase.

## Story Viewer Behavior

Reuse `MemoriesStoriesViewer` rather than creating a second viewer. Add a round-scoped invocation path that passes only the selected story group's `mediaList`, with `startIndex = 0`.

The viewer header for feed-launched stories should identify the round, not the whole tournament sequence. Footer metadata should keep uploader label, caption, hole, and time. Existing gestures should remain: tap right to advance, tap left to go back, long-press to pause, swipe down to dismiss.

If a story item fails to load, show a retry or skip affordance consistent with the existing viewer's loading/error behavior. Do not let one broken media item crash the feed.

## Finished Round Design

`RoundSummaryScreen` should become a recap-first, scorecard-immediate screen:

1. Header: back button, round/course title, optional overflow/share space kept visually quiet.
2. Compact recap panel: winner, winning points, margin, strokes, holes played, and player count.
3. Tabs: `Scorecard`, `Leaderboard`, `Photos`, `Comments` where `Scorecard` is selected by default.
4. Scorecard section: full scorecard visible immediately as front nine and back nine stacked tables.
5. Secondary sections: leaderboard, photos, notes/comments, and "Open in scorecard" for rounds the signed-in user can edit/view in the scorecard.

The scorecard must avoid the current tiny horizontally scrolling grid as the primary experience. Split the 18 holes into two nine-hole tables with fixed first column for row labels and a total column. Each player row shows strokes by hole and total strokes. Stableford points remain visible in the leaderboard and recap.

For rounds finished early, the scorecard should show only played holes clearly and leave unplayed cells empty or marked with the existing dot convention. The recap should use holes played rather than implying a full 18 if the round ended early.

## Finished Round Components

Extract focused components from `RoundSummaryScreen.js`:

- `RoundRecapPanel`: winner, margin, strokes, holes, player count.
- `RoundSummaryTabs`: local tab state, scorecard default.
- `RoundScorecardTables`: front/back nine scorecard rendering.
- `RoundLeaderboardPanel`: ranked Stableford results.
- `RoundMediaStrip`: round media preview and story viewer entry.

Keep scoring math in `tournamentStore` helpers. UI components should consume prepared totals and hole data, not recompute Stableford logic.

## Data Flow

Feed load:

1. `FeedScreen` calls `buildFeed()`.
2. `buildFeed()` loads tournaments, friend tournaments, and media.
3. It returns `{ me, friends, items, roundStories, partial, error }`.
4. `FeedScreen` renders `RoundStoriesRail` from `roundStories` and the activity list from filtered `items`.
5. Tapping a story opens `MemoriesStoriesViewer` with that story's round-scoped `mediaList`.
6. Tapping a round card navigates to `RoundSummary` with `{ tournamentId, roundId }`.

Finished round load:

1. `RoundSummaryScreen` loads tournament snapshot/remote fallback plus round media.
2. It derives ranked totals once from `roundTotals(round, players)`.
3. It renders recap and tabs.
4. `Scorecard` tab renders front/back score tables by default.
5. `Photos` tab can reuse the media strip/story viewer entry for the selected round.

## Empty, Loading, and Error States

If there are no round stories, omit the rail and let the feed begin with filters/activity. Do not show an empty rail placeholder.

If media loading partially fails, keep the existing partial-feed banner behavior. The rail can be absent in partial state; round activity should still render.

If the feed has no activity, keep the existing empty state and add friends action.

If a finished round has no hole data, show the recap and leaderboard when possible, then a clear `No scorecard data for this round` message in the Scorecard tab.

If a finished round has media but no score data, photos remain accessible and the scorecard tab shows the empty score state.

## Visual Direction

The design should stay mature and product-like, not playful or childish:

- Preserve the existing cream/green/gold app identity.
- Use the friend/round rail as the social signal, not decorative emoji or oversized badges.
- Keep cards at moderate radii, restrained borders, and low shadows.
- Use Playfair for screen titles and key recap numbers only.
- Use Plus Jakarta Sans for labels, rows, tabs, and metadata.
- Avoid a large weekly digest or story-like hero in the feed.

## Testing Plan

Store tests:

- `buildFeed()` returns round stories grouped by `(tournamentId, roundId)`.
- Round story groups sort newest-first by latest media timestamp.
- Story media lists sort oldest-first for playback.
- Groups exclude empty media groups and survive missing `roundId`.
- Existing feed item behavior remains intact.

Component/screen tests:

- Feed renders the rail when `roundStories` exists and omits it when empty.
- Tapping a rail item opens the story viewer with the selected round media only.
- Feed round cards show top-three results and keep navigation to `RoundSummary`.
- Finished round defaults to the Scorecard tab.
- Finished round scorecard renders front/back nine tables and handles early-finished rounds with missing holes/scores.
- Existing `Open in scorecard` behavior remains available for rounds where the user is a participant.

Manual verification:

- Mobile portrait feed with several story groups.
- Feed with no media.
- Feed partial-load state.
- Finished 18-hole round with four players.
- Finished early round with partial scores.
- Friend-only round where the signed-in user did not play.
