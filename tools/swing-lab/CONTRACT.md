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

## The 9 checkpoints (keys, in order)
address, takeaway, leadArm, top, transition, shaftDown, impact, trailArm, finish

## auto.json / truth.json (same shape; truth.json may omit `pose`, `video`)
{
  "clip": "marcos-2026-10-10",
  "source": "auto" | "manual",
  "video": { "w": 478, "h": 850, "frames": 1297, "playbackFps": 29.97, "captureFps": 240,
             "slowmoFactor": 8, "interpolated": false },
  "handedness": "right",
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
