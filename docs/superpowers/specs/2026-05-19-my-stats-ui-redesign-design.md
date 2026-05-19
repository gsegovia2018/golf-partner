# My Stats — UI Redesign

**Date:** 2026-05-19
**Status:** Approved (design)

## Problem

The personal stats screen (`MyStatsScreen`) is functionally rich but hard to
read. Concrete issues:

- One 609-line file with every sub-component (`Snapshot`, `FormSection`,
  `BreakdownSection`, `Sparkline`, …) defined inline — hard to change safely,
  nothing reusable or unit-testable.
- The Overview "Snapshot" is a cramped 4-up row; recent form is reduced to a
  single arrow glyph and is not what the eye lands on first.
- Trends are drawn as a tiny bar "sparkline" — low information, no labels.
- Metrics are presented as dense `label / value / sample` tables; the `12 ×`
  sample column is unexplained.
- No in-context explanation of what any metric means or how it is computed.

## Goals

- Make the stats **rich but easier to understand**: grouped metrics, real
  charts, plain-language explanations.
- Recent **form is the first thing** seen on the Overview tab.
- Replace trend bars with **labelled line charts**; keep bars only for discrete
  categories (score distribution).
- Every section and non-obvious metric gets a **tap-to-reveal explainer**.
- Split the monolith into a small, tested **component library**.

## Non-goals

- No change to the statistics themselves — the numbers `computeMyStats`
  already produces are correct and stay as they are.
- No change to round selection, the Report Card's per-round logic, or the
  5-tab structure (Report Card / Overview / Form / Breakdown / Shots stay).
- No new charting dependency — charts are built with `react-native-svg`
  (already a dependency).

## Approach

**Component-library refactor.** Build a small set of reusable presentational
components under `src/components/mystats/`, then rebuild each tab's content
from them. `MyStatsScreen` keeps orchestration only (tab state, data loading,
round selection, Report Card wiring). The inline sub-components are deleted.

### New components — `src/components/mystats/`

| Component | Responsibility |
|---|---|
| `SectionCard` | Card shell: title + optional `(i)` info button. The button calls `onInfo(key)`; it does not own the sheet. |
| `StatTile` | One large value + caption, optional tone (up/down/neutral). |
| `TrendLineChart` | `react-native-svg` line chart — dots + a value label on every point, optional low/high reference lines. Props: `series` (`[{label,value}]`), `color`, `polarity`, `height`, `showAxisLabels`. |
| `MiniTrendChart` | Compact variant of `TrendLineChart` used inside metric rows — value label on every point, no reference lines. |
| `DistributionBars` | `react-native-svg` vertical bars for discrete categories (score distribution). |
| `ScoreMixArea` | `react-native-svg` stacked area chart — birdie+/par/bogey+ share per round, with legend. |
| `MetricRow` | Label (+ optional `(i)`) · value(s) · trend chip. Used by Breakdown / Shots. |
| `FormMetricBlock` | A `MetricRow`-style header (name, Recent vs History, trend chip) above a `MiniTrendChart`. Used by the Form tab's Recent vs History card. |
| `statExplainers.js` | Plain map `{ [key]: { title, subtitle, explainer } }` of explainer copy. Not a component. |

`SectionCard`, `TrendLineChart`/`MiniTrendChart`, `DistributionBars`,
`ScoreMixArea` follow the existing theme tokens (`theme.bg.card`,
`theme.accent.primary`, `theme.spacing.*`, `theme.radius.*`, etc.).

### Explainers

`MyStatsScreen` holds one `infoKey` state and renders one shared
`StatDetailSheet` (existing component — it already supports
`title` / `subtitle` / `explainer` / `rows`). Any `(i)` tap sets `infoKey`;
the sheet reads `statExplainers[infoKey]`. No share rows are needed for these
explainers (`shareable={false}` or empty `rows`).

## Tab designs

### Overview

1. **Recent Form hero card** (new, first card). Dark-green filled card:
   - Verdict headline — `▲ Improving` / `▼ Declining` / `Flat`, derived from
     the existing `form.metrics[0].direction` (points/round).
   - One-line summary — e.g. `+4.7 pts / round vs your earlier rounds`
     (from the points/round `delta`; omitted when there is no history).
   - Inline `TrendLineChart` of points per round.
   - Three `StatTile`s below: Rounds counted, Avg pts/round, Best round.
   - `(i)` → explainer for how form is measured.
2. **Strengths & Pain Points** — unchanged content (`ranking`), restyled into
   a `SectionCard` with the green "What's working" / red "Where you lose
   points" groups and an `(i)`.

### Form

Four `SectionCard`s, all charts oldest → newest:

1. **Points per round** — `TrendLineChart` (green, higher-is-better).
2. **Strokes vs par** — `TrendLineChart` (gold, lower-is-better).
3. **Score mix** — `ScoreMixArea` stacked area + legend.
4. **Recent vs History** — one `FormMetricBlock` per `FORM_METRICS` entry.
   Each block: metric name + `(i)`, `Recent vs History` summary, trend chip,
   and a `MiniTrendChart` with a value label on every point. Shot-based
   metrics (`shot: true`) render their block only when shot data exists;
   otherwise the existing "log putts and drives…" note is shown.

The period chips (Last 3 / 5 / 10) remain a single control on the Recent vs
History card and drive the `n` split, exactly as today. The three trend
charts plot the full selected-round history.

### Breakdown

`SectionCard`s built from `MetricRow` / `DistributionBars`, same data as today
(`parType`, `difficulty`, `frontBack`, `warmupClosing`, `distribution`,
`bounceBack`/`scrambling`):

- **Score distribution** — `DistributionBars` (Eagle+ … Triple+) with counts.
- **Par type**, **Hole difficulty**, **Round shape**, **Recovery** —
  `MetricRow`s. The unexplained `12 ×` column becomes a plain `36 holes`
  secondary value; sample-size caveats move into the `(i)` explainer.

### Shots

Same data (`teeShot`, `shots`) rebuilt with `SectionCard` + `MetricRow`,
matching the Breakdown styling. Empty state (no shot data) unchanged in
meaning.

### Report Card

Structure and per-round logic unchanged. Consistency pass only: wrap its
sections in `SectionCard` and adopt the shared card styling so it matches the
other four tabs.

## Data additions

The new charts need **per-round series** that `computeMyStats` does not
currently expose. These are added as **pure, additive selectors** in
`personalStats.js` — existing outputs are untouched.

- `computeFormSeries(selectedRounds, n)` → `{ metrics: [{ key, label,
  polarity, shot, series: [{label, value}] }], scoreMix: [{label, birdie,
  par, bogey}] }`.
- Per-round values are obtained by reusing the existing `statsEngine`
  functions on a **single-round synthetic tournament** (one round sliced from
  the selection via the existing `buildSyntheticTournament`). This reuses
  proven logic instead of writing parallel per-round math:
  - points / strokes per round — already available from `playerRoundHistory`.
  - strokes vs par per round — par-played computed from the round's holes
    (same calculation `computeMetrics` already does, applied per round).
  - fairways % / GIR % / putts / 3-putts per round — `shotStats` on the
    single-round synthetic.
  - score mix per round — `playerScoreDistribution` on the single-round
    synthetic.
- `computeMyStats` gains one extra field (`formSeries`) populated by
  `computeFormSeries`; all current fields keep their current shape.

`statsEngine.js` is **not modified** — it is only called in a new way.

## Testing

- New pure functions (`computeFormSeries` and any chart-geometry helpers such
  as `series → svg coordinates` scaling) get unit tests in
  `src/store/__tests__/personalStats.test.js` and a new
  `src/components/mystats/__tests__/` suite.
- Chart components: test the pure geometry/scaling helpers directly (point
  count, min/max scaling, empty/single-point input). Visual rendering is not
  snapshot-tested.
- Existing `personalStats.test.js` / `statsEngine.test.js` must stay green —
  this refactor must not change any existing computed value.

## File-level impact

- **New:** `src/components/mystats/` (components above) +
  `src/components/mystats/__tests__/`.
- **Changed:** `src/screens/MyStatsScreen.js` (slimmed to orchestration),
  `src/store/personalStats.js` (additive `computeFormSeries`, `computeMyStats`
  gains `formSeries`).
- **Reused unchanged:** `StatDetailSheet`, `statsEngine.js`, `CardGrid`,
  `RoundReportCard` (restyled wrapper only), theme tokens.

## Out of scope

- Auto-generated narrative insight headlines (the heavier "Approach C").
- Any change to how rounds are collected or selected.
- New shareable-card formats for the explainer sheets.
