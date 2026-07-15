# Strokes Gained & Coach Improvements — Design

**Date:** 2026-07-15
**Status:** Approved design, pending implementation plan
**Scope:** My Stats — Shots tab (strokes gained) and Coach tab

## Problem

The user's verdicts on the current features:

- **Strokes gained is "not very useful":** no way to see progress over time,
  the tee game is invisible (drives are logged as direction only), and the
  numbers don't feel trustworthy (abstract baselines, mixed units, no link
  to real scores).
- **The coach doesn't help you get better:** practice-plan text is generic
  boilerplate, there are no concrete drills or measurable goals, no
  persistent focus, no follow-up on whether advice worked, and nothing is
  framed in the app's currency (Stableford points).

## Goals

1. Off-the-tee becomes a real SG category (user accepted full-detail drive
   logging: lie + distance bucket).
2. Progress is visible: per-round SG trend and personal-baseline deltas.
3. Numbers are trustworthy: reconciliation with actual scores, sample-size
   gating, an honest residual for unattributed strokes, and a full explainer.
4. The coach gives concrete drills with measurable targets, commits to one
   focus and verdicts it after later rounds, offers quantified on-course
   strategy tips, and prices everything in points per round.
5. Everything stays deterministic and on-device (no LLM, no network).

## Non-goals

- Per-shot logging (Arccos-style) — rejected as too much data entry.
- Course hole distances — the group's course library has none; nothing in
  this design may depend on `hole.distance`.
- Syncing coach focus across devices (device-local for now).
- Changing scramble/match-play exclusions from personal stats.

## Constraints & key correction

The logged "approach" is *the shot aimed at the green* (after a punch-out or
lay-up it is a later shot). Therefore the drive's lie tells us nothing about
the approach's lie:

- `driveLie` feeds **only** off-the-tee SG.
- Approach SG gets its own optional `approachLie` input.
- Strokes between drive end and approach start (lay-ups, punch-outs) belong
  to no category; reconciliation must surface them as an explicit residual.

## Phase 1 — Trustworthy SG

### 1.1 Data model (`src/components/scorecard/constants.js` DEFAULT_SHOT)

New per-hole fields (all nullable; old rounds simply lack them — no
migration, sample gating handles it):

- `driveLie`: `'fairway' | 'rough' | 'sand' | 'trouble' | null` (non-par-3).
  Derived when possible: existing drive direction `fairway`/`super` implies
  `fairway`. Only on a miss (`left`/`right`/`short`) does a chip row appear
  (Rough / Sand / Trouble), defaulting to `rough` when skipped.
- `driveDistBucket`: `'0-150' | '150-180' | '180-210' | '210-240' | '240+'`
  (metres). One new segmented row on non-par-3s, same `BucketSegment`
  component as approach/putt buckets.
- `approachLie`: `'fairway' | 'rough' | 'sand' | null`. Chip row shown only
  once an approach bucket is picked; `null` means fairway (identical to
  today's numbers when skipped). Hidden on par 3s (lie is the tee).

Logging cost: fairway hit = 1 extra tap (distance); miss = 2. Approach lie
is 0 taps unless it matters.

### 1.2 Off-the-tee SG (`statsEngine.js` + `strokesGainedBaseline.js`)

Benchmark-drive formula — needs no hole distance:

```
SG_OTT = E[benchLie, D_anchor − benchDist] − E[actualLie, D_anchor − actualDist]
```

- `D_anchor`: fixed typical hole length per par (par 4 = 340 m,
  par 5 = 470 m). Because the formula is a difference of two lookups on the
  same anchor, anchor error largely cancels; the result is driven by the
  logged distance bucket (midpoint) and lie.
- Benchmark drive: fairway lie at the target handicap's typical distance
  (scratch = 230 m, 14-hcp anchor = 200 m, linearly blended by
  `targetHandicap` like the existing baseline tables).
- `actualLie` mapping: `trouble` → the existing `recovery` table.
- Par 3s: no tee category (the tee shot is the approach, as today).
- Penalty strokes are NOT subtracted here — they stay in the penalties
  category (no double-counting).
- Holes missing `driveLie`-derivable data or `driveDistBucket` contribute
  null (excluded from sample).

### 1.3 Approach SG start lie

`sgApproach` / `approachTargetGaps` start lie becomes
`approachLie ?? 'fairway'` (par 3s stay `'tee'`).

### 1.4 Season aggregation

- `offTheTee` joins `sgTotal` / `sgSeason` as a fifth category with its own
  per-category round denominator (same pattern as the existing four).
- `sgSeason.perRound[i]` extended with `byCategory` so the UI can plot
  per-round category trends.
- Headline total keeps the single consistent denominator (T5.2 fix).

### 1.5 Personal-baseline deltas

Per category: recent-vs-previous split (same recent/history split the Form
card uses) → `{recent, previous, delta, direction}`. Exposed on
`stats.strokesGained.personalDelta[category]`.

### 1.6 Reconciliation

Expected score per round = **par + target handicap** (no course data
needed). Per tracked round: `gap = expected − actual strokes`. The five
category SGs explain part of the gap; the remainder is an explicit
**"In-between & untracked"** residual (lay-ups, punch-outs, holes without
shot detail). Output invariant: categories + residual = gap, exactly.
Aggregated as per-round averages over rounds with any SG sample.

### 1.7 Confidence gating

Each category carries `sampleHoles`. Below a minimum (10 holes) the UI
renders "needs N more holes" instead of a number. Reuse existing
low/medium/high thresholds elsewhere.

### 1.8 Shots tab UI (`ShotDashboard.js` and friends)

- Header: "Target gap" stays; Evidence panel becomes a per-category
  confidence readout calling out the weakest category.
- Five category bars, each with a personal-delta trend badge
  ("▲ +0.6 vs your last stretch") and a sample chip; under-sampled
  categories render as muted "needs N more holes" rows.
- New SG trend chart: `TrendLineChart` of per-round SG with chips for
  Total + each category.
- New reconciliation card "Where your strokes go": expected vs actual, then
  the signed category list + residual, visibly summing to the gap.
- Signals list: per-bucket signals converted to per-round impact
  ("6+ m putts: −0.8 strokes/round across 23 putts"), ranked by real cost,
  top 3 good/bad as today.
- New `statExplainers.js` entry: buckets, blended baselines,
  benchmark-drive method, exclusions, effect of target handicap.

## Phase 2 — Closing-the-loop coach

### 2.1 Drill library (`src/store/coachDrills.js`, new)

~20 deterministic drills keyed by `(category, bucket?)`, each:
`{id, title, instruction, passTarget, location}` —
e.g. leak "6+ m putts" → "Lag ladder: 10 putts from 8 m; 7+ inside 1 m".
Practice plan items pick drills matched to leak insights instead of
boilerplate. Every drill line shows payoff: "worth ≈ X pts / round".

### 2.2 Committed focus (`src/store/coachFocus.js`, new; AsyncStorage)

- "Make this my focus" button on the coach hero/insights.
- Stores `{insightId, area, metricKey, baselineValue, committedAt,
  roundCountAtCommit}`.
- Coach tab then leads with a Focus card: commitment, matched drill, and —
  once ≥2 new rounds exist — a verdict from the same stats pipeline:
  improving / flat / worse / needs-more-rounds, with before → after values.
- Complete or swap focus; completed foci archive to a small history list.
- Device-local (no schema change); sync later if wanted.

### 2.3 On-course strategy tips

~5 deterministic rules, firing only on well-sampled data, each quantified
from the player's own bucket SGs:

- Approach lay-up rule (losing from 150–200 m but gaining from 50–100 m →
  quantified lay-up recommendation).
- Tee club-down rule (trouble rate × trouble cost vs distance given up).
- 3-putt avoidance cue (lag-first framing on 6+ m putts).
- Tee-trouble side cue (persistent left/right miss pattern → aim-line cue).
- Bunker-avoidance cue (sand SG cost vs greenside miss cost when both
  sampled).

Exactly these five rules; each renders only when its data threshold is met.

Rendered as a "Play smarter" card on the Coach tab, separate from practice.

### 2.4 Points framing

Insight metric lines gain `≈ X pts / round` (SG per round ≈ Stableford
points, stated as an approximation in the explainer). Applies to Fix-first
ranking, drills, and strategy tips.

## Data flow

`ShotDetailPanel` (new fields) → round `shotDetails` (existing sync path,
schemaless per hole) → `statsEngine` (new/changed SG functions) →
`personalStats.computeMyStats` (assembles `strokesGained`, `personalDelta`,
`reconciliation`) → Shots tab UI and `coachInsights`/`coachDrills`/
`coachFocus` → Coach tab UI. `coachFocus` additionally reads/writes
AsyncStorage.

## Error handling

- Missing new fields → null contributions, excluded from samples (never
  fabricated).
- Reconciliation residual absorbs all unattributed strokes; the card can
  never show components that don't sum.
- Focus verdicts refuse to judge with <2 post-commit rounds.
- Strategy rules require minimum bucket samples before firing.

## Testing

- Unit: `sgOffTheTee` (benchmark math, lie mapping, null gating),
  `approachLie` start-lie handling, reconciliation exact-sum invariant,
  personal-delta splits, drill selection, focus verdict thresholds,
  strategy rule firing/suppression.
- Extend existing `statsEngine` / `personalStats` / `coachInsights` suites
  for the fifth category.
- UI smoke via existing jest-expo component tests where present.

## Implementation order

Two separate implementation plans:

1. **Phase 1 — Trustworthy SG** (data fields → engine → UI).
2. **Phase 2 — Coach** (drills → focus loop → strategy → points framing),
   building on Phase 1's outputs.

## Amendment (2026-07-15, post-Phase 2): penalties vs target

User finding: penalties was the only category benchmarked against zero
(raw count), so it never responded to the target handicap — vs a 25 target
it overstated the loss by the ~2 penalties/round a real 25 takes.

Change: `sgPenalties(round, playerId, targetHandicap)` now scores each
tracked hole as `expectedPenaltiesPerHole(target) − actualPenalties`.
Expected penalties per round = linear blend anchored at 0 (scratch) and
1.0 (14 hcp), t clamped [0, 2] (→ ~1.79 at 25, cap 2.0). Scratch behavior
is unchanged (expected 0). Clean holes now contribute a small positive vs
a non-scratch target, matching every other category's semantics. The SG
explainer's penalties sentence is updated accordingly. Reconciliation and
coach routing consume the new values unchanged.
