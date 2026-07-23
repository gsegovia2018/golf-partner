# Scorecard shot measuring — design

**Date:** 2026-07-23
**Status:** Approved in conversation (mockups: "First shot, step by step" artifact); pending spec review

## Goal

Let a player capture their club distances **while playing, from the scorecard**, with
the fewest possible interactions. Two flows: **GPS** (two taps stamp the shot's start
and end positions) and **no-GPS / manual** (club + distance dial). Distances feed the
existing club-recommendation pipeline.

## Entry point: a floating club button on the scorecard

A small circular **club FAB** (the `ClubIcon` SVG, accent green `#006747`, white icon)
floats bottom-right on the scorecard's hole pages during a live round, above the tab
bar. A small badge above it shows the current club suggestion (`≈ 8i`) — the same
`recommendClub` result the header block shows.

- Same button language as the hole map's shot FAB: *the green club button logs shots.*
- Zero footprint otherwise — no rows added to the hole page (explicit user requirement:
  the hole UI is already cluttered).
- Rendered at the **scorecard screen level** (sibling of the pager, like the GPS
  machinery), NOT inside a `HolePage` — the tracker must survive hole swipes and
  opening the map sheet.

## States (GPS flow)

**Idle FAB → armed card → saved toast → idle FAB.**

1. **Tap ① — arm.** Stamps `start = current GPS fix` and pre-attributes the
   **suggested club** (zero selection taps in the common case). The FAB expands into a
   compact floating card (deep green `#00553c`, ~212 px wide, same corner):
   - Top row: club label · `change ⌄` (opens the existing `ClubWheel`) · `✕` cancel.
   - Live counter: metres from the start stamp to the live fix (haversine), climbing
     as the player walks. Accuracy line (`GPS ±6 m`).
   - The **whole card is tap ②**, labeled "TAP WHEN YOU'RE AT THE BALL".
2. **Tap ② — finish.** Stamps `end = current GPS fix`, saves the shot (below), shows a
   toast `✓ Driver · 214 m saved · Undo`, and collapses back to the FAB — whose badge
   now shows the refreshed suggestion for the next shot.

Guards:
- Arming requires a usable fix (accuracy ≤ 25 m — the existing scorecard threshold).
  Without one, tap ① opens the **manual card** instead.
- Tap ② is disabled until the counter exceeds ~20 m (mis-tap guard); over ~350 m the
  save asks for confirmation (probably rode a cart).
- `✕` cancels without writing anything. Undo on the toast deletes what was saved.

Non-blocking overlay (explicit user requirements):
- The rest of the scorecard stays fully usable while tracking: score steppers, pickup,
  hole swiping, and opening the hole map all work; the card only occupies the corner.
- **The header distance block NEVER shows the tracked distance.** It keeps its one
  meaning — distance **to the hole** (live GPS / last marked ball / tee fallback,
  unchanged semantics) — while the floating card owns distance **from the strike**.
  No changes to `HoleDistanceBlock`.
- Tracking state lives in memory at screen level; it does not persist across app
  restarts (a stale start stamp is worse than re-arming).

## What gets saved (GPS flow)

GPS measurements are **real shots** in the existing `shotStore` — not a parallel
store. On tap ②, for the current `roundId/roundIndex/holeNumber`:

1. If the hole has no shots yet, or its last spot is **> 30 m** from the start stamp,
   first append the start stamp as an untagged spot (`club: null`) — the origin.
   (`shotCarries` already skips carries into untagged spots, and the next tagged
   spot measures from it, so the stored carry is exactly start → end.)
2. Append the end stamp tagged with the armed club.

Consequences, all via existing pipelines: the shot appears as a numbered pin on the
hole map, the header re-anchors per its existing last-marked-shot behavior, and the
carry flows into `clubAverages` → future `≈ club` recommendations.

## Manual flow (no GPS)

Tap ① opens a **manual card** in the same corner instead: a club chip (`⌄` opens the
wheel; defaults to the suggestion when one exists, else the last club logged), a
snapping **distance dial** (5 m steps, seeded at the club's current effective
distance), and one **Save** button.

Manual entries are **calibration samples**, not shots — they have no positions:

```js
// settings/profile-backed store, shape per sample:
{ club: '7i', meters: 145, ts: '2026-07-23T14:05:00Z' }
```

## Distance priority (one new tier)

Effective distance per club, everywhere (`recommendClub`, BagScreen rows):

**manual bag override → GPS-measured average (logged-shot carries) → manual-sample
average → catalog nominal**

Manual samples never override GPS-measured carries. BagScreen tags the sample tier
`LOGGED` (alongside today's `SET` / `MEASURED` / `EST`).

## Setting

`Settings → GPS` gains **"Shot measuring": Auto · Manual · Off** (default Auto,
stored as `settings.shotMeasuring: 'auto' | 'manual' | 'off'`).

- **Auto:** GPS card when a usable fix exists, manual card otherwise.
- **Manual:** always the manual card.
- **Off:** the FAB is not rendered at all.

The only "automatic detection" involved is *is GPS usable right now* — reliably
detectable. Background/no-interaction shot detection was evaluated and cut (phone-only
GPS cannot attribute clubs and drains battery; fails the "works well" bar).

## Non-goals

- No changes to the hole map's `ShotTracker`, `ClubWheel` internals, `shotStats`
  carry math, or `HoleDistanceBlock`.
- No background auto-detection of shots.
- No bulk "quick set" bag-anchor flow in this spec (possible follow-up in Your Bag).

## Testing

- Store/logic: arm/finish stamping, the >30 m origin-insert rule, min/max guards,
  undo deletes both inserted spots when the origin was just created.
- Component: FAB renders only in live rounds with measuring ≠ Off; armed card blocks
  tap ② under 20 m; `change ⌄` opens the wheel; ✕ cancels cleanly.
- Priority: `recommendClub`/BagScreen honor the new sample tier ordering.
- Setting: Auto/Manual/Off gating, manual fallback when accuracy > 25 m.
- Full `npm test` and `npm run lint` stay green.
