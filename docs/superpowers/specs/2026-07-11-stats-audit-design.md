# Stats Section Audit — Fixes & Improvements Design

**Date:** 2026-07-11
**Scope:** StatsScreen (Overview / Players / Holes / Pairs / My Shots / Shame), MyStatsScreen (personalStats), statsEngine, and the data-collection paths that feed them.
**Source:** Seven parallel code audits (one per tab, one for the data pipeline + MyStats), each tracing every metric through the engine and the scorecard write path. High-impact findings re-verified against source.

## 1. Problem statement

The stats engine (`src/store/statsEngine.js`) computes ~40 metrics but has **zero scoring-mode awareness** and near-zero test coverage outside a handful of functions. Three systemic defects distort many metrics at once, and a set of per-metric bugs sit on top. Presentation is solid in structure (cards + detail sheets + section index) but inconsistent: the Strokes/Points toggle and the round-scope chips silently apply to only some sections of each tab.

## 2. Systemic root causes (fix once, benefit everywhere)

### RC1 — Scramble team scores contaminate personal stats in mixed-mode tournaments (HIGH)
Scramble rounds store one team ball under the captain's player id (`scoring.js:441-444`), scored off a *team* handicap that is never persisted. `statsEngine.js` contains no `roundScoringMode`/`isScrambleMode` reference, so every function credits team play to the captain personally **at the captain's personal handicap** (double error). The screen gates only the all-scramble case (`StatsScreen.js:148,171`) and sanitizes only H2H (`withoutScrambleScores`, `StatsScreen.js:372-377`) and PairsTab pair-aggregation. Affected: every section of Overview, Players, Holes, My Shots, Shame, plus PairsTab baselines (`playerPartnerSplits`, `pairSynergy`).

**Fix:** Move `withoutScrambleScores` into `statsEngine.js` (exported), extend it to blank `scores`, `shotDetails`, and `pairs` on scramble rounds (array length preserved so roundIndex labels stay correct), and apply it in StatsScreen to the tournament passed to **all** tabs. PairsTab composes it with its existing `pairsTournament` strip. `personalStats.js` already filters per-round (`:186`) — unchanged.

### RC2 — Pickups are synthetic strokes with two disagreeing detectors (MEDIUM)
A pickup records `par + 2 + extraShots` real-looking strokes (`scoring.js:271-274`), no flag. The scorecard detects pickups with `>=` (`HolePage.js:177`), the engine with `===` (`statsEngine.js:1182`) — over-pickup values (the stepper has no upper clamp) show a pickup badge on the card but vanish from Pickup Champion. Synthetic strokes also poison strokes-based metrics: strokes-mode Skins can be "won" by the *lower* handicapper's pickup, Blow-up Hole and Chaos Holes reward fabricated numbers.

**Fix:** Export `isPickupScore(strokes, par, handicap, strokeIndex)` from `scoring.js` using `>=` (single source of truth; scorecard reuses it). In the engine: `pickupChampion` uses it; `hallOfShame.blowup`, `chaosHoles`, and strokes-mode `skinsLeaderboard` exclude pickup-valued scores from stroke comparisons (a pickup can tie/lose but never win a skin or headline a "real" stroke stat).
Also fix the scorecard's pickup-undo fabricating a par (`PlayerCard.js:143` writes `hole.par` on toggle-off) — undo clears the score instead.

### RC3 — "Consecutive" streaks bridge unscored holes and round boundaries (MEDIUM)
`playerStreaks` (`statsEngine.js:69-123`), `hallOfShame` streaks (`:561-597`), and `bounceBackRate` (`:1510-1552`) build gap-free arrays of *scored* holes across all rounds and treat adjacent array entries as consecutive. A streak survives an unscored hole in the middle and chains R1 H18 → R2 H1; a "bounce-back on the very next hole" can be two holes later.

**Fix:** Shared run-builder in statsEngine that breaks a run when the round changes or `holeNumber` is not `prev + 1`. Applied to all three. Explainer copy stays truthful ("consecutive holes within a round").

### RC4 — Library edits retroactively rewrite played rounds (HIGH, data integrity)
`propagatePlayerToTournaments` (`tournamentStore.js:648-656`) and `propagateCourseToTournaments` (`:683-700`) map over **all** rounds — re-deriving playing handicaps and wholesale-replacing `round.holes` (par, stroke index) on rounds already played. Fixing a course typo after the weekend silently re-scores history, shifts leaderboards, and desyncs pickup values (a picked-up hole can flip from 0 to 1 point). `addPlayerRoundPatches` already has the correct skip-played-rounds guard (~`:794`); the propagate functions don't.

**Fix:** Both propagate functions skip rounds that have been played (same played-round predicate as `addPlayerRoundPatches`). Future rounds still update.

## 3. Per-tab fixes

### Overview
- `strokeIndexAccuracy`: ignores the round-scope chip (violates the chip contract); a course played twice yields duplicate contradictory rows; ties get arbitrary ranks. Fix: pool observations per course+hole across rounds, average ranks over ties, accept `roundIndex`.
- Strokes-mode "Best Round" prints "No scores for this round yet." mid-round while live cards render below it. Fix copy: "No completed rounds yet (strokes needs all 18 holes)".
- Momentum bar colors assume 18 holes (32/28/22 thresholds). Normalize to points-per-hole.
- Ranked lists (Skins/Clutch/Consistency): share rank numbers on ties (no arbitrary gold); make 0-skin rows with ties tappable.
- Consistency Index: require a minimum sample (≥ 18 holes) before ranking; note that σ alone rewards "reliably bad" — display mean alongside.

### Players
- `warmupVsClosing` breakdown entries lack `roundIndex` → indistinguishable rows for the same course. Add it.
- Player chips: disambiguate duplicate first names (reuse the existing `firstName`/count logic).
- "Average per Round" diluted by partial rounds: show "n rounds · m holes" under the number.
- Round History rows: add scoring-mode badges and holes-played; use the already-computed `avgPerHole`.
- Add the `SectionIndex` (sticky chips) that Overview/Pairs already have.
- Enable the round-scope chips on this tab for the sections whose engine functions already accept `roundIndex` (distribution, streaks); label the rest "All rounds".

### Holes
- `collectiveExtremes` requires *every tournament player* to have scored the hole; a player skipping a round suppresses the whole round. Fix: require all players **with any score in that round**.
- Heatmap Avg column renders `0` for unscored holes (reads as "everyone blanked" in points view). Return null → render `-`.
- `bestWorstHoles`: easiest/hardest lists overlap when < 6 entries (dedupe guard); entries need `R{n}` labels; require ≥ 2 scores per hole before ranking; honor the round-scope chip (`roundIndex` param already exists).
- Reorder: heatmap first (it is the hero and the only chip-scoped section).

### Pairs
- `pairConfigMatrix` cross-attributes points/wins when the same 2v2 recurs with sides flipped (random draws flip ~50% of the time). Fix: canonicalize side orientation before accumulating (map the current round's pairs onto the stored `sideA`/`sideB` by member ids).
- "Total" scope silently shows first-round-only Hole Wins and H2H duel (`effectiveRound` passed instead of `roundScope`; the engine's multi-round path is dead code). Pass `roundScope` (null = tournament-wide) and label the section's scope.
- Phantom "Halved" match-play cards and inflated config counts for revealed-but-unplayed rounds (`scores: {}` exists from creation; reset preserves pairs). Guard on non-empty scores like `pairPerformance` does.
- `pairPerformance`: a pair's chemistry absorbs a 0-point "round" the moment the *other* pair enters a hole. Only count a round for a pair once that pair has scores.
- Baselines: feed `playerPartnerSplits` and `pairSynergy` the scramble-sanitized tournament (RC1).
- Presentation: merge Chemistry + Synergy + Carry into one **Pair Card** per pairing (avg pts + synergy badge + carry bar + rounds, detail sheet holds per-round rows); add a drama strip under the Pair Difference chart using the already-computed `crossovers`/`maxLead`/`maxDeficit`/`finalDelta`; label every section's effective scope.

### My Shots
- Scramble shot-detail write/read mismatch: panel reads `shotDetails[meId]` but writes under the scramble unit id (captain) — logged taps vanish and land on the captain. Fix: hide the shot-detail section in scramble rounds (the data has no honest surface; MyStats excludes scramble anyway).
- Scoring-mix card compares **net** distribution counts against **gross** Shot Scope benchmarks (permanently green birdies for mid-handicaps). Use gross distribution (`metric: 'strokes'`) for benchmark rows.
- Tee-penalty % divides par-3-inclusive penalty counts by par-4/5 drive count. Count tee penalties on drive-logged holes only.
- SG dashboard total ≠ sum of its category bars (different denominators). Make the headline the sum of per-category per-round values.
- `hasData`/`playersWithShotData` ignore approach-only/sand-only logging → false "No shot detail yet". Include all detail fields.
- Putts/round benchmarked from partially-logged rounds (9 logged holes → "16 putts/round" flagged good). Normalize: putts-per-logged-hole × 18 for benchmark rows.
- Tournament Shots tab: gate colored verdicts behind the same min-samples mystats uses; show grey "n holes — need more data" below threshold.

### Shame
- Anchor tiebreak systematically shames the higher handicapper (tied holes assign MB to the lower handicap). Exclude tied holes from the anchor score.
- Triple Bogey Club prints net vs-par but labels it strokes-over-par. Make the label metric-aware ("net" / "gross").
- Par-3 Heartbreak: collect ties; require ≥ 3 par-3s played.
- The Gift: allow 3-player groups (require ≥ 3 scores, not ≥ 4).
- Blow-up Hole: exclude pickup-valued scores (RC2) and require gross ≥ +3 before awarding.
- Zero Hero card names nobody — lead with the worst offender.
- Copy pass: banter tone for card subtitles/explainers (screenshot-sharing is the tab's superpower — write for the group chat).

### MyStats (personalStats)
- Early-finished partial games count as "completed" and 9-hole rounds halve round-total metrics. Fix: round-total metrics (`avgPoints`, `bestRoundPoints`, pts/round form series, report-card career baseline) use only rounds with all holes scored; per-hole metrics keep everything; the round selector shows a "partial · n holes" badge.
- `buildSyntheticTournament`: rekey `playerIndexes` and take the synthetic player's fallback handicap from the *most recent* round, not the oldest.
- `avgVsPar`: average over complete rounds only (consistent with the above).
- Form charts: add dates to point labels (course name alone is ambiguous).

## 4. New metrics (chosen for insight-per-effort)

| Tab | Metric | Data source |
|---|---|---|
| Overview | **Playing to Handicap** leaderboard — `Σpoints − 2×holesPlayed` per player ("+4 vs handicap") | `playerRoundHistory` |
| Overview | **Hot Stretch** — best rolling 6-hole window per player, with span in the sheet | existing hole stream |
| Players | **Difficulty split** — avg points by SI band (1-6/7-12/13-18) | `holeDifficultySplit` (exists, unused here) |
| Pairs | **Coverage %** — share of holes where ≥ 1 partner scored ≥ 2 pts, + "both blanked" count | `pairSynergy` hole loop |
| Shots | **GIR% after fairway vs after miss** — quantifies what a missed drive costs | join `drive` × per-hole GIR |
| Shame | **Nemesis Encore** — hole number that zeroed the same player in ≥ 2 rounds | `forEachHole` |
| MyStats | **Course Mastery** — per-course rounds, avg pts, best, trend | `courseDNA` on synthetic tournament |
| MyStats | **Career Milestones** — birdie/eagle counts, longest par+ streak, best 9, most points in a round | distribution + streaks |

## 5. Cross-cutting presentation rules

1. **Scope honesty:** every section states the scope it actually computes ("All rounds" / "R2 · Course") whenever the tab shows round chips; no section silently ignores a visible control.
2. **Toggle honesty:** sections hard-coded to points show a small "pts" badge when the Strokes/Points toggle is set to Strokes.
3. **Tie honesty:** shared rank numbers on ties everywhere ranked lists render.
4. **Sample honesty:** colored verdicts only above minimum samples; grey + "n holes" below.

## 6. Testing strategy

`statsEngine.test.js` covers almost none of the audited functions — every fix lands test-first (TDD): a failing fixture reproducing the audited scenario (mixed scramble tournament, flipped-pair config, gapped streak, pickup-valued scores, partial rounds), then the fix. A shared `mixedModeTournament` fixture builder serves RC1 tests across tabs.

## 7. Explicitly deferred (out of scope, recorded for later)

- Official-tournament rounds feeding Stats/MyStats (different data source; completeness gap, not a correctness bug).
- Stored per-hole pickup flag (schema/sync/merge change; RC2's shared detector removes the urgency).
- Full > 2-pairs support in pair-vs-pair sections (current group is 4 players; sections get an explanatory note instead).
- Strokes-gained tee category / non-fairway approach lies (needs more logged data than exists).
- Match-play section re-scored with true duel logic (current combined-Stableford lens gets a clarifying label instead).
- Conflict-aware stat indicators (device-local conflicted cells).
- Transposed hole heatmap (orientation change is high-risk, low-payoff vs reordering).
