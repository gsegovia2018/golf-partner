# My Stats — target tick on Strokes Gained & Breakdown bars

**Date:** 2026-07-24
**Branch:** feature/mystats-swipe-pages
**Status:** Design approved, ready for plan

## Problem

In the **Scoring** section of My Stats, the "Scoring vs target" block renders
`TargetMeterRow` meters — each has a small **gold tick** marking the target on
the track. Users like that reference mark. Every other bar chart in the
**Strokes Gained** tab (Scoring detail, Driving, GIR, aggregate putting) and
the entire **Breakdown** tab renders `BreakdownRow`, which draws a fill but
**no tick**. The user wants the target tick on those bars too.

## Scope

Add an optional target tick to `BreakdownRow`, and have its two parent
renderers compute and pass a normalized tick position:

- `src/components/mystats/tabs/ShotsTab.js` → `ShotRowsBlock` / `shotBarRatio`
- `src/components/mystats/tabs/BreakdownTab.js` → `PatternRows` / `barRatioFor`

`TargetMeterRow` (the Scoring-vs-target meters) is the visual reference and is
**not changed** — it already has the tick.

### Which bars get a tick

Per user decision, the tick marks **each bar's own reference**:

| Location | Bars | Tick marks | Source of target |
| --- | --- | --- | --- |
| Strokes Gained · Scoring detail | par3/4/5 avg, birdies/pars/bogeys/doubles per round | handicap benchmark | `target` field already on row |
| Strokes Gained · Driving | fairways, left/right miss %, tee penalty %, driver distance | handicap benchmark | **add** `target` to row |
| Strokes Gained · GIR volume | greens in reg % | handicap benchmark | **add** `target` to row |
| Strokes Gained · Aggregate putting | putts/round, 3-putts/round | handicap benchmark | **add** `target` to row |
| Breakdown · "vs your avg" groups | course/timing/tee/drive/approach pattern rows | your rolling average (`baseline`) | **add** `target: baseline` to row |
| Breakdown · putting/recovery | 2-putt rate, putts on/off GIR, 1-putt save, bounce-back, scrambling, sand-save, bunker visits | fixed threshold | **add** `target` (the value already passed to `toneFromComparison`) |

### Which bars get NO tick (unchanged)

**General rule:** a row gets a tick only when it has a **finite, non-zero**
numeric reference target. A target of `0` is the bar's origin — skip it (a tick
at the origin adds nothing). Rows with no numeric target skip it too.

Specifically:

- **Diverging ±SG bars** — Strokes Gained "X m approaches" / "X m putts"
  (`barGroup: 'sg'`). Target is SG = 0 (origin). Parent passes no `targetRatio`.
- **Penalty drag** — Breakdown `barGroup: 'drag'`, target 0 (origin).
- **Breakdown Scoring patterns** (birdies/pars/bogeys/doubles "your score mix"
  count rows) — no reference target (tone is threshold logic, not a `target`).
- **Breakdown putting `count` rows** — `puttsPerRound` (tone `neutral`, no
  target) and `onePutts` (target `0`, origin) get no tick; only `threePutts`
  (target 2) in that group does.
- Any dim (no-data) row, or any row already rendering track-less.

## Component change: `BreakdownRow`

`src/components/mystats/BreakdownRow.js`

New optional prop: `targetRatio` (number 0..1, or undefined).

Behavior:
- When `targetRatio` is a finite number **and** the row has a track
  (`hasTrack`) **and** the row is not `dim`, render a gold tick.
- Tick position: `left: ${clamp01(targetRatio) * 100}%`, clamped into [0,100].
- Reuse `TargetMeterRow`'s tick exactly:
  - Color: `theme.isDark ? theme.semantic.winner.dark : theme.semantic.winner.light`.
  - Animation: a `TickFade` component (opacity 0→1) that starts **after** the
    fill lands — `delay = rowIndex * STAGGER_MS + FILL_MS` (40ms stagger,
    400ms fill, matching the existing `BarFill`). Reduced motion ⇒ static,
    fully visible tick.
  - Geometry: the bar slot becomes a fixed **14px** tall, center-justified
    container (mirror `TargetMeterRow`'s `meterSlot`); the track stays 8px and
    centered; the tick is absolutely positioned, 14px tall, ~2.5px wide,
    `borderRadius` ~1.25, `marginLeft: -1.25` to center on its position.
  - `testID`: `${testID}-tick` when `testID` is provided.
- When `targetRatio` is absent: **no structural change** to the rendered
  output beyond the slot wrapper (which must not shift the existing track/fill
  layout). Bars that don't opt in look exactly as they do today.

Note: today `barSlot` directly contains the 8px `track`. Introducing the taller
slot + absolute tick must preserve the current fill geometry and the existing
`bar-fill` / track testIDs and widths so current `BreakdownRow` tests still pass.

## Scaling: tick shares the bar's scale

Both parents already normalize `barRatio` per `barGroup`. Extend the group
computation so the group scale accounts for targets, so a tick never pins to the
track edge misleadingly (same "scale to fit both" idea `TargetMeterRow` uses via
`max(value, target)`).

### Absolute groups
- `pct`: `barRatio = value/100`, `targetRatio = clamp01(target/100)`.
- `drag`: `barRatio = value/PENALTY_DRAG_SCALE`; **no tick** (target 0).

### Relative groups (`pts`, `count`, `avg`, `dist` — and `sg`, which gets no tick)
- Group scale = `max` over the group's non-dim rows of
  `max(|magnitude|, |target| when finite)`.
- `barRatio = clamp01(|magnitude| / scale)`.
- `targetRatio = clamp01(|target| / scale)` when `target` is finite; else undefined.
- **Solo handling:** the existing `SOLO_COUNT_RATIO` (2/3) fallback applies only
  when a group has a single non-dim row **and** that row has no finite target.
  When a solo row *has* a target, the real `max(|value|,|target|)` scale is used
  (value + tick are meaningful against each other), so drop the 2/3 cap for
  that case. `pts` groups keep their current no-solo-cap behavior.
- `sg` group: bars unchanged; parent passes no `targetRatio`.

Because a target ≤ the group's max magnitude leaves `scale == max` (the current
denominator), existing bar lengths are unchanged in the common case; bars only
shrink when a target genuinely exceeds every value in the group — exactly when
you'd want to see the tick beyond your bars.

### "vs your avg" reference line
In the Breakdown "vs your avg" groups every row shares the same `baseline`, so
every tick lands at the same x — forming a single vertical "your average"
reference the bars read above/below. This is intended and desirable.

## Data plumbing

### `ShotsTab.js`
- Add a numeric `target` field to the rows that only pass target into
  `toneFromComparison` today: the four driving `pct` rows, `driveDistance`
  (`dist`), `gir` (`pct`), and the two putting-volume `count` rows
  (`puttsPerRound`, `threePutts`). The par/count scoring rows already carry
  `target`.
- `ShotRowsBlock` already destructures `target` out of the row; use it to
  compute `targetRatio` and pass it to `BreakdownRow`. Do **not** pass
  `targetRatio` for `barGroup: 'sg'`.
- Extend `shotBarRatio` group build to track the target-inclusive scale, add a
  `shotTargetRatio` (or fold into one helper returning both).

### `BreakdownTab.js`
- Attach a numeric `target` to rows:
  - "vs your avg" rows (`pointPatternRow`, `timingNineRow`, drive/approach
    pattern rows): `target = baseline`.
  - putting/recovery rows: the fixed value currently passed to
    `toneFromComparison` (2, 60, 30, 35, 0.4→as %, 0.45→as %, 1.5, etc.).
    Match the magnitude's units (e.g. sand-save magnitude is `rate*100`, so
    target is `0.4*100 = 40`).
  - Scoring-pattern count rows and penalty drag: **no** `target` (no tick).
- Add `target` to the `PatternRows` destructure so it isn't spread onto
  `BreakdownRow` as an unknown prop; compute `targetRatio` there.
- Extend `barRatioFor` group build to track the target-inclusive scale, add a
  target-ratio computation.

## Testing

- **`BreakdownRow.test.js`** (extend): tick renders at the expected `left%` for
  a given `targetRatio`; no `-tick` node when `targetRatio` is undefined; tick
  present but fill absent when `barRatio` clamps to 0 while `targetRatio` is set
  (mirror `TargetMeterRow`'s empty-fill-keeps-tick test); tick omitted on a
  `dim` row; static (fully visible) tick under reduced motion.
- **`ShotsTab`**: a driving/GIR/putting target row passes a `targetRatio`
  (assert a `${testID}-tick`), an `sg` bucket row does not.
- **`BreakdownTab`**: a "vs your avg" row and a putting/recovery row pass a
  `targetRatio`; a scoring-pattern count row and penalty-drag row do not; the
  "vs your avg" ticks in one group share the same `left%`.
- Full `npm test` + `npm run lint` green.

## Non-goals

- No change to `TargetMeterRow`, the Scoring-vs-target meters, `SGBars`, or
  `ScoreMixBar`.
- No new "target" data or benchmarks — only surfacing targets/baselines the
  rows already compute.
- No change to bar colors, tone logic, or the diverging SG visual.
