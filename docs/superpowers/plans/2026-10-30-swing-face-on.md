# Swing analyzer: face-on view and swing speed

**Status:** plan, awaiting OK (2026-10-30). Branch `feat/swing-face-on`.
**Adds:** a second camera position to the swing analyzer. A clip filmed face-on (camera in
front of the golfer, square to the target line) gets its own positions and checks, and, at
≥ 120 fps, ball speed, clubhead speed, smash factor and launch angle. Down-the-line (DTL)
analysis is unchanged.

Out of scope here: a paired DTL + face-on view of one swing (two phones), iOS capture, a
face-on-trained club model (§7, follow-up once there are exports), spin and carry.

## 1. Decisions (Marcos, 2026-10-30)

| # | Decision |
|---|---|
| F1 | Face-on checks **and** speed in one plan, shipped in stages (§9). |
| F2 | Checks: sway & slide, head movement, shaft lean at impact, ball position & stance, plus what swingcheck.org covers (§4). |
| F3 | Speed is calibrated at a range against a launch monitor (§8). |
| F4 | **Auto-detect only.** No view picker before recording or import; `viewOf` decides, and Results offers a one-tap "Filmed from behind / in front?" correction that re-runs the analysis with the other view. |
| F5 | **Design A** (review 2026-10-31, artifact `QxE4nn29fTw1KCKzDBrzoo`): Results keeps today's structure. Face-on swings get the five positions + Extras in the strip, a view row ("Grabado de frente · ¿Era desde atrás?") under it, and the speed as Extras rows (ball, club, smash factor, launch; "≈", the word "estimación", no status dot). "For now": B's speed band stays the next step if speed turns out to be read on every swing. |
| F6 | Speed targets accepted: ball median ≤ 5 % / worst ≤ 10 %, club ≤ 8 % / 15 %, launch ≤ 2°. |

## 2. What exists

- `analyze.js` `viewOf()` already labels a clip `faceOn` | `dtl` (spine tilt < 12° and ankle
  span > 0.6 torso at address). Validated on one face-on clip (`rory-driver`, 166 fps
  estimated, no ball found) and the DTL lab clips. Results shows a "take with care" banner
  for `faceOn` and runs the DTL checks anyway.
- The phases (`phases.js`) are pose-geometric: P2/P6 grip at trail-hip height, P4 end of the
  hands' plateau, P7 ball gone, P10 grip and nose still. None depends on the camera position
  except P3/P5/P9's "wrist in the shoulder band", which is checked face-on in S1 (in a
  face-on view a lead arm parallel to the ground is seen directly, so the rule should hold or
  get simpler).
- Scale: `scale.js` leg scale (±8–10 %). Face-on both legs lie in the image plane; the rule
  holds.
- Clubhead: the native pass 2 finds the head on the checkpoint frames (YOLOX model trained
  on **DTL** frames) and tracks the resting head at address. `tools/swing-lab/track_impact.py`
  prototypes carrying the impact head frame by frame to P6/P8.
- The plan of 2026-10-11 §12 parked face-on; the capture guide has room for a second card.

## 3. Face-on positions

Five positions, the swingcheck.org face-on set (and the standard face-on coaching frames):

| Position | Frame (from `phases.js`) | What it shows |
|---|---|---|
| Address | `address` | stance, ball position, spine tilt |
| Top | `top` | sway, head |
| Downswing | `shaftDown` (P6) | hips moving to the target, head staying back |
| Impact | `impact` | shaft lean, hips, head behind the ball |
| Finish | `finish` | weight on the lead side, balance |

`resultsSteps.js` and the position dots read the list for the swing's view (`POSITIONS_BY_VIEW`),
so DTL keeps its seven.

## 4. Face-on checks

Measured in cm through the leg scale, mirrored for left-handers as the DTL checks are. "Toward
the target" = +x after mirroring. Limits below are **starting values** from coaching norms;
every one is re-read on the lab clips and the owner's face-on swings before it ships (§8).

| Position | Check (`id`) | Measure | Start limits (green / yellow), iron · driver | Fault |
|---|---|---|---|---|
| Address | `foStance` | ankle span ÷ shoulder width | 1.0–1.3 / 0.9–1.4 · 1.1–1.5 / 1.0–1.6 | `stance_width` |
| Address | `foBallPos` | ball x within the stance, 0 = trail ankle, 1 = lead ankle | 0.45–0.6 / 0.4–0.7 · 0.75–0.95 / 0.7–1.0 | `ball_position` |
| Address | `foSetupTilt` | spine tilt away from the target, degrees | 0–8 / −3–12 · 5–15 / 2–18 | `posture` |
| Top | `foSway` | trail hip x past the trail ankle (away from the target), cm | ≤ 3 / ≤ 7 | `sway` |
| Top | `foHeadTop` | head (nose) moved sideways since address, cm | ≤ 5 / ≤ 10 · ≤ 7 / ≤ 12 | `head_sway` |
| Downswing | `foHipsShift` | pelvis centre moved toward the target since the top, cm | ≥ 8 / ≥ 4 | `hanging_back` |
| Downswing | `foHeadBack` | head not past its address x toward the target, cm | ≤ 2 / ≤ 6 | `head_sway` |
| Impact | `foShaftLean` | shaft from vertical, + = hands ahead of the clubhead, degrees | 5–15 / 0–20 · −4–6 / −8–10 | `flip` (behind) · `excess_lean` (iron, far ahead) |
| Impact | `foSlide` | lead hip past the lead ankle toward the target, cm | ≤ 4 / ≤ 8 | `slide` |
| Impact | `foHeadImpact` | head behind the ball (x), cm; and drop since address (y), cm | behind ≥ 0 / ≥ −4; drop ≤ 4 / ≤ 8 | `head_sway` · `head_dip` |
| Finish | `foFinishWeight` | pelvis centre over the lead ankle (share of the stance) | ≥ 0.8 / ≥ 0.65 | `hanging_back` |
| Extra | `tempo` | as DTL (view-independent) | as DTL | `tempo_fast` / `tempo_slow` |
| Extra | `balance` | as DTL | as DTL | `balance` |

- New fault ids: `stance_width`, `ball_position`, `sway`, `slide`, `hanging_back`, `head_dip`,
  `excess_lean`. Each needs a label, copy (es/en) and at least one drill (§6). `flip`, `posture`,
  `head_sway`, `tempo_*` and `balance` are reused.
- `priority.js` tiers for face-on: 1 = address, impact; 2 = top, downswing; 3 = finish, extras.
- Shaft lean needs the clubhead and the hands at impact. The club model is DTL-trained; until
  a face-on one exists (§7) the impact head comes from the impact track (§5) or the golfer's
  mark on the canvas, and the row is `unknown` ("place the clubhead") otherwise, as DTL does.
- `checks.js` grows a `runFaceOnChecks(input)` next to `runChecks` (same helpers, its own row
  list and `THRESHOLDS_FO`), chosen in `analyze.js` by view. No DTL row changes.

## 5. Speed

Face-on, the club and ball move across the picture at impact, so their speed can be read
from the image directly. DTL clips get no speed row (they move along the camera's axis).

**Scale at the ball.** The ball is ~0.6 m nearer the camera than the golfer's legs, which at
3 m is ~20 % bigger in the picture, so the leg scale would overstate. Speed uses the ball's
own diameter (4.27 cm), measured sub-pixel by the native ball finder over the address
frames (median). Sanity: ball scale ÷ leg scale must sit in [1.0, 1.5], else no speed row
("couldn't measure the ball's size").

**Ball speed and launch.** From `ballGoneFrame` forward, the native pass searches a corridor
toward the target (0–35° up) frame by frame for the ball: a bright blob or streak in the
frame difference, nearest the line predicted from the previous two. 3–8 positions, a
least-squares line through the streak centres → px per captured frame → m/s with the
capture fps. Launch angle = the line's angle to the ground line (the ankles' line at address).

**Clubhead speed.** The impact track (`track_impact.py` → Kotlin `ImpactTrack`) carries the
head from impact back 2–4 frames (blurred: the centre of the streak), distance over captured
time at the ball scale, the frames just before contact.

**Gates.** Capture fps ≥ 120 (≥ 100 = `APPROX_FPS` today; speed is stricter: one frame of
timing at 60 fps is ±25 %). Smash factor ball ÷ club in [1.15, 1.55], else the club speed is
dropped (the ball speed is the better-measured one). Speeds outside 40–210 mph (ball) /
30–140 mph (club) are dropped as misreads. Shown as an estimate: "≈ 152 mph" with the ± from
§8, never with a decimal.

**Units.** Follows the existing `units` setting: yards → mph, meters → km/h. Stored in m/s.

Pure JS in `src/swing/speed.js` (positions + fps + scale → speeds, gates, confidence);
the image work is native (§7).

## 6. Copy, drills, coach

- Strings in `src/i18n/locales/{en,es}/swing.js`; Spanish golf terms per `docs/i18n.md`
  (sway = "balanceo lateral", slide = "deslizamiento de cadera", shaft lean = "inclinación
  del palo hacia delante").
- Drills (`drills.js`, our own wording, a well-known drill credited by name only): one each
  for `sway` (trail-foot wall / alignment stick outside the trail hip), `slide` (stick
  outside the lead hip), `hanging_back` (step-through), `head_dip` / `head_sway` face-on
  (shadow / head-against-a-wall), `ball_position` and `stance_width` (two-stick setup),
  `excess_lean` and `flip` (impact-bag / hands-ahead). Each carries the existing progression line.
- `coachSwingLink.js` maps the new faults to Coach leaks where one fits (`hanging_back`,
  `flip` → contact; `ball_position` → driving), else none.

## 7. Native and web

- `GolfSwingModule.kt` `API_VERSION` 7, new gate `SPEED_API_VERSION = 7` / `speedSupport()`.
  Pass 2 takes `view`. Face-on it adds `ballFlight` (`[{f, x, y, w}]`, normalised) and
  `impactTrack` (`[{f, x, y, conf}]`) and the ball's sub-pixel `d`.
- New Kotlin: `BallFlight.kt` (corridor search on frame differences), `ImpactTrack.kt` (port
  of `track_impact.py`'s chosen variant). JVM-pure unit tests on synthetic buffers (a drawn
  moving disc / streak: speed ± 2 %, launch ± 1°).
- Web: line-for-line ports in `src/swing/web/core/ballFlight.js` and `impactTrack.js`,
  `native.web.js` to apiVersion 7. Tests share the Kotlin cases.
- Older binaries: face-on checks still run (pure JS, OTA); the speed card says "Update the
  app to measure speed" when `speedSupport()` is false.
- Native ⇒ new `preview-arm64` APK. S1/S2 are JS-only and OTA.
- Club model: face-on frames are added to the training export (`view` in the export
  manifest), so a face-on head detector can be trained later. Not in this plan.

## 8. Calibration and the lab

- **Lab reference:** `detect.py --view faceon` gets the face-on checks and speed as the
  Python reference; `eval_faceon.py` scores them against truth; `export_fixture.py` writes
  face-on fixtures for `referenceSwings.test.js`.
- **Clips needed (Marcos):**
  1. *Home, now (checks):* 5–8 face-on swings at 240 fps, iron and driver, phone at hand
     height ~3 m in front, square to the target line, whole body and ball in frame, some
     with a deliberate sway / slide / hanging back.
  2. *Range (speed):* 10+ face-on swings at 240 fps beside a launch monitor, half driver,
     half 7-iron, writing down club speed, ball speed and launch angle per shot. Good light
     (short exposure = shorter blur).
- **Acceptance:** ball speed median |error| ≤ 5 % and worst ≤ 10 %; club speed ≤ 8 % / 15 %;
  launch ≤ 2°. Missed → the card shows a range, or the row stays hidden, and we say so.
- `viewOf` re-validated on all new face-on clips and every DTL clip (no flips).

## 9. Stages

| Stage | Contents | Ships as | Verified by |
|---|---|---|---|
| S0 | Lab: face-on reference in `detect.py`, `eval_faceon.py`, fixtures from the home clips | — | eval numbers |
| S1 | JS: `runFaceOnChecks`, positions by view, faults, copy, drills, priority tiers, view correction, `SCHEMA` 7 (face-on swings re-run on open) | OTA | `npm test` / lint, fixtures, `/verify` on web import |
| S2 | UI: Results face-on variant, speed card (hidden until S3), capture guide face-on card, Compare only within a view | OTA | three designs first (deliver step 2), `/verify` |
| S3 | Native + web: `BallFlight`, `ImpactTrack`, ball diameter, apiVersion 7, `speed.js` | APK + OTA | JVM tests, web tests, device (Marcos) |
| S4 | Range calibration, limits and speed tuned, schema bump if numbers move | OTA | §8 acceptance |

## 9a. Status (2026-10-31)

- **S1 + S2 built** (JS only, uncommitted on `feat/swing-face-on`): `checksFaceOn.js` (12 rows, `targetDir`
  from the top hands against the middle of the feet), view-aware positions / tiers / main fault /
  results steps / marking pass (`markedKeysOf`, 4 marked face-on), `viewOverride` in marks.json passed
  to every `analyze()` caller, `row.view` on the index (the list counts x of 4), Results per design A
  (view row + switch, no face-on notice), face-on overlays (`highlights.js`), compare only within a view,
  8 faults with copy / fix cards / 6 drills / coach links, the capture guide's face-on card, schema 7.
  The fault for hands behind at impact is `scoop` (not `flip`: flip's copy is the down-the-line reading).
  The stance is read against 0.23 x height, not the shoulders on screen (they narrow as the chest turns).
- **swingcheck.org's face-on rule set adopted (2026-10-31, Marcos):** only its checkpoint definitions and
  marking steps are public (its limits and detection run on its server). Impact reads the hands against
  the ball (`fo_hands_ahead`, replacing the clubhead-based shaft lean), impact checks the hips moved to the
  target (`fo_hips_impact`), the finish checks the head over the lead foot (`fo_finish_head`). Nothing
  reads the clubhead face-on, so the face-on marking pass asks for the hands (and the ball at address)
  only: `MARKS_AT(key, view)`, no Clubhead tile. A "ball" more than half a stance outside the feet reads
  as no ball. Verified on the web (dock = Manos, Bola; the pass confirms all four).
- **Not built:** speed (S3, native + web) and so the Extras speed rows; calibration (S4).
- **Verified:** `npm test` 485 suites green, lint 0 errors, `npm run build:web` exports; web walkthrough
  (Expo web, a minted account, a downloaded face-on clip and one of the owner's DTL clips): 4 marking chips
  and "0 de 4" face-on, 7 down the line; Results strip 5 + Extras face-on, 7 + Extras down the line; the
  view row switches both ways, asks first, and persists. Capture (native) not verified: needs the device.
- **S0 findings, before any limit is trusted:** on both internet face-on clips tried, the phases are wrong,
  not the checks: `rory-driver` has no still address (trimmed into the takeaway, so the per-clip "stopped"
  threshold reads the slow first half of the backswing as still: address = halfway back); `am-iphone5-240`
  holds the swing more than once (real time and a replay): address landed after impact, impact on the
  finish. S0 has to trim the web clips to one swing with a hold, and check whether face-on needs its own
  address rule. With the frames right (McIlroy's top / downswing / impact / finish), sway, hip shift, slide
  and finish weight read green, as a tour pivot should (pinned in `faceOnView.test.js`).
- **S0 phases fixed (2026-10-31):** dense pose of 22 web clips (`detect.py --variant d15 --dense`),
  the swings in each found by `tools/swing-lab/swing_segments.py`, top / impact read off labelled stills.
  The downswing anchor (`phases.js` `downswingAnchor`, twin `detect.py` `downswing_d15`, same frames on
  the three checked clips) now keeps only descents that (1) span 5+ samples (a 2-3 sample drop is the
  grip estimate jumping), (2) end within 0.15 H of the hands' lowest (address) level, (3) are followed by
  the follow-through lifting the hands 0.2 H within 3x the descent's own duration (a ratio, so a wrong
  slow-motion guess cannot reject the real one), and picks the first one within 70 % of the biggest
  drop. Before: 4 of 4 checked face-on clips locked onto the finish (100-300 frames late, one read
  60 fps); after: top and impact within ~10 frames on 13 clips at the right frame rate, sampled and dense
  pose. Down the line unchanged (every reference and owner fixture). `viewOf` widened to tilt < 20 deg and
  ankles > 0.45 torso (two face-on clips read down the line). Three clips are reference fixtures now
  (`faceon-oosthuizen-driver`, `faceon-amateur-iron-240/-120`, landmarks only) with their frames pinned.
- **S0 first calibration:** the head rows read the ears' middle, not the nose (the nose swings sideways as
  the face turns: 11-13 cm phantom moves on tour downswings). Limits moved to what the tour clips read:
  hips shift 5 cm (was 8), slide 6/10 (bump), head back 5/12, finish weight and head per club (a driver
  finishes with the hips 60-88 % across and the head 9-35 cm behind the lead foot). Still provisional:
  address-dependent rows (setup tilt, tempo, head moves) were read with a pose-only address; in the app
  pass 2's clubhead onset sets it.
- **Known small issue:** the processing screen lists the 7 down-the-line positions until pass 1 says
  the view (a few seconds of "Revisa 7 posiciones" on a face-on clip).

## 10. Risks

| Risk | Mitigation |
|---|---|
| One face-on reference clip; limits are coaching norms, not measured | S0 needs the home clips before S1 limits are final; rows start conservative (wide yellow) |
| `viewOf` misreads (e.g. an open DTL stance) | the Results correction (F4); re-validated on every clip |
| DTL-trained club model misses face-on heads → shaft lean `unknown` | impact track + golfer's mark; face-on frames into the export |
| Ball is ~8–14 px; blur at 1/240 s indoors | sub-pixel diameter over many address frames; ball-speed fit over 3–8 frames; light advice in the guide; gates |
| Ball leaves the frame in 2–3 frames when framed tight | guide asks for ~1 m of space on the target side; < 3 ball positions ⇒ no ball speed |
| Perspective: ball and legs at different depths | ball-own scale for speed, leg scale for the body (§5) |
| Left-handers | mirrored x as DTL; one mirrored fixture in tests |

## 11. Files

`src/swing/analyze.js`, `checks.js` (+ `runFaceOnChecks`), `checkpointChecks.js`, `priority.js`,
`resultsSteps.js`, `drills.js`, `strings.js`, new `speed.js`, `native.js` / `native.web.js`,
`web/core/{ballFlight,impactTrack}.js`, `src/screens/SwingResultsScreen.js`,
`SwingCaptureScreen.js` (guide), `SwingCompareScreen.js`, `components/swing/*` (speed card,
position dots), `store/coachSwingLink.js`, `i18n/locales/{en,es}/swing.js`,
`modules/golf-swing/.../{GolfSwingModule,Checkpoints,BallFlight,ImpactTrack,Ball}.kt`,
`tools/swing-lab/{detect.py,eval_faceon.py,export_fixture.py}`, CLAUDE.md (face-on and speed notes).
