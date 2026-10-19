#!/usr/bin/env python3
"""Address and impact (apiVersion 6) on swings exported from the app, against the owner's marks.

    ~/.venvs/swing-lab/bin/python -I eval_address_impact.py [exports dir] [--model PATH] [--videos DIR]

For every `*.swing.zip` (swing-export/1: swing.json, analysis.json, marks.json, video.mp4) it runs
detect.py's ball_gone_frame and clubhead_address the way pass 1 / pass 2 run them on the phone and
prints, per swing, the owner's confirmed frame (`i`), the app's proposal at export time
(`iProposed`, the old rules) and the new rule, with their errors.

What it takes from the export, as the phone would have it:
- the ball: analysis.reference.ball (the ball pass 2 gets; pass 1 uses its own detection, which the
  export doesn't keep — a swing without a reference ball is reported as "no ball", like the app);
- leadArm, handsTop, the address run and the capture fps from analysis.json;
- the resting head: the app's club detector (assets club_yolox_tiny_v1.tflite, ai-edge-litert) on
  detect.addr_samples(), best head box per frame (no scenery vote: the export has no checkpoint
  boxes for those frames); --no-model uses the fallback position, like a phone without the model.

Videos are read from --videos/<swingId[:8]>.mp4 when present, else extracted once into clips/ (git
ignored). Two exports of the same swing are both scored (the owner's marks can differ).
"""
from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path

import cv2
import numpy as np

LAB = Path(__file__).resolve().parent
sys.path.insert(0, str(LAB))  # -I leaves the script dir off sys.path
import detect as D  # noqa: E402

MODEL = LAB.parents[1] / "modules" / "golf-swing" / "android" / "src" / "main" / "assets" / "club_yolox_tiny_v1.tflite"
SIZE, CONF, NMS_IOU, HEAD = 640, 0.03, 0.45, 1


class Detector:
    """The app's ClubDecode on the lab interpreter: stretch to 640², BGR floats, NMS per class."""

    def __init__(self, path: Path):
        from ai_edge_litert.interpreter import Interpreter
        self.it = Interpreter(str(path), num_threads=4)
        self.it.allocate_tensors()
        self.inp = self.it.get_input_details()[0]
        self.out = self.it.get_output_details()[0]

    def best_head(self, bgr: np.ndarray) -> tuple[float, float, float] | None:
        h, w = bgr.shape[:2]
        x = cv2.resize(bgr, (SIZE, SIZE)).astype(np.float32)[None]
        if self.inp["shape"][1] == 3:
            x = x.transpose(0, 3, 1, 2)
        self.it.set_tensor(self.inp["index"], x)
        self.it.invoke()
        raw = self.it.get_tensor(self.out["index"])[0]
        cls = raw[:, 5:8].argmax(1)
        score = raw[:, 4] * raw[:, 5:8].max(1)
        k = np.flatnonzero((cls == HEAD) & (score >= CONF))
        if not len(k):
            return None
        i = k[np.argmax(score[k])]  # NMS keeps the best box of a class, so it alone decides
        return float(raw[i, 0] / SIZE * w), float(raw[i, 1] / SIZE * h), float(score[i])


class Video:
    """Sequential reads with a small cache (every rule here walks frames forward)."""

    def __init__(self, path: Path):
        self.path = path
        self.cache: dict[int, np.ndarray] = {}

    def frames(self, lo: int, hi: int) -> dict[int, np.ndarray]:
        need = [f for f in range(lo, hi + 1) if f not in self.cache]
        if need:
            cap = cv2.VideoCapture(str(self.path))
            cap.set(cv2.CAP_PROP_POS_FRAMES, need[0])
            for f in range(need[0], need[-1] + 1):
                ok, img = cap.read()
                if not ok:
                    break
                self.cache.setdefault(f, img)
            cap.release()
        return {f: self.cache[f] for f in range(lo, hi + 1) if f in self.cache}


def video_for(z: zipfile.ZipFile, swing_id: str, videos: Path | None) -> Path:
    if videos and (videos / f"{swing_id[:8]}.mp4").exists():
        return videos / f"{swing_id[:8]}.mp4"
    out = LAB / "clips" / f"export-{swing_id[:8]}.mp4"
    if not out.exists():
        out.parent.mkdir(exist_ok=True)
        out.write_bytes(z.read("video.mp4"))
    return out


def impact(v: Video, a: dict, w: int, h: int) -> int | None:
    ball = (a.get("reference") or {}).get("ball")
    if not ball:
        return None
    ws = 0.5 if min(w, h) >= 720 else 1.0
    fps = a["fps"]["capture"]
    la, top = a["checkpoints"]["leadArm"]["i"], a["internal"]["handsTop"]
    hi = a["checkpoints"]["impact"]["i"] + int(1.5 * fps)  # pass 1 keeps strips to ~1.5 s after impact
    grays = {f: cv2.resize(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), None, fx=ws, fy=ws, interpolation=cv2.INTER_AREA)
             if ws != 1 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) for f, img in v.frames(la, hi).items()}
    d = D.BALL_CM * a["scale"]["pxPerCm"] * ws
    gone = D.ball_gone_frame(grays, (ball[0] * w * ws, ball[1] * h * ws), d, range(la, top + 1), top, fps)
    return None if gone is None else gone - 1


def address(v: Video, det: Detector | None, a: dict, w: int, h: int) -> tuple[int | None, dict]:
    ball = (a.get("reference") or {}).get("ball")
    if not ball:
        return None, {"why": "no ball"}
    fps, px_cm = a["fps"]["capture"], a["scale"]["pxPerCm"]
    la = a["checkpoints"]["leadArm"]["i"]
    lo = max(0, a["addressSearch"]["run"][0] - int(round(D.ADDR_PRE_S * fps)))
    bxy = (ball[0] * w, ball[1] * h)
    hands = (a.get("reference") or {}).get("handsAddress") or [0, 0]
    x0, y0, x1, y1, step = D.addr_strip_rect(bxy, px_cm, w, h)
    imgs = v.frames(lo, la)
    strips = {f: cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)[y0:y1:step, x0:x1:step] for f, img in imgs.items()}
    heads = {f: det.best_head(imgs[f]) for f in D.addr_samples(lo, la) if f in imgs} if det else {}
    rest = D.resting_head(heads, bxy, px_cm)
    ref, hx, hy = rest if rest else (lo, *D.fallback_head(bxy, (hands[0] * w, hands[1] * h), px_cm))
    track = D.head_track(strips, step, (x0, y0), ref, (hx, hy), bxy, px_cm)
    info = {"ref": ref, "head": "model" if rest else "fallback"}
    if not track:
        return None, {**info, "why": "template off the strip"}
    return D.address_from_track(track, ref, la, fps, clip_start=lo == 0), info


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("exports", nargs="?", default=str(Path.home() / "swing-exports"))
    ap.add_argument("--model", default=str(MODEL))
    ap.add_argument("--videos", default=None, help="folder with <swingId[:8]>.mp4 (else extracted into clips/)")
    ap.add_argument("--no-model", action="store_true", help="the head's fallback position, as on a phone without the detector")
    args = ap.parse_args()
    det = None if args.no_model else Detector(Path(args.model))
    videos = Path(args.videos) if args.videos else None
    rows = []

    def err(x, own):
        return "" if x is None or own is None else f"{x - own:+d}"

    print(f"{'export':24s} | {'address own/app/new (err app, new)':38s} | impact own/app/new (err app, new)")
    for zp in sorted(Path(args.exports).glob("*.swing.zip")):
        z = zipfile.ZipFile(zp)
        a, m = json.loads(z.read("analysis.json")), json.loads(z.read("marks.json"))
        fr = {x["checkpoint"]: x for x in m["frames"]}
        w, h = m["video"]["width"], m["video"]["height"]
        v = Video(video_for(z, m["swingId"], videos))
        ao, ap_ = (fr.get("address") or {}).get("i"), (fr.get("address") or {}).get("iProposed")
        io, ip = (fr.get("impact") or {}).get("i"), (fr.get("impact") or {}).get("iProposed")
        an, info = address(v, det, a, w, h)
        im = impact(v, a, w, h) if io is not None else None
        rows.append((ao, ap_, an, io, ip, im))
        name = zp.name.replace(".swing.zip", "")
        print(f"{name:24s} | {ao!s:>4} {ap_!s:>4} {an!s:>4} ({err(ap_, ao):>4}, {err(an, ao):>4}) {info.get('head', info.get('why', '')):9s}"
              f" | {io!s:>4} {ip!s:>4} {im!s:>4} ({err(ip, io):>4}, {err(im, io):>4})")

    def mae(k_new, k_own):
        e = [abs(r[k_new] - r[k_own]) for r in rows if r[k_new] is not None and r[k_own] is not None]
        return (round(float(np.mean(e)), 1), len(e)) if e else (None, 0)
    print(f"address |err| mean (n): app {mae(1, 0)}  new {mae(2, 0)}")
    print(f"impact  |err| mean (n): app {mae(4, 3)}  new {mae(5, 3)}")


if __name__ == "__main__":
    main()
