# Swing analyzer: four checks from the coach series — build plan

Source: a 7-part "build a consistent swing" series by an online coach (Dom), shared from the phone on
2026-10-30. Each row below names the part and the moment it comes from. Everything is down the line and
JS only: one OTA to the installed runtime, no APK, no `apiVersion` bump.

Face-on checks (stance width, ball position, trail-hip sway, lead arm–shaft 90°, hands ahead at impact)
are a separate plan: today every check assumes down the line and a face-on clip only gets a banner.

## Rows

| # | Row | Where | Measure | Needs | Fault |
|---|---|---|---|---|---|
| R1 | `hands_bicep` | halfway back (P3), tier 2 | the grip against the trail upper arm (trail shoulder → trail elbow) at the hands' height, cm along the target-line normal; + = in front of it, over the chest | pose + hands | + `steep_backswing` (hands lifted up and away), − `flat_backswing` (whipped inside) |
| R2 | `swing_symmetry` | extra (lists under follow-through, never colours it) | line ball → hands at the top; the hands' distance from it at the first frame after impact where they reach the trail shoulder's height, cm | pose + ball | decided in the lab (see L1) |
| R3 | `finish_trail_foot` | extra (lists under finish) | trail heel above trail toe at the finish, cm: the weight is off the trail foot | pose | `balance` |
| R4 | `shaft_top` | top (P4), tier 2 | the shaft (hands → clubhead) at the top against the address shaft plane, degrees; + = across the line, − = laid off | clubhead at the top | `across_the_line` / `laid_off` |

Sources: R1 part 4 at 49–56 s ("your hands are splitting your bicep"); R2 part 7 at 70–83 s (a line from the
ball through the hands at the top, the hands exit on the same line); R3 part 7 at 34–46 s (all the weight off
the trail foot, toe tap); R4 part 4 at 11–20 s ("the shaft is right on the plane").

`across_the_line` and `laid_off` already have a label, copy and a drill each, but no row feeds them. They
join `FAULTS` (`priority.js`).

### First numbers (13 reference swings, 2026-10-30, not yet limits)

- **R1** reads +8..+24 cm on the tour swings and +4..+26 on the owner's: every swing "in front of the biceps".
  That does not match the coach's still, where the hands cover the biceps. Either our `leadArm` frame comes
  earlier than his "lead arm parallel" (the hands sit 18–31 cm under the trail shoulder at ours), or the
  elbow landmark is off down the line. **L1 decides; R1 ships only if the lab table separates good from bad.**
- **R2** is readable on 5 swings (the others have no ball): −23..+7 cm, and the tour swings alone spread
  30 cm. It is an extra until the lab says it means something.
- **R3**: the heel is above the toe on all 13 (4–24 cm). There is no flat-footed finish to set the red side.
- **R4**: no reference swing has a clubhead at the top. The lab has 5 owner tops marked (`truth.json`).

### L1 first look at the stills (2026-10-30)

- **R1 is not measurable yet.** On the stills, the `leadArm` frame is often past "lead arm parallel" (Woods
  and the owner's 15-oct swing have the shaft near vertical), and the pass-1 hands sit up to ~20 cm off the
  glove (owner 18-oct 01:08). The cue also depends on the camera's height: the coach films at hand height,
  most reference clips are lower, which pushes the hands "in front of" the arm. R1 waits until the
  halfway-back frame and its hands are fixed.
- **R4 has no reference line.** Down the line the shaft at the top points into the picture, so "on plane"
  means pointing at the target line's vanishing point, which one picture does not give (the toe and heel
  lines are too short to find it). The clubhead at the top is also a few faint pixels on most tour clips.
- **R2 looks real.** On the five swings with a ball, the hands after impact run close to the ball → top line,
  with wrist jitter where the arms cross the body. Measure it as the median distance over the stretch
  between shoulder height and the top-hands height, not one frame.
- **R3 reads right** on every still (trail heel above the toe at the finish).

### Built (2026-10-30, owner asked for all four)

- **R1** measures the grip against the trail **shoulder**, not the shoulder→elbow span (the trail elbow landmark
  wanders behind the body down the line). Tour −4..+20 cm, the owner −3..+7: limits −8..15 green, −14..22 yellow.
  The import screen already asks for the phone at hand height on the toe line, the coach's camera.
- **R2** is the median over the climb from trail-shoulder height to top-hands height; tour −6..+14 cm → 15 / 25 cm.
  No fault: it shows, it never becomes the main fault.
- **R3** green from 3 cm of heel above toe, red under 1 (all 13 reference swings 3–24 cm).
- **R4 removed** (owner, 2026-10-30): one down-the-line picture gives no reliable target line at the top.
- **Limits from the tour swings (2026-10-31, owner).** Green = the range of the seven tour swings widened by a
  sixth of its spread on each side, yellow a further third: `hands_bicep` −8..24 / −16..32 cm (tour −4..+20),
  `swing_symmetry` −10..18 / −18..26 cm (tour −6..+14, Woods' and Rose's balls marked on the stills for the
  table), `finish_trail_foot` ≥ 2 / ≥ −1 cm (tour 3..12). A guard test keeps every tour swing green on them.
  The 10 Oct test swing's 28 cm is now a yellow, so its main fault no longer "starts" halfway back.
- Drills: `sb-muslo` (stick down the lead thigh), `fb-pared` (wall at the trail side), `ott-bolsa` (swivel the
  bag), `fl-bombeo` (pump and stop); `bal-tres-seg` gained the toe tap. Overlays reuse the existing drawing
  vocabulary (no three-design step).
- Schema 7. The analyze fixture swing (10 Oct) now reads hands 28 cm in front at halfway back: its early
  extension "likely starts at" halfway back.

## Order

```
L1 lab table ──► E engine + copy ──► U drawings ──► verify ──► OTA
D1 three designs (drawings only) ──┘
```

## Build items

| # | Item | Files | Verification |
|---|---|---|---|
| **L1** | **Lab table.** A script runs R1–R4 over the reference swings and the lab clips (`truth.json` + pose), prints a row per clip with the value and the still it was read on; the owner judges each against the picture. Settles R1's frame/definition, R2's fault (or no fault), R3's green limit, and R4's sign and limits. | `tools/swing-lab/coach_checks_table.*` | table in the plan with the owner's verdicts; rows that do not separate are dropped here, not shipped |
| **E1** | **Rows** R1–R4 in `runChecks`, limits in `THRESHOLDS` (provisional comment, iron/driver where they differ); extras' homes in `EXTRA_HOME`; R2 in `BALL_ROWS`; R4's unplaced top clubhead asks to be placed (`rowNeeds`). | `checks.js`, `checkpointChecks.js`, `rowNeeds.js`, `priority.js` | synthetic-pose tests per row: bands, sign/dir, unknown reasons, left-handed mirror |
| **E2** | **Schema 7**: stored analyses re-run on open and gain the rows. | `analyze.js` | existing re-run test; the reference test stays green (≥ 70 % of tour rows green, early extension still the owner's main fault on 4 of 5) |
| **E3** | **Drills**, written in our words: wall at the trail side (R1, top), duffel bag swivel (over the top), alignment stick down the shaft brushing the lead thigh (takeaway, R1), pump twice and stop before a stick (flip); `bal-tres-seg` gains the toe tap (R3). | `drills.js` | catalogue tests; each new check has a drill |
| **C1** | **Copy** en + es: labels, texts, fix copy, drills; Spanish per `docs/i18n.md`. | `src/i18n/locales/{en,es}/swing*.js`, `strings.js` | `stringsEs.test.js` parity |
| **D1** | **Designs** for the four key-line drawings on a real still (the biceps box, the symmetry line, the trail foot, the top shaft against the plane): Now / A / B / C. Stop for the pick. | none (not committed) | owner picks |
| **U1** | **Drawings** per the pick. | `highlights.js` | highlight tests; `/verify` on the web results screen with a reference swing |

## Verification and shipping

`npm test` + `npm run lint`; `/verify` walks the results screen on the web build (new rows, their drawings,
the tap-to-place ask at Top). On the phone (Marcos): one new swing and one old one reopened. Ship with the
arm64 OTA command and its Sentry source-map upload (CLAUDE.md).

## Open questions for the owner

1. Film two or three deliberately bad swings (flat-footed finish, hands lifted out in front at halfway back),
   so R1 and R3 have a red side to calibrate on.
2. Clubheads at the top of the 7 tour swings for R4: placed by the owner in the lab editor, or by me on the
   stills and confirmed by the owner.
3. R2 as an extra that never colours the follow-through: OK?
