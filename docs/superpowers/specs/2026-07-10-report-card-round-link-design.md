# Report Card → Round Stats Link — Design

**Date:** 2026-07-10
**Status:** Approved

## Goal

From the round report card on the My Stats screen, let the user jump to the
full Round Summary page (scorecard, leaderboard, photos, comments) for the
round they're looking at — the same screen the feed opens when tapping a
round.

## Design

### `RoundReportCard` (src/components/RoundReportCard.js)

- New optional prop: `onOpenRound` (function).
- When provided, render a footer link button at the bottom of the card,
  below the expandable breakdown section, labelled **"Round Stats"** with a
  `chevron-right` Feather icon, styled like the existing `expandBtn` row
  (secondary background, accent-colored extra-bold text).
- When the prop is absent, the button does not render. The component stays
  purely presentational — no navigation dependency.

### `MyStatsScreen` (src/screens/MyStatsScreen.js)

- Resolve the currently selected round record from `myRounds` by
  `reportRoundKey` (records come from `collectMyRounds` and carry
  `tournamentId` and the raw `round` object).
- If the record exists and `round.id` is set, pass
  `onOpenRound={() => navigation.navigate('RoundSummary', { tournamentId, roundId: round.id })}`.
- If `round.id` is missing (older local data RoundSummary can't resolve),
  pass nothing so the link doesn't render.

### Out of scope

- No changes to `buildRoundReportCard` or any store module.
- No changes to `RoundSummaryScreen`; navigation params match the feed's
  existing `openRound` call exactly.

## Testing

- `RoundReportCard.test.js`:
  - renders the "Round Stats" button when `onOpenRound` is provided and
    invokes the callback on press;
  - does not render the button when the prop is absent.
- `MyStatsScreen.test.js`: selected round with an id → tapping the link
  navigates to `RoundSummary` with the right `tournamentId`/`roundId`.

## Error handling

The only failure mode is an unresolvable round (no `round.id`); it is
prevented upstream by not rendering the link in that case.
