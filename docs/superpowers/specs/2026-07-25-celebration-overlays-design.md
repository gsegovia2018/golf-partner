# Celebration overlays: escalate by rarity

**Date:** 2026-07-25
**Status:** design approved, ready for planning
**Area:** `src/components/scorecard/` — celebration tiers, `HoleView`, `ScorecardScreen`

## Problem

Every notable hole result — birdie through hole-in-one, plus the NOELADA
anti-celebration for double bogey or worse — renders the same full-screen
takeover: a 55%-black scrim, an expanding ring, and a centred card. Three
things are wrong with it.

**A birdie does not warrant a takeover.** Birdies are common. Covering the
scorecard and blocking input for 900ms every time interrupts score entry, and
the takeover is the most expensive thing the scorecard renders — a full-screen
scrim and ring over the hole pager.

**NOELADA is a mirror of the celebrations, and holds longest of all.** The hold
times fall through `BIRDIE 900 → EAGLE 1200 → ALBATROSS 1500 → else 1800`,
where the `else` is commented `// HOLE IN ONE`. NOELADA lands there by
accident, so a double bogey occupies the screen twice as long as a birdie and
exactly as long as a hole-in-one. It also fires `haptic('success')` — the same
celebratory buzz as an albatross.

**The card predates the light theme.** It is hardcoded `#003d27` on a black
scrim. That value appears nowhere in `tokens.js`; the theme's surface for play
and results is `DEEP_GREEN #00553c` (see the "green plays, navy thinks" note in
`tokens.js`). The overlay is a leftover from the dark theme.

## Approach

Escalate presentation by rarity, and give each tier its own timing and haptic.

**Common results (birdie, noelada) become a non-blocking toast.** It slides in
at the top of the hole page, holds briefly, slides out. Nothing is covered,
nothing is blocked — score entry continues straight through.

**Rare results (eagle, albatross, hole-in-one) keep the takeover.** Unchanged
behaviour. It stays special precisely because it is now rare.

This also reduces cost on the common path: the toast is roughly 8 native views
against the takeover's full-screen scrim plus ring plus card, and it never
composites a scrim over the 3-page hole pager.

### Card treatment — deep-green hero

Chosen from four mocked variants. The toast is a deep-green bar carrying the
tier accent:

- Surface `DEEP_GREEN #00553c` — replaces the orphan `#003d27`, matching
  `LiveRoundCard` and the leaderboard.
- Accent per tier: `rank.gold #d4af37` for birdie, muted clay `#c9a08f` for
  noelada. Left border and icon ring take the accent.
- Label in `PlayfairDisplay-Black`, subtitle `Name · Hole N` in muted white.
- **Score delta** (`−1`, `+3`) right-aligned in the accent colour. This is new
  information the current overlay never showed, and on a noelada it is the
  punchline.

Noelada stays clay rather than red. The Coach work established that *red must
be earned*; a double bogey among friends does not qualify.

## Tier configuration

Presentation, timing and haptic move out of the component and into
`CELEBRATION_TIERS`, so the fall-through bug becomes structurally impossible:

| Label | Presentation | Accent | holdMs | Haptic |
|---|---|---|---|---|
| `BIRDIE` | toast | `rank.gold` `#d4af37` | 900 | `light` |
| `NOELADA` | toast | clay `#c9a08f` | 600 | `selection` |
| `EAGLE` | takeover | `winner.dark` | 1200 | `success` |
| `ALBATROSS` | takeover | `#ffffff` | 1500 | `success` |
| `HOLE IN ONE` | takeover | `winner.dark` | 1800 | `success` |

Every tier declares all five fields. No defaults, no `else` branch.

## Components

**`constants.js`** — `CELEBRATION_TIERS` gains `presentation`, `holdMs` and
`haptic` per tier. `celebrationFor()` is unchanged; it already returns the right
label for every case.

**`CelebrationToast`** (new, `src/components/scorecard/CelebrationToast.js`) —
presentational. Props: `tier`, `label`, `playerName`, `holeNumber`, `delta`,
`anim`. Renders nothing when there is no label. Slides via `translateY -40 → 0`
plus opacity, native driver, `pointerEvents="none"`.

**Positioning is absolute, not in flow.** The toast is absolutely positioned at
the top of `HoleView`, overlaying the hole header. It must not participate in
layout: a toast that pushed content down would shift the score card and its
steppers under the user's finger mid-tap, which is worse than the takeover it
replaces.

**`CelebrationOverlay`** — moved verbatim out of `HoleView.js` into
`src/components/scorecard/CelebrationOverlay.js`, with no behaviour change. Its
logic is untouched; it simply now mounts only for takeover tiers. The extraction
is in scope: `HoleView.js` is already 660 lines, and the toast would otherwise
add a third concern to it.

**`HoleView`** — picks the component from `tier.presentation`. One branch.

**`ScorecardScreen.triggerCelebration`** — reads `holdMs` and `haptic` from the
tier instead of its own conditional chain, and carries `delta` into celebration
state so the toast can display it.

## Data flow

`stepScore` / `setScore` already compute `holePar` and the new strokes, and call
`celebrationFor(holePar, strokes)`. That stays. Two additions:

1. `delta = strokes - holePar`, passed to `triggerCelebration`.
2. `triggerCelebration` looks up the tier once and drives both the haptic and
   the hold from it.

Celebration state becomes `{ playerId, holeNumber, label, delta }`.

## Error handling

- **Unknown label** — falls back to the `BIRDIE` tier, as today. Since every
  tier now declares `presentation`, the fallback is a toast.
- **Missing player** — subtitle is omitted, as today.
- **Missing `delta`** — the delta element is omitted rather than rendering `NaN`.
  Callers that predate the change keep working.
- A celebration already on screen is superseded: `celebrationAnim` is stopped
  and reset before the next one starts, as today.

## Testing

Unit tests, no new runtime surface:

- Every entry in `CELEBRATION_TIERS` declares `presentation`, `accent`,
  `holdMs`, `haptic`.
- `NOELADA.holdMs < BIRDIE.holdMs` — pins the fall-through fix so it cannot
  regress.
- `NOELADA.haptic !== 'success'` — pins the haptic fix.
- Exactly `BIRDIE` and `NOELADA` are `presentation: 'toast'`; the other three
  are `'takeover'`.
- `celebrationFor` behaviour is unchanged (existing tests cover this).
- `HoleView` renders the toast for a birdie and the takeover for an eagle.
- `CelebrationToast` renders label, name, hole and delta; omits the delta when
  it is absent; renders nothing without a label.

## Out of scope

- The `noSpoilers` setting does not currently gate celebrations. Showing another
  player's birdie is arguably a spoiler, but that is pre-existing behaviour and
  a separate decision.
- No sound, no confetti, no new settings toggle.
- No change to `classifyHoleResult` or the grid-view shape notation.
