#!/usr/bin/env python3
"""Swing lab — compare auto detection with hand-placed ground truth.

For every out/<clip>/ that has truth.json and one or more auto*.json (auto.json = the plan as
written, auto-fixed.json = plan + recommended changes, auto-d15.json = phase rules implementing the
plan §5.1 D15 definitions + hands = grip estimate; see detect.py --variant):
  - per checkpoint: frame error (frames, real-time ms, 240 fps-equivalent frames), hands error,
    clubhead error or hidden-state agreement;
  - ball error;
  - summary (median / max) and pass/fail against the acceptance targets below;
  - out/<clip>/overlay<suffix>.jpg: contact sheet of the 9 checkpoints, auto marks filled,
    truth marks hollow.
Writes out/report.md and prints the same tables.

Scale (px -> cm): the plan's §4.6 leg-segment method on the AUTO pose of the address stills
(auto address ±2): legPx = median(hip->knee + knee->ankle) of the trail (camera-nearer) leg,
pxPerCm = legPx / (0.49 x heightCm), heightCm from truth.json (else auto.json, else 176).
The same scale is used for every variant of a clip so their cm numbers are comparable.

Errors are end-to-end: auto marks sit on the auto frame, truth marks on the truth frame, so a
frame error also shows up as a position error (that is what the user would see).

Usage:  ~/.venvs/swing-lab/bin/python -I eval.py [clip ...]
"""
from __future__ import annotations

import json
import statistics
import sys
from pathlib import Path

import cv2
import numpy as np

LAB = Path(__file__).resolve().parent
OUT = LAB / "out"
# shaftThrough (P8, D22) is optional: scored only when both auto and truth have it.
KEYS = ["address", "takeaway", "leadArm", "top", "transition", "shaftDown", "impact", "shaftThrough", "trailArm", "finish"]

# Acceptance targets (from the task brief).
FRAME_TOL_240 = {"address": 3, "top": 3, "impact": 3}   # others: 6
FRAME_TOL_OTHER = 6
HANDS_CM = 4.0
BALL_CM = 2.0
HEAD_CM = 6.0

R_HIP, R_KNEE, R_ANK, L_HIP, L_KNEE, L_ANK = 24, 26, 28, 23, 25, 27
EDGES = [(11, 12), (11, 13), (13, 15), (12, 14), (14, 16), (11, 23), (12, 24), (23, 24),
         (23, 25), (25, 27), (24, 26), (26, 28), (27, 31), (28, 32)]


def leg_scale(auto: dict, height_cm: float) -> tuple[float, float]:
    """Plan §4.6 on the auto pose at address ±2. Returns (pxPerCm, legPx)."""
    right = auto.get("handedness", "right") == "right"
    hip, knee, ank = (R_HIP, R_KNEE, R_ANK) if right else (L_HIP, L_KNEE, L_ANK)
    f0 = auto["checkpoints"]["address"]["frame"]
    legs = []
    for f in range(f0 - 2, f0 + 3):
        L = auto["pose"].get(str(f))
        if L:
            L = np.array(L)
            legs.append(np.linalg.norm(L[hip, :2] - L[knee, :2]) + np.linalg.norm(L[knee, :2] - L[ank, :2]))
    leg = float(np.median(legs))
    return leg / (0.49 * height_cm), leg


def dist(a: dict | None, b: dict | None) -> float | None:
    if a is None or b is None:
        return None
    return float(np.hypot(a["x"] - b["x"], a["y"] - b["y"]))


def evaluate(auto: dict, truth: dict, px_cm: float) -> dict:
    v = auto["video"]
    eff_fps = v["playbackFps"] * v["slowmoFactor"]
    rows = []
    for k in KEYS:
        a, t = auto["checkpoints"].get(k), truth["checkpoints"].get(k)
        if a is None or t is None:
            continue
        df = a["frame"] - t["frame"]
        f240 = df * 240.0 / eff_fps
        tol = FRAME_TOL_240.get(k, FRAME_TOL_OTHER)
        hpx = dist(a["hands"], t["hands"])
        row = {"key": k, "auto": a["frame"], "truth": t["frame"], "df": df, "ms": df / eff_fps * 1000,
               "f240": f240, "frameOk": round(abs(f240), 1) <= tol, "tol": tol,
               "handsPx": hpx, "handsCm": hpx / px_cm, "handsOk": hpx / px_cm <= HANDS_CM}
        if t.get("hidden") or t.get("head") is None:
            row["head"] = "hidden✓" if a["hidden"] else "visible✗"
            row["headOk"] = bool(a["hidden"])
            row["headCm"] = None
        elif a["hidden"] or a.get("head") is None:
            row["head"], row["headOk"], row["headCm"] = "hidden✗", False, None
        else:
            hp = dist(a["head"], t["head"])
            row["headPx"], row["headCm"] = hp, hp / px_cm
            row["head"] = f"{hp:.0f}px {hp / px_cm:.1f}cm"
            row["headOk"] = hp / px_cm <= HEAD_CM
        row["headConf"] = a.get("conf")
        # Same marks evaluated at the TRUTH frame (isolates the hands / club heuristics from the
        # phase error). Hands: auto smoothed series interpolated; clubhead: the pass-2 track,
        # available only when the truth frame was tracked.
        dbg = auto.get("debug", {})
        hs = dbg.get("handsSeries")
        if hs:
            fr = np.array(sorted(int(f) for f in hs))
            xy = np.array([hs[str(f)] for f in fr])
            hx, hy = np.interp(t["frame"], fr, xy[:, 0]), np.interp(t["frame"], fr, xy[:, 1])
            row["handsAtTruthCm"] = float(np.hypot(hx - t["hands"]["x"], hy - t["hands"]["y"])) / px_cm
        tr = dbg.get("track", {}).get(str(t["frame"]))
        if tr:
            if t.get("hidden") or t.get("head") is None:
                row["headAtTruth"] = "hidden✓" if tr["hidden"] else "visible✗"
            elif tr["hidden"]:
                row["headAtTruth"] = "hidden✗"
            else:
                d = float(np.hypot(tr["head"][0] - t["head"]["x"], tr["head"][1] - t["head"]["y"])) / px_cm
                row["headAtTruth"] = f"{d:.1f}cm"
                row["headAtTruthCm"] = d
        rows.append(row)
    ball = None
    if truth.get("ball"):
        bp = dist(auto.get("ball"), truth["ball"])
        ball = {"px": bp, "cm": None if bp is None else bp / px_cm,
                "ok": bp is not None and bp / px_cm <= BALL_CM}
    return {"rows": rows, "ball": ball, "effFps": eff_fps}


def fmt_table(E: dict) -> list[str]:
    out = ["| checkpoint | auto | truth | Δ frames | Δ ms | Δ @240 | frame | hands px | hands cm | hands | "
           "clubhead | head conf | head | hands cm @truth frame | clubhead @truth frame |",
           "|---|---:|---:|---:|---:|---:|:-:|---:|---:|:-:|---|---:|:-:|---:|---|"]
    ok = lambda b: "PASS" if b else "FAIL"
    for r in E["rows"]:
        out.append(f"| {r['key']} | {r['auto']} | {r['truth']} | {r['df']:+d} | {r['ms']:+.0f} | {r['f240']:+.1f} "
                   f"(≤{r['tol']}) | {ok(r['frameOk'])} | {r['handsPx']:.0f} | {r['handsCm']:.1f} | {ok(r['handsOk'])} | "
                   f"{r['head']} | {r['headConf']} | {ok(r['headOk'])} | "
                   f"{r.get('handsAtTruthCm', float('nan')):.1f} | {r.get('headAtTruth', 'not tracked')} |")
    return out


def fmt_summary(E: dict) -> list[str]:
    rows = E["rows"]
    f = [abs(r["f240"]) for r in rows]
    h = [r["handsCm"] for r in rows]
    hc = [r["headCm"] for r in rows if r.get("headCm") is not None]
    visible_truth = [r for r in rows if not r["head"].startswith("hidden✓") and r["head"] != "visible✗"]
    hidden_truth = [r for r in rows if r["head"] in ("hidden✓", "visible✗")]
    pf = lambda n, d: f"{n}/{d}"
    hat = [r["handsAtTruthCm"] for r in rows if "handsAtTruthCm" in r]
    cat = [r["headAtTruthCm"] for r in rows if "headAtTruthCm" in r]

    def med_max(xs):
        return f"{statistics.median(xs):.1f} | {max(xs):.1f}" if xs else "– | –"
    b = E["ball"]
    ball = "no truth" if b is None else ("not found → FAIL" if b["px"] is None else
                                         f"{b['px']:.1f} px / {b['cm']:.1f} cm → {'PASS' if b['ok'] else 'FAIL'}")
    lines = [
        "| metric | median | max | pass |",
        "|---|---:|---:|---:|",
        f"| phase error (240 fps-eq frames) | {statistics.median(f):.1f} | {max(f):.1f} | {pf(sum(r['frameOk'] for r in rows), len(rows))} |",
        f"| hands error (cm, ≤ {HANDS_CM}) | {statistics.median(h):.1f} | {max(h):.1f} | {pf(sum(r['handsOk'] for r in rows), len(rows))} |",
        f"| clubhead error where both visible (cm, ≤ {HEAD_CM}) | "
        f"{statistics.median(hc) if hc else float('nan'):.1f} | {max(hc) if hc else float('nan'):.1f} | "
        f"{pf(sum(r['headOk'] for r in visible_truth), len(visible_truth))} visible in truth |",
        f"| clubhead hidden-state agreement (truth hidden) | | | {pf(sum(r['headOk'] for r in hidden_truth), len(hidden_truth))} |",
        f"| ball | | | {ball} |",
        f"| diagnostic: hands at the truth frame (cm) | {med_max(hat)} | {sum(x <= HANDS_CM for x in hat)}/{len(hat)} |",
        f"| diagnostic: clubhead at the truth frame, where tracked & visible (cm) | {med_max(cat)} | "
        f"{sum(x <= HEAD_CM for x in cat)}/{len(cat)} |",
    ]
    return lines


def verdict(E: dict) -> dict:
    rows = E["rows"]
    return {
        "phases": all(r["frameOk"] for r in rows),
        "hands": all(r["handsOk"] for r in rows),
        "clubhead": all(r["headOk"] for r in rows),
        "ball": bool(E["ball"] and E["ball"]["ok"]),
    }


# ---------------------------------------------------------------------------------------------
# Overlay contact sheet
# ---------------------------------------------------------------------------------------------
def overlay(clip_dir: Path, auto: dict, truth: dict, E: dict, out: Path) -> None:
    W, H = auto["video"]["w"], auto["video"]["h"]
    pts = []
    for f, L in auto["pose"].items():
        pts += [p[:2] for p in L if p[2] > 0.3]
    pose_pts = np.array(pts)
    pts = []
    for src in (auto, truth):
        for c in src["checkpoints"].values():
            for m in (c.get("hands"), c.get("head")):
                if m:
                    pts.append([m["x"], m["y"]])
        if src.get("ball"):
            pts.append([src["ball"]["x"], src["ball"]["y"]])
    # crop: the golfer (robust percentiles of the pose) plus every mark, with a margin
    lo = np.minimum(np.percentile(pose_pts, 1, axis=0), np.min(pts, axis=0)) - 30
    hi = np.maximum(np.percentile(pose_pts, 99, axis=0), np.max(pts, axis=0)) + 30
    x0, y0 = np.clip(lo, 0, None).astype(int)
    x1, y1 = np.minimum(hi, [W, H]).astype(int)
    k = max(1.0, 420 / (y1 - y0))
    row_by_key = {r["key"]: r for r in E["rows"]}

    def m(p):
        return int((p["x"] - x0) * k), int((p["y"] - y0) * k)

    tiles = []
    for key in KEYS:
        a = auto["checkpoints"].get(key)
        if a is None:
            continue
        t = truth["checkpoints"].get(key, {})
        img = cv2.imread(str(clip_dir / "frames" / f"{a['frame']}.jpg"))
        tile = cv2.resize(img[y0:y1, x0:x1], None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
        L = auto["pose"].get(str(a["frame"]))
        if L:
            for i, j in EDGES:
                p, q = L[i], L[j]
                cv2.line(tile, m({"x": p[0], "y": p[1]}), m({"x": q[0], "y": q[1]}), (200, 200, 200), 1, cv2.LINE_AA)
        # ball: auto filled dot, truth ring
        if truth.get("ball"):
            cv2.circle(tile, m(truth["ball"]), 9, (255, 255, 255), 2, cv2.LINE_AA)
        if auto.get("ball"):
            cv2.circle(tile, m(auto["ball"]), 4, (255, 255, 255), -1, cv2.LINE_AA)
        # truth: hollow (hands = cyan square, head = green circle)
        if t.get("hands"):
            hx, hy = m(t["hands"])
            cv2.rectangle(tile, (hx - 8, hy - 8), (hx + 8, hy + 8), (255, 255, 0), 2)
        if t.get("head"):
            cv2.circle(tile, m(t["head"]), 9, (0, 255, 0), 2, cv2.LINE_AA)
        # auto: filled (hands = orange square, head = red dot, shaft = yellow line)
        hx, hy = m(a["hands"])
        if a.get("head"):
            cv2.line(tile, (hx, hy), m(a["head"]), (0, 220, 255), 2, cv2.LINE_AA)
            cv2.circle(tile, m(a["head"]), 6, (0, 0, 255), -1, cv2.LINE_AA)
        elif a.get("shaft"):  # hidden: draw the kept angle dashed-ish (thin) for context
            ex, ey = a["shaft"]["end"]
            cv2.line(tile, (hx, hy), m({"x": ex, "y": ey}), (0, 140, 255), 1, cv2.LINE_AA)
        cv2.rectangle(tile, (hx - 6, hy - 6), (hx + 6, hy + 6), (0, 120, 255), -1)
        r = row_by_key.get(key)
        cv2.rectangle(tile, (0, 0), (tile.shape[1], 46), (0, 0, 0), -1)
        cv2.putText(tile, f"{key}  auto #{a['frame']}", (6, 18), 0, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
        sub = f"truth #{t.get('frame')} ({r['df']:+d})" if r else "no truth"
        sub += "  auto:hidden" if a["hidden"] else ""
        sub += "  truth:hidden" if t.get("hidden") else ""
        cv2.putText(tile, sub, (6, 38), 0, 0.45, (200, 255, 200), 1, cv2.LINE_AA)
        tiles.append(tile)
    hgt = max(t.shape[0] for t in tiles)
    wid = max(t.shape[1] for t in tiles)
    tiles = [cv2.copyMakeBorder(t, 0, hgt - t.shape[0], 0, wid - t.shape[1] + 4, cv2.BORDER_CONSTANT) for t in tiles]
    sheet = np.vstack([np.hstack(tiles[i:i + 3]) for i in range(0, 9, 3)])
    legend = np.zeros((40, sheet.shape[1], 3), np.uint8)
    items = [("auto hands", (0, 120, 255)), ("auto head", (0, 0, 255)), ("truth hands (hollow)", (255, 255, 0)),
             ("truth head (hollow)", (0, 255, 0)), ("ball auto dot / truth ring", (255, 255, 255))]
    x = 8
    for txt, col in items:
        cv2.putText(legend, txt, (x, 26), 0, 0.5, col, 1, cv2.LINE_AA)
        x += 12 + 9 * len(txt)
    cv2.imwrite(str(out), np.vstack([sheet, legend]), [cv2.IMWRITE_JPEG_QUALITY, 88])


# ---------------------------------------------------------------------------------------------
def main() -> None:
    clips = sys.argv[1:] or sorted(p.name for p in OUT.iterdir() if (p / "truth.json").exists())
    report = ["# Swing lab — auto vs truth", "",
              "Generated by `eval.py`. `auto.json` = the plan as written; `auto-fixed.json` = the plan "
              "plus the recommended changes (`detect.py --variant fixed`); `auto-d15.json` = rules that "
              "implement the D15 checkpoint definitions, hands = grip estimate (`--variant d15`). PLAN-GAP comments in "
              "`detect.py` mark every choice the plan left open.", "",
              f"Targets: phase error ≤ 3 frames (240 fps-equivalent) for address/top/impact, ≤ {FRAME_TOL_OTHER} "
              f"for the others; hands ≤ {HANDS_CM} cm; ball ≤ {BALL_CM} cm; clubhead ≤ {HEAD_CM} cm where visible "
              "in truth, and hidden where truth says hidden.", "",
              "Scale: plan §4.6 leg-segment method (trail-leg hip→knee→ankle at auto address ±2, "
              "0.49 × heightCm), computed once per clip from `auto.json` and reused for every variant.", ""]
    for clip in clips:
        d = OUT / clip
        truth = json.loads((d / "truth.json").read_text())
        autos = sorted(d.glob("auto*.json"))
        if not autos:
            continue
        base = json.loads((d / "auto.json").read_text()) if (d / "auto.json").exists() else json.loads(autos[0].read_text())
        height = truth.get("heightCm") or base.get("heightCm") or 176
        px_cm, leg = leg_scale(base, height)
        report += [f"## {clip}", "", f"Scale: legPx {leg:.1f} → **{px_cm:.3f} px/cm** (height {height} cm).", ""]
        for ap in autos:
            auto = json.loads(ap.read_text())
            E = evaluate(auto, truth, px_cm)
            V = verdict(E)
            suffix = ap.stem[len("auto"):]
            overlay(d, auto, truth, E, d / f"overlay{suffix}.jpg")
            dbg = auto.get("debug", {})
            v = auto["video"]
            tm = auto.get("timings", {})
            head = [f"### {ap.name}  (variant: {dbg.get('variant', '?')}, model: {dbg.get('model', '?')})", "",
                    f"slow-mo factor {v['slowmoFactor']} ({dbg.get('factorSource', '?')}) → {E['effFps']:.0f} fps; "
                    f"pose inferences {tm.get('inferences')}/{v['frames']}; poseMs {tm.get('poseMs')}, "
                    f"pass2Ms {tm.get('pass2Ms')}, totalMs {tm.get('totalMs')} (lab Mac CPU, not the phone).", ""]
            table = fmt_table(E)
            summ = fmt_summary(E)
            ver = "  ".join(f"{k}: {'PASS' if ok else 'FAIL'}" for k, ok in V.items())
            block = head + table + [""] + summ + ["", f"**Verdict:** {ver}", "",
                                                   f"Overlay: `out/{clip}/overlay{suffix}.jpg`", ""]
            print("\n".join(block))
            report += block
    (OUT / "report.md").write_text("\n".join(report) + "\n")
    print(f"wrote {(OUT / 'report.md').relative_to(LAB)}")


if __name__ == "__main__":
    main()
