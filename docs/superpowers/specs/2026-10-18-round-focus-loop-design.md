# Round focus loop — the focus in the round, measured since you committed (sub-project B)

**Date:** 2026-10-18
**Status:** Design agreed in conversation (in-round presence: "reminder + focused asks"); UI canvas pending review before merge
**Scope:** coach focus stores (`src/store/coachFocus.js`, new `src/store/focusTarget.js`), stats (`src/store/personalStats.js`, `src/store/missReasons.js`), the live scorecard panel (`src/components/scorecard/ShotDetailPanel.js` and its parents), the round summary (`src/screens/RoundSummaryScreen.js`, `src/components/roundSummary/`). JS only, OTA. No migration, no network, no LLM.
**Builds on:** coach v2 focus (`specs/2026-10-16-coach-v2-design.md`), miss reasons (`specs/2026-10-17-miss-reasons-design.md`, sub-project A, shipped #221–#225).

---

## 1. Problem

The coach already has a focus loop inside My Stats → Coach: "Make this my focus" commits a leak + cause + metric, `focusVerdict` judges it after 2+ rounds (`improving | flat | worse | resolved`), drill levels step every 2 rounds. But none of it reaches the round:

1. **During the round** the scorecard knows nothing about the focus; the "On the course" task is plain text, never tracked.
2. **After the round** the round summary shows nothing; the verdict appears only if the golfer opens the Coach tab.
3. **The verdict is diluted**: it re-reads the metric from stats pooled over every selected round, before and after the commit.
4. **Strategy foci can't be measured**: a lie (e.g. ball below the feet) is only recorded on a *miss* (the Why? sheet), so the app never learns about the good shots from that lie.

## 2. Design

### 2.1 What is "in focus" — `focusTarget(focus)` (new, pure)

`src/store/focusTarget.js`. Input: the stored v2 focus record (`category`, `bucket`, `causeId`, `metricKey`). Output (or `null` for a focus with no on-course meaning, e.g. a pure SG reconciliation focus):

```
FocusTarget {
  shot: 'approach' | 'drive' | 'short' | 'putt' | null   // which shots the focus is about
  bucket: '<approach bucket>' | null                      // informational: the distance is unknown before the shot
  kind: 'swing' | 'lie' | 'decision' | 'outcome'
  lie: '<approachSituation key>' | null                   // kind 'lie': the dominant lie to ask about
  cue: MsgDescriptor                                      // one line for the strip
}
```

Rules:
- `causeId` `cause:<area>:why:swing:*` → `kind: 'swing'`, `shot` from the area (approach / tee → drive / short).
- `cause:<area>:why:lie` → `kind: 'lie'`; `lie` = the golfer's dominant lie for that area from `stats.missReasons.<area row>.lies` at commit time — stored on the focus record as `focusLie` when committing (the record gains this optional field; an old record without it falls back to `kind: 'outcome'`, reminder only).
- `cause:<area>:why:decision` → `kind: 'decision'`.
- Every other cause / category → `kind: 'outcome'`, `shot` from the category (approach, offTheTee → drive, aroundGreen → short, putting → putt, penalties → drive), `cue` = the existing course task (`courseTaskFor`).
- `cue` for swing / lie / decision = the existing `plan.course.*` copy for that cause (already per cause id).

### 2.2 During the round

**Focus strip.** One line at the top of the hole's shot-detail panel, only on holes where `shot` applies: approach → par 4/5 (and par 3 only when the focus has no bucket or the hole-distance bucket equals it); drive → par 4/5; short / putt → every hole. Shows `◎ Focus · <issue title>: <cue>`. Not interactive beyond an info tap that opens the existing focus explanation (or nothing in v1 — the canvas decides). Hidden when there is no active focus, when the panel is read-only, and when the stat group for `shot` is off.

**Focused asks.**
- `kind: 'swing'` / `'decision'`: the Why? sheet auto-opens on a missed focus shot even when the setting is *On tap* (never when *Off*, never in a muted round — "Not this round" still wins).
- `kind: 'lie'`: on every focus shot — hit or miss — a one-tap chip under the finish row: *"Ball below your feet?"* (copy per lie). Tapping toggles `<lie>` in `approachSituation` (approach) — same key the Why? sheet writes, so a later miss sheet shows it pre-selected.
- `kind: 'outcome'`: strip only.

**Rule change (from A):** a situation tag survives a green hit. `approachFinishPatch` on `green` clears `approachStart` and `approachContact` but **keeps** `approachSituation`; the approach-bucket clear (`approachBucketPatch(null)`) still clears all three. Same for the watch path (`normalizeWatchShotPatch`). `classifyMiss` already only runs on misses, so hits with a situation never count as misses.

### 2.3 Measuring since the commit

- `focusVerdict` keeps its states and thresholds but reads the metric from **stats over the rounds since the commit**: rounds whose `endedAt` is after `focus.committedAt` (or after `rebasedAt` for a rebased focus), from the same selection the screen uses. `roundsSince` becomes the count of those rounds (no longer `roundCount − roundCountAtCommit`, which shifts when the golfer changes the selection).
- Implementation: `MyStatsScreen` computes a second, cheaper stats object for that subset — `computeMyStats(sinceRounds, { …same options })` — only when a focus is active, and passes it to `focusVerdict` as `statsSince`. Baseline values stay as committed.
- Existing foci: their verdict switches to the since-commit read on the next open; a one-time notice (the existing `_notice` mechanism) says *"Your focus is now judged only on rounds since you started it."*
- **Lie encounters.** `missReasonStats` rows gain `encounters: { [lie]: { shots, greens } }` for approaches: every approach (hit or miss) whose `approachSituation` contains that lie counts as a shot; a green hit counts as a green. Encounters are **shown, not judged**: before the focus nobody tagged lies on hits, so there is no baseline for a green rate. A lie focus keeps its verdict metric — the share of tagged misses that came from that lie (`approach.why.lieRate.*`, lower is better) — which has a real "before"; the round card adds *"4 shots from below your feet, 3 greens"* as context.

### 2.4 After the round — the Focus card

In the round summary (`RoundSummaryScreen`), when a focus is active and the round touched it (at least one focus shot), a **Focus card**:
- **This round**, from that single round (`missReasonStats([round])` / the focus metric on a one-round stats object):
  - swing / decision: *"2 of 5 tagged approach misses started right"* + *"before: 7 of 10"* (the committed baseline count when available, else the baseline %).
  - lie: *"Ball below your feet: 4 times, 3 greens"* + *"before: 1 of 5 misses came from it"*.
  - outcome: the metric's this-round value vs baseline.
- **So far**: the verdict line from §2.3 (*"Improving after 3 rounds — level 2 of 3"*, *"Needs one more round"*), using the existing verdict copy.
- A link *"Open Coach"* to My Stats → Coach.

**Chosen layout (canvas option B, 2026-10-18):** overline "YOUR FOCUS" with the target icon, the focus title, then two labelled bars — *This round* (accent fill) and *Before the focus* (muted fill) — each with its value on the right ("2 of 5 tagged misses" / "7 of 10"), bar length = the metric's percent; then the verdict line (state dot + "Improving after 3 rounds · level 2 of 3") and "Open Coach ›". For a lie focus the bars are the miss share from that lie and the value adds the encounters ("1 of 6 misses · 4 shots, 3 greens"). For a metric whose polarity is `higher` the bars still show the raw percent; the verdict line carries better/worse. Canvas: https://claude.ai/artifact/R5TVitVtGbSt2sgmjsv3k3
Hidden for rounds that didn't touch the focus, for other players' cards, and for rounds without the owner.

### 2.5 Out of scope

Syncing the focus across devices (it stays in the scoring phone's AsyncStorage), watch display, notifications, an explicit "did you do it" check-in, decision-adherence asks ("Played safe?").

## 3. PRs

| PR | Content |
|---|---|
| **B1** | `focusTarget.js`; focus record gains `focusLie`; `missReasonStats` encounters (display only); since-commit verdict (`statsSince`) + one-time notice; situation survives a green hit (panel + watch patches) |
| **B2** | Focus strip + focused asks in `ShotDetailPanel` (thread the focus + `focusTarget` from `ScorecardScreen` via `loadFocus`) |
| **B3** | Round-summary Focus card |

UI (B2, B3) follows the approved design canvas; nothing merges before the owner approves it.

## 4. Testing

- `focusTarget.test.js`: every cause family → kind/shot/lie/cue; outcome categories; old records without `focusLie`; `null` for SG-only foci.
- `coachFocus.test.js`: since-commit selection (endedAt after committedAt / rebasedAt), `roundsSince` from the subset, verdict states unchanged on fixtures, notice once.
- `missReasons.test.js`: encounters on hits and misses; green counts; untagged hits ignored.
- `scoring.test.js`: green keeps `approachSituation`, clears start/contact; bucket clear clears all; watch path same.
- `ShotDetailPanel.test.js`: strip on applicable holes only (par / bucket / group off / read-only); lie chip toggles `approachSituation` on a hit; swing focus opens the sheet in *On tap*, not in *Off* or a muted round.
- Round summary: card shown only when the round touched the focus; this-round numbers; verdict line.
- Web walkthrough per UI PR (strip, ask, summary card; light/dark; ES).
