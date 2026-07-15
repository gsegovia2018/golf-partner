# Plan: Audit Tier 5 Fixes (stat correctness / polish)

Follows Tiers 1+2 (e6b15f2), 3 (14a8f23), 4 (1c13728), all merged. Fixes the
Tier 5 stat-correctness findings from the 2026-07-14 audit. Unlike Tier 4
(behavior-preserving), these CHANGE displayed stat values to CORRECT them — each
task must lock the NEW correct value with a test and explain the before/after.

## Defaults (chosen; not blocking questions)

- **Small-sample trends:** require a minimum sample before emitting a
  direction/arrow — default ≥3 rounds for recent-vs-history; a threshold band
  (not a 1-point swing) for course mastery. Below threshold → `flat`/null, not a
  confident verdict.
- **Up-and-down metric:** the module itself notes true up-and-down needs a
  chip-on marker the app doesn't track. Prefer the HONEST fix: rename/relabel the
  metric to "scrambling %" everywhere it surfaces (so it isn't read as classic
  up-and-down), rather than inventing a signal. If a reliable around-green signal
  (e.g. `sandShots>0`) genuinely exists in the data, gating the denominator on it
  is acceptable too — implementer's call, documented.
- **Dead `_appendConflicts` audit UI:** remove the dead code path (it can never
  populate under sync v2) rather than wiring a new detector.

## Global Constraints

- Stack: Expo SDK 54, RN 0.81, React 19, react-native-web. Supabase. Domain
  logic in `src/store`/`src/lib`, not screens.
- TDD: failing test FIRST that asserts the NEW correct value, then implement.
  Baseline after Tier 4: 1826 tests / 156 suites green. `npm run lint` 0 new
  errors.
- These fixes CHANGE stat outputs. When an existing test asserts the OLD (buggy)
  value, update it and explain in the report WHY the new value is correct. Do not
  silently loosen a test.
- Scramble modes are excluded from personal stats (existing invariant — don't
  regress). Stableford formula unchanged.
- Concurrent session may share the checkout — only touch the files each task
  names; do NOT run `git stash`/`git reset --hard`.

## Context

Tiers 1-4 fixed data-loss/security/correctness/resilience/perf. Tier 5 corrects
misleading personal-stat math: baselines diluted by partial rounds, a
denominator-mismatched SG headline, a mislabeled coach leak, 18-hole assumptions
that break 9-hole/back-nine rounds, trends that fire on noise, an inflated
up-and-down denominator, and a dead conflict-audit panel.

---

## Task 1: Report-card per-round baselines must divide by COMPLETE rounds

**File:** `src/store/roundReportCard.js` (`countCell` ~116-129,
`distributionCells` ~147-161; `baseStats.roundCount` usage).

**Problem:** baseline = `baseTotal / baseRounds`, where `baseTotal` (career
birdies/pars/bogeys/blow-ups) counts EVERY hole of every history round, but
`baseRounds = baseStats.roundCount` counts each round as 1 — including
early-finished/short rounds (a 6-hole round adds ~⅓ a round's birdies but a full
1 to the denominator). This deflates the per-round baseline, so nearly every full
round reads "above average" (false "bright spot" callouts).

**Fix:** Divide by the count of COMPLETE rounds (the module already computes
`isComplete` and uses it for the headline in `careerPerHole`), OR sum the
distribution only over complete rounds for the baseline. The baseline must
represent a per-COMPLETE-round rate so a full round is compared like-for-like.
Read `careerPerHole`/`isComplete` first and reuse that completeness notion.

**Tests:** With a history containing one full 18-hole round and one 6-hole round,
assert the per-round baseline equals the full-round rate (not diluted by the
partial round), so a subsequent average round is NOT flagged as above-average.
Update any test asserting the old diluted value; explain.

**Verify:** `npm test -- reportCard roundReportCard` and lint pass.

---

## Task 2: Season SG headline — one consistent denominator

**File:** `src/store/statsEngine.js` (`sgSeason` ~2636-2653; `sgPenalties`
~2476-2490 for context).

**Problem:** each SG category is averaged over `categoryRounds[category]` (rounds
that had THAT category's data), then the four per-round averages are summed for
`total`. Penalties treats every tracked hole as a sample (clean holes contribute
0) so `categoryRounds.penalties ≈ all rounds`, while approach/putting divide by
far fewer rounds. The headline "SG/round total" is a figure no actual round
produced.

**Fix:** Use ONE consistent denominator for the headline total — e.g. rounds with
ANY SG sample — across all categories, OR clearly separate "SG per round in
tracked category" (per-category, own denominator) from the summed total (which
must use a single shared denominator). The displayed total must be a coherent
per-round figure. Document which denominator you chose and why. Keep per-category
detail values sensible.

**Tests:** With a fixture where putting data exists in only 2 of N rounds and
penalties in all N, assert the headline total uses the consistent denominator
(not a sum of averages over mismatched denominators). Update old-value tests;
explain.

**Verify:** `npm test -- statsEngine sg strokesGained` and lint pass.

---

## Task 3: Coach "Penalties" insight must not be mislabeled into Scoring

**File:** `src/store/coachInsights.js` (`normalizeArea` ~61-66, `AREA_ALIASES`;
`strokesGainedCategoryInsights` ~240-265; `SG_CATEGORY_TITLES`).

**Problem:** `strokesGainedCategoryInsights` emits an insight for the `penalties`
category, but `AREA_ALIASES` has no `penalties` key, so
`normalizeArea('penalties')` falls through to `'scoring'` → labeled "Scoring".
Since `sgPenalties` is always ≤ 0, this yields a near-permanent `fixFirst` leak
titled "Penalties" filed under Scoring, crowding out genuine leaks in
`pickHero`/`buildPracticePlan`.

**Fix:** Add a `penalties` area alias + `AREA_LABELS.penalties` (so it's its own
area, correctly labeled), OR exclude penalties from category insights when the
magnitude is small/below a threshold. Choose the option that keeps the coach
output honest (penalties shown as penalties, not miscategorized as Scoring, and
not permanently dominating). Document the choice.

**Tests:** Assert a penalties-driven insight is labeled "Penalties" (not
"Scoring") OR excluded when trivial; assert it no longer crowds out a genuine
larger leak in `pickHero`. Update old tests; explain.

**Verify:** `npm test -- coach coachInsights` and lint pass.

---

## Task 4: Difficulty bands + warmup/closing must not assume 18-hole 1-based numbering

**Files:** `src/store/personalStats.js` (`holeDifficultySplit` ~85-86),
`src/store/statsEngine.js` (`warmupVsClosing` ~953-962).

**Problem A (holeDifficultySplit):** bands hardcoded `SI ≤6 hard`, `≤12 mid`,
else `easy`. For 9-hole rounds (SI 1–9) the "easy (13-18)" band is always empty
and everything collapses into hard/mid, skewing strength ranking and the report
card's "where on the course" group.
**Problem B (warmupVsClosing):** warmup = `hole.number ≤ 3`, closing =
`hole.number ≥ holes.length − 2`. A back-nine-only round numbered 10–18 captures
zero warmup holes and mislabels closing; also pools 9- and 18-hole closing
stretches.

**Fix A:** Derive band thresholds from the round's actual SI range (max SI), or
normalize SI to a 1–18 scale per round, so 9-hole rounds split into three
sensible bands.
**Fix B:** Compute warmup/closing from the round's actual hole ORDER (first-N /
last-N of the holes as played), not a hardcoded 1-based number, so a back-nine
round's first holes count as warmup. Keep 18-hole behavior identical.

**Tests:** Assert a 9-hole round produces non-empty easy/mid/hard bands; assert a
back-nine (holes 10–18) round's warmup = its first holes (not empty). Confirm an
ordinary 18-hole 1-based round is UNCHANGED (regression). Update old tests;
explain.

**Verify:** `npm test -- personalStats statsEngine difficulty warmup` and lint pass.

---

## Task 5: Trends require a minimum sample (no 1-round / 1-point verdicts)

**File:** `src/store/personalStats.js` (`computeRecentVsHistory` ~454-485 default
`n=5`; `courseMastery` ~571-573).

**Problem A (computeRecentVsHistory):** with 6 rounds, `history` is exactly 1
round; deltas/direction are computed with the same confidence as against a
20-round baseline — one noisy early round drives a "declining/improving" verdict
that feeds Coach `formInsight`.
**Problem B (courseMastery):** `trend = sign(lastRoundTotal − previousRoundTotal)`
over just the two most recent complete rounds — a 1-point difference shows a full
"improving"/"declining" arrow.

**Fix (per default):** Require a minimum history sample (≥3 rounds) before
emitting a recent-vs-history direction; below that → `flat`/null. For course
mastery, use a slope over ≥3 rounds or a threshold band around 0 (a 1-point swing
is `flat`). Keep confident verdicts when the sample is adequate.

**Tests:** Assert a 6-round history (1 history round) yields `flat`/null direction
(not a confident verdict); assert a 1-point course-mastery difference is `flat`;
assert an adequate sample still yields a real trend. Update old tests; explain.

**Verify:** `npm test -- personalStats trend courseMastery recentVsHistory` and lint pass.

---

## Task 6: Up-and-down denominator — honest labeling / correct gating

**Files:** `src/store/statsEngine.js` (`upAndDownRate` ~2306-2312,
`scramblingStats` ~1902-1918), plus the UI label(s) where it surfaces (find
consumers — likely StatsScreen/MyStats/coach copy).

**Problem:** any missed-GIR hole with shot detail is counted as an up-and-down
ATTEMPT, even holes with no greenside/recovery shot (a two-putt from the fringe, a
long 3-putt). The module's own comment admits true up-and-down needs a chip-on
marker not tracked. The inflated denominator understates the rate.

**Fix (per default — honest labeling):** Rename/relabel the metric to
"scrambling %" everywhere it surfaces so it isn't read as classic up-and-down; OR,
if a reliable around-green signal exists (`sandShots>0` or an equivalent recovery
marker), gate the attempt denominator on it. Do NOT invent a signal. Keep the
computation consistent with whatever the label promises.

**Tests:** If relabeling: assert the surfaced label is "scrambling"/"scrambling %"
(not "up & down"/"up-and-down") and the value is unchanged. If gating: assert a
missed-GIR hole with no around-green shot is NOT counted as an attempt. Update
old tests; explain the choice.

**Verify:** `npm test -- statsEngine scrambling upAndDown Stats MyStats` and lint pass.

---

## Task 7: Remove the dead conflict-audit UI (`_appendConflicts`)

**Files:** `src/store/tournamentStore.js` (`_appendConflicts` ~1883,
`_conflictLog`), `src/components/SyncStatusSheet.js` (~112-127 "Cambios
sobrescritos" section), `src/store/conflictLabels.js` (if only used by the dead
path).

**Problem:** `_appendConflicts` (the only writer of `_conflictLog`) has NO callers
anywhere in `src/` — it can never populate under the derived-conflict (sync v2)
model. `SyncStatusSheet` still renders a permanently-empty "Cambios sobrescritos"
section.

**Fix (per default — remove dead code):** Remove `_appendConflicts`,
`_conflictLog`, and the SyncStatusSheet "Cambios sobrescritos" UI that consumes
it. Verify `conflictLabels.js` (`pathToLabel`) has no OTHER live consumer before
removing it — if it's used elsewhere, keep it; if only by the dead path, remove.
Do NOT remove any live conflict UI (the derived per-author ScoreConflictSheet /
DiscrepancySheet are LIVE — leave them).

**Tests:** Confirm removal doesn't break SyncStatusSheet rendering (it renders
without the dead section); no import of the removed symbols remains. Existing sync
tests stay green.

**Verify:** `npm test -- SyncStatus conflict sync` and lint pass.

---

## Out of scope

The Tier 2/3/4 cross-cutting fast-follows tracked in memory
`audit-tier1-tier2-branch` (fixed-teams scored-round guard, secondary handicap
coercion sites, feed scroll-reset, videoThumbWeb double-buffer, etc.). This is
the LAST audit tier — after it, the ~80-finding audit backlog is cleared except
those small follow-ups.
