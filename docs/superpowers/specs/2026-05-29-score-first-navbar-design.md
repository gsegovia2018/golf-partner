# Score-First Navbar Redesign — Design Spec

**Date:** 2026-05-29  
**Status:** Draft for user review

## Goal

Refactor the primary bottom navbar into a more modern, mobile-first action dock. The selected direction is Option C from the visual exploration: a five-item bar with a raised center action that prioritizes getting into the current game or active scorecard.

The nav destinations are:

- Feed
- Stats
- Play / Score
- History
- Profile

## Current Context

`App.js` currently defines a custom `FloatingTabBar` for the bottom tab navigator. It has three primary routes:

- `Feed`
- `Home`, labelled as `Play`
- `History`

The current bar uses Feather icons, a floating pill container, an active pill label, and a live-round dot on the `Play` tab when `isRoundInProgress(tournament)` is true.

The redesign should keep the same custom-tab architecture rather than switching back to the default React Navigation tab bar, because the raised center action and live-round state need custom rendering.

## Visual Design

The navbar becomes a compact floating slab instead of a long rounded pill.

- Container: bottom floating dock with side margins, rounded corners around `22`, soft shadow, and theme-aware card/elevated background.
- Layout: five fixed nav slots with the center action visually larger and raised above the dock.
- Secondary tabs: icon-first, compact targets for `Feed`, `Stats`, `History`, and `Profile`.
- Active secondary tab: subtle well using `theme.accent.light`; icon color uses `theme.accent.primary`.
- Center action: raised rounded-square button, larger than the other tabs, with a short visible label.
- Light theme: keep the current cream app background and Augusta green action color.
- Dark theme: use the existing dark elevated/card tokens, with the center action still carrying the strongest contrast.

The center action has two states:

- `Play`: default state. Green button with flag/play-style icon. Opens the play hub/current tournament route.
- `Score`: live-round state. Dark button with Masters gold accent. Opens the active scorecard directly.

## Icons

Use a more app-specific icon set than the current `rss`, `flag`, and `clock` trio. The final library choice can remain `@expo/vector-icons`, but the names should be selected from a set with strong glyph coverage, such as Ionicons or MaterialCommunityIcons.

Recommended icon meanings:

- Feed: newspaper/list/activity feed icon
- Stats: bar chart icon
- Play: golf flag or play/flag hybrid
- Score: scorecard/flag icon, if available; otherwise flag with a scorecard-like glyph
- History: time/restore icon
- Profile: person/account icon

Avoid text-heavy tabs. The center button may show `Play` or `Score`; the four secondary destinations should rely on icons with accessibility labels.

## Navigation Behavior

The tab route set expands from three routes to five:

- `Feed` routes to `FeedScreen`
- `Stats` routes to `MyStatsScreen`
- `Home` remains the underlying play route, displayed as center `Play`
- `History` routes to `HistoryScreen`
- `Profile` routes to `ProfileScreen`

The center action is special:

- When no round is live, tapping it navigates to `Home`.
- When a round is live, tapping it navigates to `Scorecard`.
- Its label and visual treatment update from `Play` to `Score` based on `isRoundInProgress(tournament)`.

Keep the existing route name `Home` for the play hub so existing `navigate('Home')` calls remain valid.

## Stats Destination

The navbar should promote `MyStatsScreen` as the first-class Stats destination. This matches the existing home-list "Statistics" entry point and makes the navbar useful even when the user is not inside one active tournament.

The existing per-tournament `StatsScreen` remains reachable from tournament-level menus. It should not become a second navbar item.

## Profile Destination

Profile is promoted to the fifth navbar item. It should navigate directly to `ProfileScreen`.

Secondary account-adjacent tools such as players, courses, notifications, friends, and settings can remain reachable from existing screen-level menus. This navbar change should not add a separate More tab.

## Accessibility

- Every tab keeps `accessibilityRole="button"`.
- The active destination sets `accessibilityState={{ selected: true }}`.
- Secondary icon-only tabs must have explicit labels: `Feed`, `Stats`, `History`, `Profile`.
- Center action label must match its behavior: `Play` when it opens the play hub, `Score` when it opens the active scorecard.
- Maintain a minimum 44x44 tap target for every item.

## Scope

In scope:

- Refactor the custom bottom navbar visuals.
- Change the primary nav route set to include Stats and Profile.
- Replace navbar icons with the selected modern icon language.
- Preserve the live-round behavior, moving it from a dot on Play to the raised center action state.
- Keep light/dark theme support and safe-area handling.

Out of scope:

- Redesigning Feed, Stats, History, Profile, or Home screen internals.
- Creating a new More/settings hub.
- Changing stack-level flow screens or deep-link behavior except as needed to keep the tab routes valid.
- Adding new analytics features.

## Acceptance Criteria

1. The bottom navbar shows five destinations: Feed, Stats, Play/Score, History, Profile.
2. The center action is raised and visually stronger than the four secondary tabs.
3. With no live round, the center action says `Play` and navigates to the play hub.
4. With a live round, the center action says `Score` and navigates directly to the scorecard.
5. `MyStatsScreen` and `ProfileScreen` are directly reachable from the navbar.
6. Existing `Home` route navigation continues to work.
7. The navbar respects safe-area padding on native and web.
8. Light and dark themes both render with sufficient contrast.
9. Icon-only tabs remain accessible through labels and selected state.
10. Flow screens pushed above the tabs continue to hide the tab bar as they do today.
