# Swing checks v2: seven positions, a clubhead you can trust, importance-first priority

Status: design approved by the owner 2026-10-18 (brainstorm in session). Parent plan:
`docs/superpowers/plans/2026-10-11-swing-analyzer.md` (D-numbers below refer to it).

## 1. Why

Comparing a swing against swingcheck.org exposed real problems in ours (#226 fixed the first:
a good address read red and hijacked the main fault). The comparison is only a sanity check; the
goal is a check set that measures the positions coaches judge, with numbers the golfer can trust.

What is wrong today:

- **Positions without checks, checks without positions.** Nothing is checked at the takeaway;
  P5 (transition) and P8 (shaft parallel after impact) are checkpoints the golfer must mark, but
  down the line P8 is hidden behind the body.
- **Some checks measure the wrong thing.** The top compares the lead arm with the *address*
  shoulder plane instead of the body at the top; the downswing is judged from the hand path, not
  the clubhead; spine angle is only checked at impact.
- **A detection is trusted at any score.** `MODEL_MIN_CONF = 0.03` (`club.js`): a 0.05 false head
  72 cm off at P6 becomes a "placed" clubhead and a verdict.
- **Earliest fault first (D21) is fragile.** One noisy early reading (address, takeaway) decides the
  main fault, as #226 showed.

## 2. Decisions (owner, 2026-10-18)

| # | Decision |
|---|---|
| V1 | Seven positions (below) are the backbone; four groups of extras stay after them. |
| V2 | Clubhead marks are automatic. A check that needs the clubhead reads only the golfer's mark or a detection above a confidence gate; otherwise the row is "Clubhead not visible — tap to place" and does not count. |
| V3 | Follow-through is **P9, trail arm parallel**, where the hands and club are visible after impact. P8 is no longer a checkpoint. |
| V4 | Swing plane is a row of Address, not its own position. |
| V5 | Main fault = importance tier, then severity; earlier red positions are named as "likely starts at". |
| V6 | Extras kept: tempo, finish balance, head still, impact hands & shaft. |

## 3. Positions and frames

| # | Position | Frame (P-system) | Clubhead needed |
|---|---|---|---|
| 1 | Address | P1 | swing-plane row only |
| 2 | Takeaway | P2, shaft parallel back | yes |
| 3 | Halfway back | P3, lead arm parallel | yes |
| 4 | Top | P4 | no |
| 5 | Downswing | P6, shaft parallel down | yes |
| 6 | Impact | P7 | no (extras: yes) |
| 7 | Follow-through | P9, trail arm parallel | yes |
| — | Finish (extras only) | P10 | no |

P5 (transition), P8 (shaft through) and the club frames `lateBackswing`, `preImpact`,
`postImpact` stop being checkpoints: no pass-2 club request, no marking step, no check.
`phases.js` may keep using them internally to find other frames.

## 4. Rows

Conventions as today (`checks.js`): mirrored so the golfer is right-handed with the ball on +x,
pixels y down, cm through the leg scale. **Plane line** = ball → address hands (`getPlanes`).
**Tilt** = `spineTiltDeg(mid-hip, mid-shoulder)`. **Knee flex** = 180° − angle at the trail knee
(hip → knee → ankle). Bands are `[green, yellow]` limits on the magnitude unless a range is given.
Every limit is **provisional** until §8 calibrates it; iron and driver share them unless listed.

### 1 Address (P1)

| Row | Status | Measure | Bands | Fault (dir) |
|---|---|---|---|---|
| Spine tilt | keep `posture_address` | tilt | iron 25–40 / 20–45, driver 20–35 / 15–40 | posture |
| Arms hang | keep `hands_under_shoulders` | grip x − shoulder-midpoint x | 8 / 12 cm | posture |
| Upper back straight | keep `back_line` | ear→shoulder vs shoulder→hip | dropped 40 / 50°, up 10 / 20° | posture |
| Knee flex | **new** `knee_flex` | trail knee flex | 15–30 / 10–35° | posture (`stiff` / `squat`) |
| Swing plane | **new** `shaft_plane` | address shaft (head → hands) extended to the body front (mid-hip x + 0.05 × height toward the ball); height where it crosses vs the mid-hip y, + = above (toward the chest) | 10 / 18 cm; the shaft angle is shown, not graded | posture (`upright` / `flat`) |

Dropped: `waist_bend` (mixes tilt and knee flex), `hand_gap` (lead hip hidden down the line).

### 2 Takeaway (P2)

| Row | Status | Measure | Bands | Fault (dir) |
|---|---|---|---|---|
| Clubhead on plane | **new** `clubhead_plane_takeaway` | `sideOfLine(head, plane)`, + = above (outside) | 8 / 15 cm | steep_backswing (+) / flat_backswing (−) |
| Spine holds | **new** `spine_hold` | tilt(address) − tilt(P2), + = standing up | iron 3 / 6°, driver 4 / 7° | posture_loss |
| Trail knee holds | **new** `knee_hold` | flex(P2) − flex(address), − = straightening | 5 / 10° | posture_loss |

### 3 Halfway back (P3)

| Row | Status | Measure | Bands | Fault (dir) |
|---|---|---|---|---|
| Shaft points at the ball | keep `butt_extension` (reworded) | as today | as today | steep_backswing / flat_backswing |
| Spine holds | `spine_hold` at P3 | as above | as above | posture_loss |
| Trail knee holds | `knee_hold` at P3 | as above | as above | posture_loss |

Dropped: `hands_between_planes`.

### 4 Top (P4)

| Row | Status | Measure | Bands | Fault (dir) |
|---|---|---|---|---|
| Lead arm vs spine | **new** `lead_arm_spine` | 90 − the 2D angle between the spine (mid-hip → mid-shoulder) and the lead arm (lead shoulder → lead wrist); + = upright (the arm points more vertically than the perpendicular to the spine, closing the angle with the spine), − = flat | 10 / 20° | top_position |
| Hands over trail heel | keep `hands_over_heels` | as today | 6 / 12 cm | top_position |
| Spine holds | `spine_hold` at P4 | as above | as above | posture_loss |

Dropped: `lead_arm_shoulder_plane` (address plane, not the body at the top), `top_direction`. The
spine is used instead of the shoulder line because the shoulders overlap down the line at the top.

### 5 Downswing (P6)

| Row | Status | Measure | Bands | Fault (dir) |
|---|---|---|---|---|
| Clubhead on plane | **new** `clubhead_plane_down` | `sideOfLine(head, plane)`, + = above (steep) | above: green ≤ 4, yellow ≤ 10; under: green ≥ −12, yellow ≥ −20 cm | over_the_top (+) / stuck (−, new id) |
| Vs your takeaway | **new** `down_vs_takeaway` | `clubhead_plane_down` − `clubhead_plane_takeaway`, + = steeper than going back | green ≤ 0, yellow ≤ 10 cm | over_the_top |
| Spine holds | `spine_hold` at P6 | as above | as above | early_extension |

Dropped: `downswing_path` (hands, not clubhead), `shaft_down_shallow`.
`down_vs_takeaway` needs both clubheads; either missing ⇒ unknown with the missing one named.

### 6 Impact (P7)

| Row | Status | Measure | Bands | Fault |
|---|---|---|---|---|
| Hips stay back | keep `hip_drift` | as today | 3 / 6 cm | early_extension |
| Spine holds | keep `spine_loss` | as today | iron 3 / 6°, driver 4 / 7° | early_extension |

Dropped: `clubhead_vs_plane` at pre-impact and impact.

### 7 Follow-through (P9)

| Row | Status | Measure | Bands | Fault (dir) |
|---|---|---|---|---|
| Shaft points at the ball | **new** `shaft_through_ball` | head → hands extended to ball height (as `butt_extension`), against the ball and the toes | as `butt_extension` | flip (beyond the ball) / over_the_top (inside the toes: out-to-in through the ball) |
| Same line as halfway back | **new** `through_vs_halfway` | landing(P9) − landing(P3) | 10 / 20 cm | flip |

Dropped: `shaft_through_steep` (P8).

### Extras (after the seven, own section)

Unchanged rows: `tempo`, `finish_balance` (P10), `head_drift` ("Head still"),
`hands_height_impact`, `hands_out_impact`, `shaft_angle_impact` ("Impact hands & shaft"). Extras do
not colour a position.

## 5. The clubhead gate (V2)

- `resolveClub` keeps proposing every detection to the marking canvas as today (a dot to confirm).
- `checks.js` reads a clubhead only when `source === 'user'`, or `source` is `edge` with
  `conf ≥ 0.35` (today's rule), or `source` is `model | model-shaft` with `conf ≥ CHECK_MIN_CONF`.
- Below the gate the row is `unknown` with reason `unplaced` and the text "Clubhead not visible —
  tap to place"; the tap opens Edit marks on that position, step 2.
- `CHECK_MIN_CONF` is set from the 16 marked heads (§8): the lowest score that keeps every accepted
  head within 15 cm, and above the false P6 heads (0.05–0.08). It is a named constant with the table
  that chose it in the lab README.

## 6. Priority (V5)

- **Position status** = its worst measured row (red > yellow > green); a position with no
  measured row is unknown.
- **Tiers:** 1 = Address, Downswing, Impact; 2 = Halfway back, Top; 3 = Takeaway, Follow-through,
  extras.
- **Severity** of a row = how far past its yellow limit, in units of its yellow band:
  `(|v| − yellow) / (yellow − green)` (ranges use the nearer edge). Yellow rows rank by the same
  formula against the green limit.
- **Main fault:** among red rows, lowest tier first, then highest severity; if no red, the same over
  yellow rows; if nothing, none ("every position green"). Its `fault` id is the row's fault (§4),
  so `coachSwingLink`, drills and copy keyed by fault keep working.
- **Likely starts at:** the earliest position before the main one that has a red row, if any.
- **Consequences** (today's "Likely also causing") are the other red positions after the main one.
- New fault ids: `posture_loss` (spine or knee not holding before the downswing) and `stuck`
  (clubhead too far under the plane at P6). Each gets copy, a drill and a `SWING_FAULT_LINKS` row
  (or an explicit "no on-course link").

## 7. Old swings, schema, shipping

- `SCHEMA = 'swing-analysis/2'`. A stored analysis with an older schema is re-run through
  `analyze()` from its stored `pose.json`, `probe.json` and `marks.json` when the swing opens (pure
  JS, milliseconds), and saved. Marks at P5 / P8 / internal frames are kept in `marks.json` but
  ignored.
- JS only: pass 2 already returns detections with scores; the request just stops asking for the
  dropped frames. No native change, no apiVersion bump, OTA to the installed runtime.

## 8. Calibration and verification

- **Lab table first** (`tools/swing-lab`): every new row computed on the owner's marked clips
  (`truth.json` + pose), printed per clip, and the owner judges each verdict against the video.
  Limits move until the owner agrees; the table lands in the PR.
- **Gate:** score vs error for the 16 marked heads and the frames marked hidden → `CHECK_MIN_CONF`.
- **Golden tests** move to the new rows: the owner swing's per-position statuses and main fault
  (expected: downswing, likely starts at takeaway, if the lab table agrees).
- **Device:** analyse one new swing and reopen one old swing (re-run to schema 2) on the phone.

## 9. Screens (design step before building)

Three designs (fits in / better / bold) for:

- **Results:** summary of seven positions with status, the main fault with "likely starts at",
  one card per position with its rows, extras section, the "tap to place" row.
- **Marking canvas:** seven positions plus finish; P5 / P8 steps removed.

Copy (en + es) for new rows, faults, drills; dropped rows' copy and drills (`su-bisagra`, `su-palmo`)
removed. Coach: `coachSwingLink` gets the two new fault ids.

## 10. Out of scope

Face-on view; new detector training; per-club limits beyond those listed; any comparison feature
with external tools.
