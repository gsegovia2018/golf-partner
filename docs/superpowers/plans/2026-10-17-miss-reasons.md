# Miss reasons — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Each task names the model tier to run it on (think expensive, build cheap). TDD: the named test file is written first and fails before the item's code lands.

**Date:** 2026-10-17 · **Status:** plan · **Lifecycle:** `deliver` (design chosen: `why-sheet-designs.html` card 1, `push-or-slice.html` two-tap)
**Spec:** `docs/superpowers/specs/2026-10-17-miss-reasons-design.md` (sub-project A). Spec and this plan ship in PR1.
**Branches:** PR1 `feat/miss-reasons-vocab` (split 1a/1b, §6), PR2 `feat/miss-reasons-blame`, PR3 `feat/miss-reasons-coach` (split 3a/3b), each from a freshly pulled `master`. JS + jsonb keys only → OTA.

## 1. Goal

A missed drive, approach or up-and-down can carry *why* it missed — start line (absolute left/center/right), contact, situation — captured on one bottom sheet that auto-opens only on a miss the golfer taps, costs about two taps, and is always skippable. The coach then separates swing faults (start line / curve / low point / strike) from lie, decision and forced shots, moves the blame for a `blocked` approach onto the tee shot, and links the swing analyzer to the right fault.

## 2. What exists today (read 2026-10-17, branch `docs/miss-reasons-spec` @ 4182348f)

- **Shot detail record:** `DEFAULT_SHOT` and `STAT_GROUP_FIELDS` in `src/components/scorecard/constants.js`. The panel `src/components/scorecard/ShotDetailPanel.js` (`ShotDetailPanel({ hole, detail, onChange, strokes, statGroups })`) computes `driveMissed`, `missedGIR`, `effectiveOutcome = d.recoveryOutcome ?? recoveryOutcomeFromState(...)`, and renders the drive circles (`onChange(driveDirectionPatch(d.drive, key))`), `ApproachFinishRow` (`onChange(approachFinishPatch(detail, key))`) and the Up & Down / Sand Save chips (`recoveryOutcomePatch`). Chip styles `outcomeChip` / `outcomeChipActive` / `outcomeChipLabel` live in `src/components/scorecard/styles.js`.
- **Patches** (pure, `src/store/scoring.js` 1237–1332): `driveDirectionPatch(current, key)`, `teeClubPatch`, `approachBucketPatch`, `approachFinishPatch(detail, key)`, `recoveryOutcomePatch(effectiveOutcome, key)`, `normalizeWatchShotPatch(detail, patch, par)` (the watch's absolute values → the same field changes; it has an inline "clear finish" branch that bypasses `approachFinishPatch`).
- **Write path — NOT the setup sync queue (spec §4.2 is wrong here).** `PlayerCard` → `ShotDetailSection` → `onSetShot(player.id, hole.number, patch)` → `ScorecardScreen.setShot` (`src/screens/ScorecardScreen.js` 1211) which does `{ ...DEFAULT_SHOT, ...current, ...patch }` and `actions.setDraftShot` (`src/engine/store/actions.js`) → `publishHole` (`src/engine/publish.js`, copies `draftHole.shots` wholesale, deep-equal no-op) → `scorer_cards.card.holes[h].shots[playerId]` → SQL `projected_round_shots()` (`supabase/migrations/20260905000000_scorer_cards.sql` 327) copies `sh.value` into `game_shot_details.detail` (jsonb, no CHECK). **No whitelist or normalisation anywhere** (engine, `shotStore.js`, `tournamentRepo.js`, SQL): new keys sync with zero plumbing. `setShot` is a no-op when `viewOnly || official`; `PlayerCard` receives `canEdit`.
- **Watch:** `src/store/watchProtocol.js` `parsePatch` whitelists watch→phone keys (unknown key ⇒ command rejected) and `WATCH_SHOT_FIELDS` limits phone→watch state; the watch path (`ScorecardScreen.watchShot` → `normalizeWatchShotPatch` → `setDraftShot`) never goes through `ShotDetailPanel`. Reason keys are therefore invisible to the watch, and a sheet opened only from the panel's own tap handlers can never open on a watch write — no "came from the watch" flag is needed.
- **Handedness:** `getSwingProfile().handedness` (`src/store/swingStore.js`, default `'right'`), hydrated only by `hydrateSwings()` which the Swing screens call — never at app boot. `swingStore` is already imported by `MyStatsScreen.js` (web), so importing it from the scorecard is web-safe at module load; the expensive part of `hydrateSwings` (`readMarks` on old rows) must not run from the scorecard.
- **Settings:** `src/store/settingsStore.js` `DEFAULT_APP_SETTINGS.statGroups`, `mergeAppSettings` (enum sanitising pattern: `practiceMinutesPerWeek`); `src/screens/SettingsScreen.js` 143 (`SwitchRow` per group) and 152 (segmented `units` row, the pattern for a 3-way choice). Synced through `profiles.settings`.
- **Stats:** `src/store/statsEngine.js` — `approachMissTendency` (1955), `approachMissCost` (2007), `approachMissByDistance` (2131, feeds `approach.<side>Rate.<bucket>` metrics), `sgApproach` (2591) / `approachTargetGaps` (2811) through `approachStartLie(d, par)` (2722) and `approachEndState`; `driveLieFromDetail(detail)` (2653) → `driveLieBreakdown` (2663, `tee.troubleRate`) and `sgOffTheTee` (2735, `DRIVE_LIE_TABLE.trouble = 'recovery'`), `defaultApproachLie` (2714, par-4-only inheritance). `src/store/personalStats.js` 1086–1116 assembles `approachTendency`, `approachMissCost`, `approachMissByDistance`, `driveLies`, `approachTarget`, `strokesGained`. Baseline: `expectedStrokes('recovery', d, H)` in `src/store/strokesGainedBaseline.js` (recovery rows at 45.7/91.4/137.2/182.9 m; `lookupRow` handles 25 m — B2 pins the value).
- **Coach:** `coachCauses.js` (`CAUSE_MIN`, rule table `RULES`, `causesForLeak` ranking `byStrength` = strength then sample); `coachMetrics.js` (`METRICS` registry, `readMetric`); `coachCheck.js` `metricLabel(key)` (returns `null` for an unknown key → no Check line); `coachCausePair.js` (`CAUSE_IDS`, `issueMsg`, `fromCause` switch — `default: null`); `coachSwingLink.js` (`SWING_FAULT_LINKS`, `mirrorCauseId` rewrites only a trailing `:left|:right`); `coachDrills.js` (`DRILLS`, `drillsForCause` maps the id's second segment through `CAUSE_TO_DRILL_AREA`; drill copy keys `stats.my.drill.<id>.{title,instruction,pass}` in `i18n/locales/*/myStats.js`); `coachStrategy.js` (five rules, `causeId` per tip); `coachWeeklyPlan.js` (`poolFor` falls back to area drills when a cause has none; `courseTaskFor` turns an id into `plan.course.<id with dots>`); `coachWeek.js` (`buildCoachWeek` → chains); UI `components/mystats/DiagnosisCard.js` + `components/mystats/WhySheet.js` (the coach's *reasoning* sheet — name collision with the spec's `WhySheet`).
- **Tests that constrain new keys:** `src/i18n/__tests__/i18n.test.js` (en/es key and placeholder parity, no empty strings), `coachCatalogue.test.js` (`PASSED` map: every coach key the stores emit, with params), `src/store/__tests__/coachCausePair.test.js` (`CAUSE_IDS` must equal every id `coachCauses.js` can emit; issue titles ≤ 6 words), `coachDrills.test.js` (catalog shape).

## 3. Decisions (and where the plan departs from the spec — each flagged)

1. **Sync.** Reason keys ride the cards engine, not the setup queue (§2). No new plumbing; the spec's §4.2 sentence is corrected in PR1's spec edit (one line).
2. **Component name.** The sheet is `src/components/scorecard/MissWhySheet.js` (spec: `WhySheet`) — `components/mystats/WhySheet.js` already exists.
3. **`DEFAULT_SHOT` defaults are `null` for all nine keys** (spec: `null` / `[]`). `setShot` spreads `DEFAULT_SHOT` into every detail it writes, so a `[]` default would put a shared array instance into every hole and every published card; readers treat `null` and `[]` alike (`situations(d, key)` helper).
4. **Opening rule.** The sheet opens only from the panel's own tap handlers for drive `left|right|short` and approach `left|right|long|short|bunker` (a `bunker` tap with no direction titles "…into the bunker?"). It never opens from a `detail` prop change (that is how a watch write, a peer card or a re-hydrate arrives). Suppressed when `missReasons !== 'ask'`, the round is muted, or `readOnly`.
5. **Short game trigger (spec/code mismatch).** `recoveryOutcomeFromState` returns `null` (not `'none'`) for a failed up-and-down (`strokes > par`), and `'none'` only exists after a chip is toggled off. The Why chip shows when `missedGIR && strokes > par && effectiveOutcome` is neither save — i.e. "no save", not `=== 'none'`.
6. **Clearing vs switching.** `driveDirectionPatch` clears the three drive reason keys when the new value is not a miss (`null`, `fairway`, `super`); `left ↔ right ↔ short` keep them (`driveStart` is merely hidden for `short`). `approachFinishPatch` clears the three approach keys on `green` and when the last miss signal goes (`approachResult` → `null`); a side change keeps them. `recoveryOutcomePatch` clears the short keys when the outcome becomes a save. `approachBucketPatch(null)` clears the approach keys too (it already clears the finish). `normalizeWatchShotPatch`'s inline clear branch gets the same clears.
7. **Handedness.** New `hydrateSwingProfile()` in `swingStore.js` (reads `PROFILE_KEY` only, never the index or files); the sheet calls it once on mount and reads `getSwingProfile().handedness`. Names are display-only: `shotName(flight, handedness)`.
8. **Mute flag.** `src/store/missReasonsMute.js` (AsyncStorage key `missReasons.mutedRounds`, newest-first list of ≤ 20 round ids). `roundId` is threaded `HolePage` (`round.id`) → `PlayerCard` → `ShotDetailSection` → `ShotDetailPanel`, with `readOnly={!canEdit}`.
9. **Read-only scorecard (spec §4.4 names a tap that does not exist).** `ShotScorecard` cells have no per-hole tap. PR1 adds the marker only: `scorecardModel` cells gain `why` (summary descriptor or `null`), the green row draws a small dot and puts the summary in the cell's accessibility label. A tappable per-hole detail is an open question (§8), not built here.
10. **Blame shift (spec §5.2 reads as a contradiction: "excluded from approach SG" and "scores its approach against recovery").** The plan's reading: a blocked approach **stays in the SG sample** but starts from `expectedStrokes('recovery', bucketMidpoint)` in both `sgApproach` and `approachTargetGaps` (the leak's bucket children), so the approach category is not blamed and the reconciliation residual does not grow; it **is excluded** from `approachMissTendency`, `approachMissCost` and `approachMissByDistance` (each reports a `blocked` count so the denominators are explicit). `scramblingByMissType` is not in the spec and is left unchanged.
11. **Tee trouble.** Implemented in one seam, `driveLieFromDetail(detail, par)`: when `par === 4` and the approach carries `blocked` and the lie is not already `trouble` or `sand`, the lie reads `trouble`. That one change makes `driveLieBreakdown` (`tee.troubleRate`), `sgOffTheTee` (recovery table — this is how "the cost lands on the tee shot") and `defaultApproachLie` agree. Par 5 is excluded (the blocked shot may be the third; `defaultApproachLie` already inherits on par 4 only) — spec is silent, flagged in §8. An explicit `driveLie: 'fairway'` plus `blocked` becomes `trouble`, as the spec says.
12. **Why rules outrank outcome rules on a tie.** `byStrength` sorts by strength then sample; a why rule's sample (tagged misses) is always smaller than the outcome rule's (all misses), so the spec's "on a tie the why rule wins" needs an explicit `priority` field on the cause (why = 0, outcome = 1) compared before sample.
13. **Strategy-only causes get no minutes.** `drillsForCause('cause:approach:why:lie')` returns `[]` and `poolFor` would fall back to the area's drills, giving a lie cause practice minutes. `coachWeeklyPlan` gains `STRATEGY_ONLY_CAUSES` (lie, decision, forced ids): such a focus block is dropped from the drill packing and its minutes go to the next block; the course task still names the cause.
14. **`classifyMiss` contact precedence** treats `sky` like `top` (lowPoint wins over flight); the spec's precedence sentence lists only `fat/thin/top`.
15. **Metric keys** (one per rule, read from `stats.missReasons`): `approach.why.swing.start.<side>Rate.<bucket>`, `approach.why.swing.curve.<side>Rate.<bucket>`, `approach.why.swing.strike.<side>Rate.<bucket>`, `approach.why.swing.lowPointRate.<bucket>`, `approach.why.lieRate.<bucket>`, `approach.why.decisionRate.<bucket>`; `tee.why.swing.<sub>[.<side>]Rate`, `tee.why.decisionRate`; `short.why.swing.lowPointRate`, `short.why.lieRate`, `short.why.decisionRate`. Value = percent of **tagged** misses; `sample.shots` = tagged misses (the gate `whyTagged` reads it).

## 4. Data and stores

### 4.1 `src/store/missReasons.js` (new, pure)

```
MISS_REASON_KEYS = { drive: ['driveStart','driveContact','driveSituation'],
                     approach: ['approachStart','approachContact','approachSituation'],
                     short: ['shortResult','shortContact','shortSituation'] }
OPTIONS = { start: ['left','center','right'],
            driveContact: ['top','sky','toe','heel'], driveSituation: ['wind','decision'],
            approachContact: ['fat','thin','toe','shank'],
            approachSituation: ['above-feet','below-feet','uphill','downhill','blocked','bad-lie','wind','decision'],  // fixed order, never reordered
            shortResult: ['short','long'], shortContact: ['fat','thin'], shortSituation: ['bad-lie','short-sided','wrong-shot'] }
clearedReasonPatch(shotType)              → { key: null, … }
flightOf({ start, finish })               → { start, curve, family } | null   (§3 table; finish long/short → family null, curve null)
shotName(flight, handedness)              → 'push'|'pull'|'slice'|'hook'|'pull-slice'|'push-hook'|null  (mirrored for 'left')
summaryOf(shotType, detail, handedness)   → [descriptor] for the chip ("Push · heavy"), [] when untagged
hasReason(shotType, detail)               → boolean
isBlockedApproach(detail)                 → boolean          (PR2)
classifyMiss(shotType, detail)            → { family, sub } | null   (PR2, §5.1 first-match)
missReasonStats(rounds, playerId)         → { approach: { byBucket: { [b]: Row }, all: Row }, tee: Row, short: Row }   (PR2)
  Row { misses, tagged, untagged, blocked, families: { forced, lie, decision, swing },
        subs: { start: { left, right }, curve: { left, right }, strike: { left, right }, lowPoint } }
```
`missReasonStats` counts the same holes the engine does: approach = par ≠ 3, `approachBucket` set, `approachResult === 'miss'`; tee = par ≥ 4, `drive ∈ left|right|short`; short = `approachResult === 'miss'` or GIR false, outcome not a save. "Tagged" = any reason key set. `personalStats.computeMyStats` adds `missReasons: missReasonStats(synthetic.rounds, CANON_ID)` to `baseStats`.

### 4.2 `src/store/missReasonsMute.js` (new, AsyncStorage)
`isRoundMuted(roundId)`, `muteRound(roundId)` (LRU 20), `__resetForTests`.

### 4.3 Setting
`DEFAULT_APP_SETTINGS.missReasons = 'ask'`; `mergeAppSettings` accepts only `'ask'|'manual'|'off'` (else keeps base). Settings → Stats tracking: a segmented row under the group switches (`settings.missReasons.label`, `.ask`, `.manual`, `.off`, `.hint`), `testID="setting-missReasons"`.

## 5. UI

### 5.1 `MissWhySheet` (`src/components/scorecard/MissWhySheet.js`)
Props `{ visible, mode: 'drive'|'approach'|'short', hole, detail, onChange, onClose, onMuteRound, units }`. Built on `components/BottomSheet` + `ui/SheetHandle`. Title `shots.why.title.<side|long|short|bunker>`; subline `shots.why.sub` with hole number and `shots.why.ctx.<approach|drive>` (+ bucket label in the user's units). Tracer: `react-native-svg` (15.12.1, already a dependency) — sky/ground, target line, green ellipse (approach) or fairway band (drive), the finish marker from the detail (tap → `approachFinishPatch` / `driveDirectionPatch` through `onChange`, same as the panel row), a 3-segment start band (hidden for drive `short`); a selected segment draws the path and shows the name pill (`shots.why.name.<push|…>` + side). Contact chips single-select, situation chips multi-select (approach shows all 8 in `OPTIONS` order), short mode replaces the tracer with the `shortResult` pair. Footer: "Not this round" (`shots.why.notThisRound`) and Done (`shots.why.done`); scrim/back = Done. Every tap calls `onChange({ key: value })` immediately. Chips reuse `outcomeChip*` styles with `minHeight: 44`. `useTheme()` tokens only, light and dark.

### 5.2 Panel wiring (`ShotDetailPanel.js`)
- New props `roundId`, `readOnly`; `useAppSettings().missReasons`; local `sheet` state `{ mode } | null`.
- Drive circles / `ApproachFinishRow`: after `onChange(patch)`, if the tapped key is a miss and `canAutoOpen` (setting `'ask'`, not muted, not read-only), open the sheet. `canAutoOpen` reads `isRoundMuted` into state once per `roundId`.
- `ReasonChip` under the drive row (when `driveMissed`), under the finish row (when `approachResult === 'miss'`) and on the outcome row (per decision 5): summary text when tagged, muted "Why?" (`shots.why.chip`) when not; hidden when the setting is `'off'` or the row's group is off; tapping opens the sheet in that mode (allowed even when `'manual'`).
- `ShotDetailSection` and `PlayerCard` pass `roundId={round?.id}` and `readOnly={!canEdit}` (`HolePage` → `PlayerCard` already has `round` and `canEdit`).

### 5.3 Read-only scorecard
`scorecardModel` cell: `why: summaryOf(...)` for the approach (or drive when no approach miss), `null` otherwise. `ShotScorecard` green row: a 4 px dot next to the GIR mark when `c.why.length`, a11y `stats.game.ledger.a11y.why` with the rendered summary.

## 6. Build items

Model routing: **Haiku** mechanical and fully specified; **Sonnet** feature work against this plan; **Opus** cross-cutting (the SG/stats blame shift). Order within a PR is the table order; tests are written first.

### PR1 — vocabulary + sheet + chips + setting + i18n (split: **1a** A1–A5 + docs, **1b** A6–A9; 1a is inert until 1b)

| # | Item | Files | Tests first | Model |
|---|---|---|---|---|
| A1 | `DEFAULT_SHOT` nine keys (null), `STAT_GROUP_FIELDS` (drive → `teeShot`, approach → `approach`, short → `shortGame`) | `src/components/scorecard/constants.js` | new `src/components/scorecard/__tests__/constants.test.js`: every `DEFAULT_SHOT` key is in exactly one group | Haiku |
| A2 | `missReasons.js` PR1 surface: `MISS_REASON_KEYS`, `OPTIONS`, `clearedReasonPatch`, `flightOf`, `shotName`, `summaryOf`, `hasReason`, `situations` | `src/store/missReasons.js` | `src/store/__tests__/missReasons.test.js`: every `flightOf` row of spec §3 incl. long/short; `shotName` both hands; `summaryOf` composition and empty | Sonnet |
| A3 | Patch clearing (decision 6) incl. `normalizeWatchShotPatch` inline branch and `approachBucketPatch(null)` | `src/store/scoring.js` | `src/store/__tests__/scoring.test.js` new `describe('miss reason clearing')`: clearing a miss clears its keys; side switch keeps them; watch clear path clears; watch side change keeps | Sonnet |
| A4 | Setting `missReasons` + enum sanitising; Settings row | `src/store/settingsStore.js`, `src/screens/SettingsScreen.js`, `src/i18n/locales/{en,es}/settings.js` | `settingsStore.test.js` (bad value keeps base, default `'ask'`); `src/screens/__tests__/SettingsScreen.test.js` if present else a render case next to the stat-group test | Sonnet |
| A5 | Mute store | `src/store/missReasonsMute.js` | `src/store/__tests__/missReasonsMute.test.js`: mute, isMuted, LRU cap 20, corrupt value → empty | Haiku |
| A6 | `hydrateSwingProfile()` export | `src/store/swingStore.js` | `src/store/__tests__/swingStore.test.js` (add case: reads profile only, no index read) | Haiku |
| A7 | `MissWhySheet` (§5.1) | `src/components/scorecard/MissWhySheet.js` | `src/components/scorecard/__tests__/MissWhySheet.test.js`: band tap writes `approachStart` and shows the name for a right- and a left-hander; tap again clears; contact single-select; situation multi-select in fixed order; short mode; Done/scrim call `onClose`; "Not this round" calls `onMuteRound`; finish marker tap writes the finish patch; band hidden for drive `short` | Sonnet |
| A8 | Panel wiring + chips + prop threading (§5.2) | `src/components/scorecard/ShotDetailPanel.js`, `ShotDetailSection.js`, `PlayerCard.js` | `ShotDetailPanel.test.js` new describes: opens on a tapped drive/approach miss; not on fairway/green/super; never on a `detail` prop change (re-render with a miss already set); never for the short row (chip only); suppressed by `'manual'`, `'off'`, muted round, `readOnly`; summary chip text; chips hidden when the group is off or setting `'off'` | Sonnet |
| A9 | Scorecard marker (§5.3) | `src/store/scorecardView.js`, `src/components/scorecard/ShotScorecard.js` | `src/store/__tests__/scorecardView.test.js` (`why` on cells), `ShotScorecard.test.js` (dot + a11y) | Sonnet |
| A10 | i18n: `shots.why.*` (title/sub/ctx/labels/chips/names/notThisRound/done), chip labels (`shots.why.contact.<key>`, `shots.why.situation.<key>`, `shots.why.start.<key>`, `shots.why.shortResult.<key>`), ledger a11y; glossary rows (push/pull/slice/hook/heavy/thin/hosel/below feet/short-sided) | `src/i18n/locales/{en,es}/shots.js`, `docs/i18n.md` | `i18n.test.js` parity green | Haiku |

### PR2 — families + blame shift

| # | Item | Files | Tests first | Model |
|---|---|---|---|---|
| B1 | `classifyMiss`, `isBlockedApproach`, `missReasonStats`; `personalStats` adds `missReasons` | `src/store/missReasons.js`, `src/store/personalStats.js` | `missReasons.test.js`: priority on every combination (below-feet + curve-right → lie; blocked + fat → forced; fat + start-right → lowPoint; toe + start-right → strike; untagged → null; short `wrong-shot` → decision); stats counts per bucket, tagged/untagged/blocked; `personalStats.test.js`: `missReasons` present | Sonnet |
| B2 | Blame shift (decisions 10–11): `approachStartLie` → `'recovery'` when blocked (par ≠ 3); `approachMissTendency` / `approachMissCost` / `approachMissByDistance` skip blocked holes and report `blocked`; `driveLieFromDetail(detail, par)` + callers (`driveLieBreakdown`, `sgOffTheTee`, `defaultApproachLie`) | `src/store/statsEngine.js` | `statsEngine.test.js` new `describe('blocked approach')`: rates and cost ignore the hole; `sgApproach` / `approachTargetGaps` start from `expectedStrokes('recovery', mid)` (pin the 25 m value); `driveLieBreakdown` counts the drive as trouble on par 4 only; `sgOffTheTee` scores it off the recovery table; explicit `driveLie: 'fairway'` + blocked → trouble; `sgCalibration.test.js` unchanged; `coachMetrics.test.js` "real computeMyStats output" still green | **Opus** |

### PR3 — coach (split: **3a** C1–C3 + their copy, **3b** C4–C7 + their copy)

| # | Item | Files | Tests first | Model |
|---|---|---|---|---|
| C1 | Metric registry keys (decision 15) + `metricLabel` branches + `benchmarkFor` null for why keys | `src/store/coachMetrics.js`, `src/store/coachCheck.js` | `coachMetrics.test.js` (each key reads `stats.missReasons`, percent of tagged, sample = tagged); new `src/store/__tests__/coachCheck.test.js` labels for every why key | Sonnet |
| C2 | Cause rules: `CAUSE_MIN.whyTagged/whyFamilyPct/whyLikelyPct`; `approachWhyRule`, `teeWhyRule`, `shortWhyRule` emitting the §5.3 ids with counts; `priority` tiebreak (decision 12); `CAUSE_IDS` + `fromCause` single-bar cases + `issueMsg`; `courseTaskFor` keys | `src/store/coachCauses.js`, `src/store/coachCausePair.js`, `src/store/coachWeeklyPlan.js` (courseTask only) | `coachCauses.test.js` new `describe('why rules')`: fires at ≥ 6 tagged and ≥ 50 % family; `likely` at 70 %; outranks the side rule at equal strength; falls back to today's cause under `whyTagged`; side only on start/curve/strike; `coachCausePair.test.js` (update the id extraction for the templated why ids; new single bars); `coachWeeklyPlan.test.js` course task per id | Sonnet (Opus review of the ranking change) |
| C3 | `SWING_FAULT_LINKS` rows of spec §5.5 | `src/store/coachSwingLink.js` | `coachSwingLink.test.js`: `over_the_top` links `approach:why:swing:curve:right`; left-hander mirrors `start:left` → `start:right`; `lowPoint` ids unchanged by `mirrorCauseId` | Haiku |
| C4 | Drills: new `appr-path-gate`, `appr-low-point-line`, `appr-strike-tape` (area `approach`, `range`, 15 min, three levels); cause lists on `appr-start-line-gate`, `tee-shape-window`, `sg-landing-towel`; copy keys `stats.my.drill.<id>.*` | `src/store/coachDrills.js`, `src/i18n/locales/{en,es}/myStats.js` | `coachDrills.test.js`: `drillsForCause` for each why sub returns the mapped drill first | Sonnet |
| C5 | Strategy cards `lie` (aim/club per lie family, from `missReasons.approach.all.subs`/families) and `decision`; `STRATEGY_ONLY_CAUSES` in the weekly plan (decision 13) | `src/store/coachStrategy.js`, `src/store/coachWeeklyPlan.js` | `coachStrategy.test.js` (thresholds, payoff, sorting); `coachWeeklyPlan.test.js`: a lie-cause focus gets 0 drill minutes, minutes move to the next block, course task names the cause | Sonnet |
| C6 | Coverage hint: chain `coverage` in `buildCoachWeek`; rendered in `DiagnosisCard` (and the mystats `WhySheet`) when the top leak is approach/offTheTee and tagged < `whyTagged` | `src/store/coachWeek.js`, `src/components/mystats/DiagnosisCard.js`, `src/components/mystats/WhySheet.js` | `coachWeek.test.js`; `DiagnosisCard.test.js` (`testID="coverage-hint"`, text "3/6") | Sonnet |
| C7 | Coach copy en/es per §5.4 ball-flight laws: `stats.my.coach.cause.{approach,tee,short}.why.*` (+ `.lead`-compatible), `ui.issue.*` (≤ 6 words), `plan.course.*`, `check.*`, `ui.coverage`, `tip.lie.*`, `tip.decision.*`; `coachCatalogue.test.js` `PASSED` entries; glossary | `src/i18n/locales/{en,es}/coach.js`, `src/i18n/__tests__/coachCatalogue.test.js`, `docs/i18n.md` | parity + catalogue tests green | Haiku |

Dependencies: A1 → A2/A3; A2 → A7/A8/A9; A4/A5/A6 → A8; B1 → B2 (helper) → C1 → C2 → C3–C6; C7 alongside C2/C5.

## 7. Verification (per PR)

1. `npm test`, `npm run lint`, `EXPO_NO_TYPESCRIPT_SETUP=1 npm run build:web` (verify on the export — Metro has served stale bundles before).
2. `/verify` web walkthrough at 390 px, light and dark:
   - **PR1:** on a live scorecard tap approach *Right* → the sheet opens titled "Why did it miss right?"; tap *Right* on the band → "Push · right" pill and path; *Heavy*; *Below feet* + *Wind*; Done → chip "Push · heavy"; reopen from the chip; tap *On green* → chip gone and keys null in the hole's draft; drive *Left* opens the drive sheet; a failed up-and-down shows only the "Why?" chip; "Not this round" stops auto-open for that round only; Settings: *Only when I tap Why?* stops auto-open, *Off* hides the chips; the played-round scorecard shows the dot; a par 3 never shows reason UI.
   - **PR2:** My Stats → Shots: a round with one `blocked` approach drops that hole from the miss-direction fan and the approach SG does not move against the golfer; the tee trouble rate rises by one drive.
   - **PR3:** a fixture with ≥ 6 tagged right misses starting right → the Coach verdict reads the start-line cause with its count, the Check line names the metric, the swing line links `over_the_top`/`flat_backswing` accordingly, the plan carries the start-line drill; a lie-family fixture shows a strategy card and no range minutes; a thin fixture shows "Tag why on misses … 3/6".
3. After merge (owner): `GOLF_ANDROID_BUILD_ARCHS=arm64-v8a npx eas-cli update --branch preview -m "…"`.

## 8. Risks and open questions

| # | Risk / question | Position |
|---|---|---|
| R1 | `setShot` spreads `DEFAULT_SHOT` into every detail, so every hole written after PR1 carries nine extra `null` keys (bigger cards, every re-touched old hole publishes a new version). | Accepted; `null` not `[]` (decision 3). |
| R2 | Opening a `Modal` from inside the hole pager on web/Android while the draft write is in flight. | The sheet reads `detail` from props (the store echo), so a tap before the echo still shows the finish from the patch it just sent; `MissWhySheet.test` covers a late echo. |
| R3 | `expectedStrokes('recovery', 25)` below the table's first row (45.7 m). | B2 pins the value and, if `lookupRow` extrapolates oddly, clamps the distance to the first row for `recovery` only. |
| R4 | The why rules change which cause is primary for golfers who already have a focus (`focus.causeId`, `metricKey`). | `needsRebase`/`focusVerdict` already re-read by `metricKey`; an old focus keeps its outcome metric until it ends. |
| R5 | `coachCausePair.test` extracts emitted ids from the source; templated why ids break its regex. | C2 updates the extraction to enumerate `WHY_SUBS × sides`. |
| R6 | 12 chips on a sunny tee (mockup's own caveat). | Ship as designed; revisit "4 most-used + More" after use. |
| Q1 | Blame shift reading (decision 10): keep blocked holes in approach SG scored off `recovery`, or drop them from the SG sample entirely? | Plan keeps them. Owner to confirm. |
| Q2 | Tee trouble shift on par 5 (decision 11)? | Plan: par 4 only. |
| Q3 | Read-only scorecard: marker only (decision 9), or add a per-hole tap/sheet? | Plan: marker only. |
| Q4 | Should `hydrateSwingProfile` run at app boot instead of on first sheet open? | Plan: on sheet open (no boot cost). |
