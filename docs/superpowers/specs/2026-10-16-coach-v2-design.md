# Coach v2 — Diagnosis chain, weekly plan, swing link

**Date:** 2026-10-16
**Status:** Implemented on feat/coach-v2 (2026-10-16)
**Scope:** My Stats → Coach tab. Stores under `src/store/coach*.js`, UI under `src/components/mystats/`, swing data read from `src/store/swingStore.js`. No LLM, no network, deterministic, on-device.
**Prerequisite:** the strokes-gained baseline recalibration PR (per-handicap baselines so a typical H golfer scores ≈ 0 SG per category vs target H; targets no longer clamped at 28) lands first. Nothing here duplicates it; §3.2 lists what the coach *additionally* needs so priorities come out right.

History this builds on: `specs/2026-05-29-stats-coach-practice-plan-design.md` (coach-first tab, board groups, deterministic only), `specs/2026-07-15-sg-coach-improvements-design.md` + `plans/2026-07-15-coach-phase2.md` (five SG categories, drills with pass targets, committed focus + verdict, exactly five strategy rules, points framing), `plans/2026-07-21-coach-quiet-clubhouse-colors.md` (red is earned, never permanent; Fix first wears a gold badge on the card surface).

---

## 0. The coach as it is today (map)

### 0.1 What the app actually knows

**Per hole, from the scorecard** (`src/components/scorecard/constants.js` `DEFAULT_SHOT`, all nullable, grouped by the Settings → Stats tracking toggles):

| Group | Fields |
|---|---|
| putting | `putts`, `firstPuttBucket` `'0-1'|'1-2'|'2-3'|'3-6'|'6+'` (m) |
| teeShot | `drive` `'left'|'fairway'|'right'|'short'|'super'`, `teeClub` `'driver'|'wood'|'hybrid'|'iron'` (null = driver), `driveLie` `'fairway'|'rough'|'sand'|'trouble'`, `driveDistBucket` `'0-150'…'240+'` (m) |
| approach | `approachBucket` `'0-50'…'200+'` (m), `approachResult` `'green'|'miss'`, `approachMiss` `'long'|'short'|'left'|'right'`, `approachBunker`, `approachLie` `'fairway'|'rough'|'sand'` |
| shortGame | `sandShots`, `recoveryOutcome` `'up-and-down'|'sand-save'|'none'` |
| penalties | `teePenalties`, `otherPenalties` |

Plus strokes per hole, par, SI, playing handicap. **GPS shots** (`shotStore`: `{roundId, holeNumber, seq, lat, lng, club}`) give measured carries per club (`realClubDistances`). There is no per-shot contact quality, no shot shape, no lie for the putt, no practice log.

**Per swing analysis** (`swingStore` index row): `{ id, createdAt, name, club: 'iron'|'driver', status, fps, mainFault, counts: {green, yellow, red}, marked }`. `analysis.json` (read lazily with `readAnalysis(id)`) adds `main: { fault, phase, score, evidence[], drills[], consequences[] }` and the 15 `checks`. The profile holds `handedness` and `heightCm`. Faults: `posture, steep_backswing, flat_backswing, top_position, tempo_fast, tempo_slow, over_the_top, early_extension, head_sway, flip, balance` (+ `across_the_line`/`laid_off` as check directions, never main). The swing analyzer has its own drill catalogue (`src/swing/drills.js`, pass targets, one progression line) and a 60-minute range-session card (D24). Swings are Android-only (`getSwingAvailability()` → `'web'` / `'update'`).

### 0.2 The pipeline

`computeMyStats` (`personalStats.js`) → `baseStats` (SG season + per-round `byCategory`, `approachTarget` / `puttingTarget` with per-shot `breakdown[].sg`, `driveImpact`, `driveLies`, `teeClubAccuracy`, `approachMissByDistance`, `approachMissCost`, `upAndDown.byLie`, `sandSaves`, `bunkerVisits`, `shots` totals incl. tee/other penalties, `form.metrics` recent-vs-previous, `shotBenchmark` for the target handicap) → `buildCoachInsights(baseStats)` → `{ hero, board{fixFirst, keepDoing, gettingBetter, gettingWorse, nextGains, watch}, practicePlan[3] }` and `buildStrategyTips(baseStats)` (five rules). `coachFocus.js` stores one focus in AsyncStorage keyed by user, verdicts it after ≥2 rounds by re-finding `insight.id` and comparing `impact`. `coachDrills.js` picks a drill by `(area, bucket parsed from the insight title)`.

UI (`CoachTab.js`, top to bottom): `TargetBenchmarkRow` → `FocusCard` (if any) → `FormTrendCard` → `CoachHero` (fixFirst[0]) → `CoachBoard` (improve / protect / trends / monitor) → `PlaySmarterCard` → `PracticePlanCard` (practice first / secondary / on-course cue).

### 0.3 Why it earns the four complaints

1. **Wrong priorities.** The board pools cells with incomparable units: drive-direction buckets in *pts/hole vs your own average*, approach/putt buckets in *SG/shot* or *SG/putt*, categories in *SG/round*. `sortByImpact` orders by `priority` (action cells 0 before SG categories 1) → confidence → `|impact|`, so a −0.3 SG/shot approach bucket with 13 shots beats a −1.4 SG/round putting category. The same leak enters from three doors (the approach SG category, its worst distance bucket, and the "Greens in reg %" form delta) and de-duplication is by title only. Confidence is a raw count (`≤5` low, `≥12` high) with no notion of variance. The hero is `fixFirst[0]`. The baseline fix removes the systematic bias; it does not fix any of this.
2. **Generic.** Reasons are one template per source ("X is costing Y SG / round across N holes"). Drills are picked by area + bucket, so two golfers with opposite approach problems (always short vs always left) get the same "Green reps 125 m". The practice plan says "Spend the first block on … with a simple make-or-miss target".
3. **No training plan.** Three items, no minutes, no week, no progression, no re-plan.
4. **Ignores swing analysis.** Nothing in `src/store/coach*` reads `swingStore`; nothing in `src/swing` reads stats.

---

## 1. Goals and non-goals

**Goals**

- One ranked list of **leaks** in one currency (strokes per round vs the target handicap ≈ Stableford points), each with a sample-and-variance confidence, never double counted.
- For the top leak(s) a **diagnosis chain**: symptom → likely cause (pattern rules over the logged data, plus the swing analyzer when a relevant analysis exists) → prescription (cause-matched drills with numeric pass targets, an on-course task) → verification (the same metric, after N rounds).
- A **weekly training plan** sized to the minutes the golfer has, split range / short game / putting / on-course, with week-to-week progression and automatic re-planning when rounds arrive.
- **Copy that cites the golfer's own numbers** and the benchmark for the target handicap, in EN and ES.
- **Swing ↔ course link** through an explicit fault→symptom table, honest wording ("consistent with"), and a "record a swing" prompt when the course points at the swing.
- Thin screens: every new piece is a pure function in `src/store/` with Jest tests; `CoachTab`/`MyStatsScreen` only compose.

**Non-goals**

- No LLM, no server, no new network calls. Swing data never leaves the phone.
- No new per-hole data entry by default (§7 lists optional fields for the user to opt into).
- No change to SG maths, baselines, Stableford or handicap logic.
- No practice-session logging (listed as an option, §7).
- No sync of the focus/plan across devices (stays device-local like today).
- Strategy rules stay exactly the five of the 2026-07-15 spec; they gain a `causeId` so they appear inside the diagnosis, not a sixth rule.

---

## 2. Decisions carried forward

- Deterministic and explainable from visible stats (2026-05-29).
- 1 SG ≈ 1 Stableford point; every number the coach prices is "≈ X pts / round" (2026-07-15 §2.4).
- Focus is one at a time, device-local, verdicted by the same pipeline, refuses to judge under 2 rounds (2026-07-15 §2.2).
- Colour: card surface + info chrome for advice, Masters red only for "getting worse", gold badge marks "the work" (2026-07-21). Designs in §9 must not change colours or fonts.
- Store modules return message descriptors (`{key, params}` via `statsMsg.js`), rendered with `renderMsg`; drills keep stable ids with copy in the catalogues (`docs/i18n.md`).

---

## 3. Diagnosis chain

Vocabulary used below and in code:

```
Leak        { id: 'leak:<category>[:<bucket>]', category, bucket?, strokesPerRound,
              sample: { rounds, holes|shots }, se, confidence: 'high'|'medium'|'low'|'insufficient',
              evidence: {...numbers}, benchmark: {...} }
Cause       { id: 'cause:<...>', leakId, strength: 'likely'|'consistent'|'possible',
              evidence: {...numbers}, swing?: SwingLinkRef }
Prescription{ drills: DrillRef[], courseTask: {...}, strategyTipId? }
Verification{ metricKey, baselineValue, baselineSample, minRounds }
Diagnosis   { leaks: Leak[], top: Leak|null, tie: Leak|null, chains: Chain[] }
```

### 3.1 Step 1 — Symptoms: candidate leaks in one currency

**New module `src/store/coachDiagnosis.js`**, pure, input `baseStats` (what `buildCoachInsights` already receives).

**Leak tree.** Leaks live at two levels and a child never competes with its parent:

| Category (SG) | Children (buckets) | Strokes/round of a child |
|---|---|---|
| `putting` | first-putt buckets `0-1 … 6+` | `bucket.sgPerPutt × bucket.attempts / roundsByCategory.putting` |
| `approach` | distance buckets `0-50 … 200+` | `bucket.avgSg × bucket.holes / roundsByCategory.approach` |
| `offTheTee` | by tee club (`teeClubAccuracy.byClub`), by lie (`driveLies`), by direction (`driveImpact.buckets`) — *evidence only, not ranked leaks* | — |
| `aroundGreen` | `sand` vs `nonSand` (`upAndDown.byLie`, `sandSaves`) — *evidence only* | — |
| `penalties` | `tee` vs `other` (`shots.teePenalties`/`otherPenalties`) — *evidence only* | — |

Ranking happens **at category level** using `strokesGained.byCategory[c]` (already per round, already vs target). Children explain *where inside* the category the loss sits; the worst child becomes the leak's `bucket` so copy, drills and verification can be specific. This is what stops the approach category, its 150-200 bucket and the GIR trend from appearing as three leaks. Drive-direction buckets measured in *pts/hole vs your own average* stay out of the ranking altogether (different baseline); they are cause evidence (§3.2).

**Confidence from sample and variance** (new, cheap, deterministic):

- Category: per-round values exist in `strokesGained.perRound[].byCategory[c]`. `mean`, `sd`, `se = sd/√n` over the rounds that sampled the category. Bucket: per-shot `sg` in `approachTarget.buckets[b].breakdown[]` / `puttingTarget.buckets[b].breakdown[]`.
- `insufficient` when holes < 10 (category; reuse `SG_SEASON_MIN_SAMPLE`-style gate) or shots < 8 (bucket) or rounds < 3 → rendered as "needs N more holes/rounds", never ranked.
- `high` when `|mean| ≥ 2·se`, `medium` when `≥ 1·se`, `low` otherwise. Thresholds are constants in the module; tests pin them.

**What is a leak.** `strokesPerRound ≤ −LEAK_MIN` (proposed 0.4) and confidence ≥ `low`. Below that the coach says so instead of inventing one ("Nothing clearly costs you yet; the biggest candidate is X at −0.3, from 11 holes").

**Order.** By `strokesPerRound` ascending (most negative first); tie-break by confidence; then by a fixed *trainability* order (putting > aroundGreen > approach > penalties > offTheTee — cheaper to move first). **Two close leaks:** when the top two are within `max(0.3, se₁ + se₂)` the diagnosis sets `tie` and the UI shows both with a one-line "these are too close to call; the plan splits the week"; the focus button offers both.

**What the coach additionally needs beyond the baseline fix (checklist):**
- one currency (strokes/round vs target) for everything ranked; sub-bucket and per-hole-vs-own-average numbers are evidence, never rank entries;
- variance-aware confidence (above) instead of count thresholds;
- parent/child de-duplication by construction (the tree), not by title string;
- a leak floor so a −0.1 category is never "Fix first";
- form deltas (recent vs previous) stay trends, not leaks; they modulate copy ("and it's getting worse lately") but never ranking;
- penalties keep the existing guard (a small persistent penalty cost does not outrank a bigger leak) — it falls out of the new ordering automatically;
- stable ids (`leak:approach:150-200`) so focus, plan and verdict survive copy changes.

### 3.2 Step 2 — Likely cause: pattern rules over the logged data

**New module `src/store/coachCauses.js`**: a table of rules `(leak, stats) → Cause|null`, run per leak, each rule with its own minimum sample. The strongest rule wins (`likely` > `consistent` > `possible`; then by evidence size); a second cause is kept as `alsoPossible` for copy. Benchmarks come from `shotBenchmarkForHandicap(targetHandicap)` where a row exists, otherwise from the golfer's own other buckets, and the copy says which.

| Leak | Rule (min sample) | Cause id | Evidence in copy |
|---|---|---|---|
| putting (6+ or 3-6 worst) | 3-putt rate from that bucket ≥ 25 % and `sgPerPutt < 0` (≥10 putts) | `cause:putting:lag` | "You average 2.5 putts from 6 m+ (31 % three-putts, 18 of 58); a 15 takes about 2.2" — expected from `expectedFromBucket('firstPutt', b, target)` |
| putting (0-1 / 1-2 / 2-3 worst) | `sgPerPutt < 0` there (≥10 putts) | `cause:putting:short` | "From 1-2 m you hole 71 % (17 of 24); the target is ~85 %" |
| putting (no bucket stands out) | `puttsPerRound` and `threePuttsPerRound` vs benchmark | `cause:putting:general` | benchmark row exists (32.1 / 3.8 at 15) |
| approach (bucket b) | `approachMissByDistance.buckets[b].shortRate ≥ 50` of known misses, misses ≥ 8 | `cause:approach:short` | "From 100-150 m you miss 64 % of greens, and 7 of every 10 misses are short" |
| approach | `leftRate` or `rightRate ≥ 50` (misses ≥ 8) | `cause:approach:side:left|right` | side + the cost from `approachMissCost.byFinish[side].avgPoints` vs `green` |
| approach | `bunkerRate ≥ 30` (misses ≥ 8) and `upAndDown.byLie.sand.rate` low | `cause:approach:bunker` | links to the avoid-sand strategy tip |
| approach | none of the above | `cause:approach:distance` | "Your 150-200 m shots cost 0.6 strokes each vs a 15; your 50-100 m shots gain 0.1" (own buckets) |
| offTheTee | `teeClubAccuracy.byClub.driver.penaltyPct ≥ 10` or `driveLies.troubleRate ≥ 0.25` (≥15 drives) | `cause:tee:trouble:driver` | "Driver finds sand or trouble on 28 % of holes (9 of 32)" — ties to the club-down rule |
| offTheTee | dominant miss side (`driveImpact.buckets.left/right`, ≥2× the other, ≥10 misses) | `cause:tee:side:left|right` | "11 of 15 misses go left, costing 0.8 pts/hole vs a fairway" — ties to the miss-side rule; benchmark `leftMissPct`/`rightMissPct` |
| offTheTee | `driveDistance.avgDistance` ≥ 20 m under `benchmarkDriveDistance(target)` (≥15 drives) and lies fine | `cause:tee:distance` | distance vs benchmark (note: `shotBenchmark.driverDistance` is in yards from Shot Scope — use `benchmarkDriveDistance` from `strokesGainedBaseline.js`, which is metres) |
| aroundGreen | `upAndDown.byLie.sand.rate ≤ nonSand.rate − 0.2` (≥6 each) | `cause:short:sand` | "28 % from sand vs 52 % from grass" |
| aroundGreen | `upAndDown.rate` below target expectation (≥6) | `cause:short:chip` | own rate vs the SG table's greenside expectation |
| penalties | `shots.teePenalties ≥ 2× otherPenalties` | `cause:penalty:tee` | "9 of your 12 penalties come off the tee" |
| penalties | otherwise | `cause:penalty:other` | — |

Round-shape signals (closing 3, back nine, bounce-back, doubles) stay **watch** items with the existing copy; they are not causes of an SG leak.

**Honest wording.** A `likely` cause reads "most of this comes from …"; `consistent` reads "this is consistent with …"; `possible` reads "one possibility: …". Every cause sentence carries its counts in parentheses. When the benchmark is missing the sentence is a separate key without the comparison (two keys per sentence, per `docs/i18n.md`).

### 3.3 Step 3 — Prescription

**Drills.** `coachDrills.js` keeps its catalogue and ids and gains additive fields per drill: `causes: ['cause:putting:lag', …]`, `minutes` (10–25), `levels: [{ passTarget }, { passTarget }, { passTarget }]` (level 1 is today's `passTarget`; 2 and 3 tighten it — "7 of 10 inside 1 m" → "8 of 10" → "8 of 10 from 10 m"), `kind: 'range'|'shortGame'|'putting'|'course'` (replaces the loose `location`). `drillsForCause(causeId)` → cause-matched first, then today's area+bucket order (`drillsForInsight` stays for backward compatibility). New drills only where a cause has none today (≈6): `appr-club-up-back-half` (approach:short), `appr-start-line-gate` (approach:side), `tee-shape-window` (tee:side), `putt-short-circle-80pct` (putting:short), `sg-chip-landing-ladder` (short:chip), `pen-provisional-plan` (penalty:other). Copy for new drills goes in `locales/*/myStats.js` under `stats.my.drill.<id>.*` like the existing ones.

**On-course task.** Each cause maps to one task for the next round with a countable target and a logging ask that sharpens the diagnosis, e.g. `cause:approach:short` → "Take one more club on every approach over 120 m; log the miss direction on every green you miss" (target: short misses ≤ 30 %). This is the `course` session of the weekly plan (§4), not a sixth strategy rule.

**Strategy tips.** The five rules in `coachStrategy.js` gain `causeId` (`layup-150-200` → `cause:approach:distance`, `tee-club-down` → `cause:tee:trouble:driver`, `lag-first-6plus` → `cause:putting:lag`, `tee-miss-side` → `cause:tee:side:*`, `avoid-short-side-sand` → `cause:approach:bunker` / `cause:short:sand`). A tip whose cause is the top leak's cause renders *inside* the diagnosis chain; the rest stay in Play smarter.

**Copy.** The chain's sentences are descriptors built in the store with `n()` numbers and nested descriptors, e.g.
`msg('stats.my.coach.chain.symptom.putting', { strokes: n(1.4), bucket: msg('stats.my.label.puttBucket', {bucket:'6+'}), rounds: 12 })` → EN "Putting costs you about 1.4 strokes a round against a 15, mostly from 6 m+ (12 rounds)." / ES "El putt te cuesta unos 1,4 golpes por vuelta frente a un 15, sobre todo desde 6 m+ (12 vueltas)." Spanish golf terms follow the glossary in `docs/i18n.md`.

### 3.4 Step 4 — Verification

**New module `src/store/coachMetrics.js`**: a registry `METRICS[key] = { polarity, unit, read(stats) → { value, sample } }` for every metric a leak or cause can be verified by: `sg.<category>`, `sg.putting.bucket.<b>` (sgPerPutt), `sg.approach.bucket.<b>` (avgSg), `putting.threePuttRate.<b>`, `approach.shortRate.<b>`, `tee.troubleRate`, `tee.penaltyPct.driver`, `tee.missSideShare.<side>`, `short.upDownRate.sand`, `penalties.perRound.tee`, … Every leak and cause names its `metricKey`, so the verdict re-reads *the number that triggered it*.

**`coachFocus.js` v2.** `makeFocusCommit(chain, stats)` stores `{ v: 2, leakId, causeId, metricKey, baselineValue, baselineSample, baselineSe, committedAt, roundCountAtCommit, swingId? }`. `focusVerdict(focus, stats)`: `needs-more-rounds` under 2 rounds (unchanged); otherwise `delta` in the metric's polarity, `improving` when `delta ≥ max(0.25 strokes, baselineSe)` (metrics in rates: `≥ 10 points`), `worse` symmetric, else `flat`; `early: true` until 4 rounds so the UI can say "early read". `resolved` when the metric no longer has a sample. **Migration:** a v1 focus (has `insightId`, no `leakId`) is archived on load with `finalState: 'resolved'` and the UI shows "Your old focus was closed; pick a new one" once — simplest, no dual code path (decision §11).

The `metricKey` is also what the weekly plan progresses on (§4.3).

---

## 4. Weekly training plan

**New module `src/store/coachWeeklyPlan.js`**, pure:

```
buildWeeklyPlan({ diagnosis, focus, focusVerdict, swingLink, minutesPerWeek, roundsSinceCommit, today })
→ { minutes, level, weekLabel, sessions: Session[], courseTask, split: {range, shortGame, putting, course},
    reasons: { replanned: 'newRounds'|'focusChanged'|'tie'|null } }
Session { id, kind: 'range'|'shortGame'|'putting'|'course', minutes, title, why,
          drills: [{ drillId, level, passTarget, minutes }] }
```

### 4.1 Sizing to time available

`minutesPerWeek` comes from a new setting (§7) with default **60**; the card shows a four-way picker 30 / 60 / 90 / 120 that writes the setting (decision §11). Minutes below 30 produce a single session; a session is 15–45 min; the plan never exceeds the budget by more than 5 min and never has more than 4 sessions.

### 4.2 Allocation (deterministic)

Blocks, in order, each taking a share of the budget:

1. **Focus block** — the committed focus (or the top leak when none): 55 % of minutes, cause-matched drill(s) at the current level, in the kind that matches the leak's area (putting → green; approach / offTheTee → range; aroundGreen → short game; penalties → course).
2. **Second block** — the second leak (or the tie partner, 45/45 when `tie`): 25 %.
3. **Keep block** — 10 %: the strongest `keepDoing` category's generic drill ("don't let it slide"); replaced by the **swing block** when a swing fault is linked (§5): the swing's first `drillsForMain` drill with its pass target and the swing progression line.
4. **Course block** — the on-course task for the next round (0 minutes in the budget, always present) plus the logging ask when the diagnosis is `insufficient` or a cause has only `possible` evidence ("log approach misses for 2 more rounds").

Blocks are then packed into sessions by kind (range / short game / putting / course) so the golfer sees "Range · 35 min · 2 drills" rather than a flat list. Sparse data: with no leaks the plan is one "collect" session (a mixed ladder) plus the logging ask.

### 4.3 Progression

Driven by rounds, not the clock, so it stays pure and honest about not seeing practice: `level = clamp(1 + floor(roundsSinceCommit / 2), 1, 3)`; a `worse` verdict holds the level (it never drops below 1); `improving` at level 3 adds "ready to move on — end this focus" to the card. `weekLabel` ("Week 3 of your putting focus") is computed from `today − committedAt` purely for display, and `today` is an input (tests pin it). Decision §11: rounds-driven (recommended) vs calendar-driven.

### 4.4 Re-planning

The plan is a pure function of its inputs, so it re-plans whenever `stats` change (new round, target change). Stability rule: while a focus is committed the focus block does not move even if the ranking changes; the second block follows the ranking. With no focus the plan follows the top leak and the card says "re-planned after your round at X" when the top leak changed (`reasons.replanned`).

### 4.5 Tests (Jest, `src/store/__tests__/coachWeeklyPlan.test.js`)

Session minutes sum to budget ± 5 for 30/60/90/120; focus block ≥ 50 % unless tie; tie splits 45/45; swing block replaces keep block when linked; level 1/2/3 by rounds; `worse` holds level; no leaks → collect session; same inputs → identical output (determinism snapshot).

---

## 5. Swing link

**New module `src/store/coachSwingLink.js`**, pure: `buildSwingLink({ diagnosis, swings, profile, today })`. Inputs are `getSwings()` rows (`status === 'ready'`), `getSwingProfile().handedness`, and the diagnosis. `MyStatsScreen` subscribes with `useSyncExternalStore(subscribeSwings, getSwingsVersion)` and passes the rows down; on web the rows are empty and `getSwingAvailability()` says `'web'`.

### 5.1 Fault → on-course symptom table (right-hander; mirror `left|right` for `handedness === 'left'`)

| Main fault | Consistent with (cause ids) | Club relevance |
|---|---|---|
| `over_the_top` | `tee:side:right` (slice), `tee:side:left` (pull), `tee:trouble:driver`, `approach:side:left`, `approach:side:right` | driver → tee causes; iron → approach causes |
| `steep_backswing`, `top_position` | `tee:side:right`, `approach:side:right`, `approach:short` (steep contact) | both |
| `flat_backswing` | `tee:side:left` (hook), `approach:side:left` | both |
| `early_extension` | `approach:short`, `approach:distance` (thin/fat), `short:chip`, `tee:side:right` (block) | both |
| `flip` | `approach:short`, `approach:distance`, `short:chip` | iron |
| `head_sway` | `approach:short`, `approach:distance`, `tee:side:*` | both |
| `posture` | `approach:short`, `tee:distance`, `approach:distance` | both |
| `tempo_fast` | `tee:trouble:driver`, `tee:side:*`, `penalty:tee` | driver first, iron allowed |
| `tempo_slow` | `tee:distance` | driver |
| `balance` | `tee:side:*`, `tee:distance` | driver first |

`consequences` strengthen the link (a consequence that matches the cause counts as a second signal). The link's `strength` is `consistent` when the main fault matches the top cause with the right club, `possible` when it matches with the other club or only via a consequence; never `likely` — the analyzer sees one swing on a mat, not the round.

### 5.2 States

| State | When | What the coach says / does |
|---|---|---|
| `linked` | a `ready` swing ≤ 60 days old whose fault row lists the top cause and whose club fits | "Your driver swing from 4 Oct: main fault *over the top*, which is consistent with the left miss (11 of 15). Its first drill joins this week's range session." Link to `SwingResults`. |
| `stale` | newest fitting swing > 60 days | Same sentence prefixed "from 4 Jul (old)" + "Record a new driver swing". |
| `wrongClub` | the only recent swing is the other club and the cause is club-specific | "Your last analysis was a 7-iron; this leak is off the tee. Record a driver swing." |
| `none` | no swing, cause is in the table | "This often starts in the swing — record a driver swing and the coach will check." CTA to `SwingHome` (Android with `supported`); on web / `'update'` a plain line "available on the phone / needs an app update". |
| `notSwing` | cause not in the table (lag putting, penalties:other, …) | Nothing shown; no CTA. |
| `swingOnly` | a recent swing with a main fault but no matching leak | one watch row: "Your swing analysis flags *early extension*; nothing on the course points at it yet — keep logging approach misses." |

### 5.3 Data access

Everything needed is in the index row except `consequences` and the analysis-time `handedness`. Add both to the row in `saveAnalysis` (`consequences: analysis.main?.consequences ?? []`, `handedness`) — additive; rows saved earlier read as `[]` / profile handedness. No lazy `readAnalysis` from the stats path.

---

## 6. Keep, change, remove

| Piece | Verdict |
|---|---|
| `coachInsights.js` `buildCoachInsights` | **Change:** becomes an adapter. `board.fixFirst` / `nextGains` come from `diagnosis.leaks` (top leak(s) → fixFirst, remaining leaks → nextGains), `keepDoing` from positive categories, `gettingBetter`/`gettingWorse` unchanged from `form.metrics`, `watch` keeps round shape + `insufficient` leaks + `swingOnly`. Insight ids become the leak ids. `practicePlan` is removed from its output (the weekly plan replaces it); `hero` = top leak's insight. |
| `coachDrills.js` | **Keep + extend** (cause tags, minutes, levels, kind). `drillsForInsight` stays. |
| `coachStrategy.js` | **Keep** the five rules; add `causeId`. |
| `coachFocus.js` | **Change** to v2 schema and metric-registry verdicts; storage adapters and history unchanged; v1 archive on load. |
| `personalStats.computeMyStats` | **Change:** also returns `coachDiagnosis` (and keeps `coach`, `coachStrategy`). Swing link and weekly plan are *not* computed here (they need swings/settings/today) — `MyStatsScreen` memoises them from `stats` + those inputs. |
| `CoachTab.js` | **Change** order (after the design pick): `TargetBenchmarkRow` → `FocusCard` (now with chain verdict + level) → **`DiagnosisCard`** (new: symptom → cause → evidence → swing line → fix) → **`WeeklyPlanCard`** (new) → `FormTrendCard` → `CoachBoard` → `PlaySmarterCard` (tips not already shown in the chain). Still composition only. |
| `CoachHero` | **Keep** as the symptom header inside `DiagnosisCard` (same surface rules) or standalone, per design. |
| `PracticePlanCard`, `ROLE_LABELS`, `stats.my.practice.*` keys | **Remove** once `WeeklyPlanCard` ships (same PR; drop the keys from both catalogues; `CoachBoard`'s practice pill becomes a "this week" pill fed by the plan's drill ids). |
| `FocusCard` | **Change:** verdict copy adds "early read" and before → after in the metric's unit; drill comes from the plan's focus block, not `drillsForInsight({area,title})`. |
| `MyStatsScreen` | **Change:** subscribe to swings + settings, compute `swingLink`/`weeklyPlan` with `useMemo`, pass `today` (one `new Date()` at render), handlers for the minutes picker and "record a swing" navigation. |
| `statExplainers.js` | **Add** `coachDiagnosis` (how leaks are priced and gated), `weeklyPlan` (allocation and levels), `swingLink` (what "consistent with" means). |

---

## 7. Data model

- **Zero new per-hole fields by default.**
- `settingsStore` `DEFAULT_APP_SETTINGS.practiceMinutesPerWeek: 60` (synced via `profiles.settings` like every setting; old blobs read the default).
- `swingStore` index row: `consequences`, `handedness` (additive, §5.3).
- Focus v2 record (§3.4); history entries keep the old shape plus `v`.
- **Options for the user, not defaults** (each would sharpen one link; each is one tap on the scorecard):
  - (a) *Approach contact* `'good'|'thin'|'fat'` — would turn `early_extension`/`flip` ↔ `approach:short` from "consistent with" into measured evidence.
  - (b) *Tee miss shape* `'slice'|'hook'|'straight'` on a missed drive — would separate `over_the_top` (slice) from `flat_backswing` (hook) on the course side.
  - (c) *Practice log* (did the session, passed / failed) — would make progression real instead of rounds-driven and let the verdict say "you practised 3 of 4 weeks".

---

## 8. i18n

- New area module `locales/{en,es}/coach.js` (plus the import, spread and `AREAS` entries in both index files), keys `stats.my.coach.chain.*`, `stats.my.coach.cause.*`, `stats.my.coach.plan.*`, `stats.my.coach.swing.*`, `stats.my.coach.verdict.*`. New drill copy stays in `myStats.js` under `stats.my.drill.<id>.*` where the existing drills live (one module per key).
- Every sentence with a benchmark has a sibling key without it. Counts use `{ one, other }` plurals. Numbers travel as `n()` params and are formatted at render. Spanish uses the glossary (`docs/i18n.md`): *putt*, *green*, *calle*, *búnker*, *aproximación* (approach), *golpes* for strokes, *vuelta* for round, *hándicap*.
- A Jest test in the catalogue suite already enforces key parity and placeholder parity; a new `MyStatsSpanish`-style test renders the Coach tab in ES with a fixture diagnosis.

---

## 9. Design brief (step 2 of the process — three UI options for the Coach tab)

**Produce three mock directions, A / B / C, for the Coach tab only.** Colours and fonts are fixed (DESIGN.md tokens; the quiet-clubhouse rules: card surface + info chrome for advice, gold badge for "the work", Masters red only for "getting worse"); C may break layout and interaction, never colours or fonts. Phone width first (360–430 px), dark mode, web and Android (the swing CTA exists only on Android; web shows the "on the phone" line). No colour-only meaning; evidence chips stay text.

**Content every option must carry, in some order:** target row · committed focus with verdict (state, before → after, level, "end focus") · the diagnosis chain for the top leak (symptom with strokes/round + confidence chip → cause sentence with counts and benchmark → swing line (one of the six states) → fix: drills with pass targets + the on-course task + the matching strategy tip) · the weekly plan (minutes picker 30/60/90/120, sessions by kind with minutes and drills, level, "re-planned after your round" note) · current form · the board (improve / protect / trends / monitor) · remaining Play smarter tips.

**Screens / states to show in each option:**
1. **No data** — zero rounds (existing empty state) and "rounds but no shot detail" (plan = collect session + logging ask).
2. **Few rounds** — 2 rounds, every leak `insufficient` ("needs 5 more holes"), no focus button.
3. **One clear leak** — putting 6 m+, high confidence, cause `putting:lag`, focus not yet committed.
4. **Two close leaks** — approach 150-200 vs off the tee, `tie`, plan split 45/45, both focus buttons.
5. **Focus in progress with verdict** — approach:short, 3 rounds in, `improving` (early read), level 2, before → after.
6. **Swing fault linked** — tee:side:left + driver swing `over_the_top` from 4 Oct, swing drill in the range session.
7. **No swing analysis** — same leak as 6, state `none` (Android CTA) and the web variant.
(Plus: `stale` / `wrongClub` as small variants of 6, and dark mode for 3 and 6.)

**A — fits in.** Same tab, same cards, same order as today except `PracticePlanCard` → `WeeklyPlanCard` and `CoachHero` grows a cause line and a swing line. Minimal motion.
**B — better.** `DiagnosisCard` as a vertical chain with four labelled steps (Leak → Why → Fix → Check) and evidence chips; `WeeklyPlanCard` as session tiles with a minutes picker in the header; the board collapses to "more findings".
**C — bold.** A "this week" front: one screen = one leak, chain on the left, sessions as a horizontal pager, swipe to the second leak / tie partner, sticky focus bar with the verdict; the board and tips behind a "everything else" disclosure. May restructure the tab's scroll and interaction; keeps the tokens.

Deliverable for step 2: the three directions rendered for the states above (static HTML mock like `docs/superpowers/mockups/stats-ui-versions.html` is fine), then wait for the pick.

---

## 10. Build items

Model tiers per `~/.claude-work/CLAUDE.md` routing. Every store item: pure function, Jest tests beside the existing suites (`src/store/__tests__/`), `npm test` + `npm run lint` green. Items 1–9 are UI-independent and can start before the design pick; 10–12 after it. One concern per PR; `Closes #N` on the issue for each item.

| # | Item | Files | Tier | Tests | Depends on |
|---|---|---|---|---|---|
| 0 | Baseline recalibration PR merged (separate, prerequisite) | — | — | — | — |
| 1 | `coachMetrics.js` registry (`METRICS`, `readMetric(key, stats)`) | new store + test | **Sonnet** | every key reads the fixture value and sample; unknown key → null | 0 |
| 2 | `coachDiagnosis.js`: leak tree, strokes/round per child, se-based confidence, floor, ordering, tie | new store + test | **Opus** (ranking correctness is the whole complaint 1) | category beats its own bucket; bucket named on the leak; −0.3 SG/shot × 8 shots does not outrank −1.4 SG/round; `insufficient` under gates; tie within `max(0.3, se₁+se₂)`; trainability tiebreak; determinism | 1 |
| 3 | `coachCauses.js`: the §3.2 rule table + benchmark lookups + descriptors | new store + test | **Sonnet** | one test per rule (fires / suppressed under min sample); strongest wins; `alsoPossible`; benchmark vs no-benchmark key | 2 |
| 4 | `coachDrills.js` extension (cause tags, minutes, levels, kind, 6 new drills) + EN/ES drill copy | store, `locales/*/myStats.js`, test | **Haiku** | `drillsForCause` order; every drill has 3 levels and a kind; catalogue parity test passes | 3 |
| 5 | `coachStrategy.js` `causeId` on the five rules | store + test | **Haiku** | each tip carries the expected `causeId`; no rule logic change | 3 |
| 6 | `coachSwingLink.js` + `swingStore` index additions (`consequences`, `handedness`) | new store, `swingStore.js`, tests | **Sonnet** | six states; club relevance; left-hander mirror; 60-day staleness with pinned `today`; consequence as second signal; old rows without `consequences` | 2, 3 |
| 7 | `coachWeeklyPlan.js` | new store + test | **Sonnet** | §4.5 list | 3, 4, 6 |
| 8 | `coachFocus.js` v2: commit from chain, metric-registry verdict, `early`, v1 archive-on-load | store + test | **Opus** (persistence migration, verdict semantics) | v2 commit shape; verdict by polarity and se; `early` until 4; `resolved`; v1 record archived once; history keeps both shapes | 1, 2 |
| 9 | `buildCoachInsights` adapter over the diagnosis; `computeMyStats` returns `coachDiagnosis`; `settingsStore.practiceMinutesPerWeek` | `coachInsights.js`, `personalStats.js`, `settingsStore.js`, tests | **Sonnet** | board groups from leaks; ids = leak ids; `practicePlan` gone; existing `coachInsights.test.js` updated, `personalStats.test.js` extended; settings default + merge | 2, 3 |
| 10 | UI per the picked design: `DiagnosisCard`, `WeeklyPlanCard`, `FocusCard` v2, `CoachTab` composition, `MyStatsScreen` plumbing (swings subscription, settings, `today`, swing navigation), remove `PracticePlanCard` + keys, `CoachBoard` pill | `src/components/mystats/*`, `tabs/CoachTab.js`, `screens/MyStatsScreen.js`, `statExplainers.js` | **Sonnet** (Opus only if the pick is C) | component tests for the seven §9 states (`__tests__/DiagnosisCard.test.js`, `WeeklyPlanCard.test.js`, `CoachTab.test.js`, `FocusCard.test.js`); `MyStatsScreen.test.js` keeps tab order and the legacy `overview` mapping; `MyStatsSpanish.test.js` renders the chain in ES; `StatsScreen.test.js` untouched | 7, 8, 9 + design pick |
| 11 | EN/ES catalogue module `coach.js` (all chain / cause / plan / swing / verdict keys) + explainers copy | `locales/{en,es}/coach.js`, index files, `statExplainers` locale | **Haiku** | catalogue parity + placeholder tests; explainer keys resolve | 3, 6, 7 (keys known) |
| 12 | Docs: `docs/superpowers/specs/2026-10-16-coach-v2-design.md` + plan copied from this file; `CLAUDE.md` architecture note (one paragraph on the coach modules); `docs/i18n.md` area list | docs | **Haiku** | — | 10 |

**Verify (per the `deliver` skill, after 10):**
1. `npm test` (all ~2.4k) and `npm run lint`.
2. Web walkthrough with the project `verify` skill (`npx expo start --web --port 8090`, Playwright MCP; mint a throwaway account — never the real one on :8090/:8091, see memory): seed rounds with shot detail through the scorecard (putts + first-putt bucket, approach bucket + miss direction) until a leak clears the floor; check states 1–5 and the web variant of 7; commit a focus, add two rounds, check the verdict and the level; change the minutes picker and confirm the sessions re-pack; switch to ES and check the chain sentences; dark mode.
3. Android: states 6/7 need a phone with a swing analysis — `GOLF_ANDROID_BUILD_ARCHS=arm64-v8a npx eas-cli update --branch preview` after `fingerprint:compare` (JS-only change; the `swingStore` index edit is JS). Check the swing CTA opens `SwingHome`, the linked line opens `SwingResults`.
4. Review of items 2 and 8 at top tier regardless of who implemented them.

---

## 11. Open decisions for the user

1. **Practice time preference** — add `practiceMinutesPerWeek` (default 60) as a synced setting with a 30/60/90/120 picker on the plan card (recommended), or a Settings-only row, or no preference (fixed 60)?
2. **Progression driver** — rounds-played since commit (recommended: pure, honest about unseen practice) or calendar weeks?
3. **Leak floor and tie band** — proposed `LEAK_MIN = 0.4` strokes/round and tie within `max(0.3, se₁+se₂)`; OK as starting constants (tests pin them, tunable later)?
4. **Old focus migration** — archive any v1 focus as `resolved` on first load with a one-time notice (recommended) vs keep a v1 verdict path alive?
5. **Swing staleness** — 60 days? And should a swing older than the oldest round in the stats window also count as stale?
6. **Trainability tiebreak order** — putting > around green > approach > penalties > off the tee; agree?
7. **Optional new scorecard fields** (§7): none (default), or opt into (a) approach contact, (b) tee miss shape, (c) a practice log? Each is one tap and its own small PR.
8. **Remove `PracticePlanCard`** entirely (recommended) or keep it as a collapsed "quick list" under the weekly plan?
9. **Design pick** after step 2: A / B / C.

---

## 12. Decisions taken (2026-10-16)

Owner's picks, then the answers to the rough edges found while drawing the designs (mock: claude.ai/artifact/XYKHcNsRuUdyjzYx1rswZH). These override anything above.

**Design: B**, plus two touches from C: the "Re-planned after your round at {course} ({date}): {what changed}" note under the plan, and the tie treatment (header "Two leaks too close to call", both chains in the card, two equal outline focus buttons, plan split 45 / 45).

**§11 answers:** 1 `practiceMinutesPerWeek` synced setting, default 60, picker 30/60/90/120 in the plan card header · 2 progression by rounds since commit · 3 `LEAK_MIN = 0.4`, tie within `max(0.3, se₁+se₂)` · 4 archive a v1 focus as `resolved` on first load, with a one-time notice · 5 swing stale after 60 days (a swing older than the oldest round in the window is *not* extra-stale; 60 days is the only rule) · 6 trainability order putting > around green > approach > penalties > off the tee · 7 no new scorecard fields in this PR; "approach contact" is a later, separate PR · 8 `PracticePlanCard` removed.

**Rough edges, resolved:**
1. **Card order (B):** target row → focus card (only when a focus exists) → DiagnosisCard → WeeklyPlanCard → Current form → board collapsed as "More findings" (counts visible) → Play smarter (tips not already shown inside the chain).
2. **Small blocks:** a block shorter than its drill's minimum minutes (10) folds into the session of the same kind, else into the focus session; nothing renders under 10 min. At 30 min the week is one session (focus block) + the on-course task.
3. **No calendar week label.** Progress reads "Level N of 3 · K rounds in · since {commit date}".
4. **One benchmark per place:** the Why sentence cites the cause's own benchmark (e.g. expected putts from 6 m+ for a 15); the Check step cites the verdict metric's benchmark (e.g. three-putt rate from 6 m+).
5. **Colours follow the code:** CoachHero today is the card surface + info chrome + gold "Fix first" badge; the 2026-07-21 plan's green surface is superseded.
6. **Re-planned note** appears whenever the latest round changed the plan (focus or not) and names what changed; nothing when the plan is unchanged.
7. **Focus card only exists with a focus;** states without one show the focus button(s) in the DiagnosisCard.

**Delivery:** one branch `feat/coach-v2`, one commit per build item (§10), one PR — the UI and the stores change together because removing `practicePlan` breaks `PracticePlanCard`.
