#!/usr/bin/env python3
"""Swing lab — track the shaft / clubhead outward from impact (prototype).

The app proposes the clubhead at address and impact only (one ShaftSearch at the impact frame,
seeded hands -> ball ±15°). This script measures whether that impact seed can be carried frame by
frame BACKWARD (to shaftDown / P6) and FORWARD (to shaftThrough / P8), and what it gives at
preImpact = impact - round(0.025 x fps).

Inputs (all produced by `detect.py <clip> --variant d15 --dense`):
  out/<clip>/.pose-full-dense.json   per-frame pose (hands = d15 grip estimate, smoothed)
  out/<clip>/auto-d15-dense.json     ball, scale, detected phase frames
  out/<clip>/truth.json              truth frames/heads (truth frames win over detected ones)

Chosen variant (the defaults): seed at impact hands -> ball ±15° (as the app); each next frame
searches ±15° around the previous frame's angle with that frame's pose hands; a direction stops at
the first frame that is hidden or has conf < 0.35; the clubhead along the tracked ray comes from
motion (`motion_end`), not from the shaft-profile length rule. Variants: --hw, --floor, --predict
(constant angular velocity prior), --length first (the app's rule) | gap | motion.

Usage:
  ~/.venvs/swing-lab/bin/python -I track_impact.py [clip ...] [--sweep] [--no-sheets]
  (swing-2026-10-12-bc118e4c: its truth frames are wrong — pass
   --frames impact=150,shaftDown=144,shaftThrough=156, read off the video)

Writes out/<clip>/track/{down,through}.png contact sheets and out/<clip>/track/track.json.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np

LAB = Path(__file__).resolve().parent
sys.path.insert(0, str(LAB))
import detect as D  # noqa: E402

CLIPS = ["marcos-2026-10-10", "swing-2026-10-14-b5e60f31", "swing-2026-10-13-88125330",
         "swing-2026-10-12-bc118e4c"]
MARGIN = 6          # frames tracked past shaftDown / shaftThrough
SHEET_MARGIN = 2    # frames shown past them on the contact sheets


# ---------------------------------------------------------------------------------------------
class GapSearch(D.ShaftSearch):
    """ShaftSearch with a gap-tolerant length rule. The app's rule ends the shaft at the FIRST
    radius past the profile peak where the window-averaged profile drops below 35 % of the peak;
    a background edge crossing the shaft (grass -> mat) is a short dip that ends it there, at
    mid-shaft. Here the shaft ends where the profile STAYS below 35 % for >= gap x expected px."""

    def __init__(self, gray, expected_px, ball_d_px, gap=0.10):
        super().__init__(gray, expected_px, ball_d_px)
        self.gap = gap

    def search(self, hx, hy, center_deg, half_width=15):
        r0 = super().search(hx, hy, center_deg, half_width)
        prof, r = self.profiles(hx, hy)
        k = r0["angleDeg"]
        win = max(3, int(round(0.05 * self.exp)))
        p = np.convolve(prof[k], np.ones(win) / win, "same")
        kp = int(np.argmax(p))
        need = max(2, int(round(self.gap * self.exp)))
        below = (np.arange(len(p)) > kp) & (p < 0.35 * p[kp])
        end = len(p) - 1
        run = 0
        for i in range(kp + 1, len(p)):
            run = run + 1 if below[i] else 0
            if run >= need:
                end = i - need + 1
                break
        length = float(r[end])
        ex, ey = hx + math.cos(math.radians(k)) * length, hy + math.sin(math.radians(k)) * length
        ratio = r0["ratio"]
        conf = float(np.clip((ratio - 1) / 4, 0, 1) * min(1.0, length / self.exp))
        return {**r0, "lengthPx": length, "end": (ex, ey), "head": self.blob(ex, ey),
                "hidden": bool(ratio < 2.5 or length < 0.3 * self.exp), "conf": round(conf, 2)}


def motion_end(grays, f, hx, hy, angle_deg, exp, band):
    """Clubhead end along the tracked ray from motion, in working px from the hands (None if no
    motion). m = min(|g_f - g_f-1|, |g_f - g_f+1|): pixels that differ from BOTH neighbours, i.e.
    the moving club as it is at frame f (background, the static ball and the previous/next
    positions cancel). Per radius in [0.4, 1.2] x expected: max of m over a +-1 ball-diameter
    strip across the ray; the head end is the LAST radius whose value >= max(12 grey levels,
    0.35 x the ray's 95th percentile)."""
    if f - 1 not in grays or f + 1 not in grays:
        return None
    b = [cv2.GaussianBlur(grays[k], (3, 3), 0) for k in (f - 1, f, f + 1)]
    m = np.minimum(np.abs(b[1] - b[0]), np.abs(b[1] - b[2]))
    th = math.radians(angle_deg)
    d = np.array([math.cos(th), math.sin(th)])
    n = np.array([-d[1], d[0]])
    rr = np.arange(0.4 * exp, 1.2 * exp)
    off = np.arange(-band, band + 1)
    X = (hx + d[0] * rr[:, None] + n[0] * off[None, :]).astype(np.float32)
    Y = (hy + d[1] * rr[:, None] + n[1] * off[None, :]).astype(np.float32)
    v = cv2.remap(m, X, Y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0).max(1)
    v = np.convolve(v, np.ones(3) / 3, "same")
    idx = np.flatnonzero(v >= max(12.0, 0.35 * np.percentile(v, 95)))
    return float(rr[idx[-1]]) if len(idx) else None


def load(clip: str, override: dict | None = None) -> dict:
    out = LAB / "out" / clip
    auto = json.loads((out / "auto-d15-dense.json").read_text())
    truth_p = out / "truth.json"
    truth = json.loads(truth_p.read_text()) if truth_p.exists() else {"checkpoints": {}}
    pose = json.loads((out / ".pose-full-dense.json").read_text())
    pose["samples"] = {int(k): v for k, v in pose["samples"].items()}
    path = LAB / "clips" / f"{clip}.mp4"
    info = D.probe(path)
    handed = auto.get("handedness", "right")
    _, S, _, _ = D.choose_factor_d15(pose, info, handed, D.GRIP_K)
    ws = auto["debug"]["workScale"]
    px_cm = auto["debug"]["scale"]["pxPerCm"]
    fps = auto["video"]["captureFps"]
    tc, ac = truth["checkpoints"], auto["checkpoints"]

    def frame_of(k):
        if override and k in override:
            return int(override[k]), "manual"
        if k in tc:
            return int(tc[k]["frame"]), "truth"
        return int(ac[k]["frame"]), "auto"
    frames = {k: frame_of(k) for k in ("shaftDown", "impact", "shaftThrough")}
    imp = frames["impact"][0]
    frames["preImpact"] = (imp - int(round(0.025 * fps)), frames["impact"][1])
    return {"clip": clip, "path": path, "info": info, "S": S, "ws": ws, "pxCm": px_cm, "fps": fps,
            "ball": auto["ball"], "frames": frames, "truth": tc, "handed": handed}


def hands_at(C, f):
    return D.at_frame(C["S"]["idx"], C["S"]["hands"], f)


def read_frames(C, lo, hi) -> dict[int, np.ndarray]:
    cap = cv2.VideoCapture(str(C["path"]))
    cap.set(cv2.CAP_PROP_POS_FRAMES, lo)
    out = {}
    for f in range(lo, hi + 1):
        ok, fr = cap.read()
        if not ok:
            break
        out[f] = fr
    cap.release()
    return out


# ---------------------------------------------------------------------------------------------
def track(C, frames_bgr, grays, *, hw=15, floor=0.35, predict=False, stop=True, length="first"):
    """Seed at impact (hands -> ball, ±15°, like the app), then walk each direction.

    predict: centre the window on prev + (prev - prev2) (constant angular velocity) instead of prev.
    stop:    False = keep going through hidden / low-conf frames (for the contact sheets).
    Returns {frame: result + 'alive'}; result coords in full-res px.
    """
    ws = C["ws"]
    exp_px = D.SHAFT_CM * C["pxCm"] * ws
    ball_d = D.BALL_CM * C["pxCm"] * ws
    imp = C["frames"]["impact"][0]
    lo = C["frames"]["shaftDown"][0] - MARGIN
    hi = C["frames"]["shaftThrough"][0] + MARGIN
    b = C["ball"]

    def run(f, center, half):
        hx, hy = hands_at(C, f)
        srch = GapSearch(grays[f], exp_px, ball_d) if length == "gap" else D.ShaftSearch(grays[f], exp_px, ball_d)
        r = srch.search(hx * ws, hy * ws, center, half)
        r = dict(r)
        if length == "motion":
            L = motion_end(grays, f, hx * ws, hy * ws, r["angleDeg"], exp_px, max(2, int(round(ball_d))))
            if L is not None:
                th = math.radians(r["angleDeg"])
                e = (hx * ws + math.cos(th) * L, hy * ws + math.sin(th) * L)
                r.update(lengthPx=L, end=e, head=e)
        r["hands"] = (float(hx), float(hy))
        r["end"] = (r["end"][0] / ws, r["end"][1] / ws)
        r["head"] = (r["head"][0] / ws, r["head"][1] / ws)
        r["lengthPx"] = r["lengthPx"] / ws
        return r

    h = hands_at(C, imp)
    seed = math.degrees(math.atan2(b["y"] - h[1], b["x"] - h[0])) % 360
    res = {imp: {**run(imp, seed, 15), "alive": True}}
    res[imp]["alive"] = not (res[imp]["hidden"] or res[imp]["conf"] < floor)
    for step, end in ((-1, lo), (1, hi)):
        alive = res[imp]["alive"]
        angs = [res[imp]["angleDeg"]]
        f = imp + step
        while (f >= end if step < 0 else f <= end) and f in grays:
            center = angs[-1]
            if predict and len(angs) >= 2:
                d = (angs[-1] - angs[-2] + 180) % 360 - 180
                center = angs[-1] + d
            r = run(f, center, hw)
            bad = r["hidden"] or r["conf"] < floor
            alive = alive and not bad
            r["alive"] = alive
            res[f] = r
            if not alive and stop:
                break
            angs.append(r["angleDeg"])
            f += step
    return res


def err_cm(C, r, key):
    t = C["truth"].get(key)
    if not t or not t.get("head") or r is None:
        return None
    return math.hypot(r["head"][0] - t["head"]["x"], r["head"][1] - t["head"]["y"]) / C["pxCm"]


def summarize(C, res):
    rows = {}
    for key in ("preImpact", "shaftDown", "impact", "shaftThrough"):
        f = C["frames"][key][0]
        r = res.get(f)
        found = bool(r and r["alive"])
        rows[key] = {"frame": f, "src": C["frames"][key][1], "found": found,
                     "conf": r["conf"] if r else None,
                     "errCm": (round(err_cm(C, r, key), 1) if (found and err_cm(C, r, key) is not None) else None),
                     "errCmIfShown": (round(err_cm(C, r, key), 1) if err_cm(C, r, key) is not None else None)}
    imp = C["frames"]["impact"][0]
    alive = sorted(f for f, r in res.items() if r["alive"])
    rows["survives"] = {"back": imp - alive[0] if alive else None, "fwd": alive[-1] - imp if alive else None}
    return rows


# ---------------------------------------------------------------------------------------------
def colour(r):
    if r["hidden"]:
        return (60, 60, 230)                 # red: hidden
    if r["conf"] >= 0.6:
        return (60, 200, 60)                 # green
    if r["conf"] >= 0.35:
        return (0, 200, 255)                 # amber
    return (60, 60, 230)                     # red


def sheet(C, frames_bgr, res, stopped, f0, f1, name, tile_w=450, cols=4, per=12):
    """One tile per frame f0..f1: crop around the golfer, tracked shaft + head dot (colour = conf),
    truth head (cyan ring) where present, 'X' when the stop rule has already ended the track."""
    imp = C["frames"]["impact"][0]
    L = D.SHAFT_CM * C["pxCm"]
    # fixed crop for the clip: hands over the range +- 1.15 shaft lengths, plus the ball
    hs = np.array([hands_at(C, f) for f in range(f0, f1 + 1)])
    x0 = int(max(0, hs[:, 0].min() - 1.15 * L)); x1 = int(min(C["info"]["w"], hs[:, 0].max() + 1.15 * L))
    y0 = int(max(0, hs[:, 1].min() - 1.0 * L)); y1 = int(min(C["info"]["h"], max(hs[:, 1].max() + 1.0 * L, C["ball"]["y"] + 0.15 * L)))
    s = tile_w / (x1 - x0)
    th = int(round((y1 - y0) * s))
    tiles = []
    keys = {v[0]: k for k, v in C["frames"].items()}
    for f in range(f0, f1 + 1):
        img = frames_bgr[f][y0:y1, x0:x1].copy()
        img = cv2.resize(img, (tile_w, th), interpolation=cv2.INTER_AREA)
        r = res.get(f)

        def P(p):
            return (int(round((p[0] - x0) * s)), int(round((p[1] - y0) * s)))
        if r is not None:
            c = colour(r)
            cv2.line(img, P(r["hands"]), P(r["end"]), c, 1, cv2.LINE_AA)
            cv2.circle(img, P(r["hands"]), 3, (255, 255, 255), 1, cv2.LINE_AA)
            cv2.circle(img, P(r["head"]), 4, c, -1, cv2.LINE_AA)
            if not stopped.get(f, {}).get("alive", False):
                q = P(r["head"])
                cv2.line(img, (q[0] - 7, q[1] - 7), (q[0] + 7, q[1] + 7), (0, 0, 0), 2)
                cv2.line(img, (q[0] - 7, q[1] + 7), (q[0] + 7, q[1] - 7), (0, 0, 0), 2)
        for k, (tf, _) in C["frames"].items():
            t = C["truth"].get(k)
            if tf == f and t and t.get("head"):
                cv2.circle(img, P((t["head"]["x"], t["head"]["y"])), 8, (255, 255, 0), 1, cv2.LINE_AA)
        lab = f"{f} ({f - imp:+d})" + (f" {keys[f]}" if f in keys else "")
        lab2 = "-" if r is None else ("hidden" if r["hidden"] else f"c{r['conf']:.2f}") + \
            ("" if r is None else f" a{r['angleDeg']}")
        cv2.rectangle(img, (0, 0), (tile_w, 30), (0, 0, 0), -1)
        cv2.putText(img, lab, (3, 12), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1, cv2.LINE_AA)
        cv2.putText(img, lab2, (3, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1, cv2.LINE_AA)
        tiles.append(img)
    out = LAB / "out" / C["clip"] / "track"
    out.mkdir(parents=True, exist_ok=True)
    paths = []
    for part, i0 in enumerate(range(0, len(tiles), per)):
        chunk = tiles[i0:i0 + per]
        while len(chunk) % cols:
            chunk.append(np.zeros_like(tiles[0]))
        rows = [np.hstack(chunk[i:i + cols]) for i in range(0, len(chunk), cols)]
        p = out / f"{name}-{part + 1}.png"
        cv2.imwrite(str(p), np.vstack(rows))
        paths.append(p)
    return paths


# ---------------------------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clips", nargs="*", default=CLIPS)
    ap.add_argument("--sweep", action="store_true", help="print the variant sweep table")
    ap.add_argument("--no-sheets", action="store_true")
    ap.add_argument("--hw", type=float, default=15)
    ap.add_argument("--frames", default=None,
                    help="override phase frames, e.g. impact=150,shaftDown=144,shaftThrough=156 "
                         "(for a clip whose truth frames are wrong)")
    ap.add_argument("--floor", type=float, default=0.35)
    ap.add_argument("--predict", action="store_true")
    ap.add_argument("--length", choices=["first", "gap", "motion"], default="motion")
    a = ap.parse_args()
    variants = [(hw, fl, pr, ln) for ln in ("first", "gap", "motion") for hw in (10, 15, 20) for fl in (0.0, 0.35)
                for pr in (False, True)] if a.sweep else [(a.hw, a.floor, a.predict, a.length)]
    for clip in a.clips:
        C = load(clip, dict(kv.split("=") for kv in a.frames.split(",")) if a.frames else None)
        lo = C["frames"]["shaftDown"][0] - MARGIN
        hi = C["frames"]["shaftThrough"][0] + MARGIN
        fb = read_frames(C, lo - 1, hi + 1)   # +-1: the motion head needs both neighbours
        grays = {f: D.work_gray(fr, C["ws"]) for f, fr in fb.items()}
        print(f"\n== {clip}  fps={C['fps']} pxPerCm={C['pxCm']} frames="
              + " ".join(f"{k}={v[0]}({v[1]})" for k, v in C["frames"].items()))
        for hw, fl, pr, ln in variants:
            res = track(C, fb, grays, hw=hw, floor=fl, predict=pr, length=ln)
            sm = summarize(C, res)
            cells = []
            for k in ("preImpact", "shaftDown", "impact", "shaftThrough"):
                r = sm[k]
                e = r["errCmIfShown"]
                cells.append(f"{k[:6]}:{'Y' if r['found'] else 'n'} c{r['conf'] if r['conf'] is not None else '-'}"
                             + (f" e{e}" if e is not None else ""))
            print(f"{ln:5} hw{hw:>2} floor{fl:.2f} {'pred' if pr else 'prev'} | back {sm['survives']['back']:>3} fwd "
                  f"{sm['survives']['fwd']:>3} | " + " | ".join(cells))
        if not a.no_sheets:
            hw, fl, pr, ln = a.hw, a.floor, a.predict, a.length
            full = track(C, fb, grays, hw=hw, floor=fl, predict=pr, stop=False, length=ln)
            stopped = track(C, fb, grays, hw=hw, floor=fl, predict=pr, stop=True, length=ln)
            imp = C["frames"]["impact"][0]
            p1 = sheet(C, fb, full, stopped, C["frames"]["shaftDown"][0] - SHEET_MARGIN, imp, "down")
            p2 = sheet(C, fb, full, stopped, imp, C["frames"]["shaftThrough"][0] + SHEET_MARGIN, "through")
            dump = {str(f): {"angleDeg": r["angleDeg"], "conf": r["conf"], "hidden": r["hidden"],
                             "ratio": r["ratio"], "lengthPx": round(r["lengthPx"], 1),
                             "head": [round(v, 1) for v in r["head"]], "alive": stopped.get(f, {}).get("alive", False)}
                    for f, r in sorted(full.items())}
            (LAB / "out" / clip / "track" / "track.json").write_text(json.dumps(
                {"variant": {"hw": hw, "floor": fl, "predict": pr, "length": ln}, "frames": {k: v[0] for k, v in C["frames"].items()},
                 "summary": summarize(C, stopped), "track": dump}, indent=1))
            print("sheets: " + " ".join(str(p.relative_to(LAB)) for p in p1 + p2))


if __name__ == "__main__":
    main()
