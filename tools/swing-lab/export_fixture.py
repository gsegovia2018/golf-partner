#!/usr/bin/env python3
"""Write a lab clip as a reference-swing fixture for the app's tests.

    python3 -I export_fixture.py <clip> --name NAME --who WHO --source SRC --club iron|driver
        --height-cm N [--positions right|wrong] [--note TEXT] [--export ZIP] [--lab DIR]

Reads out/<clip>/.pose-full-policy-fixed.json and out/<clip>/auto-d15.json (detect.py --variant d15)
and writes src/swing/__tests__/fixtures/reference/<NAME>.json: the pass-1 samples in the shape the
native analyzePose returns (normalised, 3 decimals), the ball, and the pass-2 address / impact
clubhead proposals. Landmark numbers only, never a picture. With --export (an app "Export swing"
zip) the swing's club, height and capture fps come from it, and its checkpoint frames become
frame marks, so the app re-reads the frames the owner confirmed.
"""
import argparse
import json
import zipfile
from pathlib import Path

LAB = Path(__file__).resolve().parent
OUT = LAB.parent.parent / "src" / "swing" / "__tests__" / "fixtures" / "reference"
CHECKPOINTS = ["address", "takeaway", "leadArm", "top", "transition",
               "shaftDown", "impact", "shaftThrough", "trailArm", "finish"]


def finite(v):
    return isinstance(v, (int, float)) and v == v and abs(v) != float("inf")


def proposal(c):
    """A detect.py checkpoint's clubhead as a pass-2 proposal (px), or None."""
    head = c.get("head")
    if not head or not finite(head.get("x")) or not finite(head.get("y")):
        return None
    return {"head": [round(head["x"], 1), round(head["y"], 1)], "hidden": bool(c.get("hidden")),
            "conf": round(c.get("conf") or 0, 2)}


def build(lab, clip, a):
    pose = json.loads((lab / "out" / clip / ".pose-full-policy-fixed.json").read_text())
    text = (lab / "out" / clip / "auto-d15.json").read_text()
    auto = json.loads(text.replace("-Infinity", "null").replace("Infinity", "null").replace("NaN", "null"))
    v = auto["video"]
    w, h = v["w"], v["h"]
    frames = [[int(i), [[round(x / w, 3), round(y / h, 3), round(vis, 2)] for x, y, vis in lm]]
              for i, lm in sorted(pose["samples"].items(), key=lambda kv: int(kv[0]))]
    ball = auto.get("ball")
    fx = {
        "name": a.name, "who": a.who, "source": a.source, "club": a.club, "heightCm": a.height_cm,
        "handedness": "right", "positions": a.positions, "note": a.note,
        "video": {"width": w, "height": h, "containerFps": v["playbackFps"], "frameCount": v["frames"],
                  "captureFps": None},
        "frames": frames,
        "ball": {"x": round(ball["x"] / w, 4), "y": round(ball["y"] / h, 4), "r": round(ball["r"] / w, 4),
                 "conf": ball.get("conf")} if ball else None,
        "ballGoneFrame": (auto.get("debug") or {}).get("ballGoneFrame"),
        "proposals": {k: proposal(auto["checkpoints"][k]) for k in ("address", "impact")},
        "addressFrame": auto["checkpoints"]["address"]["frame"],
        "marks": None,
    }
    if a.export:
        z = zipfile.ZipFile(a.export)
        meta = json.loads(z.read("swing.json"))
        analysis = json.loads(z.read("analysis.json"))
        fx["club"] = meta.get("club") or fx["club"]
        fx["heightCm"] = meta.get("heightCm") or fx["heightCm"]
        fx["handedness"] = meta.get("handedness") or "right"
        fx["video"]["captureFps"] = (meta.get("video") or {}).get("captureFps")
        fx["marks"] = {k: {"frame": analysis["checkpoints"][k]["i"]} for k in CHECKPOINTS}
    return fx


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("clip")
    ap.add_argument("--name", required=True)
    ap.add_argument("--who", required=True)
    ap.add_argument("--source", required=True, help="e.g. youtube:<id> or owner")
    ap.add_argument("--club", choices=["iron", "driver"], default="iron")
    ap.add_argument("--height-cm", type=float, default=None)
    ap.add_argument("--positions", choices=["right", "wrong"], default="right",
                    help="whether detect.py's checkpoints were checked as right on the stills")
    ap.add_argument("--note", default="")
    ap.add_argument("--export", default=None, help="the app's .swing.zip for an owner swing")
    ap.add_argument("--lab", default=str(LAB), help="lab directory holding clips/ and out/")
    a = ap.parse_args(argv)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{a.name}.json"
    path.write_text(json.dumps(build(Path(a.lab), a.clip, a), separators=(",", ":")))
    print(f"wrote {path.relative_to(LAB.parent.parent)} ({path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
