#!/usr/bin/env python3
"""Turn a swing exported from the app ("Export swing") into a lab test case.

    python3 -I import_export.py <export.swing.zip | folder> [--clip NAME] [--lab DIR]

Writes (inside the lab directory, both git-ignored):
    clips/<clip>.mp4          the original video
    out/<clip>/truth.json     the corrected marks, in the shape CONTRACT.md describes

The export is the app's `swing-export/1` bundle: swing.json, analysis.json, marks.json and
video.mp4. A folder holding those four files works too. Standard library only.
"""
import argparse
import json
import re
import shutil
import sys
import zipfile
from pathlib import Path

CHECKPOINTS = ["address", "takeaway", "leadArm", "top", "transition",
               "shaftDown", "impact", "shaftThrough", "trailArm", "finish"]
EXPORT_SCHEMA = "swing-export/1"
LABELS_SCHEMA = "swing-club-labels/1"


def _px(p, w, h):
    """A normalised [x, y] (0-1) as pixels, or None."""
    if not p or p[0] is None or p[1] is None:
        return None
    return {"x": round(p[0] * w, 2), "y": round(p[1] * h, 2)}


def clip_name(meta):
    """swing-2026-10-11-1a2b3c4d: stable per swing, so re-importing overwrites."""
    swing = meta.get("swing") or {}
    day = (swing.get("createdAt") or "")[:10] or "undated"
    ident = re.sub(r"[^A-Za-z0-9]", "", str(swing.get("id") or ""))[:8] or "unknown"
    return f"swing-{day}-{ident}"


CLUBS = ("iron", "driver")


def club_of(meta, analysis):
    """'iron' | 'driver'. Exports from before the club picker carry none: they read as iron (D19)."""
    for c in (meta.get("club"), (meta.get("swing") or {}).get("club"), analysis.get("club")):
        if c in CLUBS:
            return c
    return "iron"


def build_truth(meta, analysis, marks, clip):
    """The lab's truth.json for one exported swing (pure; no file access)."""
    video = meta.get("video") or {}
    w, h = video.get("width"), video.get("height")
    if not w or not h:
        raise ValueError("export has no video size (swing.json video.width/height)")
    fps = analysis.get("fps") or {}
    capture = video.get("captureFps") or fps.get("capture")
    container = video.get("containerFps")
    factor = fps.get("factor") or (round(capture / container) if capture and container else 1)

    # What the user left on screen: the analysis already folds their corrections in
    # (clubMarks/checkpoints); marks.json is applied on top as the authoritative label.
    club = analysis.get("clubMarks") or {}
    cps = analysis.get("checkpoints") or {}
    labelled = {f.get("checkpoint"): f for f in (marks or {}).get("frames") or []}

    checkpoints = {}
    for key in CHECKPOINTS:
        if key not in cps and key not in labelled:
            continue
        frame = (cps.get(key) or {}).get("i")
        c = club.get(key) or {}
        hands, head, hidden = c.get("hands"), c.get("head"), bool(c.get("hidden"))
        conf = (cps.get(key) or {}).get("conf", 1)
        f = labelled.get(key)
        if f:
            frame = f.get("i", frame)
            hands = (f.get("hands") or {}).get("final", hands)
            head = (f.get("head") or {}).get("final", head)
            hidden = bool((f.get("head") or {}).get("finalHidden", hidden))
            if f.get("corrected"):
                conf = 1
        if frame is None:
            continue
        checkpoints[key] = {
            "frame": frame,
            "hands": _px(hands, w, h),
            "head": None if hidden else _px(head, w, h),
            "hidden": hidden,
            "conf": conf,
        }

    ball = ((marks or {}).get("ball") or {}).get("final") or (analysis.get("reference") or {}).get("ball")
    return {
        "clip": clip,
        "source": "manual",
        "video": {
            "w": w,
            "h": h,
            "frames": video.get("frameCount"),
            "playbackFps": container,
            "captureFps": capture,
            "slowmoFactor": factor,
            "interpolated": bool(fps.get("approximate")),
        },
        "handedness": meta.get("handedness") or analysis.get("handedness") or "right",
        "club": club_of(meta, analysis),
        "heightCm": meta.get("heightCm"),
        "ball": ({"x": round(ball[0] * w, 2), "y": round(ball[1] * h, 2), "conf": 1} if ball else None),
        "checkpoints": checkpoints,
        "app": {"swingId": (meta.get("swing") or {}).get("id"), "analysisSchema": analysis.get("schema")},
    }


def read_bundle(src):
    """(meta, analysis, marks, open_video) from a zip or a folder. open_video() -> file-like."""
    src = Path(src)
    if src.is_dir():
        def load(name):
            return json.loads((src / name).read_text())
        meta = load("swing.json")
        video = src / "video.mp4"
        return meta, load("analysis.json"), load("marks.json"), (lambda: video.open("rb"))
    z = zipfile.ZipFile(src)
    meta = json.loads(z.read("swing.json"))
    return meta, json.loads(z.read("analysis.json")), json.loads(z.read("marks.json")), (lambda: z.open("video.mp4"))


def import_export(src, lab_dir, clip=None):
    meta, analysis, marks, open_video = read_bundle(src)
    if meta.get("schema") != EXPORT_SCHEMA:
        raise ValueError(f"not a {EXPORT_SCHEMA} export (schema={meta.get('schema')!r})")
    if marks and marks.get("schema") not in (None, LABELS_SCHEMA):
        raise ValueError(f"unknown marks schema {marks.get('schema')!r}")
    clip = clip or clip_name(meta)
    truth = build_truth(meta, analysis, marks, clip)
    lab = Path(lab_dir)
    (lab / "clips").mkdir(parents=True, exist_ok=True)
    out = lab / "out" / clip
    out.mkdir(parents=True, exist_ok=True)
    with open_video() as fin, open(lab / "clips" / f"{clip}.mp4", "wb") as fout:
        shutil.copyfileobj(fin, fout)
    (out / "truth.json").write_text(json.dumps(truth, indent=2))
    return clip, truth


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("export", help="the .swing.zip (or an unpacked folder)")
    ap.add_argument("--clip", help="clip name (default: swing-<date>-<id>)")
    ap.add_argument("--lab", default=str(Path(__file__).resolve().parent), help="swing-lab directory")
    args = ap.parse_args(argv)
    clip, truth = import_export(args.export, args.lab, args.clip)
    print(f"clips/{clip}.mp4 and out/{clip}/truth.json written "
          f"({len(truth['checkpoints'])} checkpoints). Next: python3 detect.py {clip}, then eval.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
