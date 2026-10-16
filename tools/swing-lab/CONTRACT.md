# Swing lab — file contract

Local-only validation tool for the swing analyzer plan
(`docs/superpowers/plans/2026-10-11-swing-analyzer.md`). Nothing is uploaded.
`clips/` and `out/` are git-ignored (real video and frames of real people).

## Layout
- `clips/<clip>.mp4` — input videos.
- `detect.py <clip>` → `out/<clip>/auto.json` + `out/<clip>/frames/<n>.jpg` (full-res JPEG of every
  checkpoint frame ±2, plus the ball/address frames).
- `serve.py` — local server (127.0.0.1 only) serving `editor/` and `out/`; `POST /api/truth/<clip>`
  writes `out/<clip>/truth.json`. Opens the browser.
- `editor/` — design-B edit screen (HTML/JS, no build step). Reads `auto.json` and `truth.json`
  (truth wins when present), lets you drag marks, saves `truth.json`.
- `editor/checks.js` — the plan §5.4 checks as pure JS (ES module, no DOM), used by the editor
  for live recompute; later ported to `src/swing/checks.js`.
- `eval.py` — compares `auto.json` with `truth.json` for every clip that has both; prints a table
  and writes `out/report.md`.

## The checkpoints (keys, in order)
address, takeaway, leadArm, top, transition, shaftDown, impact, shaftThrough, trailArm, finish

`shaftThrough` (P8, shaft parallel after impact; plan D22) is **optional**: `detect.py --variant d15`
writes it (first frame after impact the grip is back at lead-hip height), the older variants and
older truth files do not, and `eval.py` scores it only when both auto and truth have it.

## auto.json / truth.json (same shape; truth.json may omit `pose`, `video`)
{
  "clip": "marcos-2026-10-10",
  "source": "auto" | "manual",
  "video": { "w": 478, "h": 850, "frames": 1297, "playbackFps": 29.97, "captureFps": 240,
             "slowmoFactor": 8, "interpolated": false },
  "handedness": "right",
  "club": "iron" | "driver",   // plan D19: which per-club thresholds column applies; absent = iron
  "heightCm": 176,
  "ball": { "x": 273, "y": 505, "conf": 0.9 },
  "checkpoints": {
    "<key>": { "frame": 556,
               "hands": { "x": 220, "y": 405 },
               "head":  { "x": 275, "y": 505 } | null,   // clubhead
               "hidden": false,                           // clubhead end-on / not visible
               "conf": 0.8 }
  },
  "pose": { "<frame>": [[x, y, visibility] × 33] },  // pixels, MediaPipe order; every frame that has a JPEG
  "timings": { "poseMs": 0, "totalMs": 0 }
}
Pixel coordinates are in the video's display orientation (w × h above).

## Setup
Python env lives outside the repo (so the app lint never scans it):
`uv venv -p 3.12 ~/.venvs/swing-lab && uv pip install -p ~/.venvs/swing-lab/bin/python mediapipe opencv-python-headless numpy`.
Models (git-ignored): `pose_landmarker_full.task` / `pose_landmarker_heavy.task` from storage.googleapis.com/mediapipe-models.
Run: `~/.venvs/swing-lab/bin/python -I detect.py <clip> --variant d15`, `~/.venvs/swing-lab/bin/python -I eval.py`, `python3 serve.py`.

## Importing a swing from the app (D18)
The app's **Export swing** (Results header menu > Export swing) shares ONE file, `<name>.swing.zip`
(a stored zip written in JS, schema `swing-export/1`), through the system share sheet. Nothing is sent
automatically. It contains:
- `video.mp4` (the original clip) and `analysis.json` (the app's analysis),
- `marks.json` (the corrected labels, `swing-club-labels/1`: frames/hands/head/hidden/ball),
- `swing.json` (index row, `club` (`iron` | `driver`, absent in older exports = iron), `handedness`, `heightCm`, clip size `video.width/height/frameCount/containerFps/captureFps`).

Unpack it into a lab test case:
`python3 -I import_export.py ~/Downloads/<name>.swing.zip [--clip NAME]` (a folder holding the four files also works).
It writes `clips/<clip>.mp4` (default clip name `swing-<date>-<id8>`) and `out/<clip>/truth.json` in the shape above
(`source: "manual"`; the app's normalised coordinates become pixels of the video's display size; a hidden clubhead gets `head: null`).
If the export also holds `pose.json` (pass-2 club output, `pass2.shaft[frame]` = `head`, `source`, `boxes`) it is copied to
`out/<clip>/pose.json`; `eval_yolo.py <clip> --from-export out/<clip>/pose.json` scores the phone's own boxes against `truth.json`.
Then `detect.py <clip>` and `eval.py` as usual. Tests: `python3 -m unittest test_import_export` from this directory.

## Club detector under the phone's rules (plan 2026-10-16-swing-club-detector, L1)
`models/` is git-ignored, so the table lives here. Run 2 epoch 8 (`models/yolox-club-v2/epoch_8.pth`), conf 0.03,
`~/.venvs/swing-yolox/bin/python -I eval_yolo.py --yolox <ckpt> --conf 0.03 [--hands pose] [--frames checkpoints]`
(`--rescore yolox` re-scores the saved dets). 16 marked heads over the three clips:

| hands anchor / frames | found | median | ≤5 cm | ≤10 cm | worst | top | transition | leadArm |
|---|---|---|---|---|---|---|---|---|
| box / all (2026-10 bar) | 16/16 | 4.1 cm | 9 | 11 | 101.4 cm (transition) | 26.7 / 13.9 / 8.2 | 101.4 | 2.2 / 2.1 / 3.6 |
| pose / all | 16/16 | 4.0 cm | 10 | 12 | 101.4 cm (transition) | 4.1 / 13.9 / 8.2 | 101.4 | 2.2 / 2.1 / 3.6 |
| pose / checkpoints (13 frames) | 16/16 | 4.0 cm | 10 | 12 | 101.4 cm (transition) | 4.1 / 13.9 / 8.2 | 101.4 | 2.2 / 2.1 / 3.6 |

Per-position cells are the clips in order marcos-10-10 / 88125330 / b5e60f31 (transition is marked on the first only).
Static rule on the 13 frames: no true head is dropped under any setting tried. The spare club at the left edge of
`marcos-2026-10-10` is fully dropped at the default 0.5; on `swing-2026-10-13-88125330` 9 of its 23 low-confidence
(0.03-0.14) boxes survive at 0.5 (the dense rule also leaves 121 of 349), because the detector flickers and the box holds
only 5 of 11 places. `--static-frac 0.3` drops all of them with scores unchanged (a swung head holds address + the impact
place = 2 of 11). The plan's fallback (`--static ends`, >=70 % and address and finish) is stricter on these clips and keeps all of them.
