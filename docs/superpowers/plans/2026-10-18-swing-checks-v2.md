# Swing checks v2 — build plan

Spec: `docs/superpowers/specs/2026-10-18-swing-checks-v2-design.md` (owner-approved 2026-10-18).
Everything is JS: one OTA to the installed runtime, no APK.

## Order

```
E (engine, one PR) ──► L (lab calibration, limits PR) ──► U (screens, after the design pick) ──► OTA
D (three designs) ─────────────────────────────────────┘
```

The engine and the designs run in parallel. The OTA goes out only when U is merged: the results
screen must speak the new rows before any phone gets them.

## Build items

| # | Item | Files | Verification | Model |
|---|---|---|---|---|
| **E1** | **Positions.** `CHECKPOINT_KEYS` stays the ten frames for detection, but `POSITIONS` (new, `checkpointChecks.js`) = address, takeaway, leadArm, top, shaftDown, impact, trailArm (+ finish for extras). `CLUB_KEYS` drops `transition`, `shaftThrough`, `lateBackswing`, `preImpact`, `postImpact` (check first that native impact detection does not read their pass-2 entries); `PASS2_KEYS` follows. `markPass.js`: `MARKED_KEYS` = the seven positions, `AUTO_KEYS` = finish. | `analyze.js`, `runAnalysis.js`, `checkpointChecks.js`, `markPass.js`, `phases.js` (only if a key list lives there) | unit tests: pass-2 request has no dropped frames; mark pass walks seven positions | Opus (E1–E5 are one agent: shared files) |
| **E2** | **Rows** per spec §4: new `knee_flex`, `shaft_plane`, `clubhead_plane_takeaway`, `spine_hold` (P2, P3, P4, P6 — one id, `cp` field like `clubhead_vs_plane` today), `knee_hold` (P2, P3), `lead_arm_spine`, `clubhead_plane_down`, `down_vs_takeaway`, `shaft_through_ball`, `through_vs_halfway`; dropped rows removed; every row carries `position` and `extra: true` for extras. Geometry helper `kneeFlexDeg`. Limits as spec, in `THRESHOLDS` (provisional comment). | `checks.js`, `geometry.js`, `checkpointChecks.js` | synthetic-pose tests per row (style of `checksSetupTop.test.js`): bands, sign/dir, unknown reasons, left-handed mirror | Opus |
| **E3** | **Clubhead gate.** `CHECK_MIN_CONF` (placeholder 0.3 until L2) in `club.js`; `checks.js` treats a `model`/`model-shaft` head under it as unplaced; reason text "Clubhead not visible — tap to place". Canvas proposals unchanged. | `club.js`, `checks.js` | tests: 0.05 model head ⇒ unknown/unplaced; 0.5 ⇒ measured; user mark always measured | Opus |
| **E4** | **Priority** per spec §6: position status, tiers, severity, main fault, `startsAt`, consequences; fault ids `posture_loss`, `stuck`; `fixes.js`, `drills.js`, `compare.js` remapped (dropped rows out); `coachSwingLink` `SWING_FAULT_LINKS` rows for the two new ids. | `priority.js`, `fixes.js`, `drills.js`, `compare.js`, `src/store/coachSwingLink.js` | synthetic tests: tier beats severity, severity within tier, yellow only without red, startsAt = earliest earlier red; golden owner swing statuses + main fault | Opus |
| **E5** | **Schema 2 and migration.** `SCHEMA = 'swing-analysis/2'`; opening a swing whose analysis is older re-runs `analyze()` from stored pose/probe/marks and saves it (index summary too). Export schema unchanged. | `analyze.js`, `swingStore.js` (or the results load path), `reanalyze.js` | test: a v1 analysis on disk comes back v2 with the new rows after one read; a failed re-run keeps v1 and logs | Opus |
| **C1** | **Copy.** en + es labels, texts, reasons, fault names and drills for the new rows/faults; dropped keys removed; Spanish glossary per `docs/i18n.md`. | `src/i18n/locales/{en,es}/swing*.js`, `strings.js` | `stringsEs.test.js` parity; no orphan keys | Sonnet (inside E's PR) |
| **L1** | **Lab table.** A script runs the new `runChecks` over the four marked lab swings (`truth.json` + `auto-d15-dense.json` pose) and prints every row per clip with value and status; the owner judges each against the video; limits move until he agrees. | `tools/swing-lab/checks_v2_table.*`, `THRESHOLDS` | table in the PR body with the owner's verdicts | Sonnet runs, Fable reviews |
| **L2** | **Gate value.** Score vs error for the 16 marked heads and the frames marked hidden, from the two phone exports' pass-2 boxes and the lab model elsewhere → `CHECK_MIN_CONF`; table in `models/club/README.md`. | `tools/swing-lab/eval_yolo.py` (a `--scores` table), `club.js` | rule from the spec: lowest score keeping every accepted head ≤ 15 cm, above the false P6 heads | Sonnet |
| **D1** | **Three designs** (fits in / better / bold) for Results (seven positions, main fault + "likely starts at", cards with rows, extras, tap-to-place) and the marking canvas (seven positions + finish). One private Artifact; stop for the owner's pick. | none (mockups not committed) | owner picks | Fable |
| **U1** | **Results screen** per the pick, with key-line drawings for the new rows (`highlights.js`). | `SwingResultsScreen.js`, `components/swing/*`, `highlights.js` | screen tests; web build; device walkthrough on one new and one old swing | Sonnet |
| **U2** | **Marking canvas** per the pick: seven positions + finish; P5/P8 steps gone; tap-to-place deep link from a result row opens that position at step 2. | `SwingEditMarksScreen.js`, `markPass.js`, `editMarks.js` | screen tests; device: mark one swing end to end | Sonnet |
| **S1** | **Ship.** Docs (CLAUDE.md swing bullets, parent plan D-line pointing here), OTA from the current OTA base after `fingerprint:generate`, owner verifies on the phone. | docs | runtime matches; phone shows v2 on a new and an old swing | Sonnet |

## PRs

1. **E1–E5 + C1** — engine and copy. Merged but not OTA'd.
2. **L1 + L2** — lab scripts and the calibrated limits / gate.
3. **U1 + U2** — screens. Then OTA (S1).

## Risks

- **Old results screen on new rows.** Mitigated by the OTA order above; master between PR 1 and 3
  is not published.
- **`spine_hold` at the top in 2D.** Shoulder turn moves the mid-shoulder in the image, so a good
  turn may read as tilt change. L1 decides: if the owner's tops read red, the P4 row gets its own
  limits or is dropped.
- **Shaft-plane body front** (`0.05 × height`) is an estimate; L1 checks it reads "belt" on the
  owner's address.
- **Coach link.** Fault ids are kept, so existing links survive; the two new ids need rows or an
  explicit no-link.
