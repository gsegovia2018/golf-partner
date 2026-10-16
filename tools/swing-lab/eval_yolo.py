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


def best(rows, cls):
    rows = [r for r in rows if r["cls"] == cls]
    return max(rows, key=lambda r: r["conf"]) if rows else None


def iou(a, b) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def drop_static(dets: dict, frac: float = 0.5, min_iou: float = 0.5) -> dict:
    """Remove scenery: a box whose place (same class, IoU >= min_iou) is occupied in >= frac of
    the span's frames does not move, so it is not the swung club (a spare club on the ground,
    a pole). The clubhead at address is still for only ~10-15 % of the span."""
    n = len(dets)
    if not n:
        return dets
    allrows = [(f, r) for f, rows in dets.items() for r in rows]

    def static(r):
        frames = {f for f, o in allrows if o["cls"] == r["cls"] and iou(o["box"], r["box"]) >= min_iou}
        return len(frames) >= frac * n
    return {f: [r for r in rows if r["cls"] == HANDS or not static(r)] for f, rows in dets.items()}


def head_track(dets: dict, fallback: str = "hands", px_cm: float | None = None,
               max_cm: float = 150) -> dict:
    """Frame -> (x, y, source, conf) with a shaft-end fallback, in frame order.

    fallback "hands": the shaft box corner farthest from the most confident `hands` box (the
    grip sits at one end of the diagonal, the head at the other); without a hands box, or with
    "last": the corner nearest the last head (the public repo's rule). With px_cm, a head box
    more than max_cm from the hands box is impossible (shaft ~105 cm) and is ignored."""
    out, last = {}, None
    for f in sorted(dets):
        rows = dets[f]
        g = best(rows, HANDS)
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
    ap.add_argument("--rescore", choices=["yolo", "yolox"],
                    help="re-score the saved out/<clip>/<tag>/dets.json, no inference")
    a = ap.parse_args()
    tag = a.rescore or ("yolox" if a.yolox else "yolo")
    predict = (None if a.rescore else yolox_predictor(a.yolox, a.conf) if a.yolox else
               ultralytics_predictor(a.conf, a.imgsz))
    allrows = []
    for clip in a.clips:
        out = LAB / "out" / clip
        auto = json.loads((out / "auto-d15-dense.json").read_text())
        truth = json.loads((out / "truth.json").read_text())["checkpoints"]
        px_cm = auto["debug"]["scale"]["pxPerCm"]
        frames = [v["frame"] for v in truth.values()]
        f0, f1 = max(0, min(frames) - PAD), max(frames) + PAD
        if a.rescore:
            saved = json.loads((out / tag / "dets.json").read_text())
            dets = {int(f): [r for r in rows if r["conf"] >= a.conf]
                    for f, rows in saved["dets"].items()}
            ms = saved["msPerFrame"]
        else:
            dets, ms = detect_span(predict, LAB / "clips" / f"{clip}.mp4", f0, f1)
        raw = dets
        if not a.keep_static:
            dets = drop_static(dets)
        trk = head_track(dets, a.fallback, px_cm if a.max_cm else None, a.max_cm)
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
        if not a.rescore:  # keep the inference record; a rescore only re-reads it
            (out / tag / "dets.json").write_text(json.dumps(
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
