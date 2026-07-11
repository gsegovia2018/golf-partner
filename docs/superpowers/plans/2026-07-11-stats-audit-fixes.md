# Stats Audit Fixes & Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the correctness bugs found by the 2026-07-11 stats audit (spec: `docs/superpowers/specs/2026-07-11-stats-audit-design.md`), make every tab's scope/toggle honest, and add eight new metrics.

**Architecture:** Domain fixes land in `src/store/statsEngine.js` / `scoring.js` / `tournamentStore.js` / `personalStats.js` with tests first (the engine is almost untested today); UI changes land in `src/screens/StatsScreen.js`, `src/components/mystats/*`, and scorecard components. One systemic sanitizer (RC1) is applied at the StatsScreen boundary so every tab inherits it.

**Tech Stack:** React Native (Expo 54), Jest (jest-expo), plain JS store modules.

## Global Constraints

- `npm test -- <file>` for targeted runs; full `npm test` and `npm run lint` must be green before every commit (lint is CI-blocking).
- Jest picks up nested worktree copies — ignore failures from `.claude/worktrees`/`.worktrees` paths; run with `--testPathPattern src/` when in doubt.
- TDD for every behavioral change: failing test → verify RED → implement → verify GREEN.
- Keep domain logic in `src/store/`, not screens (CLAUDE.md).
- Match existing code style; comments only where the code can't express a constraint.
- Read the audited file region before editing — line numbers below are from the 2026-07-11 audit and may drift a few lines.
- Commit after every task; message style: `fix(stats): …` / `feat(stats): …` / `test(stats): …`.

---

### Task 1: Shared mixed-mode test fixture builder

**Files:**
- Create: `src/store/__tests__/statsFixtures.js`
- Test: consumed by later tasks (this task's own check: existing suite stays green)

**Interfaces:**
- Produces: `buildTournament({ players, rounds })` and `mixedModeTournament()` — the canonical fixture used by Tasks 2, 3, 5, 9, 10.

**Contract:** Read `src/store/__tests__/statsEngine.test.js` first and reuse its tournament shape exactly (players `{id, name, handicap}`, rounds with `courseName`, `holes: [{number, par, strokeIndex}]`, `scores: {playerId: {holeNumber: strokes}}`, `playerHandicaps`, optional `pairs`, optional per-round `scoringMode`). `mixedModeTournament()` must return: 4 players (hcp 8/12/18/24), R1 normal `stableford` round fully scored, R2 `scramblepairs` round with pairs `[[p1,p2],[p3,p4]]` and team-ball scores stored ONLY under captains p1 and p3, R3 normal round partially scored (holes 1–9 only, with a deliberate gap: player p2 has no score on hole 5). Export a helper `holes18()` (pars 4/3/5 rotation, deterministic strokeIndex 1..18) so tests don't rebuild them.

- [ ] **Step 1:** Read `statsEngine.test.js` fixtures; write `statsFixtures.js` matching that shape, with the exports above.
- [ ] **Step 2:** Run `npm test -- statsEngine` to confirm nothing broke.
- [ ] **Step 3:** Commit: `test(stats): add shared mixed-mode tournament fixtures`

---

### Task 2: RC1 — scramble sanitizer in the engine, applied to all tabs

**Files:**
- Modify: `src/store/statsEngine.js` (new exported function near the top)
- Modify: `src/screens/StatsScreen.js:360-377` (remove local helper), `:246-283` (tab props), `:1666-1673` (PairsTab composition)
- Test: `src/store/__tests__/statsEngine.test.js`

**Interfaces:**
- Produces: `export function withoutScrambleScores(tournament)` in statsEngine — blanks `scores`, `shotDetails`, and `pairs` (sets each to `null`) on every round whose `roundScoringMode(tournament, round)` is a scramble mode; preserves array length and all other round fields.
- Consumes: `roundScoringMode` (`src/store/tournamentStore.js`), `isScrambleMode` (`src/components/scoringModes.js`) — statsEngine must NOT import from `src/components`; check what `tournamentStore`/`scoring` already export; if the scramble predicate only lives in components, move it into `scoring.js` and re-export from `scoringModes.js` so existing imports keep working.

- [ ] **Step 1: Failing tests.** In `statsEngine.test.js`, using `mixedModeTournament()`:

```js
describe('withoutScrambleScores', () => {
  it('blanks scores, shotDetails and pairs on scramble rounds only', () => {
    const t = mixedModeTournament();
    const clean = withoutScrambleScores(t);
    expect(clean.rounds).toHaveLength(3);
    expect(clean.rounds[1].scores).toBeNull();
    expect(clean.rounds[1].shotDetails).toBeNull();
    expect(clean.rounds[1].pairs).toBeNull();
    expect(clean.rounds[0].scores).toBe(t.rounds[0].scores);
  });
  it('keeps captain team-ball points out of personal aggregates', () => {
    const t = mixedModeTournament();
    const dirty = playerAvgStableford(t, 'p1');
    const clean = playerAvgStableford(withoutScrambleScores(t), 'p1');
    expect(clean).not.toEqual(dirty); // R2 team ball no longer credited to p1
  });
});
```

- [ ] **Step 2:** Run `npm test -- statsEngine` → RED (function not exported).
- [ ] **Step 3:** Implement the sanitizer in statsEngine (port the explanatory comment from StatsScreen.js:364-371 with it). Delete the StatsScreen local copy and import from the engine.
- [ ] **Step 4:** In StatsScreen, compute once: `const statsTournament = useMemo(() => withoutScrambleScores(tournament), [tournament]);` and pass `statsTournament` (NOT the raw `tournament`) to OverviewTab, PlayersTab, HolesTab, ShotsTab, ShameTab, and into PairsTab's `pairsTournament` composition (sanitize first, then strip non-team pairs). Keep the raw tournament for the header and `RoundScopeChips` (chips label scramble rounds too; sections read the sanitized data — document this split in a comment). Remove the now-redundant H2H-only sanitize calls.
- [ ] **Step 5:** `npm test -- statsEngine StatsScreen` → GREEN; fix any StatsScreen tests that asserted raw-tournament behavior.
- [ ] **Step 6:** `npm test && npm run lint` → green. Commit: `fix(stats): exclude scramble team scores from all personal stats tabs`

---

### Task 3: RC2 — single pickup detector, engine adoption

**Files:**
- Modify: `src/store/scoring.js` (new export near `pickupStrokes`, ~line 271)
- Modify: `src/components/scorecard/HolePage.js:177` (reuse the export)
- Modify: `src/store/statsEngine.js` — `pickupChampion` (~1178-1193), `hallOfShame.blowup` (~667-675), `chaosHoles` (~959-985), `skinsLeaderboard` strokes branch (~1265-1277)
- Test: `src/store/__tests__/scoring.test.js`, `src/store/__tests__/statsEngine.test.js`

**Interfaces:**
- Produces: `export function isPickupScore(strokes, par, handicap, strokeIndex)` in scoring.js → `strokes != null && strokes >= pickupStrokes(par, handicap, strokeIndex)`.

**Behavioral contract:**
- `pickupChampion` counts holes where `isPickupScore(...)` (fixes the `===` vs `>=` mismatch).
- `hallOfShame.blowup` and `chaosHoles` skip pickup-valued scores when comparing/ranking **strokes** (points side unchanged — a pickup is legitimately 0 pts). `chaosHoles` needs ≥ 2 non-pickup scores to emit a hole.
- `blowup` additionally requires gross `vsPar >= 3` before awarding.
- Strokes-mode `skinsLeaderboard`: a pickup-valued score can tie or lose a hole but never win it outright.

- [ ] **Step 1: Failing tests.** scoring.test.js: `isPickupScore(8, 4, 18, 1)` true when the pickup value is 7 (over-pickup); false for 6. statsEngine.test.js: (a) player with strokes = pickup+1 still counted by `pickupChampion`; (b) strokes-mode skins: par-4 SI 1, scratch pickup (6) vs hcp-18 pickup (7) → **no skin awarded**; (c) blowup ignores a pickup-valued 9 but keeps a real gross +4.
- [ ] **Step 2:** RED run.
- [ ] **Step 3:** Implement; HolePage's local `isPickup` computation delegates to the export (same semantics, one source).
- [ ] **Step 4:** GREEN run, full suite + lint.
- [ ] **Step 5:** Commit: `fix(stats): unify pickup detection and stop pickups winning stroke stats`

---

### Task 4: RC2b — pickup undo clears the score instead of fabricating a par

**Files:**
- Modify: `src/components/scorecard/PlayerCard.js:143`
- Test: `src/components/scorecard/__tests__/` (check whether PlayerCard has its own test file; if not, extend `HolePage.test.js` which mounts PlayerCard)

**Contract:** Toggling pickup OFF calls `onSetScore(player.id, hole.number, null)` (clears the cell) instead of writing `hole.par`. The `score.set` mutation already deletes on `null` (`mutate.js:107`).

- [ ] **Step 1:** Failing test: render a card with a picked-up score, press the pickup control, assert `onSetScore` called with `null`.
- [ ] **Step 2:** RED → implement → GREEN → full suite + lint.
- [ ] **Step 3:** Commit: `fix(scorecard): undoing a pickup clears the hole instead of recording a par`

---

### Task 5: RC3 — streaks and bounce-back respect hole adjacency and round boundaries

**Files:**
- Modify: `src/store/statsEngine.js` — `playerStreaks` (~69-123), `hallOfShame` `longestRunPerPlayer` (~561-597), `bounceBackRate` (~1510-1552)
- Modify: `src/screens/StatsScreen.js` explainer copy (~617, ~1118, ~2869-2881): append "within a round".
- Test: `src/store/__tests__/statsEngine.test.js`

**Interfaces:**
- Produces: internal helper `longestAdjacentRun(entries, predicate)` where entries carry `{roundIndex, holeNumber, …}`; a run breaks when `roundIndex` changes or `holeNumber !== prev.holeNumber + 1`.

- [ ] **Step 1: Failing tests** (use `mixedModeTournament`'s R3 gap — p2 missing hole 5): (a) pars on holes 3,4,6,7 report streak 2, not 4; (b) par on R1 H18 + par on R3 H1 do not chain; (c) bounce-back: bogey H4, unscored H5, birdie H6 → the H4 opportunity is counted but NOT converted (recovery must be on hole `prev+1` in the same round).
- [ ] **Step 2:** RED → implement the shared run-builder, rewire all three consumers → GREEN.
- [ ] **Step 3:** Update explainer strings; run `npm test -- StatsScreen`.
- [ ] **Step 4:** Full suite + lint. Commit: `fix(stats): streaks and bounce-back no longer bridge unscored holes or rounds`

---

### Task 6: RC4 — library propagation skips played rounds

**Files:**
- Modify: `src/store/tournamentStore.js` — `propagatePlayerToTournaments` (~640-663), `propagateCourseToTournaments` (~683-706)
- Test: the store's existing test file (Glob `src/store/__tests__/tournamentStore*` first)

**Contract:** Both functions leave a played round untouched. Use the same played predicate `addPlayerRoundPatches` uses (~line 794 — read it and reuse, do not invent a new one). Pair-name refresh (cosmetic rename) MAY still apply to played rounds in `propagatePlayerToTournaments`, but `recomputeRoundPlayingHandicaps` and hole/tee replacement MUST NOT.

- [ ] **Step 1: Failing tests:** tournament with R1 played and R2 future; propagate a handicap change → R1 `playerHandicaps` unchanged, R2 updated. Same shape for a course-holes edit (R1 `holes` unchanged, R2 replaced).
- [ ] **Step 2:** RED → implement → GREEN → full suite + lint.
- [ ] **Step 3:** Commit: `fix(store): library edits no longer rewrite handicaps/holes of played rounds`

---

### Task 7: Overview — strokeIndexAccuracy pooled per course, tie-stable, scope-aware

**Files:**
- Modify: `src/store/statsEngine.js:1601-1632`
- Modify: `src/screens/StatsScreen.js` (~377, ~740-759): pass the screen `roundScope` through; section subtitle states its scope
- Test: `src/store/__tests__/statsEngine.test.js`

**Contract:** `strokeIndexAccuracy(tournament, { roundIndex } = {})`:
- Pools observations by `courseId ?? courseName` + hole number across all (non-blanked) rounds; one row per physical hole.
- Observed difficulty rank uses average-rank for ties (holes with equal pooled `avgVsPar` share the mean of the ranks they span) so tied holes get no fake `siGap` between them.
- With `roundIndex` set, pools only that round.

- [ ] **Step 1: Failing tests:** (a) same course played R1+R3 yields ONE row per hole (pooled), not two; (b) two holes with identical avgVsPar get equal actualSi (average rank); (c) `roundIndex: 2` only considers R3.
- [ ] **Step 2:** RED → implement → GREEN.
- [ ] **Step 3:** Wire `roundIndex` in StatsScreen; update the section subtitle. Full suite + lint.
- [ ] **Step 4:** Commit: `fix(stats): stroke index accuracy pools rounds per course and honors round scope`

---

### Task 8: Overview — UI honesty pass

**Files:**
- Modify: `src/screens/StatsScreen.js` only (OverviewTab ~368-814, MomentumChart ~818-871)
- Test: `src/screens/__tests__/StatsScreen.test.js`

**Changes (all in-screen, no engine edits):**
1. Strokes-mode Best Round empty copy (~593) → `No completed rounds yet — strokes mode needs all 18 holes.`
2. Momentum bar tones (~852): compute from points-per-hole (`total / holesPlayed`): ≥ 32/18 excellent, ≥ 28/18 good, ≥ 22/18 neutral, else poor (same cutoffs as today, now length-proof).
3. Shared rank numbers on ties in Skins / Clutch / Consistency lists (equal values ⇒ same rank; on a tie for first, all tied rows get the gold style).
4. Consistency list renders only players with ≥ 18 counted holes; below that show a muted `Needs a full round of data.`; display each player's mean pts/hole next to σ.
5. Skins rows with `skins === 0 && ties > 0` become tappable (open the existing detail sheet listing tied holes).
6. New tiny `PtsBadge` component (small `pts` chip) rendered beside the section title of Momentum, Clutch, Consistency, and Course DNA when `metric === 'strokes'` — exported for reuse by Tasks 16/20.

- [ ] **Step 1:** Failing tests: two tied skins leaders both render `#1`; consistency hidden under 18 holes; the new best-round copy string.
- [ ] **Step 2:** RED → implement → GREEN → full suite + lint.
- [ ] **Step 3:** Commit: `fix(stats): overview tie ranks, momentum per-hole tones, honest copy and pts badges`

---

### Task 9: Holes tab — engine fixes + heatmap polish + reorder

**Files:**
- Modify: `src/store/statsEngine.js` — `bestWorstHoles` (~127-172), `holeDifficultyMap` (~174-188), `collectiveExtremes` (~990-1013)
- Modify: `src/screens/StatsScreen.js` HolesTab (~1383-1647)
- Test: `src/store/__tests__/statsEngine.test.js`, `src/screens/__tests__/StatsScreen.test.js`

**Contracts:**
- `collectiveExtremes`: a hole qualifies when **every player with any score in that round** scored it (not every tournament player).
- `holeDifficultyMap`: `avgPoints`/`avgStrokes` are `null` (not 0) when no scores; screen renders `-`.
- `bestWorstHoles`: accepts `{ metric, roundIndex, minScores = 2 }`; holes with fewer than `minScores` scores are excluded; an entry appears in at most one of `best`/`worst` (when < 6 entries, split top/bottom without overlap and drop the middle); each entry carries `roundIndex`; the screen shows `R{n}` on cards and sheet titles and passes the screen `roundScope`.
- HolesTab render order: Heatmap → Easiest/Hardest → Nemesis → Chaos → Extremes.

- [ ] **Step 1:** Failing engine tests for the four contracts (skipping-player scenario; null avg; 4-entry overlap; minScores; roundIndex filter).
- [ ] **Step 2:** RED → implement engine → GREEN.
- [ ] **Step 3:** Screen changes (order, `-` rendering, R{n} labels, roundScope pass-through). Screen test: avg cell shows `-` for an unscored hole row.
- [ ] **Step 4:** Full suite + lint. Commit: `fix(stats): holes tab sample guards, honest averages, round labels and scope`

---

### Task 10: Pairs tab — engine correctness

**Files:**
- Modify: `src/store/statsEngine.js` — `pairConfigMatrix` (~1365-1408), `matchPlayResults` (~1300-1359), `pairPerformance` (~236-268)
- Modify: `src/screens/StatsScreen.js` (~1682, ~1699): pass `roundScope` (nullable) instead of `effectiveRound` to `pairHoleWins` and the H2H duel; add a scope label line to both sections.
- Test: `src/store/__tests__/statsEngine.test.js`

**Contracts:**
- `pairConfigMatrix`: before accumulating a round, orient the current round's two pairs onto the stored config sides by comparing sorted member-id keys with `sideA`'s key — if flipped, swap A/B for points, wins, and the per-round entry. Audit scenario: R1 `[[A,B],[C,D]]` then R3 `[[C,D],[A,B]]` — R3's wins/points must accrue to the correct side.
- `matchPlayResults` and `pairConfigMatrix`: skip rounds where `Object.keys(round.scores ?? {}).length === 0` (kills phantom "Halved" cards and inflated round counts).
- `pairPerformance`: a round contributes to a pair's average only when at least one member of THAT pair has a score in it.
- Screen: with the "Total" chip selected, `pairHoleWins`/H2H duel receive `roundIndex: null` (the engine's tournament-wide path already exists); each section prints its effective scope (`All rounds` / `R{n} · course`).

- [ ] **Step 1:** Failing tests for all four contracts (flipped-config attribution with concrete win counts; empty-scores round produces no match-play entry; opposing-pair-only scores don't add a 0-round to a pair's chemistry; `pairHoleWins(t, {roundIndex: null})` aggregates two rounds).
- [ ] **Step 2:** RED → implement → GREEN.
- [ ] **Step 3:** Screen wiring + scope labels; adjust StatsScreen tests.
- [ ] **Step 4:** Full suite + lint. Commit: `fix(stats): pair config attribution, phantom rounds, chemistry guards, total scope`

---

### Task 11: Pairs tab — merged Pair Cards + drama strip

**Files:**
- Modify: `src/screens/StatsScreen.js` PairsTab (~1650-2288)
- Test: `src/screens/__tests__/StatsScreen.test.js`

**Changes (presentation only — engine functions already return everything needed):**
1. Replace the three sections Pair Chemistry / Pair Synergy / Carry Ratio with ONE `PAIR CARDS` section: one card per pairing showing avg pts/round (`pairPerformance`), a `×{synergy}` badge (`pairSynergy`), the carry split bar (`pairCarryRatio` — fix the 101% width bug: second share = `100 − first`), and rounds count. Tap opens a detail sheet combining the per-round rows the three old sheets showed.
2. Under the Pair Difference chart, add a one-line drama strip from the already-computed `pairDifferenceByHole` fields: `Lead changes: {crossovers} · Biggest lead: {leader} +{max} · Final: {±finalDelta}`.
3. Every remaining section gets its scope line (`All rounds` unless chip-scoped).

- [ ] **Step 1:** Failing render test: Pair Cards section renders one card per pairing with synergy badge and carry bar; the old three section titles are gone; the drama strip renders for a two-pair round.
- [ ] **Step 2:** RED → implement → GREEN → full suite + lint.
- [ ] **Step 3:** Commit: `feat(stats): unified pair cards and pair-difference drama strip`

---

### Task 12: Shots — engine and MyStats benchmark fixes

**Files:**
- Modify: `src/store/statsEngine.js` — `shotStats` (~1416-1497), `playersWithShotData` (~1502), `sgSeason` (~2319-2355)
- Modify: `src/store/personalStats.js:515` (gross distribution for benchmarks)
- Modify: `src/components/mystats/tabs/ShotsTab.js` (~366 tee-penalty; ~473-494 putts normalization consumers)
- Test: `src/store/__tests__/statsEngine.test.js`, plus the personalStats test file (Glob for it)

**Contracts:**
- `shotStats` gains `penalties.teeOnDriveHoles` (tee penalties counted only on holes where a drive direction was logged) — ShotsTab's `teePenaltyPct` uses it over `drives.recorded`.
- `shotStats` gains `putts.per18` = `puttsTotal / puttHoles × 18` (null when `puttHoles === 0`); benchmark rows (putts/round and 3-putts/round via the same normalization) use it instead of raw per-round figures.
- Round/hasData detection (~1433-1435, 1466-1467) counts ANY detail field (putts, drive, penalties, sandShots, recoveryOutcome, firstPuttBucket, approachBucket, approachResult).
- `sgSeason`: headline `total` = sum of the per-category per-round values it reports.
- `computeMyStats` benchmark `distribution` uses gross vs-par (`playerScoreDistribution` with `metric: 'strokes'` — verify the actual options signature at statsEngine.js:34 before writing the call); the par-3/4/5 rows already use gross and stay unchanged.

- [ ] **Step 1:** Failing tests: tee penalty on a par-3 doesn't move `penalties.teeOnDriveHoles`; a 9-logged-hole round yields `putts.per18` = per-hole × 18; an approach-only logger appears in `playersWithShotData`; sgSeason total equals category sum; gross distribution feeds computeMyStats output.
- [ ] **Step 2:** RED → implement → GREEN → full suite + lint.
- [ ] **Step 3:** Commit: `fix(stats): shot benchmarks use gross mix, honest denominators, consistent SG totals`

---

### Task 13: Shots — scramble shot-panel gating + tournament tab sample gating

**Files:**
- Modify: `src/components/scorecard/PlayerCard.js` (~239-248) and/or `HolePage.js` (read both — gate wherever `ShotDetailSection` is rendered, keyed off the round's effective scoring mode which HolePage already knows)
- Modify: `src/screens/StatsScreen.js` ShotsTab (~2507-2812)
- Test: `src/components/scorecard/__tests__/HolePage.test.js`, `src/screens/__tests__/StatsScreen.test.js`

**Contracts:**
- The shot-detail section does not render in scramble rounds (the write path stores it under the team unit id where no surface reads it honestly).
- Tournament Shots tab: any colored verdict (drive-impact rows, approach rows, putt deep-dive tones) renders grey with subtitle `{n} holes — need more data` when its bucket has fewer than 6 samples (same floor mystats uses).

- [ ] **Step 1:** Failing tests: a scramble round renders no shot-detail section; a 2-sample drive bucket renders the grey needs-more-data state.
- [ ] **Step 2:** RED → implement → GREEN → full suite + lint.
- [ ] **Step 3:** Commit: `fix(shots): hide shot logging in scramble rounds; gate verdicts behind sample floors`

---

### Task 14: Shame tab — fairness fixes + banter copy pass

**Files:**
- Modify: `src/store/statsEngine.js` — `anchor` (~1198-1211), `hallOfShame` gift (~599-637), `par3Heartbreak` (~1150-1173), `zeroHero` (~1216-1238)
- Modify: `src/screens/StatsScreen.js` ShameTab (~2814-3112)
- Test: `src/store/__tests__/statsEngine.test.js`, `src/screens/__tests__/StatsScreen.test.js`

**Contracts:**
- `anchor`: tied holes contribute to neither MB nor PB counts (only outright best/worst-ball roles count). Audit scenario: partners tying 10 of 18 holes must gain zero anchor score from those ties.
- `par3Heartbreak`: returns ALL tied leaders (array), requires ≥ 3 par-3 holes played; screen renders ties like other cards.
- Gift: minimum 3 scores on the hole (was 4).
- Triple Bogey Club card + explainer: metric-aware wording — points mode says `net over par`, strokes mode `gross over par`.
- `zeroHero` card leads with the worst offender: `{FirstName} — {n} pointless holes in R{k}`.
- Copy pass: rewrite the shame card explainer strings in group-chat banter tone (e.g. Pickup Champion: `Picked it up, put it away, pretended it never happened.`) — one sentence each, factual subtitles stay.

- [ ] **Step 1:** Failing tests: anchor tie exclusion with concrete counts; heartbreak tie array + min sample; gift fires with 3 players; zeroHero name appears on the card.
- [ ] **Step 2:** RED → implement engine → GREEN.
- [ ] **Step 3:** Screen copy + rendering changes; screen tests.
- [ ] **Step 4:** Full suite + lint. Commit: `fix(stats): fair shame awards (anchor ties, heartbreak sample, gift for 3), banter copy`

---

### Task 15: MyStats — partial-round honesty + synthetic tournament fixes

**Files:**
- Modify: `src/store/personalStats.js` — `buildSyntheticTournament` (~30-55), `computeMetrics` (~101-132), round collection/selection (~177-200, ~401)
- Modify: `src/screens/MyStatsScreen.js` + `src/components/mystats/*` (selector badge, form chart labels)
- Test: the personalStats test file (Glob for it)

**Contracts:**
- A collected round gains `holesPlayed` and `isComplete` (all round holes scored by the user).
- Round-total metrics (`avgPoints`, `bestRoundPoints`, the pts/round form series, report-card career baseline) use complete rounds only; per-hole metrics unchanged. `avgVsPar` averages complete rounds only.
- `buildSyntheticTournament` rekeys `playerIndexes` to the canonical id and derives the synthetic player's fallback handicap from the **most recent** collected round.
- Round selector rows show a `partial · {n} holes` badge for incomplete rounds; form chart x-labels append a short date after the course name (check what date field the round/tournament stores — use what exists).

- [ ] **Step 1:** Failing tests: a 6-hole finished game is excluded from `avgPoints` but present in per-hole metrics; a `playerIndexes` override is honored for a legacy round without `playerHandicaps`; fallback handicap comes from the newest round.
- [ ] **Step 2:** RED → implement store → GREEN.
- [ ] **Step 3:** UI badge + labels; component tests if the selector has any.
- [ ] **Step 4:** Full suite + lint. Commit: `fix(mystats): round-total metrics use complete rounds; synthetic tournament handicap fixes`

---

### Task 16: New metrics — Overview (Playing to Handicap, Hot Stretch)

**Files:**
- Modify: `src/store/statsEngine.js` (two new exports), `src/screens/StatsScreen.js` OverviewTab
- Test: `src/store/__tests__/statsEngine.test.js`

**Interfaces:**
- `playingToHandicap(tournament)` → sorted `[{player, points, holesPlayed, delta}]` where `delta = points − 2 × holesPlayed`; skips players with 0 holes.
- `hotStretch(tournament, { windowSize = 6 } = {})` → per player the best rolling `windowSize`-hole sum of points over **adjacent** holes within a round (reuse Task 5's adjacency rules), returning `{player, points, roundIndex, startHole, endHole, breakdown}`.

**UI:** Two new Overview sections after Highlights: `PLAYING TO HANDICAP` (ranked rows, `+4` / `−7` formatting, sheet shows per-round deltas) and `HOT STRETCH` (top-3 cards, `Marco — 11 pts · R2 H7–H12`, sheet shows the window's holes). Both points-based → include Task 8's `PtsBadge` in strokes mode.

- [ ] **Step 1:** Failing engine tests with hand-computed numbers from the shared fixture (assert the exact delta and the exact best window, including gap handling: a window may not span the unscored hole 5).
- [ ] **Step 2:** RED → implement → GREEN.
- [ ] **Step 3:** UI sections + a render test each. Full suite + lint.
- [ ] **Step 4:** Commit: `feat(stats): playing-to-handicap leaderboard and hot stretch cards`

---

### Task 17: New metrics — Players difficulty split + Shame Nemesis Encore

**Files:**
- Modify: `src/store/personalStats.js` or `src/store/statsEngine.js` for the split (read `holeDifficultySplit` at personalStats.js:63 first — reuse it if its signature fits a tournament+playerId call, otherwise add a thin engine wrapper), `src/store/statsEngine.js` (`nemesisEncore`), `src/screens/StatsScreen.js` (PlayersTab + ShameTab sections)
- Test: `src/store/__tests__/statsEngine.test.js`, `src/screens/__tests__/StatsScreen.test.js`

**Interfaces:**
- PlayersTab `DIFFICULTY SPLIT` card: avg points per SI band (1-6 / 7-12 / 13-18) for the selected player.
- `nemesisEncore(tournament)` → `[{player, holeNumber, courseName, rounds: [roundIndex…]}]` for hole numbers on the SAME course that zeroed the same player (0 points) in ≥ 2 different rounds. Card: `🔁 Nemesis Encore — Hole 7 owns {FirstName} ({n} rounds)`.

- [ ] **Step 1:** Failing tests (encore requires same course + ≥ 2 rounds; difficulty split bands cover all 18 SIs).
- [ ] **Step 2:** RED → implement → GREEN → UI sections + render tests → full suite + lint.
- [ ] **Step 3:** Commit: `feat(stats): SI-band difficulty split and nemesis encore award`

---

### Task 18: New metrics — Pairs Coverage % + Shots GIR-after-drive

**Files:**
- Modify: `src/store/statsEngine.js` (`pairCoverage`, `girByDriveResult`), `src/screens/StatsScreen.js` (Pair Cards addition + ShotsTab driving section)
- Test: `src/store/__tests__/statsEngine.test.js`

**Interfaces:**
- `pairCoverage(tournament)` → per pairing `{pair, coveragePct, bothBlanked, holes}` where coverage = holes where ≥ 1 partner scored ≥ 2 pts. Renders as `{pct}% covered · {n} double-blanks` inside Task 11's Pair Cards.
- `girByDriveResult(tournament, playerId)` → `{fairway: {girPct, holes}, miss: {girPct, holes}}` joining logged drive result with the per-hole GIR check `strokes − putts <= par − 2` (requires putts + drive both logged; skip otherwise; `short/left/right/super` all count as miss). Renders in ShotsTab's driving section: `GIR after fairway 44% · after a miss 18%`, grey under 6 samples per side (Task 13's floor).

- [ ] **Step 1:** Failing tests with hand-built shotDetails.
- [ ] **Step 2:** RED → implement → GREEN → UI wiring + render tests → full suite + lint.
- [ ] **Step 3:** Commit: `feat(stats): pair coverage and GIR-by-drive-result`

---

### Task 19: New metrics — MyStats Course Mastery + Career Milestones

**Files:**
- Modify: `src/store/personalStats.js` (`courseMastery` via `courseDNA` on the synthetic tournament; `careerMilestones` from distribution + streaks), `src/components/mystats/` (new cards — follow the existing tab-card patterns; put them in the Breakdown tab unless a more natural home exists after reading the tabs)
- Test: the personalStats test file

**Interfaces:**
- `courseMastery(myStats)` → per course `{courseName, rounds, avgPoints, bestPoints, trend}` (trend = sign of latest vs previous round) — complete rounds only (Task 15's flag).
- `careerMilestones(myStats)` → `{birdies, eagles, longestParStreak, bestNine, bestRound}` (bestNine = max front/back nine points over complete rounds; streak uses Task 5's adjacency rules).

- [ ] **Step 1:** Failing store tests with two-course fixtures and hand-computed milestone numbers.
- [ ] **Step 2:** RED → implement → GREEN → cards + render tests → full suite + lint.
- [ ] **Step 3:** Commit: `feat(mystats): course mastery and career milestones`

---

### Task 20: Players tab — remaining honesty items

**Files:**
- Modify: `src/store/statsEngine.js` `warmupVsClosing` (~874-895: add `roundIndex` to breakdown entries), `src/screens/StatsScreen.js` PlayersTab (~1027-1366)
- Test: `src/store/__tests__/statsEngine.test.js`, `src/screens/__tests__/StatsScreen.test.js`

**Changes:** warmup/closing breakdown rows show `R{n} · course · H{x}`; player chips disambiguate duplicate first names (reuse the `joinNames` count logic at StatsScreen.js:41-52); the Average-per-Round card gains an `n rounds · m holes` subtitle; Round History rows show a scoring-mode badge, `avgPerHole`, and holes played; add the `SectionIndex` sticky chips (reuse the Overview component); enable round-scope chips on this tab, passing `roundIndex` to distribution + streaks and labeling other sections `All rounds`.

- [ ] **Step 1:** Failing tests (breakdown roundIndex present; duplicate-name chips disambiguated; history row shows the mode badge).
- [ ] **Step 2:** RED → implement → GREEN → full suite + lint.
- [ ] **Step 3:** Commit: `fix(stats): players tab scope chips, section index, honest history rows`

---

## Self-Review

- **Spec coverage:** RC1→T2, RC2→T3+T4, RC3→T5, RC4→T6; Overview→T7+T8+T16; Players→T17+T20; Holes→T9; Pairs→T10+T11+T18; Shots→T12+T13+T18; Shame→T14+T17; MyStats→T15+T19; cross-cutting presentation rules→T8 (`PtsBadge`), scope labels in T9/T10/T11/T20, sample floors in T13/T18. Spec §7 deferred items intentionally have no tasks.
- **Ordering:** T1 (fixtures) before everything; T5 before T16/T19 (adjacency reuse); T8 before T16 (`PtsBadge`); T11 before T18 (Pair Cards host coverage); T15 before T19 (complete-round flag). Otherwise tasks are independent.
- **Type consistency:** `withoutScrambleScores(tournament)` (T2) is the name used in T9/T10 contexts; `isPickupScore(strokes, par, handicap, strokeIndex)` (T3) used in T14's blowup context; `PtsBadge` (T8) consumed by T16/T20; `putts.per18` and `penalties.teeOnDriveHoles` (T12) consumed in ShotsTab only.
