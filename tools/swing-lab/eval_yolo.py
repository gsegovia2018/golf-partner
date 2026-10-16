#!/usr/bin/env python3
"""Swing lab — score a public club detector against the owner's clubhead marks (spike).

Runs the `golf-club-tracking` YOLO11m (github.com/nishsm/golf-club-tracking, AGPL-3.0, trained
on the CC BY 4.0 Roboflow dataset club-head-tracking/golf-club-tracking) over every frame of each
swing span and compares its clubhead with truth.json. Lab-only: the AGPL weights never ship.

Per frame: head = centre of the most confident `head` box; when there is none, the end of the
most confident `shaft` box nearest the last head (the repo's own fallback). Errors are in cm via
the address leg scale (auto-d15-dense.json debug.scale.pxPerCm), like track_impact.py.

Setup (separate env, torch is big): `uv venv -p 3.12 ~/.venvs/swing-yolo &&
uv pip install -p ~/.venvs/swing-yolo/bin/python ultralytics opencv-python-headless numpy`;
weights: `curl -L -o models/swingtrace-yolo11m.pt
https://github.com/nishsm/golf-club-tracking/raw/HEAD/weights/best.pt` (models/ is git-ignored).

Usage: ~/.venvs/swing-yolo/bin/python -I eval_yolo.py [clip ...] [--conf 0.25] [--imgsz 640]
       ~/.venvs/swing-yolox/bin/python -I eval_yolo.py --yolox models/yolox-club/epoch_N.pth
       (our own YOLOX-tiny from train_yolox.py; frames are stretched to 640x640 as in training)
Writes out/<clip>/<tag>/{dets.json,sheet.jpg} (tag yolo | yolox) and prints a table.

The phone's rules (plan 2026-10-16-swing-club-detector, §4.1/§4.4): `--hands pose` anchors the
150 cm rule and the shaft-corner fallback on the pose grip (auto-d15-dense.json handsSeries, the
d15 grip) instead of the detector's `hands` box; `--frames checkpoints` runs only the 13 frames
pass 2 decodes (the ten checkpoints + lateBackswing / preImpact / postImpact, plus the truth
frames to score) and applies drop_static over those places (impact / preImpact / postImpact count
as one place), saved as dets-cp.json. `--from-export out/<clip>/pose.json` scores the phone's own
pass2.shaft output instead of running a model (one clip; no inference).
"""
from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import cv2
import numpy as np

LAB = Path(__file__).resolve().parent
WEIGHTS = LAB / "models" / "swingtrace-yolo11m.pt"
# swing-2026-10-12-bc118e4c is left out: its truth frames are wrong (see track_impact.py).
CLIPS = ["marcos-2026-10-10", "swing-2026-10-13-88125330", "swing-2026-10-14-b5e60f31"]
SHAFT, HEAD, HANDS = 0, 1, 2
PAD = 20  # frames run before the first / after the last truth checkpoint


def ultralytics_predictor(conf: float, imgsz: int):
    from ultralytics import YOLO
    model = YOLO(str(WEIGHTS))

    def predict(img):
        r = model.predict(img, conf=conf, imgsz=imgsz, verbose=False)[0]
        rows = []
        if r.boxes is not None:
            for b, c, s in zip(r.boxes.xyxy.cpu().numpy(), r.boxes.cls.cpu().numpy(),
                               r.boxes.conf.cpu().numpy()):
                rows.append({"cls": int(c), "conf": round(float(s), 3),
                             "box": [round(float(v), 1) for v in b]})
        return rows
    return predict


def yolox_predictor(ckpt: Path, conf: float):
    import sys
    import torch
    sys.path.insert(0, str(LAB))  # -I leaves the script dir off sys.path
    from train_yolox import SIZE, build_exp
    from yolox.utils import postprocess
    dev = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    model = build_exp().get_model()
    model.load_state_dict(torch.load(ckpt, map_location="cpu")["ema"])
    model.to(dev).eval()

    @torch.no_grad()
    def predict(img):
        h, w = img.shape[:2]
        x = cv2.resize(img, (SIZE, SIZE)).transpose(2, 0, 1)
        x = torch.from_numpy(np.ascontiguousarray(x)).float()[None].to(dev)
        out = postprocess(model(x).cpu(), 3, conf, 0.45, class_agnostic=False)[0]
        rows = []
        if out is not None:
            for x1, y1, x2, y2, obj, cc, c in out.numpy():
                rows.append({"cls": int(c), "conf": round(float(obj * cc), 3),
                             "box": [round(float(v), 1) for v in
                                     (x1 * w / SIZE, y1 * h / SIZE, x2 * w / SIZE, y2 * h / SIZE)]})
        return rows
    return predict


def detect_span(predict, path: Path, f0: int, f1: int) -> tuple[dict, float]:
    cap = cv2.VideoCapture(str(path))
    cap.set(cv2.CAP_PROP_POS_FRAMES, f0)
    dets, ms = {}, []
    for f in range(f0, f1 + 1):
        ok, img = cap.read()
        if not ok:
            break
        t = time.perf_counter()
        dets[f] = predict(img)
        ms.append((time.perf_counter() - t) * 1000)
    cap.release()
    return dets, float(np.median(ms[3:] if len(ms) > 3 else ms))


def detect_frames(predict, path: Path, frames: list[int]) -> tuple[dict, float]:
    """detect_span for an arbitrary frame list (seeks per frame; ~15 frames per clip)."""
    cap = cv2.VideoCapture(str(path))
    dets, ms = {}, []
    for f in sorted(set(frames)):
        cap.set(cv2.CAP_PROP_POS_FRAMES, f)
        ok, img = cap.read()
        if not ok:
            continue
        t = time.perf_counter()
        dets[f] = predict(img)
        ms.append((time.perf_counter() - t) * 1000)
    cap.release()
    return dets, float(np.median(ms[1:] if len(ms) > 1 else ms)) if ms else 0.0


def checkpoint_places(auto: dict) -> dict:
    """Frame -> place for the 13 frames pass 2 decodes: the ten checkpoints, lateBackswing
    (midway leadArm..top), preImpact (impact - 25 ms) and postImpact (impact + 10 frames), as
    phases.js derives them. impact / preImpact / postImpact are one place (the head is there)."""
    cps = {k: v["frame"] for k, v in auto["checkpoints"].items()}
    fps = auto["video"].get("captureFps") or 240
    places = {f: k for k, f in cps.items()}
    imp = cps["impact"]
    places[imp - max(1, round(0.025 * fps))] = "impact"
    places[imp + 10] = "impact"
    places[round((cps["leadArm"] + cps["top"]) / 2)] = "lateBackswing"
    return places


def pose_grip(auto: dict) -> dict:
    """Frame -> (x, y) pose grip (d15 grip point, px) from the stored hands series."""
    return {int(f): tuple(p) for f, p in auto["debug"]["handsSeries"].items() if p}


def export_dets(pose: dict) -> tuple[dict, dict]:
    """(dets, trk) from a phone pose.json / analysis.json: pass2.shaft[frame] -> boxes + head."""
    p2 = pose.get("pass2") or (pose.get("pose") or {}).get("pass2")
    if not p2 or "shaft" not in p2:
        raise SystemExit("no pass2.shaft in that file (analysed without the club model?)")
    names = {"shaft": SHAFT, "head": HEAD, "hands": HANDS}
    dets, trk = {}, {}
    for f, e in p2["shaft"].items():
        f = int(f)
        dets[f] = [{"cls": names[b["cls"]], "conf": b["score"], "box": b["box"]}
                   for b in e.get("boxes") or []]
        if e.get("head") and e.get("source") in ("model", "model-shaft"):
            trk[f] = (e["head"][0], e["head"][1],
                      "head" if e["source"] == "model" else "shaft", e.get("conf"))
    return dets, trk


def best(rows, cls):
    rows = [r for r in rows if r["cls"] == cls]
    return max(rows, key=lambda r: r["conf"]) if rows else None


def iou(a, b) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def drop_static(dets: dict, frac: float = 0.5, min_iou: float = 0.5,
                places: dict | None = None, rule: str = "frac") -> dict:
    """Remove scenery: a box whose place (same class, IoU >= min_iou) is occupied in >= frac of
    the span's frames does not move, so it is not the swung club (a spare club on the ground,
    a pole). The clubhead at address is still for only ~10-15 % of the span.

    places (frame -> place name) switches to the phone's checkpoint frames: occupancy is counted
    over distinct places, not frames, and only the frames named in `places` vote (other frames,
    such as a truth frame, are tested against the result). rule "ends" is the plan's fallback:
    static = present in >= 70 % of the places and also at address and finish."""
    if places is None:
        ref = {f: f for f in dets}
    else:
        ref = {f: p for f, p in places.items() if f in dets}
    n = len(set(ref.values()))
    if not n:
        return dets
    allrows = [(ref[f], r) for f in ref for r in dets[f]]

    def static(r):
        held = {p for p, o in allrows if o["cls"] == r["cls"] and iou(o["box"], r["box"]) >= min_iou}
        if rule == "ends":
            return len(held) >= 0.7 * n and {"address", "finish"} <= held
        return len(held) >= frac * n
    return {f: [r for r in rows if r["cls"] == HANDS or not static(r)] for f, rows in dets.items()}


def head_track(dets: dict, fallback: str = "hands", px_cm: float | None = None,
               max_cm: float = 150, grip: dict | None = None) -> dict:
    """Frame -> (x, y, source, conf) with a shaft-end fallback, in frame order.

    fallback "hands": the shaft box corner farthest from the most confident `hands` box (the
    grip sits at one end of the diagonal, the head at the other); without a hands box, or with
    "last": the corner nearest the last head (the public repo's rule). With px_cm, a head box
    more than max_cm from the hands box is impossible (shaft ~105 cm) and is ignored.
    grip (frame -> (x, y)) replaces the hands box as that anchor on the frames it covers."""
    out, last = {}, None
    for f in sorted(dets):
        rows = dets[f]
        g = best(rows, HANDS)
        if f in (grip or {}):
            g = {"box": [*grip[f], *grip[f]]}  # a point, so the centre maths below is shared
        if px_cm and g:
            gx, gy = (g["box"][0] + g["box"][2]) / 2, (g["box"][1] + g["box"][3]) / 2
            rows = [r for r in rows if r["cls"] != HEAD or math.hypot(
                (r["box"][0] + r["box"][2]) / 2 - gx, (r["box"][1] + r["box"][3]) / 2 - gy)
                <= max_cm * px_cm]
        h = best(rows, HEAD)
        if h:
            x1, y1, x2, y2 = h["box"]
            last = ((x1 + x2) / 2, (y1 + y2) / 2)
            out[f] = (*last, "head", h["conf"])
            continue
        s = best(rows, SHAFT)
        if s:
            x1, y1, x2, y2 = s["box"]
            corners = [(x1, y1), (x2, y1), (x1, y2), (x2, y2)]
            if fallback == "hands" and g:
                gx, gy = (g["box"][0] + g["box"][2]) / 2, (g["box"][1] + g["box"][3]) / 2
                p = max(corners, key=lambda c: math.hypot(c[0] - gx, c[1] - gy))
            elif last is None:
                p = corners[-1]
            else:
                p = min(corners, key=lambda c: math.hypot(c[0] - last[0], c[1] - last[1]))
            last = p
            out[f] = (*p, "shaft", s["conf"])
    return out


def sheet(path: Path, rows: list, dets: dict, out: Path, px_cm: float) -> None:
    cap = cv2.VideoCapture(str(path))
    tiles = []
    half = int(45 * px_cm)  # 90 cm square around the truth head
    for r in rows:
        cap.set(cv2.CAP_PROP_POS_FRAMES, r["frame"])
        ok, img = cap.read()
        if not ok:
            continue
        for d in dets.get(r["frame"], []):
            col = {SHAFT: (0, 0, 255), HEAD: (0, 255, 0), HANDS: (255, 0, 0)}[d["cls"]]
            x1, y1, x2, y2 = map(int, d["box"])
            cv2.rectangle(img, (x1, y1), (x2, y2), col, 2)
        tx, ty = map(int, r["truth"])
        cv2.circle(img, (tx, ty), 6, (255, 255, 255), 2)  # truth: white ring
        if r["pred"]:
            cv2.drawMarker(img, tuple(map(int, r["pred"])), (0, 255, 255), cv2.MARKER_CROSS, 16, 2)
        H, W = img.shape[:2]
        x0, y0 = max(0, tx - half), max(0, ty - half)
        crop = img[y0:min(H, ty + half), x0:min(W, tx + half)]
        crop = cv2.resize(crop, (320, 320))
        err = "miss" if r["errCm"] is None else f'{r["errCm"]:.0f}cm {r["src"]}'
        cv2.putText(crop, f'{r["key"]} {err}', (6, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                    (0, 0, 0), 4)
        cv2.putText(crop, f'{r["key"]} {err}', (6, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                    (255, 255, 255), 1)
        tiles.append(crop)
    cap.release()
    if tiles:
        cv2.imwrite(str(out), np.hstack(tiles))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clips", nargs="*", default=CLIPS)
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--yolox", type=Path, help="checkpoint from train_yolox.py")
    ap.add_argument("--fallback", choices=["hands", "last"], default="hands",
                    help="shaft-end rule when no head box (see head_track)")
    ap.add_argument("--max-cm", type=float, default=150,
                    help="ignore head boxes farther than this from the hands box (0 = off)")
    ap.add_argument("--keep-static", action="store_true",
                    help="skip drop_static (scenery boxes stay)")
    ap.add_argument("--hands", choices=["box", "pose"], default="box",
                    help="anchor for the max-cm rule and the shaft-corner fallback: the detector's "
                         "hands box, or the pose grip (the phone's rule; falls back to the box)")
    ap.add_argument("--frames", choices=["all", "checkpoints"], default="all",
                    help="all: every frame of the truth span; checkpoints: the 13 pass-2 frames "
                         "(+ truth frames), with drop_static over those places")
    ap.add_argument("--static", choices=["frac", "ends"], default="frac",
                    help="checkpoints only: frac = >=50%% of places; ends = the plan's fallback "
                         "(>=70%% and also at address and finish)")
    ap.add_argument("--static-frac", type=float, default=0.5,
                    help="share of frames (places, with --frames checkpoints) a box must hold to "
                         "count as scenery")
    ap.add_argument("--from-export", type=Path, metavar="POSE_JSON",
                    help="score the phone's pass2.shaft from its pose.json / analysis.json "
                         "(one clip, no inference)")
    ap.add_argument("--rescore", choices=["yolo", "yolox"],
                    help="re-score the saved out/<clip>/<tag>/dets.json, no inference")
    a = ap.parse_args()
    tag = a.rescore or ("export" if a.from_export else "yolox" if a.yolox else "yolo")
    cp = a.frames == "checkpoints"
    dname = "dets-cp.json" if cp else "dets.json"
    if a.from_export and len(a.clips) != 1:
        ap.error("--from-export scores one clip: name it")
    predict = (None if a.rescore or a.from_export else yolox_predictor(a.yolox, a.conf) if a.yolox else
               ultralytics_predictor(a.conf, a.imgsz))
    allrows = []
    for clip in a.clips:
        out = LAB / "out" / clip
        auto = json.loads((out / "auto-d15-dense.json").read_text())
        truth = json.loads((out / "truth.json").read_text())["checkpoints"]
        px_cm = auto["debug"]["scale"]["pxPerCm"]
        frames = [v["frame"] for v in truth.values()]
        f0, f1 = max(0, min(frames) - PAD), max(frames) + PAD
        places = checkpoint_places(auto) if cp else None
        if a.from_export:
            raw, trk = export_dets(json.loads(a.from_export.read_text()))
            dets, ms = raw, 0.0  # the phone already dropped scenery and chose the head
        else:
            if a.rescore:
                saved = json.loads((out / tag / dname).read_text())
                dets = {int(f): [r for r in rows if r["conf"] >= a.conf]
                        for f, rows in saved["dets"].items()}
                ms = saved["msPerFrame"]
            elif cp:
                f0, f1 = min(list(places) + frames), max(list(places) + frames)
                dets, ms = detect_frames(predict, LAB / "clips" / f"{clip}.mp4", list(places) + frames)
            else:
                dets, ms = detect_span(predict, LAB / "clips" / f"{clip}.mp4", f0, f1)
            raw = dets
            if not a.keep_static:
                dets = drop_static(dets, a.static_frac, places=places, rule=a.static)
            grip = pose_grip(auto) if a.hands == "pose" else None
            trk = head_track(dets, a.fallback, px_cm if a.max_cm else None, a.max_cm, grip)
        n = len(dets)
        n_head = sum(1 for f in dets if best(dets[f], HEAD))
        n_any = sum(1 for f in dets if f in trk)
        rows = []
        for key, v in truth.items():
            if v.get("conf") != 1:
                continue
            row = {"clip": clip, "key": key, "frame": v["frame"], "hidden": bool(v.get("hidden"))}
            p = trk.get(v["frame"])
            row["pred"] = p[:2] if p else None
            row["src"] = p[2] if p else None
            if v.get("head"):
                row["truth"] = (v["head"]["x"], v["head"]["y"])
                row["errCm"] = (round(math.hypot(p[0] - row["truth"][0], p[1] - row["truth"][1])
                                      / px_cm, 1) if p else None)
                app = auto["checkpoints"].get(key, {}).get("head")
                row["appCm"] = (round(math.hypot(app["x"] - row["truth"][0],
                                                 app["y"] - row["truth"][1]) / px_cm, 1)
                                if app and key in ("address", "impact") else None)
            rows.append(row)
        (out / tag).mkdir(exist_ok=True)
        if not (a.rescore or a.from_export):  # keep the inference record; a rescore only re-reads it
            (out / tag / dname).write_text(json.dumps(
                {"weights": str(a.yolox or WEIGHTS), "conf": a.conf, "imgsz": a.imgsz,
                 "span": [f0, f1], "msPerFrame": ms, "dets": raw, "rows": rows}, default=list))
        sheet(LAB / "clips" / f"{clip}.mp4", [r for r in rows if r.get("truth")], dets,
              out / tag / "sheet.jpg", px_cm)
        print(f"\n{clip}  frames {f0}-{f1}  head {n_head}/{n} ({100*n_head/n:.0f}%)  "
              f"head|shaft {n_any}/{n} ({100*n_any/n:.0f}%)  {ms:.0f} ms/frame (Mac, MPS)")
        for r in rows:
            if r.get("truth"):
                err = "miss" if r["errCm"] is None else f'{r["errCm"]:5.1f} cm ({r["src"]})'
                app = "" if r["appCm"] is None else f'   app today {r["appCm"]:5.1f} cm'
                print(f'  {r["key"]:<13} f{r["frame"]:<5} {err}{app}')
            elif r["hidden"]:
                print(f'  {r["key"]:<13} f{r["frame"]:<5} marked hidden; detector '
                      f'{"says " + r["src"] if r["pred"] else "says nothing (correct)"}')
        allrows += [r for r in rows if r.get("truth")]
    errs = [r["errCm"] for r in allrows if r["errCm"] is not None]
    if errs:
        print(f"\nAll marked heads: {len(errs)}/{len(allrows)} found, median {np.median(errs):.1f} cm, "
              f"≤5 cm {sum(e <= 5 for e in errs)}, ≤10 cm {sum(e <= 10 for e in errs)}")


if __name__ == "__main__":
    main()
