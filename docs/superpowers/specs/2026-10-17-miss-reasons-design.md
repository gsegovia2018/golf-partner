# Miss reasons — capturing *why* a shot missed (sub-project A)

**Date:** 2026-10-17
**Status:** Design approved in brainstorming (2026-10-17); awaiting spec review
**Scope:** Scorecard hole-detail capture (`src/components/scorecard/`), the per-hole shot-detail record (`DEFAULT_SHOT`), Settings → Stats tracking, and the coach stores (`src/store/coach*.js`, new `src/store/missReasons.js`). JS only, OTA. No migration (details live in `game_shot_details.detail` jsonb). No LLM, no network.
**Mockups:** `2026-10-17-miss-reasons/why-sheet-designs.html` (design **1** chosen), `2026-10-17-miss-reasons/push-or-slice.html` (the start/finish logic).

---

## 1. Problem

The scorecard records **outcomes only**: where the drive finished, the approach bucket, green hit or missed, which side, the lie, putts, up-and-down. The coach therefore sees "approach 100–150 m, missed right" and cannot tell apart five causes that need opposite advice:

| Cause | What the coach should say |
|---|---|
| Started right, flew straight (push) | Face at impact / aim — a start-line drill |
| Started on line, curved right (slice) | Face open to path — a path drill + swing analyzer |
| Ball below the feet | Physics, not a fault — "aim left on these lies" |
| Punched under a branch | Not this shot's fault — bill the drive that put you there |
| Wrong club / went for it | A decision — course management, not practice |

Lumped together they become "you miss right, practise approaches".

Constraint from the user: **no 100 metrics per hole.** A normal hole costs zero extra taps; a miss costs about two; everything is skippable.

## 2. The program (four sub-projects) — this spec is A

| # | Sub-project | Depends on |
|---|---|---|
| **A** | **Vocabulary + "Why?" sheet (two-tap tracer) + coach rules reading it** | — |
| B | Trouble button: one tap on the live hole header *before* a forced shot | A's vocabulary |
| C | Coach asks: one adaptive question card leaving a hole, likely answers first, per-round question budget | A, B |
| D | GPS inference: stops in the background-GPS trail → ball positions → trees/bunker proposal. Starts with a spike (persist trails for a few real rounds, measure stop-detection accuracy, OSM tree coverage, battery) | C |

Each gets its own spec → plan → PRs. B, C and D are out of scope here except where A must leave room for them (§8).

## 3. Vocabulary (the data model)

New optional keys on `DEFAULT_SHOT` (`src/components/scorecard/constants.js`). All default to `null` / `[]`; **empty means "not answered", never "no reason"**.

| Key | Values | Asked when |
|---|---|---|
| `driveStart` | `'left' \| 'center' \| 'right'` | `drive` is `left` or `right` |
| `driveContact` | `'top' \| 'sky' \| 'toe' \| 'heel'` | `drive` is `left`, `right` or `short` |
| `driveSituation` | array of `'wind' \| 'decision'` | same |
| `approachStart` | `'left' \| 'center' \| 'right'` | `approachResult === 'miss'` |
| `approachContact` | `'fat' \| 'thin' \| 'toe' \| 'shank'` | same |
| `approachSituation` | array of `'above-feet' \| 'below-feet' \| 'uphill' \| 'downhill' \| 'blocked' \| 'bad-lie' \| 'wind' \| 'decision'` | same |
| `shortResult` | `'short' \| 'long'` | up-and-down failed (§4.1) |
| `shortContact` | `'fat' \| 'thin'` | same |
| `shortSituation` | array of `'bad-lie' \| 'short-sided' \| 'wrong-shot'` | same |

Rules:

- **Directions are absolute** (left/right of the target from the golfer's view), never "slice"/"hook". Names are derived at display time with the swing profile's `handedness` (default right), read through a new cheap `hydrateSwingProfile()` (profile key only, never the swing index) since the profile is otherwise hydrated only by the Swing screens.
- `DEFAULT_SHOT` defaults for all nine keys are `null` (arrays included): `setShot` spreads `DEFAULT_SHOT` into every detail, so an `[]` default would share one array instance across holes.
- **Curve is derived, not stored**: finish = start + curve, and the finish is already recorded (`drive` / `approachMiss`). `flightOf({ start, finish })` in `missReasons.js`:

  | start | finish | curve | family | name (right-hander) |
  |---|---|---|---|---|
  | center | right | right | curve | slice |
  | center | left | left | curve | hook |
  | right | right | none (or more right — not separable) | start | push |
  | left | left | none | start | pull |
  | left | right | right | curve | pull-slice |
  | right | left | left | curve | push-hook |
  | any | long / short | unknown | — (start only) | — |

  Push vs push-slice is **deliberately not separated**: both start right; the start line is the primary signal. Stored as `start`, so a later, finer capture can refine without migrating.
- **No "good" contact value.** Blank contact = good or unknown.
- Labels are feel words, keys are technical: `fat` → "Heavy", `thin` → "Thin", `shank` → "Hosel", `sky` → "Skied", etc. (i18n §4.5).
- `STAT_GROUP_FIELDS` gains the new keys under their existing groups (drive keys → `teeShot`, approach → `approach`, short → `shortGame`), so hiding a group hides its reasons too.
- Clearing the miss that triggered a reason (e.g. switching `approachMiss` to on-green) clears that shot's reason keys in the same patch (`approachFinishPatch`, `driveDirectionPatch`, `recoveryOutcomePatch` gain this).

## 4. Capture — the "Why?" sheet (design 1)

### 4.1 When it opens

- **Auto-opens only on a miss the golfer taps** in `ShotDetailPanel`: drive `left`/`right`/`short`; approach finish `left`/`right`/`long`/`short`/`bunker`. Picking fairway, on-green or `super` never opens it.
- **Short game never auto-opens.** `recoveryOutcome` is usually derived (`recoveryOutcomeFromState`), so there is no tap to react to. When the green was missed, the hole is over par and the effective outcome is not a save (`recoveryOutcomeFromState` returns `null` here, not `'none'`), the short-game row shows a **"Why?" chip**; tapping it opens the sheet in short-game mode.
- **After answering**, the miss row shows a summary chip (*"Push · heavy"*, built from the stored keys); tapping it reopens the sheet. An unanswered miss shows a muted "Why?" chip instead.
- **Watch-entered misses** never open the sheet; they get the "Why?" chip on the phone.
- Opening is suppressed when: setting `missReasons` is `'manual'` or `'off'`, the round has "Not this round" set, or the panel is read-only.

### 4.2 Layout (design 1 — everything on one sheet)

Component `src/components/scorecard/MissWhySheet.js` (not `WhySheet`: `components/mystats/WhySheet.js` already exists), on the existing `BottomSheet`. Top to bottom:

1. **Title** — "Why did it miss right?" (side/long/short from the finish) and a subline "Hole 7 · approach 100–150 m · all optional".
2. **Tracer** (approach and drive only) — a sky/ground illustration: target line, the green (approach) or fairway (drive), the finish marker pre-placed from the panel tap, and a wide **start band** split *Left · On line · Right*. Tapping the band draws the flight (`flightOf`) and shows its name in a pill ("Push · right"). Tapping the selected segment again clears it. The finish marker is tappable to change the finish (writes the same patch as the panel row). For a `short` drive the band is hidden (start is meaningless for a top).
3. **"How did it feel?"** — contact chips, single-select, tap again to clear.
4. **"Anything unusual?"** — situation chips, multi-select. Approach shows all 8 in the fixed §3 order: never reordered, so muscle memory holds.
5. **Short-game mode** replaces 2 with a two-chip row "Came up short · Ran long" (`shortResult`).
6. **Footer** — "Not this round" (left, text link) and **Done** (primary). Swipe-down / scrim tap = Done.

Every tap writes immediately through the panel's existing `onChange(patch)` path, so closing early loses nothing. Shot details ride the cards engine (`setShot` → `setDraftShot` → `publishHole` → `scorer_cards` → SQL `projected_round_shots` → `game_shot_details.detail`), which copies the detail object whole: no whitelist anywhere, so the new keys need no plumbing. The watch path (`normalizeWatchShotPatch`) never touches the sheet.

Light and dark via `useTheme()` tokens; tap targets ≥ 44 pt; chips use the existing outcome-chip styling in `ShotDetailPanel`.

### 4.3 Not nagging

- **Skip is free**: nothing is required, Done with nothing tapped stores nothing.
- **"Not this round"** sets a per-round, device-local flag (AsyncStorage key `missReasons.mutedRounds`, a small LRU of round ids) that stops auto-open for that round; chips remain.
- **Setting** `missReasons: 'ask' | 'manual' | 'off'` in `settingsStore` (default `'ask'`), shown in Settings → Stats tracking under the existing group toggles: *Ask on misses* / *Only when I tap Why?* / *Off*. `'off'` also hides the chips. Synced like the other settings.

### 4.4 Read-only surfaces

The played-round scorecard (`ShotScorecard` / `scorecardView.scorecardModel`) shows a small marker on a hole whose miss has a reason, with the summary in the cell's accessibility label. Its cells have no per-hole tap today, so A ships the marker only; no editing there.

### 4.5 i18n

All strings via `useT()` / the `scorecard` and `settings` catalogues. Glossary additions in `docs/i18n.md`: push → *empujada*, pull → *tirada*, slice → *slice / cortada*, hook → *gancho*, heavy (fat) → *pesada*, thin → *fina*, hosel/shank → *socket*, ball below feet → *bola por debajo de los pies*, short-sided → *sin green para trabajar*. Shot names are composed from handedness-resolved descriptors, never concatenated English.

## 5. Coach

### 5.1 `src/store/missReasons.js` (new, pure)

- `flightOf({ start, finish })` → `{ start, curve, family: 'start' | 'curve' | null }` (§3 table).
- `shotName(flight, handedness)` → descriptor key (`push`, `slice`, …).
- `classifyMiss(shotType, detail)` → `{ family, sub }` or `null` (untagged). **First match wins**:
  1. **forced** — `blocked`
  2. **lie** — `above-feet`, `below-feet`, `uphill`, `downhill`, `bad-lie`, `wind` (short game: `bad-lie`, `short-sided`)
  3. **decision** — `decision` (short game: `wrong-shot`)
  4. **swing** — sub: `start` (start line), `curve` (face-to-path), `lowPoint` (`fat`/`thin`/`top`/`sky`), `strike` (`toe`/`heel`/`shank`). When both flight and contact are present, contact wins for `fat`/`thin`/`top` (they explain direction and distance), flight wins otherwise.
- `missReasonStats(rounds, playerId)` → per shot type and approach bucket: tagged / untagged miss counts, family and sub counts, and by-side breakdowns. Shaped for `coachMetrics`.

### 5.2 Moving the blame for forced shots

A hole whose approach carries `blocked`:

- is **excluded** from the approach miss aggregates (`approachMissTendency`, `approachMissCost`, `approachMissByDistance`, so `approach.<side>Rate.*`), each of which reports a `blocked` count;
- **stays in approach strokes gained** (`sgApproach`, `approachTargetGaps`) but starts from the existing **`recovery`** baseline (`expectedStrokes('recovery', midpoint)`) instead of fairway, so the approach is judged only for what it did from trouble;
- on **par 4** reads its drive as **trouble** in `driveLieFromDetail(detail, par)` when the lie is not already `trouble` or `sand`, so `tee.troubleRate` and `sgOffTheTee` (recovery table) carry the cost. Par 5 is excluded: the blocked shot may be the third.

No baseline tables change.

### 5.3 Cause rules (`coachCauses.js`)

New rules sit beside the outcome rules and **outrank** them when they fire (same leak, higher strength wins; on a tie the why rule wins through an explicit `priority` on the cause, compared before sample, since a why rule's tagged sample is always smaller):

| Id | Fires when | Strength |
|---|---|---|
| `cause:approach:why:swing:<sub>[:<side>]` (side only for `start`, `curve`, `strike`) | ≥ `whyTagged` tagged misses in the leak's bucket and one swing sub covers ≥ `whyFamilyPct` of them | `likely` at ≥ `whyLikelyPct`, else `consistent` |
| `cause:approach:why:lie` | lie family ≥ `whyFamilyPct` | same |
| `cause:approach:why:decision` | decision family ≥ `whyFamilyPct` | same |
| `cause:tee:why:swing:<sub>[:<side>]` / `:decision` | same on drives (`whyTagged` tee misses) | same |
| `cause:short:why:<sub \| lie \| decision>` | same on failed up-and-downs | same |

Starting thresholds in `CAUSE_MIN`: `whyTagged: 6`, `whyFamilyPct: 50`, `whyLikelyPct: 70`. Messages cite counts ("7 of your 10 tagged right misses started right on flat lies"), with keys in `i18n/locales/*/coach.js`.

**Coverage hint:** when an approach or tee leak is top-ranked and its tagged share is below `whyTagged`, the diagnosis card shows "Tag why on misses for a sharper diagnosis — 3/6".

### 5.4 Ball-flight wording (correctness)

Coach copy follows the modern ball-flight laws: **start line ≈ clubface at impact (and aim); curve ≈ face relative to path.** So a push is "face open at impact / aimed right", a slice is "face open to the path — usually an out-to-in path", a pull-slice is the classic over-the-top pattern. (This corrects the brainstorm shorthand "push = path, slice = face".)

### 5.5 Swing link (`coachSwingLink.js`)

`SWING_FAULT_LINKS` gains the why cause ids (right-hander; `mirrorCause` handles left-handers):

| Fault | Adds |
|---|---|
| `over_the_top` | `approach:why:swing:curve:right`, `tee:why:swing:curve:right`, `approach:why:swing:start:left` |
| `flat_backswing` | `approach:why:swing:curve:left`, `tee:why:swing:curve:left`, `approach:why:swing:start:right` |
| `early_extension` | `approach:why:swing:strike:right`, `approach:why:swing:lowPoint`, `short:why:swing:lowPoint` |
| `flip` | `approach:why:swing:lowPoint`, `short:why:swing:lowPoint` |
| `head_sway` | `approach:why:swing:lowPoint` |

Rule ids without a side suffix (`lowPoint`) are side-free and skip `mirrorCause`.

### 5.6 Drills, strategy, metrics

- **Drills** (`coachDrills.js`): `start` → existing `appr-start-line-gate` / `tee-shape-window`; `curve` → new `appr-path-gate` (headcover outside the ball); `lowPoint` → new `appr-low-point-line` (strike a chalk line, divot in front); `strike` → new `appr-strike-tape` (face tape, centre 7/10); short `lowPoint` → existing `sg-landing-towel`.
- **Strategy** (`coachStrategy.js`): `lie` and `decision` families produce strategy cards, not practice minutes (e.g. "Below-feet lies: aim at the left edge, one club more"). The weekly plan (`coachWeeklyPlan.js`) gives these causes no practice minutes: a `STRATEGY_ONLY_CAUSES` set stops `poolFor` falling back to the area's drills, and the block's minutes move to the next focus.
- **Metrics** (`coachMetrics.js`): one key per cause rule (`approach.why.<sub>.<side>Rate.<bucket>`, `approach.why.lieRate.<bucket>`, …) so focus verdicts re-read the same number the cause cited.

## 6. Shipping and PRs

JS + jsonb keys only → OTA (`GOLF_ANDROID_BUILD_ARCHS=arm64-v8a npx eas-cli update --branch preview`). One concern per PR, ~< 400 lines:

1. **Vocabulary + sheet** — `DEFAULT_SHOT` keys, patches clearing reasons, `missReasons.flightOf` / `shotName`, the `missReasons` setting, `MissWhySheet` component, panel chips, i18n. Data starts collecting immediately.
2. **Families + blame** — `classifyMiss`, `missReasonStats`, blocked → recovery re-attribution in approach rates, cost, SG and tee trouble.
3. **Coach** — cause rules, metric keys, swing-link rows, new drills, strategy cards, coverage hint, copy.

Verify each through the web UI (`/verify`) as well as Jest.

## 7. Testing

- `missReasons.test.js`: every `flightOf` row; `shotName` for both hands; `classifyMiss` priority on every combination (below-feet + curve-right → lie; blocked + fat → forced; fat + start-right → lowPoint; untagged → null).
- Patch tests: clearing a miss clears its reasons; switching finish side keeps start/contact/situation.
- `coachCauses.test.js`: why rules outrank side rules; sample floors; fallback to today's cause under `whyTagged`; coverage hint.
- Strokes gained / stats tests: a `blocked` approach leaves approach rates and SG, scores off `recovery`, and adds tee trouble.
- `ShotDetailPanel` / `WhySheet` tests: auto-open only on a tapped miss; never on derived short-game outcome; suppressed by `'manual'`, `'off'`, "Not this round", watch-entered misses; summary chip text; group hidden → no chips.
- UI verification on web QA: tag several misses across a round, confirm the summary chips, the scorecard markers and the coach card change.

## 8. Out of scope / left room for

- **B (trouble button)** will write `approachSituation: ['blocked']` *before* the shot; the sheet must show it pre-selected. No other coupling.
- **C (coach asks)** will take over *when* the sheet opens (budget, ordering of likely answers). `missReasons` setting values stay; C adds a mode.
- **D (GPS inference)** proposes situation chips as pre-selections the golfer confirms; inferred values must never be stored without a tap.
- Not in A: watch capture, voice, partner tagging, putting reasons, separating push from push-slice, intent ("I meant to fade it").
