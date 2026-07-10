# Match Play Relative Handicaps — Design

**Date:** 2026-07-10
**Status:** Approved

## Problem

Both match play modes (`matchplay` 1v1 and `pairsmatchplay` cross-team duels)
currently give every player their **full playing handicap** when computing net
strokes per hole (`matchPlayHolePts` and `duelNetWinner` in
`src/store/scoring.js` both call `calcExtraShots(fullHandicap, strokeIndex)`).

Standard match play handicapping is **relative**: the lower-handicap player in
a match plays off scratch (0), and the opponent receives only the *difference*,
allocated on the hardest holes (lowest stroke index) first. This changes
*which* holes receive strokes, not just totals — e.g. HCP 15 vs 5 with full
handicaps gives the weaker player their edge on SI 6–15; relative handicapping
gives it on SI 1–10.

## Decisions

- **Reference player:** per duel. In `pairsmatchplay`, each of the two 1v1
  duels is its own match — the lower-handicap player of *that duel* plays off
  0 and their opponent gets the difference. (Not relative to the best of all
  four players.)
- **Scope:** both `matchplay` and `pairsmatchplay`. No other modes change.
- **Allowance:** 100% of the difference (no percentage reduction).

## Approach

Derive relative handicaps at scoring/display time. `round.playerHandicaps`
keeps storing full playing handicaps exactly as today — stats, sync, manual
handicap edits, and every other scoring mode are untouched.

### New helper (`src/store/scoring.js`)

`matchPlayEffectiveHandicaps(round, players)` → `{ [playerId]: effectiveHandicap }`

- `matchplay` (2 players): `[hA, hB] → [hA − min, hB − min]`.
- `pairsmatchplay`: iterate `pairsMatchDuels(round.pairs)`; within each duel,
  lower player → 0, opponent → difference.
- Any other mode: identity (full handicaps), so callers can use it
  unconditionally.
- Source handicaps resolve the same way scoring does today:
  `round.playerHandicaps[id] ?? player.handicap ?? 0`.

Differences are always ≥ 0, so the negative branch of `calcExtraShots` is
never involved. Equal handicaps → both play gross.

### Scoring integration

`matchPlayHolePts`, `matchPlayRoundTally`, `duelNetWinner`,
`pairsMatchHolePts`, `pairsMatchDuelPts`, and `pairsMatchRoundTally` operate
on the effective map internally. Every consumer — round tallies, clinch math,
`tournamentMatchPlayStandings`, team leaderboards, scorecard points — gets the
new rule automatically with no call-site changes.

### Display integration

In match play modes the scorecard supplies the effective map where strokes
received are shown, so display always matches scoring:

- Stroke-received dots: `src/components/scorecard/GridView.js:179,206`
- Pickup hint: `src/components/scorecard/HolePage.js:153`

Other modes pass the stored map through unchanged. Player profiles and stats
keep showing full handicaps — `statsEngine` is intentionally untouched, since
personal net stats should stay based on real playing handicaps.

## Retroactive effect

Match play results are computed on the fly from stored strokes and handicaps.
Previously played match play rounds and tournament standings will re-render
under the new rule automatically. No data migration — this is a pure rule
change.

## Rejected alternatives

- **Store relative handicaps in `round.playerHandicaps` at round creation:**
  breaks manual handicap edits, corrupts the "playing handicap" meaning for
  stats/display, doesn't fix already-created rounds, adds sync/merge
  complexity.
- **Adjust only inside the net comparison (no shared helper):** functionally
  equivalent for scoring, but the UI dots would duplicate the derivation.

## Testing

TDD on the new helper plus updated expectations in
`src/store/__tests__/scoring.test.js` and
`src/store/__tests__/pairsMatchplay.test.js`:

- Per-duel reference (not best-of-four) in pairs match play.
- Equal handicaps → gross duel, no strokes either side.
- Strokes land on SI 1–n for a difference of n.
- 1v1 `matchplay` uses the difference.
- Identity behavior for non-match-play modes.
- Tally/clinch/standings math otherwise unchanged.
- Display: GridView dots reflect relative strokes in match play modes.
