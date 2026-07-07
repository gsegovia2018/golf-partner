# Marbella Course Data + Scramble & Pairs Match Play Modes — Design

**Date:** 2026-07-07
**Status:** Approved by user (sections approved in conversation)

## Overview

Two independent workstreams:

1. **Course data (live Supabase, no app code):** add full tee sets with official
   slope and course rating for Golf Torrequebrada and Santa Clara Golf Marbella,
   merge the duplicate Santa Clara entry, and create Mijas Golf's two layouts
   (Los Lagos, Los Olivos) as new courses.
2. **Game modes (app code):** four new scoring modes following the existing
   `SCORING_MODES` catalog pattern — three scramble variants and Pairs Match Play.

---

## Part 1 — Course data

The app already computes WHS course handicaps from tee slope/rating
(`calcPlayingHandicap` in `src/store/scoring.js`), and per-player tees are
assigned per round. Courses live in Supabase (`courses`, `course_holes`,
`course_tees`). This part is executed directly against the live DB with the
service-role key (as done for schema-drift fixes before), followed by
verification queries.

### Current live state

| Course | Live row | Tees today |
|---|---|---|
| Golf Torrequebrada | `e6b357db-…` | single "Default", slope/rating null |
| Santa Clara Golf Marbella | `942f2c50-…` | single "Default", slope 129, rating null |
| Santa Clara (duplicate) | `49802bf8-…` | single "Default", slope 132, rating null |
| Mijas Los Lagos | — (does not exist; "Golf Los Lagos" is a different course) | — |
| Mijas Los Olivos | — (does not exist) | — |

### Work

1. **Golf Torrequebrada (Benalmádena):** replace the Default tee with the
   official tee sets (typically Blancas / Amarillas / Azules / Rojas, plus
   ladies' ratings where published), each with course rating and slope from the
   official scorecard / RFEG data.
2. **Santa Clara Golf Marbella:** same treatment. Duplicate merge: inspect
   which tournaments / favorites / clubs reference each of the two rows, keep
   the canonical "Santa Clara Golf Marbella", repoint references, delete the
   duplicate. Past rounds snapshot their holes into the round JSON, so history
   is unaffected.
3. **Mijas Golf — Los Lagos & Los Olivos:** create both as new courses with
   18 holes each (par, stroke index, distance) and full tee sets, grouped under
   a "Mijas Golf" club row (the `clubs` grouping already exists).

### Data sourcing

Official club scorecards and RFEG course-rating tables, fetched via web search
during implementation. Every tee gets `{ label, rating, slope, sort_order }`;
ladies' tees are separate labeled entries (matching the Golf Santander S.A.
precedent already in the library).

### Verification

Re-query each course with its tees after the writes; sanity-check the app's
course handicap for a known handicap index against a manual WHS calculation.

---

## Part 2 — Game modes

### Approach

Extend the existing mode-catalog architecture (approach A, chosen over a
generic configurable team-game engine and over flag-overloading existing
modes):

- catalog entries in `src/components/scoringModes.js`
- pure scoring engines alongside the existing ones in
  `src/store/tournamentStore.js` / `src/store/scoring.js`
- mode branches + summary variants in `src/components/scorecard/scoreModel.js`
- scorecard rendering reusing the existing pairs/team UI patterns
  (`GridView`, `HoleView`, `PlayerCard`)

### New modes (all require exactly 4 players)

| Key | Label | Teams | Scoring |
|---|---|---|---|
| `scramblepairs` | Scramble — Pairs | 2 v 2, one ball per team | Team Stableford; team hcp = 35% low + 15% high |
| `scramble3v1` | Scramble — 3 v 1 | 3-man scramble team vs 1 individual | Team Stableford (20/15/10% allowance) vs individual Stableford on full course handicap |
| `scramble4` | Scramble — 4-man | one team of 4 vs the course | Team Stableford; allowance 25/20/15/10% |
| `pairsmatchplay` | Pairs Match Play | 2 v 2 as two 1v1 duels | 2 pts/hole: each duel gives 1 to net hole winner, ½ each if halved; team totals; clinched when lead > 2 × holes left |

(Mode keys are lowercase to match the existing catalog: `individual`,
`stableford`, `matchplay`, `sindicato`, `bestball`.)

### Key decisions

- **Scramble score entry:** one score per team per hole, stored under the
  team's first member ("team ball" row) in the existing
  `scores[playerId][holeNumber]` shape. Offline sync (`syncQueue`, `merge`)
  is untouched. The scorecard renders one row per team.
- **Personal stats:** scramble rounds are excluded from individual stat
  aggregation in `statsEngine.js` — a team ball is not an individual score.
  Pairs Match Play counts the same way existing match play does.
- **Team handicaps:** derived from `round.playerHandicaps` — the per-player
  course handicaps already frozen at round build — using the WHS scramble
  allowances. No new round field; manual handicap edits affect the game
  exactly as they do in every existing mode. USGA Rules of Handicapping
  Appendix C allowances: 2-man = 35%/15%, 3-man = 20/15/10%,
  4-man = 25/20/15/10% (low → high course handicap).
- **Pairs Match Play structure:** reuse the existing random-pairs mechanism
  for the two teams, then randomly assign the two cross-team duels; duels are
  stored on the round (e.g. `round.duels`) and revealed like partners are
  today. Holes are decided on net scores (stroke-index extra shots), like
  existing match play. Every fully-scored hole distributes exactly 2 points
  (1/0, or ½/½ per duel). Match is decided when a team's lead exceeds
  2 × remaining holes.
- **Mode picker:** scrambles appear under Teams, Pairs Match Play under
  Head-to-head (or Teams — final call in the plan), all gated
  `count === 4` with a matching `requirement` string. `fallbackScoringMode`
  behavior unchanged.
- **Leaderboard toggles:** each new mode gets `leaderboardToggleLabels`
  entries (native view left, Stableford right).
- **Summary panel (`summaryState`):** `scramblePairs` and `pairsMatchplay`
  reuse the `pairs` variant shape; `scramble4` gets a new `team` variant
  (team total + vs-par ribbon, no opponent); `scramble3v1` uses `pairs` with
  a 3-name side vs a 1-name side.

### Error handling / edge cases

- Roster shrinks below 4 mid-setup → existing `fallbackScoringMode` path
  already handles invalid modes.
- Partially scored holes: duel points and team Stableford points are `null`
  until the relevant scores exist (mirrors `matchPlayHolePts` semantics).
- Missing tee slope/rating: `calcPlayingHandicap` already falls back
  gracefully; team handicap simply uses the resulting course handicaps.

### Testing

Unit tests mirroring the existing suites:

- engine tests: scramble team handicap allowances, team Stableford tallies,
  3v1 comparison, duel hole points (win/half/null), team tally + clinch logic
- `scoringModes` gating: player-count gating, categories, toggle labels,
  `scoringModeUsesTeams`
- `scoreModel` summary states for each new mode (live, decided, solo-edge)
- stats exclusion: scramble rounds don't feed personal stats

---

## Out of scope

- Official-tournament (managed leaderboard) support for the new modes —
  casual games only for now, matching how sindicato/bestball rolled out.
- Generic team-size configurations (3v3, 5-man) — YAGNI.
- Per-shot attribution in scramble (whose drive was used).
