# Round-scoped settings cleanup — design

**Date:** 2026-07-11
**Status:** Approved (user confirmed in chat, including gear-icon and pager-bug additions)

## Goal

Scoring mode is now a per-round concept; the tournament gear sheet still
exposes the old tournament-wide mode picker, which (a) shows the tournament
default (e.g. Best Ball) even when the selected round has a different mode
and (b) resets every round's override on save. Remove that footgun and
re-home the genuinely tournament-wide team settings. Also: per-round best
ball point values, a gear icon for the round settings trigger, and a fix for
the round pager showing round 1's card while the round 2 tab is selected.

## Parts

### A. Gear sheet: "Scoring Mode" → "Team Settings" (multi-round)

- Remove the tournament-wide Scoring Mode entry (`HomeScreen.js:2058-2078`),
  the `showScoringModeSheet` BottomSheet that hosts `ScoringModeField`, and
  the `saveScoringMode` reset-to-uniform path — for multi-round tournaments.
- Add a **Team Settings** entry in its place (icon `users`). Its bottom
  sheet contains:
  - *Fixed teams* toggle and *Manual teams* choice — extracted from
    `ScoringModeField` into a reusable component (e.g. `TeamSettingsFields`
    in `src/components/ScoringModePicker.js`) so the setup wizard
    (`SetupScreen`) keeps rendering them unchanged inside
    `ScoringModeField`.
  - When fixed teams is ON and the roster supports 2×2 teams: a read-only
    pairs preview ("Marcos + Noé vs Guille + Alex") plus an **Edit Pairs**
    button navigating to `EditTeams` with `roundIndex: 0` — the existing
    fixed-teams save already propagates pairs from the edited round to all
    later rounds, so round 0 covers the whole tournament.
  - Saving toggles dispatches a new `tournament.setTeamSettings` mutation
    stamping `settings.fixedTeams` / `settings.manualTeams` `_meta` paths
    (per-path LWW like every other mutation). No eager pair rebuilds —
    `pairsForNextRound` already applies fixedTeams lazily at reveal time.
- **Single-round tournaments:** the gear keeps a "Scoring Mode" entry, but
  round-scoped — it opens the same `ScoringModeSheet` as the multi-round
  per-round sheet and saves via the existing `round.setScoringMode`
  mutation for round 0. The Team Settings entry appears for single-round
  games too (same sheet).
- `settings.scoringMode` remains as the default for rounds without an
  override and for tournament creation (wizard unchanged).
- Consequence (deliberate): no single action flips every round's mode at
  once anymore.

### B. Per-round best/worst ball point values

- New optional `round.bestBallValue` / `round.worstBallValue` (positive
  integers), falling back to `settings.bestBallValue` /
  `settings.worstBallValue`, resolved by a single helper in
  `store/scoring.js`:
  `roundBestBallValues(tournament, round) → { bestBallValue, worstBallValue }`
  (same pattern as `roundScoringMode`).
- All point computations consume the helper instead of raw settings:
  the best/worst leaderboard + per-round tallies in `tournamentStore.js`
  (~lines 995–1311), `scoreModel.js` cfg (lines 260-261), `GridView.js`
  (line 551), and `HomeScreen`'s `playerRoundBestWorstPoints` call site.
- Editing UI: a **Point Values** item rendered with the round-scoped
  actions (multi-round: the per-round sheet; single-round: the gear sheet,
  which hosts round actions), shown only when that round's effective mode
  is `bestball`. Small sheet with the
  two numeric inputs (same normalization as `mergeScoringSettings`:
  `parseInt`, default 1). Saves via a new `round.setBestBallValues`
  mutation stamping `rounds.<id>.bestBallValue` / `rounds.<id>.worstBallValue`.
- Wizard and Edit Tournament keep editing the tournament defaults only.

### C. Random match draw for pairs match play

Already shipped (2026-07-11, commit af7f39e): ••• → Edit Teams shows the
duels with Randomize/Swap/manual editing. No further change.

### D. Gear icon for the round settings trigger

The per-round-card "Round options" button switches its Feather icon from
`more-horizontal` (•••) to `settings` (gear). Accessibility label stays
"Round options".

### E. Fix: round pager shows round 1's card with round 2's tab selected

- Symptom: select round 2, open the round settings sheet (or tournament
  gear), close it — sometimes the R2 tab stays highlighted but the pager
  displays round 1's card (reported with round 2 empty of scores).
- Suspected mechanism: the pager-sync effect (`HomeScreen.js:441-460`)
  early-returns when `roundScrollOffset.current` already equals the target;
  if the ScrollView's real scroll position resets to 0 (modal open/close,
  layout re-measure, or remount on focus return) without an onScroll
  commit, the ref goes stale and nothing re-scrolls.
- Fix requirement: implementer must first reproduce (jsdom test in
  `HomeScreen.roundPager.test.js` simulating a layout/remount scroll reset,
  or runtime reproduction), then re-assert the pager position — e.g. on the
  pager's `onLayout` (and/or screen focus), scroll to
  `selectedRound * roundPagerWidth` with `animated: false` and refresh
  `roundScrollOffset.current` — without reintroducing the snap-fight that
  6e0e580 fixed (manual picks must survive reloads; the regression tests
  from 6e0e580 must stay green).
- Acceptance: after open/close of either settings sheet and after
  navigating away and back, the displayed round card matches the selected
  tab, on an empty and on a scored round.

## Error handling

- `roundBestBallValues` treats missing/invalid round values as absent
  (fallback to settings, then 1) so legacy data renders unchanged.
- Team Settings sheet edits dispatch through `mutate` (offline queue +
  LWW stamps) like all other tournament edits.

## Testing

- Unit: `roundBestBallValues` fallbacks; `tournament.setTeamSettings` and
  `round.setBestBallValues` mutations (apply + `_meta` paths, offline
  merge survival); best/worst tallies honoring per-round values.
- Pager regression test per Part E.
- Existing suites (incl. `HomeScreen.roundPager.test.js`, scoring, sync)
  stay green; lint clean.
- Runtime verify (Expo web): gear sheet shows Team Settings (no Scoring
  Mode) on a multi-round tournament; pairs preview + Edit Pairs when fixed
  teams; per-round Point Values on a bestball round affect that round's
  points only; gear icon on round cards; pager desync no longer
  reproducible.
