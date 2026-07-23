# Scorecard shot measuring — design

**Date:** 2026-07-23
**Status:** Approved in conversation (mockups: "First shot, step by step" artifact); pending spec review

## Goal

Let a player capture their club distances **while playing, from the scorecard**, with
the fewest possible interactions. Two flows, one data pipeline:

- **GPS flow (new):** two taps stamp the shot's start and end positions.
- **Manual / no-GPS flow (existing):** place the ball on the hole map by eye — the
  shipped `ShotTracker` flow (aim ring + club FAB + wheel). Nothing new to build.

Both produce real, positioned shots in `shotStore`, so pins, carries, and club
averages all flow through the existing pipeline.

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
- **No usable GPS fix** (accuracy > 25 m, denied, or absent): tapping the FAB opens
  the **hole map sheet** instead — the manual flow's home. One button, one promise
  ("log your shot"), best available mechanism per context.

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

GPS measurements are **real shots** in the existing `shotStore` — the same records the
map flow writes. On tap ②, for the current `roundId/roundIndex/holeNumber`:

1. If the hole has no shots yet, or its last spot is **> 30 m** from the start stamp,
   first append the start stamp as an untagged spot (`club: null`) — the origin.
   (`shotCarries` already skips carries into untagged spots, and the next tagged
   spot measures from it, so the stored carry is exactly start → end.)
2. Append the end stamp tagged with the armed club.

Consequences, all via existing pipelines: the shot appears as a numbered pin on the
hole map, the header re-anchors per its existing last-marked-shot behavior, and the
carry flows into `clubAverages` → future `≈ club` recommendations.

## Manual flow (no GPS) — the hole map

Shots are placed on the **hole map** as shipped: header block → map sheet → position
the aim ring → club FAB → wheel. Positions come from the player's eyes on the
satellite imagery instead of a GPS fix; the saved shot is identical in shape and
flows through the same pins/carries/averages pipeline.

The scorecard FAB routes here automatically when no usable fix exists (see Entry
point), so the manual flow needs no mode of its own.

### Specifying start AND end (two rings)

Today "Add shot" only places the landing — the start is implicit (previous pin, or
the auto-seeded tee). That breaks when the implicit start is wrong (e.g. measuring
only your 3rd shot on a hole with nothing logged). Fix, reusing the existing
two-ring mechanic:

- **Hold (long-press) on the map adds a second aim ring** — this shipped 2026-07-20
  and must keep working; verify at runtime and repair if the recent pin-interactivity
  change broke it.
- **With two rings placed, "Add shot" logs the segment ring 1 → ring 2**: append the
  ring closer to the start of the chain as an untagged origin spot (`club: null`,
  subject to the same > 30 m dedupe rule as the GPS flow), then the far ring as the
  landing, tagged via the club wheel. Afterwards the rings collapse to one at the
  landing, ready for the next shot.
- **With one ring, behavior is unchanged**: landing at the ring, start = previous
  pin / seeded tee.

### Adjusting shots (GPS- and map-added alike)

Shot pins on the map become **directly draggable** — drag a pin to reposition that
spot (`setShotPos`), with the trail and carry chips recomputing live. Tapping a pin
still opens the club wheel (re-club / delete; the wheel's Move mode becomes
redundant and is removed). GPS-stamped and manually placed shots are identical
records, so both adjust the same way.

### Hint cleanup

Remove the persistent **"Drag the ring to measure"** pill at the bottom of the map —
it advertises only one of the ring's abilities and adds clutter. The HUD (F/C/B
distances) stays.

## Distance priority — unchanged

`recommendClub` keeps its existing ladder: **manual bag override → measured average
(logged-shot carries, GPS-stamped or map-placed alike) → catalog nominal.** No new
tier; no calibration-samples store. (A "quick set" bulk seeding flow in Your Bag
remains a possible follow-up, out of scope here.)

## Setting

`Settings → GPS` gains **"Shot measuring button": On · Off** (default On, stored as
`settings.shotMeasuring: 'on' | 'off'`).

- **On:** the FAB renders during live rounds; tap = GPS tracker with a usable fix,
  hole map otherwise.
- **Off:** the FAB is not rendered at all (the map flow stays reachable via the
  header, as today).

Background/no-interaction shot detection was evaluated and cut (phone-only GPS cannot
attribute clubs and drains battery; fails the "works well" bar).

## Non-goals

- No changes to `ClubWheel` internals (beyond dropping its Move action),
  `shotStats` carry math, or `HoleDistanceBlock`.
- No background auto-detection of shots.
- No numeric distance-entry UI; no calibration-samples store.

## Testing

- Store/logic: arm/finish stamping, the >30 m origin-insert rule, min/max guards,
  undo deletes both inserted spots when the origin was just created.
- Component: FAB renders only in live rounds with the setting On; armed card blocks
  tap ② under 20 m; `change ⌄` opens the wheel; ✕ cancels cleanly; FAB opens the
  hole map when the fix is unusable.
- Map page (string-level, per `holeMapHtml.test.js` convention): two-ring add posts
  both positions; pins are draggable and post a move with the correct index; the
  "Drag the ring to measure" hint is gone; the long-press second-ring handler is
  present.
- Runtime verify: hold-to-add-second-ring works in the live map (suspected broken);
  pin drag vs tap don't conflict.
- Setting: On/Off gating.
- Full `npm test` and `npm run lint` stay green.
