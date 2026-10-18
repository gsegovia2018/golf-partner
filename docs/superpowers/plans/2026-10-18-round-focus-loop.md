# Round focus loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Each task names the model tier to run it on (think expensive, build cheap). TDD: the named test file is written first and fails before the item's code lands.

**Date:** 2026-10-18 · **Status:** plan · **Lifecycle:** `deliver` (UI canvas for B2/B3 pending owner approval; nothing in B2/B3 merges before it)
**Spec:** `docs/superpowers/specs/2026-10-18-round-focus-loop-design.md` (sub-project B). Spec and this plan ship in B1a.
**Branches:** B1a `feat/focus-target-encounters`, B1b `feat/focus-since-commit`, B2 `feat/focus-in-round`, B3a `feat/focus-round-model`, B3b `feat/focus-round-card`, each from a freshly pulled `master` (read at `093e01e6`). JS only → OTA.

## 1. Goal

The committed coach focus reaches the round: a one-line strip on the owner's shot-detail panel on the holes it applies to, a focused ask (the Why? sheet for swing/decision foci even in *On tap*; a one-tap lie chip for lie foci on hits and misses), a verdict judged only on rounds finished since the commit, and a Focus card on the round summary with this round's numbers and the verdict so far.

## 2. What exists today (read 2026-10-18, `master` @ `093e01e6`)

- **Focus store** `src/store/coachFocus.js`: v2 record (`v, leakId, category, bucket, causeId, metricKey, baselineValue, baselineSample, baselineSe, minChange, baselineVersion, targetHandicap, committedAt, roundCountAtCommit, roundCountAtBaseline?, rebasedAt?, rebaseReason?, swingId?`). `makeFocusCommit(chain, stats, committedAt)` (65) picks `metricKey = cause?.metricKey ?? child?.metricKey ?? leak.metricKey` and reads the baseline via `readMetric`. `focusVerdict(focus, stats)` (175) derives `roundsSince = roundCount − roundCountAtCommit` and `judged = roundCount − (roundCountAtBaseline ?? roundCountAtCommit)`, reads `metric.read(stats)` for `current`. `rebaseFocus` (147) re-anchors on `readMetric(focus.metricKey, stats)` and stamps `rebasedAt`. Storage: `loadFocus(userId, now)` (251, archives a v1 record and writes the notice), `saveFocus`, `clearFocus`, `archiveFocus`, `loadFocusNotice`/`dismissFocusNotice` (301/306) — notice shape `{ kind: 'v1-closed', closedAt }`, written in `archiveV1` *before* the history entry and the slot removal. Keys `@mystats_coach_focus:<userId|anon>` and `…_notice:`.
- **Notice UI** `src/components/mystats/tabs/CoachTab.js` 34–48: renders `focusNotice` with the hard-coded key `stats.my.coach.ui.notice.v1Closed` (no switch on `kind`); test `components/mystats/__tests__/CoachTab.test.js` 127.
- **MyStatsScreen** `src/screens/MyStatsScreen.js`: `user` from `useAuth()` (129); focus + notice state and load (154–172); `selected = resolveSelection(myRounds, overrides)` (482); `stats = computeMyStats(selected, { n, targetHandicap: targetHandicap ?? 0, shots, handedness })` (490–496); `coachFocusVerdict = focusVerdict(coachFocus, stats)` (498–501); `buildCoachWeek({ stats, focus, verdict, … })` (515–531); rebase effect (546–551); `onCommitFocus` (554–559) and `onEndFocus` (561–567). `targetHandicap` state from the profile (142, 325). `personalStats` is mocked in `screens/__tests__/MyStatsScreen.test.js` 38–56 (`computeMyStats` returns coach fixtures).
- **Rounds and stamps** `src/store/personalStats.js`: `collectMyRounds` (354) returns MyRound `{ key, round, tournamentId, roundIndex, playerId, completed, isComplete, endedAt: roundEndedAt(t, round) (ms | null), startedAt, … }`; `resolveSelection` (614) = `completed` unless overridden; `computeMyStats` (1028) builds `missReasons: missReasonStats(synthetic.rounds, CANON_ID)` (1092) and `roundCount` (1041). `src/store/finishStamp.js` `roundEndedAt` (50): `round.finishedAt`, else the game's `tournament.finishedAt`, else `null` (an unstamped round of a multi-round tournament has no end).
- **Miss reasons** `src/store/missReasons.js` (220 lines): `OPTIONS.approachSituation` fixed order (56), `clearedReasonPatch(shotType)` nulls the three keys (62), `situations(detail, key)` (68), `LIE.approach = ['above-feet','below-feet','uphill','downhill','bad-lie','wind']` (131), `classifyMiss` (140), `emptyRow` with `lies: {}` (158–171), `addMiss` counts `lies` only on lie-family misses (180), `missReasonStats(rounds, playerId)` (189) reads `round.shotDetails[playerId][hole.number]`, approach = `par !== 3 && approachBucket && approachResult === 'miss'`.
- **Metric registry** `src/store/coachMetrics.js`: `WHY_KINDS` with `count(row)` per kind (142), `whyRow(stats, area, bucket)` exported (154), `whyMetric` (160), `METRICS` built 172–219, `readMetric` (223). `coachMetrics.test.js` 119–122 asserts the non-why key set equals `EXPECTED`. Labels: `src/store/coachCheck.js` `metricLabel(key)` (43) with a `p[1] === 'why'` branch; `buildCheck({ leak, cause, focus, stats })` (84).
- **Course task / issue title**: `src/store/coachWeeklyPlan.js` `courseTaskFor({ causeId, category, bucket })` (114) already maps why ids to `stats.my.coach.plan.course.<area>.why.<sub>[.<side>]`, outcome ids to `plan.course.<id>` and no cause to `plan.course.area.<category>`; `src/store/coachCausePair.js` `issueMsg(leak, cause)` (54) gives the issue title per cause id or the area kicker. `src/store/coachWeek.js` `buildCoachWeek` (42) builds the focus chain with `buildCheck({ …, focus: committed, stats })` (70–78) and passes `roundsSinceCommit: verdict?.roundsSince` to the plan.
- **Patches** `src/store/scoring.js`: `approachBucketPatch` (1252, clears the three reason keys with the finish), `approachFinishPatch` (1269: `patch.approachResult === 'miss' ? patch : { ...patch, ...clearedReasonPatch('approach') }`), `normalizeWatchShotPatch` (1305) with three finish branches (1337 green via `approachFinishPatch({}, 'green')`; 1339 explicit null with an inline `clearedReasonPatch('approach')`; 1345 direction/bunker with `dir || bunker ? {} : clearedReasonPatch('approach')`). Test block `scoring.test.js` 1345 `describe('miss reason clearing')`.
- **Panel chain**: `src/screens/ScorecardScreen.js` — `user` (257), `meId` = the *player* id (482–486, `tournament.meId` or `deriveMeIdFromAuth`), `viewOnly`/`official` (322/237), renders `<HoleView … shotDetails meId onSetShot … official …>` (2148–2200). `src/components/scorecard/HoleView.js` (68) renders `<HolePage …>` (332–377). `HolePage.js`: `React.memo` with `holePagePropsEqual` (82–130, an explicit prop list — a new prop must be added or it is ignored); `showShotDetail = isMe && !isScramble` (332) so the panel already renders only on the owner's card; `<PlayerCard … isMe canEdit roundId={round.id} shotDetail onSetShot …>` (372–397). `PlayerCard.js` (44) → `<ShotDetailSection … roundId readOnly={!canEdit}>` (310–319). `ShotDetailSection.js` (15) → `<ShotDetailPanel … statGroups roundId readOnly>`. `ShotDetailPanel.js` (245): `g` group flags (270), `isPar3`, `showApproachExtrasFlag = g.approach && !isPar3 && d.approachBucket` (275), `canAutoOpen = missSetting === 'ask' && !muted && !readOnly` (295), `onDriveTap`/`onFinishTap` open the sheet only from taps (301–312), `ReasonChip` (218), `ApproachFinishRow` (159), `MissWhySheet` at the end (643). Styles `whyRow*`/`whyChip*` in `styles.js` 868–878. Tests: `components/scorecard/__tests__/ShotDetailPanel.test.js` (`renderPanel`, mocks for `missReasonsMute`, `swingStore`, `settingsStore` real), `HolePage.test.js` 416 `describe('holePagePropsEqual')`, `screens/__tests__/ScorecardScreen.holePageMemo.test.js` (callback identity across draft writes).
- **Hole distance**: round holes carry `par`/`strokeIndex` only; the only distance on the scorecard is the live GPS feed (`gps.distances.center`, `HoleDistanceBlock`). On a par 3 the panel's distance segment writes `approachBucket` ("Hole distance", 278).
- **Round summary** `src/screens/RoundSummaryScreen.js`: `me` = auth user id from `supabase.auth.getUser()` (93–98); `round` by `roundId` (116); `players` via `useRoundRoster` (119); `iAmPlaying` (120); `myPlayerId` (183); `live` (153); `wantsRecords = round && !live && iAmPlaying` gates a lazy load of `loadAllTournamentsWithFallback` + `loadProfile` → `setMyRounds(collectMyRounds(list, me, profile.displayName))` (193–210, the profile is not kept); scorecard tab renders `RoundRecapPanel`, `AchievementStrip`, `RoundLeaderboard`, `ScorecardTable` (292–313). `round.shotDetails[playerId][hole]` comes with the round (`tournamentRepo.js` 23–26). Components in `src/components/roundSummary/` (`AchievementStrip`, `RoundLeaderboard`, `RoundRecapPanel`, `RoundSummaryTabs`); tests in `components/roundSummary/__tests__/` and `screens/__tests__/RoundSummaryScreen.test.js` (mocks `supabase.auth.getUser → u1`, `readLocal → mockTournament` with `p1.user_id = 'u1'`). Navigation: `App.js` 460 `MyStats` stack screen; `MyStatsScreen` reads `route.params.tab` through `normalizeStatsTab` (121, `'coach'` is a valid key).
- **i18n**: coach copy `src/i18n/locales/{en,es}/coach.js` (`stats.my.coach.plan.course.*` 115–151, `ui.issue.*` 214–252, `ui.metric.*` 311+, `ui.notice.*` 366–367); focus verdict copy `myStats.js` 382–392 (`stats.my.focus.improving|flat|worse|resolved|needMore(plural)`), level `coach.js` 190 `stats.my.coach.ui.fix.level`; shots copy `shots.js` (`shots.why.situation.<key>` 157–166); round summary `rounds.js` (`rounds.summary.*` 25–34). Tests: `i18n/__tests__/i18n.test.js` (parity, placeholders, plural shape, no empty strings), `coachCatalogue.test.js` (`PASSED` map already lists every `plan.course.*` key with params).
- **Verdict copy in UI**: `components/mystats/FocusCard.js` `VERDICT_COPY` (13–18) + `needMore` with `verdict.roundsNeeded`; `metricValueText(unit, value)` in `components/mystats/msg.js` 107; `renderMsg` (20).

## 3. Decisions (and where the plan departs from the spec — each flagged)

> **Owner decisions after this plan was drafted (2026-10-18) — they override the items below where they conflict:**
> - **No `lieGreenRate` metric.** A lie focus keeps its verdict metric `approach.why.lieRate.<scope>` (share of tagged misses from that lie, lower is better). `focusLie` is still stored at commit (for the chip and the round card), but `makeFocusCommit` does **not** swap the metric. Encounters (`shots`, `greens`) are display-only context. Drop item A3; A5 keeps only `focusLie` + `measuredSince`; decision 4's metric swap, decision 5 and decision 21's lie remark no longer apply.
> - **Round card = canvas option B (bars):** "YOUR FOCUS" overline with the target icon, the focus title, two labelled bars — *This round* (accent fill) and *Before the focus* (muted fill) — each with its value on the right, bar length = the metric percent; then the verdict line (state dot + "Improving after 3 rounds · level 2 of 3") and "Open Coach ›". A lie focus adds the encounters to the This-round value ("1 of 6 misses · 4 shots, 3 greens"). Design: https://claude.ai/artifact/R5TVitVtGbSt2sgmjsv3k3 (boards SummaryB / SummaryLie).

1. **`FocusTarget` gains `title`** (descriptor from `issueMsg({ category, bucket }, { id: causeId })`). The spec's shape (§2.1) has only `cue`, but the strip shows `<issue title>: <cue>`. *Spec gap.*
2. **`cue` is always `courseTaskFor({ causeId, category, bucket })`.** The spec's two cases (why causes → `plan.course.*` per cause; outcome → "the existing course task") are the same function; no second path.
3. **Lie asks, encounters and the `lieGreenRate` metric are approach-only.** Spec §2.1 says the dominant lie comes from "that area" but §2.2 (chip writes `approachSituation`) and §2.3 (encounters for approaches) only define approach. A `cause:tee:why:lie` / `cause:short:why:lie` focus reads `kind: 'outcome'` (strip only), no `focusLie`. *Flagged.*
4. **`focusLie` is chosen in `makeFocusCommit`**: for `cause:approach:why:lie` the row is the one the cause's metric scope names (`approach.why.lieRate.<scope>` → `whyRow(stats, 'approach', scope).lies`); dominant = highest count, ties broken by `OPTIONS.approachSituation` order; the commit then swaps `metricKey` to `approach.focus.lieGreenRate.<lie>` and stores `focusLie`. No lie counts → the commit keeps the miss-share metric and no `focusLie` (→ `kind: 'outcome'`), as the spec's fallback for old records.
5. **Lie focus baseline is biased at commit.** Before B1 lies were tagged only on misses, so `encounters` at commit = those misses with 0 greens → baseline 0 %. Accepted (the first judged rounds restart from real encounters); listed in §8.
6. **The situation survives every finish change; only the bucket clear drops it.** Spec §2.2 names `green` only; the `approachResult → null` case (green toggled off, last direction cleared) is unspecified — the lie is a fact about the shot, not the miss, so it is kept there too. `clearedReasonPatch(shotType, { keepSituation })` is the single helper; `approachFinishPatch` and both inline watch branches use it. *Flagged.*
7. **An encounter needs a result.** `encounters[lie].shots` counts approaches on par ≠ 3 with `approachBucket`, the lie in `approachSituation` and `approachResult ∈ {green, miss}`; a tagged shot without a finish is not yet a shot outcome. `greens` = `approachResult === 'green'`.
8. **Verdict signature `focusVerdict(focus, stats, since = null)`**, `since = { stats, rounds, judged }` from a new pure `roundsSinceCommit(myRounds, focus)` → `{ committed: MyRound[], judged: MyRound[] }` (`endedAt` ms > `Date.parse(committedAt)` / `Date.parse(rebasedAt ?? committedAt)`; rounds with `endedAt == null` are excluded — they cannot be placed in time). With `since`, `roundsSince = since.rounds`, `judged = since.judged`, `current = since.stats ? metric.read(since.stats) : null`; `since.stats` is `null` when `judged` is empty (never call `computeMyStats([])`). Without `since` the function behaves exactly as today, so every existing caller and fixture stays green. The spec's "roundsSince becomes the count of those rounds" conflates the level count (since commit) and the judged count (since rebase) — the plan keeps both. *Flagged.*
9. **The Check line reads since-stats too.** `buildCoachWeek` gains `statsSince` and the focus chain calls `buildCheck({ …, stats: isFocus && statsSince ? statsSince : stats })`, so the DiagnosisCard's "Now" bar agrees with the FocusCard. Spec silent. *Flagged.*
10. **One-time notice.** The record gains `measuredSince: 'commit'` (set by `makeFocusCommit`). `loadFocus` on a v2 record without it writes the notice `{ kind: 'since-commit', at }` first, then saves the stamped record (same order as `archiveV1`; a failed save just rewrites the same notice next time). `CoachTab` picks the text by `notice.kind` (`v1-closed` → existing key, `since-commit` → `stats.my.coach.ui.notice.sinceCommit`).
11. **Par-3 rule (spec §2.2) has no data source**: round holes carry no distance. The plan uses the hole's own entry: on a par 3 the approach strip shows when the focus has no bucket, or the golfer has not set the hole distance yet, or `d.approachBucket === target.bucket`. *Spec error flagged.*
12. **Short-game swing/decision foci get no auto-open.** The short Why? trigger is state-derived (plan A decision 4: never auto-opens), so for `shot: 'short'` the focused ask is the strip only. *Spec gap flagged.*
13. **Scorecard loading goes through a hook** `src/hooks/useFocusTarget.js` (`useFocusTarget(userId)` → stable `FocusTarget | null`), not inline in the 2 400-line `ScorecardScreen`. `loadFocus(user?.id)` matches `MyStatsScreen` (auth id); the panel already renders only on the owner's card (`showShotDetail = isMe && !isScramble`), so no `meId` check is needed. The hook never calls `setState` when the loaded target is `null` and the state is already `null` (no extra render / act() noise in the scorecard suites, which mock `useAuth` as `{ user: null }`).
14. **No info tap on the strip in v1** (spec leaves it to the canvas).
15. **"Not this round" mutes the sheet only.** The lie chip stays on a muted round (a one-tap fact, no sheet); swing/decision auto-open respects the mute, as the spec says.
16. **Round summary uses the default selection** (`resolveSelection(myRounds)`, no manual overrides — they live in `MyStatsScreen`'s AsyncStorage key). Only golfers who manually deselected rounds in My Stats can see a different "so far" count here. *Flagged.*
17. **"Touched"**: swing/decision → at least one shot of `target.shot` recorded this round (approach: `approachBucket && approachResult` on par ≠ 3; drive: `drive` set on par ≥ 4; short: a missed GIR with `strokes > par`); lie → `encounters[lie].shots > 0`; outcome → the metric's `sample.shots > 0` on the one-round stats.
18. **Component name `RoundFocusCard`** (`components/mystats/FocusCard.js` exists).
19. **One-round stats, cheapest correct path**: why and lie kinds read `missReasonStats([round], myPlayerId)` directly on the raw round (no synthetic tournament); outcome kinds need the registry → `computeMyStats([mr], { targetHandicap })` where `mr = collectMyRounds([tournament], me, profile?.displayName).find((r) => r.round?.id === round.id)` (one round, one pass). The "so far" verdict needs `computeMyStats(since.judged, …)` over the career list the screen already loads for records.
20. **`stats` passed to `focusVerdict` from the round summary is `{ targetHandicap }`** (`needsRebase`/`targetChanged` read only that once `since` supplies the reading); `targetHandicap = profile?.targetHandicap ?? 0`, same default as `MyStatsScreen`.
21. **"Before" line is generic by unit**: percent with `baselineSample.shots` → "{count} of {total}" (`count = round(baselineValue / 100 × shots)`), otherwise `metricValueText(unit, baselineValue)`. The spec's lie example ("1 of 5 misses came from it") is the pre-ship miss-share metric; a lie focus committed after B1 has a `lieGreenRate` baseline, so one rule covers both. *Flagged.*
22. **`coachMetrics.test.js` `EXPECTED`** keeps excluding registry families by prefix: the filter becomes `!k.includes('.why.') && !k.includes('.focus.')` and the new keys get their own describe.
23. **PR sizes**: B1 as specified is ~470 changed lines → split **B1a** (target, encounters, metric, patch rule, lie commit) / **B1b** (since-commit verdict, notice, screen wiring). B3 is ~440 → split **B3a** (pure model + tests) / **B3b** (card, screen, copy).

## 4. Data and stores

### 4.1 `src/store/focusTarget.js` (new, pure)

```
focusTarget(focus) → null | {
  shot: 'approach' | 'drive' | 'short' | 'putt',
  bucket: string | null,                      // focus.bucket
  kind: 'swing' | 'lie' | 'decision' | 'outcome',
  lie: string | null,                         // kind 'lie' only: focus.focusLie
  title: MsgDescriptor,                       // issueMsg({ category, bucket }, causeId ? { id: causeId } : null)
  cue: MsgDescriptor,                         // courseTaskFor({ causeId, category, bucket })
}
```
Rules: `null` unless `isV2Focus(focus)` and `category ∈ SG_CATEGORIES`. `causeId` `/^cause:(approach|tee|short):why:swing:/` → `swing`, shot from the area (`tee → drive`); `…:why:lie` → `lie` only when `area === 'approach' && focus.focusLie`, else `outcome`; `…:why:decision` → `decision`; anything else → `outcome` with shot from the category (`approach`, `offTheTee → drive`, `aroundGreen → short`, `putting → putt`, `penalties → drive`).

### 4.2 `src/store/coachFocus.js`

- `makeFocusCommit`: after `metricKey` is chosen, if `cause?.id === 'cause:approach:why:lie'` → `const lie = dominantLie(whyRow(stats, 'approach', scopeOf(cause.metricKey)))`; when found, `metricKey = \`approach.focus.lieGreenRate.${lie}\`` and the record gets `focusLie: lie`. Every new record gets `measuredSince: 'commit'`.
- `roundsSinceCommit(myRounds, focus)` → `{ committed, judged }` (decision 8).
- `focusVerdict(focus, stats, since = null)` (decision 8).
- `loadFocus`: stamp + notice for a v2 record lacking `measuredSince` (decision 10). `loadFocusNotice` unchanged (any `kind`).

### 4.3 `src/store/missReasons.js`

- `clearedReasonPatch(shotType, { keepSituation = false } = {})` — with `keepSituation`, the situation key is left out of the patch.
- `emptyRow` gains `encounters: {}`; `missReasonStats` adds, for every par ≠ 3 hole with `approachBucket` and `approachResult ∈ {green, miss}`, each lie in `situations(d, 'approachSituation') ∩ LIE.approach` to `encounters[lie] = { shots, greens }` on both the bucket row and `all`. Tee and short rows keep `encounters: {}` (never filled).

### 4.4 `src/store/coachMetrics.js` / `coachCheck.js`

- `LIE.approach` moves to an exported `APPROACH_LIES` in `missReasons.js` (reused here); `METRICS['approach.focus.lieGreenRate.<lie>']` for the six lies: `polarity 'higher'`, `unit 'percent'`, `read(stats)` → `enc = stats?.missReasons?.approach?.all?.encounters?.[lie]`, `{ value: shots > 0 ? Math.round(greens / shots × 100) : null, sample: { shots } }`.
- `metricLabel`: `p[1] === 'focus'` → `msg('stats.my.coach.ui.metric.lieGreenRate', { lie: lower(msg(\`shots.why.situation.${p[3]}\`)) })`. `benchmarkFor` returns `null` (falls through).

### 4.5 `src/store/scoring.js`

`approachFinishPatch`: `patch.approachResult === 'miss' ? patch : { ...patch, ...clearedReasonPatch('approach', { keepSituation: true }) }`. `normalizeWatchShotPatch` 1339–1352: both inline clears use `{ keepSituation: true }`. `approachBucketPatch(null)` unchanged (clears all three).

### 4.6 `src/store/roundFocus.js` (new, pure; B3a)

```
roundFocusSummary({ focus, target, round, playerId, roundStats = null }) → null | {
  touched: boolean,
  thisRound: { kind: 'count', count, total }          // swing / decision: kind.count(row) of row.tagged
            | { kind: 'lie', lie, shots, greens }      // lie
            | { kind: 'value', value, unit },          // outcome: readMetric(focus.metricKey, roundStats)
  before:    { kind: 'count', count, total } | { kind: 'value', value, unit } | null   (decision 21)
}
```
Row and kind for why metrics are parsed from `focus.metricKey` (`<area>.why.<base>Rate[.<scope>]` → `whyRow({ missReasons }, area, scope)` + the `WHY_KINDS` entry with that `base`). `missReasons = missReasonStats([round], playerId)`. Touched per decision 17.

## 5. UI

### 5.1 `ShotDetailPanel` (B2)

- New prop `focusTarget` (default `null`), threaded `ScorecardScreen` → `HoleView` → `HolePage` (+ `holePagePropsEqual` entry) → `PlayerCard` → `ShotDetailSection` → `ShotDetailPanel`.
- `applies`: `target && !readOnly && groupOn(target.shot)` (`approach → g.approach`, `drive → g.teeShot`, `short → g.shortGame`, `putt → g.putting`) and per hole: `approach → !isPar3 || !target.bucket || d.approachBucket == null || d.approachBucket === target.bucket`; `drive → !isPar3`; `short`/`putt` → always.
- **Strip** (first child of `s.shotPanel`, `testID="focus-strip"`): Feather `target` icon, `tl('shots.focus.label')` + `renderMsg(target.title)` + `renderMsg(target.cue)` in one two-line caption; styles `focusStrip` / `focusStripText` in `styles.js` next to `whyRow` (accent-light background, `theme.accent.primary` text, light and dark via tokens).
- **Focused asks**: `focusAsk(mode)` = `applies && (target.kind === 'swing' || target.kind === 'decision') && target.shot === (mode === 'drive' ? 'drive' : 'approach')`; `canOpen(mode) = (missSetting === 'ask' || (missSetting === 'manual' && focusAsk(mode))) && !muted && !readOnly`; `onDriveTap`/`onFinishTap` use `canOpen('drive'|'approach')` instead of `canAutoOpen`. `'off'` never opens.
- **Lie chip** (`testID="focus-lie-chip"`): when `applies && target.kind === 'lie' && showApproachExtras`, rendered right under `ApproachFinishRow` (before `ReasonChip`), reusing `whyRow`/`whyChip*` styles, label `tl(\`shots.focus.ask.${target.lie}\`)`, `accessibilityState.selected` = included; tap → `onChange({ approachSituation: toggled })` where `toggled` adds/removes `target.lie` from `situations(d, 'approachSituation')` (empty list → `null`, matching the sheet's write).

### 5.2 `src/hooks/useFocusTarget.js` (B2)

`useFocusTarget(userId)`: `useEffect([userId])` → `loadFocus(userId).then((f) => focusTarget(f))`, cancel on unmount, `setState` only when the value changes (decision 13). `ScorecardScreen`: `const focusTargetValue = useFocusTarget(user?.id)` passed as `focusTarget` to `HoleView`.

### 5.3 `RoundFocusCard` (`src/components/roundSummary/RoundFocusCard.js`, B3b)

Props `{ target, summary, verdict, onOpenCoach }`; renders `null` unless `target && summary?.touched`. Title `rounds.summary.focus.title`; kicker `renderMsg(target.title)`; **This round** (`rounds.summary.focus.thisRound`): `count` → `rounds.summary.focus.count` ("{count} of {total}") + `renderMsg(metricLabel(focus.metricKey))`; `lie` → `rounds.summary.focus.lie` ("{lie}: {shots} shots, {greens} greens", lie label from `shots.why.situation.<lie>`); `value` → `metricValueText`; before line `rounds.summary.focus.before` with the same two renderings. **So far** (`rounds.summary.focus.soFar`): `stats.my.focus.<state>` / `stats.my.focus.needMore` (count) + `stats.my.coach.ui.fix.level` ({ level, max: MAX_LEVEL }). Link `rounds.summary.focus.openCoach` → `onOpenCoach`. Card styling follows `RoundRecapPanel` (theme tokens, `testID="round-focus-card"`).

### 5.4 `RoundSummaryScreen` wiring (B3b)

- State `focus`, `profile`; the `wantsRecords` effect also `setProfile(profile)`; a new effect on `[me, wantsRecords]` loads `loadFocus(me)`.
- `target = useMemo(focusTarget(focus))`; `myRound = collectMyRounds([tournament], me, profile?.displayName).find(r => r.round?.id === round.id)`; `roundStats = target?.kind === 'outcome' && myRound ? computeMyStats([myRound], { targetHandicap }) : null`; `summary = roundFocusSummary({ focus, target, round, playerId: myPlayerId, roundStats })`.
- Verdict: `since = roundsSinceCommit(resolveSelection(myRounds ?? []), focus)`; `statsSince = since.judged.length ? computeMyStats(since.judged, { targetHandicap }) : null`; `verdict = focusVerdict(focus, { targetHandicap }, { stats: statsSince, rounds: since.committed.length, judged: since.judged.length })`. All memoised and only when `focus && wantsRecords`.
- Render `<RoundFocusCard … onOpenCoach={() => navigation.navigate('MyStats', { tab: 'coach' })} />` between `AchievementStrip` and `RoundLeaderboard` on the scorecard tab (position per canvas).

## 6. Build items

Model routing: **Haiku** mechanical and fully specified; **Sonnet** feature work against this plan; **Opus** cross-cutting (the since-commit verdict, which changes every existing user's verdict and interacts with the rebase window). Order within a PR is the table order; tests are written first.

### PR B1a — focus target, encounters, lie metric, patch rule (~300 lines)

| # | Item | Files | Tests first | Model |
|---|---|---|---|---|
| A1 | `clearedReasonPatch` `keepSituation`; `encounters` on approach rows; `APPROACH_LIES` export | `src/store/missReasons.js` | `src/store/__tests__/missReasons.test.js`: new `describe('encounters')` — a tagged green hit counts `shots` and `greens`; a tagged miss counts `shots` only; an untagged hit is ignored; bucket + `all` both count; bucket set but no result → not counted; tee/short rows have empty `encounters`; `clearedReasonPatch('approach', { keepSituation: true })` omits `approachSituation` | Sonnet |
| A2 | Situation survives a green hit (decision 6) in the panel and watch paths | `src/store/scoring.js` | `src/store/__tests__/scoring.test.js` in `describe('miss reason clearing')`: green keeps `approachSituation` and nulls start/contact; result → null keeps it too; side switch keeps all; `approachBucketPatch(null)` clears all three; watch green / explicit null / direction-clear branches match | Sonnet |
| A3 | `approach.focus.lieGreenRate.<lie>` metrics; `metricLabel` branch; `EXPECTED` filter | `src/store/coachMetrics.js`, `src/store/coachCheck.js`, `src/store/__tests__/coachMetrics.test.js` (filter) | `coachMetrics.test.js` new `describe('focus lie metrics')`: six keys exist, polarity higher, percent of encounters, sample = shots, `null` without encounters; `coachCheck.test.js`: label descriptor carries the lie | Haiku |
| A4 | `focusTarget(focus)` (§4.1) | `src/store/focusTarget.js` | new `src/store/__tests__/focusTarget.test.js`: every cause family × area → kind/shot/lie; `cause:approach:why:lie` with `focusLie` → `lie`, without → `outcome`; tee/short lie → `outcome`; outcome categories incl. `penalties → drive`, `putting → putt`; `title` = issue key for a cause, kicker without; `cue` key = the `courseTaskFor` key; `null` for a v1 record and an unknown category | Sonnet |
| A5 | `makeFocusCommit`: `focusLie` + metric swap for approach lie causes; `measuredSince: 'commit'` | `src/store/coachFocus.js` | `coachFocus.test.js` in `describe('makeFocusCommit')`: a lie cause with `approach.why.lieRate.all` and `lies { 'below-feet': 3, uphill: 1 }` commits `metricKey 'approach.focus.lieGreenRate.below-feet'`, `focusLie`, baseline from encounters; a tie picks `OPTIONS` order; no lies → metric unchanged, no `focusLie`; every commit has `measuredSince` | Sonnet |
| A6 | Copy: `stats.my.coach.ui.metric.lieGreenRate` en/es; spec + plan docs | `src/i18n/locales/{en,es}/coach.js`, `docs/superpowers/specs/…`, `docs/superpowers/plans/…` | `i18n.test.js` parity green | Haiku |

### PR B1b — since-commit verdict + notice (~180 lines)

| # | Item | Files | Tests first | Model |
|---|---|---|---|---|
| B1 | `roundsSinceCommit`; `focusVerdict(focus, stats, since)` (decision 8); `loadFocus` stamp + `since-commit` notice (decision 10) | `src/store/coachFocus.js` | `coachFocus.test.js` new `describe('since the commit')`: selection by `endedAt` vs `committedAt`, `rebasedAt` narrows `judged` but not `committed`, `null endedAt` excluded; with `since` the verdict reads `since.stats`, `roundsSince = since.rounds`, needs-more-rounds counts `since.judged`, `since.stats null` → no reading; without `since` every existing fixture test is untouched; `loadFocus` stamps an old v2 record once, writes the notice first, a stamped record loads silently | **Opus** |
| B2 | `buildCoachWeek({ …, statsSince })` → Check on since-stats for the focus chain (decision 9) | `src/store/coachWeek.js` | `coachWeek.test.js`: the focus chain's `check.value` comes from `statsSince`, the tie/second chain from `stats`; no `statsSince` → unchanged | Sonnet |
| B3 | Screen: `since = roundsSinceCommit(selected, coachFocus)`, `statsSince` memo (only with a focus and `judged.length`), verdict and week get `since`/`statsSince`; `CoachTab` text by `notice.kind` | `src/screens/MyStatsScreen.js`, `src/components/mystats/tabs/CoachTab.js` | `screens/__tests__/MyStatsScreen.test.js`: with a stored focus `computeMyStats` is called twice (selection, then the since subset) and `focusVerdict` receives `since`; `components/mystats/__tests__/CoachTab.test.js`: `since-commit` notice renders the new text and dismisses | Sonnet |
| B4 | Copy `stats.my.coach.ui.notice.sinceCommit` en/es ("Your focus is now judged only on rounds since you started it.") | `src/i18n/locales/{en,es}/coach.js` | parity green | Haiku |

### PR B2 — focus strip + focused asks in the round (~270 lines)

| # | Item | Files | Tests first | Model |
|---|---|---|---|---|
| C1 | `useFocusTarget(userId)` hook (§5.2) | `src/hooks/useFocusTarget.js` | new `src/hooks/__tests__/useFocusTarget.test.js` (renderHook): resolves a stored focus to a target, `null` without one, no state write when still `null`, reloads on a user change | Haiku |
| C2 | Prop threading `ScorecardScreen` → `HoleView` → `HolePage` (+ comparator) → `PlayerCard` → `ShotDetailSection` → `ShotDetailPanel` | `src/screens/ScorecardScreen.js`, `src/components/scorecard/{HoleView,HolePage,PlayerCard,ShotDetailSection}.js` | `HolePage.test.js` `holePagePropsEqual`: a changed `focusTarget` re-renders, same reference skips; `ScorecardScreen.holePageMemo.test.js` still green (the hook's value is stable) | Haiku |
| C3 | Strip, lie chip, focused auto-open (§5.1); styles | `src/components/scorecard/ShotDetailPanel.js`, `src/components/scorecard/styles.js` | `ShotDetailPanel.test.js` new `describe('focus')`: strip on par 4 for an approach target, not on par 3 with a different hole bucket, yes with none set / same bucket / no focus bucket; drive target hidden on par 3; short/putt on every hole; hidden when `readOnly`, when the group is off, without a target; lie chip toggles `approachSituation` on a green hit and on a miss, selected state, absent for a swing target; swing target opens the sheet in `'manual'` on an approach miss, not for a drive miss when the target is approach, never in `'off'`, never on a muted round, never on `readOnly`; decision target same as swing | Sonnet |
| C4 | Copy: `shots.focus.label`, `shots.focus.ask.<six lies>` en/es; glossary rows | `src/i18n/locales/{en,es}/shots.js`, `docs/i18n.md` | parity green | Haiku |

### PR B3a — round focus model (~150 lines)

| # | Item | Files | Tests first | Model |
|---|---|---|---|---|
| D1 | `roundFocusSummary` (§4.6) | `src/store/roundFocus.js` | new `src/store/__tests__/roundFocus.test.js`: swing focus on `approach.why.swing.start.rightRate.100-150` → "2 of 5" from a fixture round, bucket vs `all` scope; decision kind; lie kind counts shots/greens; outcome kind reads `roundStats`; `touched` false with no focus shots (and for a lie with no encounters); `before` as count for percent with a sample, as value otherwise; `null` without a target | Sonnet |

### PR B3b — round-summary Focus card (~290 lines)

| # | Item | Files | Tests first | Model |
|---|---|---|---|---|
| E1 | `RoundFocusCard` (§5.3) | `src/components/roundSummary/RoundFocusCard.js` | new `src/components/roundSummary/__tests__/RoundFocusCard.test.js`: count / lie / value renderings, before line, every verdict state incl. needs-more-rounds and level, "Open Coach" calls back, `null` when untouched | Sonnet |
| E2 | Screen wiring (§5.4) | `src/screens/RoundSummaryScreen.js` | `screens/__tests__/RoundSummaryScreen.test.js`: with `saveFocus('u1', …)` seeded and `shotDetails.p1` on the round the card shows with this round's count; hidden without a focus, for a round with no focus shots, when `getUser` is `u3` (not playing), and while live; the link navigates to `MyStats` `{ tab: 'coach' }` | Sonnet |
| E3 | Copy `rounds.summary.focus.{title,thisRound,soFar,before,count,lie,openCoach}` en/es | `src/i18n/locales/{en,es}/rounds.js` | parity green | Haiku |

Dependencies: A1 → A2/A3; A3 → A5; A4 needs A5's `focusLie`; B1 → B2/B3; A4 → C1 → C2 → C3; A4 + B1 → D1 → E1/E2.

## 7. Verification (per PR)

1. `npm test`, `npm run lint`, `EXPO_NO_TYPESCRIPT_SETUP=1 npm run build:web` (verify on the export).
2. `/verify` web walkthrough at 390 px, light and dark, EN and ES (UI PRs):
   - **B1b:** My Stats → Coach with an existing focus: the notice shows once and dismisses; FocusCard "Now" and the diagnosis Check bar agree; a selection change does not move "rounds in".
   - **B2:** commit an approach start-line focus; open a live scorecard: the strip shows on hole 1 (par 4) with the issue title and cue, not on a par 3 once its distance is set to another bucket; with the setting *Only when I tap Why?* an approach *Right* tap opens the Why? sheet, a drive *Left* tap does not; *Not this round* stops it; a *Below feet* lie focus shows the chip on a hit, tapping it pre-selects the lie in a later miss sheet; switching the Approach group off hides the strip; a peer's card shows nothing.
   - **B3b:** open the finished round from the feed: the Focus card shows "2 of 5" (or the lie counts), the before line, the verdict line and level; "Open Coach" lands on the Coach tab; a friend's round and a round without focus shots show no card.
3. After merge (owner): `git checkout ota/be6b8748-sg && git cherry-pick <merge-commit>`; `GOLF_ANDROID_BUILD_ARCHS=arm64-v8a npx eas-cli fingerprint:compare be6b8748` (no generated `android/` folder present) must report a match; then `GOLF_ANDROID_BUILD_ARCHS=arm64-v8a npx eas-cli update --branch preview -m "feat(focus): …"`.

## 8. Risks and open questions

| # | Risk / question | Position |
|---|---|---|
| R1 | Existing foci switch to a since-commit verdict: a golfer with 3 rounds in may drop back to "needs one more round" if those rounds predate the stamp or are unstamped (`endedAt` null). | Accepted; the notice explains it. Unstamped rounds are older than the finish stamp, so recent rounds are covered. |
| R2 | Two `computeMyStats` passes per render of My Stats with a focus. | The subset is small (rounds since commit); memoised on `selected` + focus. |
| R3 | Lie focus baseline at commit is 0 % greens (decision 5), so the first judged rounds read "improving" easily. | Accepted; revisit with a minimum-encounters floor if it misleads. |
| R4 | `clearedReasonPatch` signature change touches the sheet, scorecard view and watch path. | Default argument keeps every current call identical; A2's tests pin each branch. |
| R5 | `MyStatsScreen` mocks `computeMyStats` in its screen test; the since-subset call sees the same fixture. | B3's assertion checks call count and arguments, not values. |
| R6 | A setState from `useFocusTarget` after an async load can land outside `act()` in the scorecard suites. | The hook skips the write when the value is unchanged (`null → null`); suites that seed a focus flush with `waitFor`. |
| Q1 | Tee (`wind`) and short-game lie foci: strip only (decision 3), or a chip writing `driveSituation` / `shortSituation` too? | Plan: approach only. Owner to confirm. |
| Q2 | Should the situation survive `approachResult → null` (decision 6) or only the green hit? | Plan: survives everything but the bucket clear. |
| Q3 | Round summary "so far" ignores manual round deselection (decision 16). | Plan: default selection. |
| Q4 | Strip info tap in v1? | Plan: none; the canvas decides. |

### Critical Files for Implementation
- /Users/marcospecker/orca/workspaces/golf-partner/coach-redesign/src/store/coachFocus.js
- /Users/marcospecker/orca/workspaces/golf-partner/coach-redesign/src/store/missReasons.js
- /Users/marcospecker/orca/workspaces/golf-partner/coach-redesign/src/components/scorecard/ShotDetailPanel.js
- /Users/marcospecker/orca/workspaces/golf-partner/coach-redesign/src/screens/MyStatsScreen.js
- /Users/marcospecker/orca/workspaces/golf-partner/coach-redesign/src/screens/RoundSummaryScreen.js
