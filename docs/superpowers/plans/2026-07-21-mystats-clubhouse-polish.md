# My Stats — Clubhouse Polish Pass

**Date:** 2026-07-21
**Branch:** worktree-mystats-clubhouse-polish
**Goal:** Refactor the My Stats section (MyStatsScreen + src/components/mystats/**) to a
polished, modern, unique finish. Extend the merged Clubhouse direction — do NOT invent a
new palette. Guidance sources: ui-ux-pro-max (data-dense dashboard rules, RN stack rules,
pre-delivery checklist) + Emil Kowalski design-engineering principles (animate little,
animate fast, ease-out only, reduced-motion respected, press feedback on everything).

## Design constants (use these exact values)

- Palette/tokens: existing `src/theme/tokens.js` — Masters green `accent.primary #006747`,
  cream `bg.primary #f6f3ee`, hero green `#0f3d2c` / cream `#f3efe6` (CoachHero constants).
- Fonts: `PlayfairDisplay-*` (display serif, hero numbers/titles only),
  `PlusJakartaSans-*` (everything else). Numbers always `fontVariant: ['tabular-nums']`.
- Motion: easing `Easing.bezier(0.23, 1, 0.32, 1)` (same as PressableScale). Durations:
  press 160ms, content transitions 180ms, chart draw 400ms. All mount animations gated on
  `useReducedMotion()` from `react-native-reanimated` (reduced ⇒ render final state, no motion).
- Never animate `width`/`height` when `transform` can do it. Overline label style:
  fontSize 10, `PlusJakartaSans-Bold`, letterSpacing 1.4, uppercase, `text.muted`.

## Tasks

### Task A — Screen chrome + Reveal primitive (MyStatsScreen.js, new ui/Reveal.js)
1. New `src/components/ui/Reveal.js`: mount-reveal wrapper. Props `{ delay = 0, dy = 6, duration = 180, style, children }`.
   Implementation: Reanimated `useSharedValue` + `withDelay(withTiming(...))` on mount
   (do NOT use Layout/entering animations — they are unreliable on react-native-web).
   Animates opacity 0→1 and translateY dy→0. `useReducedMotion()` ⇒ static render.
2. MyStatsScreen header: add an overline kicker line `CLUBHOUSE · MEMBER RECORD` above the
   serif "My Stats" title (kicker uses the overline style; title stays PlayfairDisplay-Bold 24;
   wrap both in a column so the back button / rounds pill layout still works).
3. Tab pills: replace `TouchableOpacity` with `PressableScale` (`src/components/ui/PressableScale.js`),
   keep all existing props (onLayout, accessibilityRole="tab", accessibilityState, testIDs).
4. Tab content transition: wrap the tab body (the ScrollView's child content) in
   `<Reveal key={tab}>` so switching tabs does a 180ms fade + 6px rise. Do not remount the
   ScrollView itself; reset scroll position on tab change (`scrollTo({y:0, animated:false})`).
5. Also swap the rounds-selector pill and retry/choose-rounds buttons to PressableScale.
6. `npm test -- MyStatsScreen` and update tests if press primitives changed roles.

### Task B — TrendLineChart + ScoreMixArea polish (chart files only)
1. `TrendLineChart.js`: add a gradient area fill under the line — `<Defs><LinearGradient>`
   stroke color at 0.14 opacity → 0 at bottom; build the area `<Path>` per segment (line
   points + close down to `height - padBottom`). Slim the stroke: compact 2.4 / full 2.8.
2. Emphasize the final point: last drawn dot gets radius +1.5 and a 2px ring in `bg.card`
   stroke so it pops; intermediate dots shrink to r 3 (compact 2.8).
3. Keep every existing prop, gap behavior (`toSegments`), empty state, testIDs.
4. `ScoreMixArea.js`: give each stacked band a subtle top-edge stroke of its own color at
   full opacity with band fill dropped to ~0.85 of current; no new props.
5. Run `npm test -- TrendLineChart chartGeometry ScoreMix` (or matching test file names).

### Task C — SGBar rebuild with mount animation (SGBars.js)
1. Rebuild `SGBar` with plain Views (drop react-native-svg here): track = rounded View with
   `bg.secondary`, center zero line = absolutely-positioned 1-2px hairline View
   (`border.default`), bar = absolutely positioned rounded View anchored at the center,
   extending left (poor) or right (good), colors via `theme.scoreColor('good'|'poor')` as today.
2. Mount animation: bar grows out of the zero line — animate `scaleX` 0→1 with
   `transformOrigin` at the zero-line edge (RN 0.81 supports the `transformOrigin` style
   prop), 400ms, bezier(0.23,1,0.32,1), gated on `useReducedMotion` (reduced ⇒ full width).
3. Preserve the public API `{ label, value }`, null-value em-dash row, clamp ±1.5, value
   label formatting/colors, and testIDs `sg-bar-row`, `sg-bar-track`, `sg-bar-value`.
4. Percentage widths: bar width = `Math.abs(clamped)/1.5 * 50%` of track. Verify layout at
   value 0 (no bar), ±1.5 (half track each way).
5. Run the existing SGBars tests: `npm test -- SGBar`.

### Task D — DistributionBars grow-up animation + polish (DistributionBars.js)
1. Bars grow up on mount: `scaleY` 0→1, `transformOrigin` bottom, 300ms bezier(0.23,1,0.32,1),
   staggered `index * 40ms` via `withDelay`; `useReducedMotion` ⇒ static. Animate the
   colored bar only, never the labels.
2. Visual polish: round the top corners only (radius 4), keep value labels above bars
   (they must NOT animate/scale — keep them outside the transformed view).
3. Preserve API and any testIDs; run `npm test -- DistributionBars` (and BreakdownTab tests).

### Task E — Card system unification + hero + press sweep (after A–D land)
1. `SectionCard.js`: make `titleVariant='overline'` the DEFAULT. Remove the now-redundant
   explicit `titleVariant="overline"` at call sites (HandicapTab, CareerMilestonesCard).
   Keep `titleVariant='heading'` available; audit call sites — none should opt back out.
   The `(i)` info icon stays, but at size 14 aligned to the overline.
2. `StatTile.js`: value gets fontSize 22 `PlusJakartaSans-ExtraBold` + tabular-nums;
   caption becomes overline-style (fontSize 9.5, letterSpacing 1.2, uppercase, Bold, muted),
   marginTop 2. Hero surface variants keep current colors.
3. ShotsTab / ShotDashboard: promote the top "vs target" summary into a Clubhouse hero —
   use `SectionCard tone='hero'` (or match CoachHero's `#0f3d2c` surface) with the headline
   SG number in `PlayfairDisplay-Black` ~34 and StatTile `surface='hero'` for the sub-grid.
   Keep all data/logic and `(i)` hooks untouched — restyle only.
4. Press-feedback sweep across `src/components/mystats/**`: every `TouchableOpacity` that
   is a button/row (CourseMasteryCard rows, FocusCard buttons, CoachHero focus button,
   FormTab/SGTrend period chips, HandicapTab toggles) becomes `PressableScale`
   (activeScale 0.97; keep accessibility props, hitSlop, testIDs). Leave `SectionCard`'s
   tiny (i) TouchableOpacity as-is but add hitSlop if missing.
5. CourseStatsScreen.js uses the same primitives — it inherits the SectionCard/StatTile
   changes; give its rows/buttons the same PressableScale treatment.
6. Run the full mystats test sweep: `npm test -- mystats CourseStats Handicap Breakdown Shots Form Coach`.

## Verification (final)
- `npm test` (full) and `npm run lint` — zero new failures/warnings. NOTE: run inside the
  worktree; if jest picks up `.claude/worktrees` copies from the main checkout, that is a
  known artifact — only worktree-local results count.
- Runtime verify via the project `verify` skill (Expo web + Playwright): walk all 6 tabs,
  check reveal transition, SG bar growth, distribution bars, pressed states, reduced-motion
  sanity, and screenshot each tab.
- ui-ux-pro-max pre-delivery checklist: touch targets ≥44pt (hitSlop where smaller), no
  emoji icons, tab a11y state, contrast unchanged (token colors only), no layout-shifting
  press states (scale only), reduced-motion everywhere.
