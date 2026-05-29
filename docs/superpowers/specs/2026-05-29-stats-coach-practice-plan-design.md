# Stats Coach and Practice Plan Refactor

**Date:** 2026-05-29
**Status:** Draft for review

## Problem

`MyStatsScreen` has useful data, but the first stats view still reads like a
stack of analytics cards. It does not clearly answer what the player should
improve next. The current Overview tab shows recent form, action plan,
strokes-gained, strengths, and pain points, but the hierarchy is too flat:
the user has to interpret the stats themselves.

The refactor should make Stats feel like a smart golf buddy after a round:
direct, specific, and grounded in the player's own scoring patterns.

## Goals

- Make **Coach** the first stats tab and the default landing view.
- Keep the existing Overview value, but refactor it into practical coaching:
  what is costing points, what is working, what is changing lately, and what to
  do next.
- Show more than "best" and "worst". The Coach tab must include:
  - biggest current leak
  - strongest scoring edge
  - things improving lately
  - things getting worse lately
  - additional improvement opportunities that are not necessarily the worst
  - watch items with low confidence or smaller sample sizes
- Preserve the current high-value Overview content:
  - Strokes Gained vs the selected target handicap, including the edit target
    affordance
  - top 3 strengths and bottom 3 pain points
- Keep the **Practice Plan** near the bottom of the Coach tab so it feels like
  the conclusion after the diagnosis, not the whole page.
- Use deterministic local stats logic only. No AI-generated coaching text, no
  backend service, and no network dependency.
- Preserve the casual clubhouse tone. Advice should feel useful and friendly,
  not like enterprise performance software.

## Non-goals

- No full training-program feature, drill library, calendar, reminders, or
  practice logging.
- No changes to scoring rules, Stableford calculation, handicap logic, or round
  selection.
- No new charting dependency.
- No redesign of the Report Card internals beyond tab order and visual
  consistency.
- No hidden "coach model" or probabilistic recommendations. The output must be
  explainable from visible stats.

## Selected Direction

Use the **Coach First** visual direction as the landing tab, with the
**Practice Plan** idea from the fourth mockup placed at the bottom.

Visual reference:

- `docs/superpowers/mockups/stats-ui-versions.html`

The chosen direction is not a literal implementation target. It defines the
hierarchy: diagnosis first, evidence next, practice plan last.

## Tab Structure

The Stats tab order becomes:

1. **Coach**
2. **Report Card**
3. **Form**
4. **Breakdown**
5. **Shots**

The current `overview` tab is replaced by `coach`. Existing route params that
refer to `overview` should still resolve to Coach for backward compatibility.
The old Overview content is not removed wholesale; it is reorganized into the
Coach tab.

## Coach Tab Layout

### 1. Coach Hero

The first card is a filled green diagnosis card.

It contains:

- a short label such as `Biggest leak`, `Good trend`, or `Main read`
- one headline with the clearest current insight
- one supporting sentence with the measured impact and sample
- two compact proof chips, such as `18 attempts` and `-2.1 pts/round`

Example:

> Long putting is costing 2.1 pts per round.
> Your 6m+ first putts are turning into 3-putts too often across 18 attempts.

The hero should choose the most useful headline from all available insight
types, not always the worst stat. If the player is clearly improving, the hero
may lead with momentum instead of failure.

### 2. Coach Board

Below the hero, show a richer set of coaching rows. This is the core of the
refactor and must go beyond best/worst.

Recommended groups:

| Group | Purpose | Example |
|---|---|---|
| `Fix first` | Highest-confidence point leak | `6m+ putting: 24% 3-putt rate` |
| `Keep doing` | Strongest reliable scoring edge | `Fairway drives average 2.6 pts` |
| `Getting better` | Recent-vs-history metric trending positively | `Points per round up by 3.4` |
| `Getting worse` | Recent-vs-history metric trending negatively | `GIR down 9% over last 5` |
| `Next gain` | Meaningful opportunity that is not the single worst issue | `100-150m approaches are below target` |
| `Watch` | Interesting signal with lower sample size or lower confidence | `Closing 3 holes may be fading` |

Each row contains:

- category label
- concise title
- one plain-language reason
- metric value or impact
- confidence/sample text where useful
- icon and tone, but color cannot be the only meaning

Rows should be ordered by usefulness, not by source module. The user should not
have to know whether an insight came from putting, approach, strokes-gained, or
form trend.

### 3. Current Form Snapshot

Keep the existing form chart and core tiles, but demote them below the Coach
Board.

Content:

- points-per-round trend line
- rounds counted
- average points
- best round
- optional strokes-gained-per-round summary when available

This section answers "how am I playing lately?" after the top sections answer
"what should I do about it?"

### 4. Strokes Gained vs Target

Keep the current Strokes Gained card visible on the Coach tab.

Requirements:

- title reflects the selected target, such as `Strokes Gained vs scratch` or
  `Strokes Gained vs handicap 12`
- total strokes-gained value remains prominent
- per-round framing remains clear
- target-handicap edit affordance remains available
- category breakdown can be compact, but the user must still understand where
  the gain or loss comes from

This card is evidence behind the Coach Hero and can also feed the Coach Board.
It should not be reduced to only a small row or hidden behind a tap.

### 5. Top 3 / Bottom 3

Keep the current strengths and pain-points concept, but make it clearer and
more explicit:

- show up to 3 `Top strengths`
- show up to 3 `Bottom leaks`
- include each item's average points or deviation from baseline
- keep the baseline explanation visible or available through the info sheet
- preserve empty states such as `Nothing stands out yet`

This section can use the existing `ranking.strengths` and
`ranking.weaknesses` data. It is separate from the Coach Board: the Coach Board
is a curated diagnosis across many signals, while Top 3 / Bottom 3 is the
direct ranked evidence list.

### 6. Practice Plan

The Practice Plan appears near the bottom of the Coach tab.

It should include 3 items:

1. **Practice first** - the highest-confidence area to work on before the next
   round.
2. **Secondary focus** - another improvement opportunity, preferably from a
   different part of the game.
3. **On-course cue** - a simple reminder for the next round, such as protecting
   the closing holes, avoiding penalties, or favoring fairways over distance.

The plan should avoid pretending to be a complete training program. It should
feel like an actionable summary:

- `20 putts from 6 to 9m: finish inside 1m`
- `10 approaches from 125m: track GIR or leave distance`
- `On the last 3 holes, choose the shot that keeps double bogey away`

If shot data is missing, the plan can still use form, par type, hole
difficulty, score distribution, and round-shape data.

## Insight Data Model

Add an additive, pure stats selector in the store layer. Domain logic stays out
of the screen.

Recommended shape:

```js
coach: {
  hero: CoachInsight | null,
  board: {
    fixFirst: CoachInsight[],
    keepDoing: CoachInsight[],
    gettingBetter: CoachInsight[],
    gettingWorse: CoachInsight[],
    nextGains: CoachInsight[],
    watch: CoachInsight[],
  },
  practicePlan: PracticePlanItem[],
}
```

`CoachInsight`:

```js
{
  id: string,
  group: 'fixFirst' | 'keepDoing' | 'gettingBetter' | 'gettingWorse' | 'nextGain' | 'watch',
  area: 'form' | 'driving' | 'approach' | 'putting' | 'shortGame' | 'scoring' | 'roundShape',
  title: string,
  reason: string,
  metric: string,
  impact?: number,
  sample?: number,
  confidence: 'high' | 'medium' | 'low',
  tone: 'good' | 'bad' | 'watch' | 'neutral',
}
```

`PracticePlanItem`:

```js
{
  id: string,
  role: 'practiceFirst' | 'secondaryFocus' | 'onCourseCue',
  title: string,
  instruction: string,
  reason: string,
  sourceInsightId?: string,
}
```

The exact field names can change during implementation if existing naming
patterns suggest a cleaner fit, but the selector must remain deterministic,
tested, and store-owned.

## Insight Sources

Use the stats already produced by `computeMyStats` and related helpers.

Candidate signals:

- `actionPlan`: existing keep/improve/practice candidates.
- `ranking.strengths` and `ranking.weaknesses`: reliable best and worst
  categories.
- `form.metrics`: recent-vs-history deltas for getting better and getting
  worse.
- `formSeries`: trend context for points, vs-par, fairways, GIR, putts, and
  3-putts.
- `strokesGained.byCategory`: high-level tee, approach, around-green, and
  putting opportunities.
- `driveImpact`: fairway, miss direction, penalty rate, and worst drive type.
- `approachImpact` and `approachTarget`: distance-bucket approach
  opportunities.
- `puttDive` and `puttingTarget`: long-putt and 3-putt opportunities.
- `frontBack` and `warmupClosing`: opening, closing, and back-nine pattern
  watch items.
- `difficulty` and `parType`: par-type or hole-difficulty scoring gaps.
- `distribution`: score-mix problems such as too many doubles or missed pars.

## Ranking Rules

The first implementation should use simple deterministic priority rules:

- Prefer higher confidence over lower confidence.
- Prefer larger point impact over smaller impact.
- Prefer actionable stats over descriptive stats.
- Avoid showing two rows that say the same thing from different sources.
- Keep samples visible when confidence is medium or low.
- Do not let one category dominate the whole board. If putting is both the
  biggest leak and the practice-first item, the secondary focus should usually
  come from another area.

Confidence guidance:

- High: strong sample and direct scoring impact.
- Medium: useful sample or strong trend, but less direct impact.
- Low: interesting pattern, small sample, or indirect relationship.

## Empty and Sparse Data States

Coach should still render when data is limited.

- **No rounds:** keep the existing empty state.
- **Only one round:** show a first Coach card based on that round, but replace
  trend groups with "Play more rounds to see what is changing."
- **No shot data:** omit shot-specific insights and use scoring, round shape,
  par type, and score distribution instead.
- **Low sample insights:** show them in `Watch`, not `Fix first`.
- **All stats neutral:** lead with consistency and show a small plan focused on
  collecting better shot data during the next round.

## Visual System

Use the existing Golf Partner design system:

- Clubhouse green for the Coach Hero and selected tab.
- White cards on warm canvas for the board, evidence, and plan.
- Red for point leaks and declining trends.
- Bronze or neutral muted tones for watch items.
- Gold remains reserved for special scoring or report-card moments, not normal
  Coach UI.

Avoid making the Coach tab look like a dense analytics dashboard. Cards should
be compact, but each card needs a clear job.

## Component Plan

Likely new or changed components under `src/components/mystats/`:

- `CoachHero`
- `CoachBoard`
- `CoachInsightRow`
- `PracticePlanCard`
- optional `CoachEvidenceCard` if the existing `SectionCard` composition gets
  too busy

`MyStatsScreen` should remain orchestration only. It should not contain ranking
logic or insight construction.

## File-Level Impact

- **Changed:** `src/components/mystats/tabs/OverviewTab.js`, likely renamed or
  replaced by `CoachTab.js`.
- **Changed:** `src/screens/MyStatsScreen.js` for tab order, default tab, and
  backward-compatible route mapping.
- **Changed:** `src/store/personalStats.js` or a new store helper such as
  `src/store/coachInsights.js` for deterministic insight selection.
- **New:** focused tests for the coach insight selector.
- **Possible:** component tests for Coach tab rendering states.

## Testing

Store tests:

- hero chooses a high-confidence leak when one exists.
- hero can choose an improving trend when that is the strongest useful signal.
- board includes best, worst, improving, worsening, next-gain, and watch groups
  when inputs support them.
- duplicate or near-duplicate insights are de-duplicated.
- practice plan produces three items when enough data exists.
- practice plan falls back gracefully without shot data.
- low-sample signals go to `Watch`, not `Fix first`.

Screen/component tests:

- default Stats tab is Coach.
- `overview` route param maps to Coach.
- tab order is Coach, Report Card, Form, Breakdown, Shots.
- Strokes Gained vs target handicap remains visible on Coach when data exists.
- target-handicap edit control remains available from the Coach tab.
- Top 3 strengths and Bottom 3 leaks render from the ranking data when
  available.
- sparse data states render without crashes.
- Practice Plan appears after the diagnostic sections, not at the top.

## Open Questions

None for the design direction. Implementation can tune exact thresholds for
confidence and priority, but the behavior above should remain stable.
