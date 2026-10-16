#!/usr/bin/env python3
"""Swing lab — export the YOLOX-tiny club detector to TFLite (fp16 weights) + golden fixtures (L2).

Plan: docs/superpowers/plans/2026-10-16-swing-club-detector.md §3 (export), §6.2 (acceptance).

What it does
  1. Loads the `ema` weights of a train_yolox.py checkpoint into build_exp().get_model() with the
     decode baked into the graph (head.decode_in_inference = True): the output is the decoded
     tensor [1, 8400, 8] = (cx, cy, w, h, obj, cls_shaft, cls_head, cls_hands) in 640-px units,
     obj / cls already sigmoided. NMS is NOT in the graph (Kotlin: ClubDecode).
  2. Converts with litert-torch (Google, Apache-2.0; the renamed `ai-edge-torch`, whose 0.7.x
     package is only a shim over it) to fp32 TFLite, then casts the weights to fp16 with
     ai-edge-quantizer's FLOAT_CASTING (fp16 weights + DEQUANTIZE ops, fp32 compute).
  3. Checks the TFLite model against PyTorch on every marked, visible clubhead of the lab clips
     (out/<clip>/truth.json; frames read with cv2 like eval_yolo.py): same decode + class-wise NMS
     (numpy, mirrors the Kotlin ClubDecode), best `head` box centre within 2 px and score within
     0.02 (plan §6.2). Prints the table; exit 1 if it fails.
  4. Writes golden fixtures for the Kotlin unit test (plan §3.5) for the impact frame of each clip.
  5. Copies the model + fixtures into the app worktree (skipped when the check fails).

Model I/O (what Kotlin must honour)
  input   float32 NHWC [1, 640, 640, 3], channel order B, G, R, values 0..255, NO normalisation.
          The frame is stretched (not letterboxed) to 640x640, like cv2.resize in training.
          (litert-torch's to_channel_last_io makes the converted graph take NHWC; the PyTorch
          model itself is NCHW.) input.bin fixtures are the uint8 HWC BGR bytes = the same bytes
          as the NHWC tensor before the cast to float.
  output  float32 [1, 8400, 8], row-major: 8400 = 80*80 + 40*40 + 20*20 anchors (strides 8,16,32).
  Per row: x1 = cx - w/2 ...; cls = argmax(cols 5..7); score = obj * max(cols 5..7); keep >= 0.03;
  class-wise greedy NMS at IoU 0.45 (IoU without +1), sorted by score desc.

AGPL guard: this script never touches `ultralytics` (AGPL-3.0, only eval_yolo.py's public-baseline
mode uses it, in another venv). It refuses to run if ultralytics is importable in its env, and
refuses checkpoints that are not YOLOX state dicts from train_yolox.py.

Setup: `uv venv -p 3.11 ~/.venvs/swing-export && uv pip install -p ~/.venvs/swing-export/bin/python
litert-torch ai-edge-litert ai-edge-quantizer torch torchvision opencv-python-headless numpy loguru
tabulate pycocotools thop psutil tqdm packaging`  (ai-edge-torch installs the same stack).
Usage: ~/.venvs/swing-export/bin/python -I export_tflite.py [--ckpt models/yolox-club-v2/epoch_8.pth]
       [--out models/club] [--app <worktree>] [--no-copy]
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import shutil
import sys
import time
from pathlib import Path

if importlib.util.find_spec("ultralytics") is not None:  # AGPL guard (plan §7)
    sys.exit("refusing to run: `ultralytics` (AGPL-3.0) is importable in this environment. "
             "Use ~/.venvs/swing-export, which must not contain it.")

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import torch  # noqa: E402

LAB = Path(__file__).resolve().parent
sys.path.insert(0, str(LAB))  # -I leaves the script dir off sys.path
from train_yolox import SIZE, build_exp  # noqa: E402
from yolox.utils import postprocess  # noqa: E402

APP = LAB.parents[1] / ".claude" / "worktrees" / "club-detector"
if not APP.exists():
    APP = Path("/Users/marcospecker/Projects/golf-partner/.claude/worktrees/club-detector")
CLIPS = ["marcos-2026-10-10", "swing-2026-10-13-88125330", "swing-2026-10-14-b5e60f31"]
HEAD = 1
CONF, NMS_IOU = 0.03, 0.45
MAX_CENTRE_PX, MAX_SCORE = 2.0, 0.02
ASSET = "club_yolox_tiny_v1.tflite"


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def load_model(ckpt: Path) -> torch.nn.Module:
    sd = torch.load(ckpt, map_location="cpu", weights_only=False)
    ema = sd.get("ema") if isinstance(sd, dict) else None
    if not isinstance(ema, dict) or not any(k.startswith("head.cls_preds") for k in ema) \
            or list(sd.get("names", [])) != ["shaft", "head", "hands"]:
        sys.exit(f"refusing {ckpt}: not a train_yolox.py checkpoint (no YOLOX `ema` state dict)")
    model = build_exp().get_model()
    model.load_state_dict(ema)
    model.head.decode_in_inference = True
    return model.eval()


def convert(model: torch.nn.Module, out: Path) -> tuple[Path, Path]:
    import litert_torch
    from ai_edge_quantizer import quantizer
    nhwc = litert_torch.to_channel_last_io(model, args=[0]).eval()
    sample = (torch.rand(1, SIZE, SIZE, 3) * 255,)
    f32 = out / "club_yolox_tiny_fp32.tflite"
    litert_torch.convert(nhwc, sample).export(str(f32))
    q = quantizer.Quantizer(str(f32))
    q.load_quantization_recipe([{
        "regex": ".*", "operation": "*", "algorithm_key": "float_casting",
        "op_config": {"weight_tensor_config": {"num_bits": 16, "dtype": "FLOAT"},
                      "compute_precision": "FLOAT", "explicit_dequantize": True}}])
    f16 = out / "club_yolox_tiny_fp16.tflite"
    q.quantize().export_model(str(f16), overwrite=True)
    return f32, f16


def decode_nms(raw: np.ndarray, conf: float = CONF, iou_thr: float = NMS_IOU) -> list[dict]:
    """[8400, 8] -> boxes in 640 units; mirrors the Kotlin ClubDecode / YOLOX postprocess."""
    raw = raw.reshape(-1, 8).astype(np.float64)
    cx, cy, w, h = raw[:, 0], raw[:, 1], raw[:, 2], raw[:, 3]
    cls = raw[:, 5:].argmax(1)
    score = raw[:, 4] * raw[:, 5:].max(1)
    keep = np.flatnonzero(score >= conf)
    boxes = []
    for c in range(3):
        idx = keep[cls[keep] == c]
        idx = idx[np.argsort(-score[idx], kind="stable")]
        x1, y1, x2, y2 = cx[idx] - w[idx] / 2, cy[idx] - h[idx] / 2, cx[idx] + w[idx] / 2, cy[idx] + h[idx] / 2
        area = (x2 - x1) * (y2 - y1)
        alive = np.ones(len(idx), bool)
        for i in range(len(idx)):
            if not alive[i]:
                continue
            boxes.append({"cls": c, "score": float(score[idx[i]]), "x1": float(x1[i]),
                          "y1": float(y1[i]), "x2": float(x2[i]), "y2": float(y2[i])})
            ix = np.clip(np.minimum(x2[i], x2[i + 1:]) - np.maximum(x1[i], x1[i + 1:]), 0, None)
            iy = np.clip(np.minimum(y2[i], y2[i + 1:]) - np.maximum(y1[i], y1[i + 1:]), 0, None)
            inter = ix * iy
            union = area[i] + area[i + 1:] - inter
            alive[i + 1:] &= ~(inter / np.maximum(union, 1e-12) > iou_thr)
    return sorted(boxes, key=lambda b: -b["score"])


def best_head(boxes: list[dict]):
    heads = [b for b in boxes if b["cls"] == HEAD]
    return max(heads, key=lambda b: b["score"]) if heads else None


def marked_frames() -> list[tuple[str, str, int]]:
    rows = []
    for clip in CLIPS:
        cps = json.loads((LAB / "out" / clip / "truth.json").read_text())["checkpoints"]
        for key, v in cps.items():
            if v.get("conf") == 1 and v.get("head") and not v.get("hidden"):
                rows.append((clip, key, v["frame"]))
    return rows


def read_frame(clip: str, frame: int) -> np.ndarray:
    cap = cv2.VideoCapture(str(LAB / "clips" / f"{clip}.mp4"))
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame)
    ok, img = cap.read()
    cap.release()
    if not ok:
        sys.exit(f"cannot read {clip} frame {frame}")
    return img


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", type=Path, default=LAB / "models/yolox-club-v2/epoch_8.pth")
    ap.add_argument("--out", type=Path, default=LAB / "models/club")
    ap.add_argument("--app", type=Path, default=APP, help="club-detector worktree root")
    ap.add_argument("--no-copy", action="store_true", help="do not copy into the app worktree")
    a = ap.parse_args()
    torch.set_num_threads(4)
    a.out.mkdir(parents=True, exist_ok=True)

    model = load_model(a.ckpt)
    f32, f16 = convert(model, a.out)

    from ai_edge_litert.interpreter import Interpreter
    it = Interpreter(str(f16), num_threads=4)
    it.allocate_tensors()
    inp, outp = it.get_input_details()[0], it.get_output_details()[0]
    in_shape, out_shape = [int(v) for v in inp["shape"]], [int(v) for v in outp["shape"]]
    assert in_shape == [1, SIZE, SIZE, 3] and out_shape == [1, 8400, 8], (in_shape, out_shape)

    def run_tflite(bgr640: np.ndarray) -> tuple[np.ndarray, float]:
        it.set_tensor(inp["index"], bgr640[None].astype(np.float32))
        t = time.perf_counter()
        it.invoke()
        return it.get_tensor(outp["index"])[0].copy(), (time.perf_counter() - t) * 1000

    def run_torch(bgr640: np.ndarray) -> list[dict]:
        x = torch.from_numpy(np.ascontiguousarray(bgr640.transpose(2, 0, 1))).float()[None]
        with torch.no_grad():
            out = postprocess(model(x), 3, CONF, NMS_IOU, class_agnostic=False)[0]
        rows = [] if out is None else out.numpy()
        return [{"cls": int(c), "score": float(o * cc), "x1": float(x1), "y1": float(y1),
                 "x2": float(x2), "y2": float(y2)} for x1, y1, x2, y2, o, cc, c in rows]

    # ---- acceptance: TFLite vs PyTorch on the marked heads -------------------------------------
    print(f"{'clip':<28}{'checkpoint':<13}{'frame':>6}  {'torch (cx,cy,score)':<26}"
          f"{'tflite (cx,cy,score)':<26}{'dpx':>6}{'dscore':>8}")
    ok_all, max_d, max_s, ms, n_cmp = True, 0.0, 0.0, [], 0
    for clip, key, frame in marked_frames():
        img = cv2.resize(read_frame(clip, frame), (SIZE, SIZE))
        raw, t = run_tflite(img)
        ms.append(t)
        ref, got = best_head(run_torch(img)), best_head(decode_nms(raw))

        def fmt(b):
            return "none" if b is None else f"{(b['x1']+b['x2'])/2:7.2f},{(b['y1']+b['y2'])/2:7.2f},{b['score']:.3f}"
        if ref is None and got is None:
            print(f"{clip:<28}{key:<13}{frame:>6}  {'none':<26}{'none':<26}{'-':>6}{'-':>8}  (no head, agree)")
            continue
        if ref is None or got is None:
            ok_all = False
            print(f"{clip:<28}{key:<13}{frame:>6}  {fmt(ref):<26}{fmt(got):<26}  MISMATCH")
            continue
        d = float(np.hypot((ref["x1"] + ref["x2"]) / 2 - (got["x1"] + got["x2"]) / 2,
                           (ref["y1"] + ref["y2"]) / 2 - (got["y1"] + got["y2"]) / 2))
        ds = abs(ref["score"] - got["score"])
        n_cmp += 1
        max_d, max_s = max(max_d, d), max(max_s, ds)
        bad = d > MAX_CENTRE_PX or ds > MAX_SCORE
        ok_all &= not bad
        print(f"{clip:<28}{key:<13}{frame:>6}  {fmt(ref):<26}{fmt(got):<26}{d:6.3f}{ds:8.4f}{'  FAIL' if bad else ''}")
    print(f"\n{n_cmp} heads compared: max centre diff {max_d:.3f} px (limit {MAX_CENTRE_PX}), "
          f"max score diff {max_s:.4f} (limit {MAX_SCORE}) -> {'PASS' if ok_all else 'FAIL'}")

    # ---- speed (Mac CPU, XNNPACK, 4 threads) -----------------------------------------------------
    warm = ms[2:] if len(ms) > 2 else ms
    print(f"TFLite fp16 CPU (XNNPACK, 4 threads, Mac): median {np.median(warm):.0f} ms/frame, "
          f"min {min(warm):.0f}, max {max(warm):.0f} over {len(warm)} frames")

    # ---- golden fixtures: impact frame per clip ------------------------------------------------
    fx = a.out / "fixtures"
    shutil.rmtree(fx, ignore_errors=True)
    fx.mkdir(parents=True)
    for clip in CLIPS:
        truth = json.loads((LAB / "out" / clip / "truth.json").read_text())["checkpoints"]
        frame = truth["impact"]["frame"]
        full = read_frame(clip, frame)
        h, w = full.shape[:2]
        img = np.ascontiguousarray(cv2.resize(full, (SIZE, SIZE)))
        raw, _ = run_tflite(img)
        boxes = decode_nms(raw)
        stem = f"{clip}-{frame}"
        (fx / f"{stem}.input.bin").write_bytes(img.tobytes())  # uint8 HWC BGR 640x640x3
        (fx / f"{stem}.raw.bin").write_bytes(raw.astype("<f4").tobytes())  # float32 [8400, 8] LE
        disp = [{**b, "x1": b["x1"] * w / SIZE, "x2": b["x2"] * w / SIZE,
                 "y1": b["y1"] * h / SIZE, "y2": b["y2"] * h / SIZE} for b in boxes]
        (fx / f"{stem}.boxes.json").write_text(json.dumps({
            "clip": clip, "frame": frame, "frameW": w, "frameH": h, "modelSize": SIZE,
            "conf": CONF, "nmsIou": NMS_IOU, "order": "score desc",
            "note": "boxes from numpy decode+NMS on the TFLite raw output; boxes640 in 640-px "
                    "model units, boxesDisplay scaled by frameW/640, frameH/640",
            "boxes640": boxes, "boxesDisplay": disp}, indent=1))
    sizes = {p.name: p.stat().st_size for p in sorted(fx.iterdir())}

    digest = sha256(f16)
    info = {"ckpt": str(a.ckpt), "ckptSha256": sha256(a.ckpt), "sha256": digest,
            "bytes": f16.stat().st_size, "input": in_shape, "output": out_shape,
            "layout": "input float32 NHWC BGR 0..255, output float32 [1,8400,8]",
            "maxCentrePx": max_d, "maxScore": max_s, "pass": ok_all,
            "cpuMsMedian": float(np.median(warm)), "fixtures": sizes}
    (a.out / "export.json").write_text(json.dumps(info, indent=1))
    (a.out / "EXPORT.md").write_text(
        f"# Club detector export (L2)\n\n- checkpoint `{a.ckpt}` sha256 `{info['ckptSha256']}`\n"
        f"- asset `{ASSET}` sha256 `{digest}`, {info['bytes']} bytes (fp16 weights, fp32 compute)\n"
        f"- input `{in_shape}` float32 **NHWC**, channels **B,G,R**, values 0..255, no normalisation, "
        f"frame stretched to 640x640\n- output `{out_shape}` float32 (cx, cy, w, h, obj, shaft, head, hands), "
        f"decoded in-graph, sigmoid applied; **NMS is outside the graph**\n"
        f"- acceptance (plan 6.2): {n_cmp} heads, max centre diff {max_d:.3f} px, max score diff "
        f"{max_s:.4f} -> {'PASS' if ok_all else 'FAIL'}\n- Mac CPU XNNPACK 4 threads: median "
        f"{np.median(warm):.0f} ms/frame\n- re-run: `~/.venvs/swing-export/bin/python -I export_tflite.py "
        f"--ckpt {a.ckpt}`\n")

    # ---- copy into the app worktree ------------------------------------------------------------
    if ok_all and not a.no_copy:
        assets = a.app / "modules/golf-swing/android/src/main/assets"
        res = a.app / "modules/golf-swing/android/src/test/resources/club"
        assets.mkdir(parents=True, exist_ok=True)
        shutil.rmtree(res, ignore_errors=True)
        res.mkdir(parents=True)
        shutil.copy2(f16, assets / ASSET)
        for p in fx.iterdir():
            shutil.copy2(p, res / p.name)
        print(f"copied {ASSET} -> {assets}\ncopied {len(sizes)} fixture files -> {res}")
    elif not ok_all:
        print("acceptance FAILED: nothing copied into the app worktree")
    print(json.dumps({k: info[k] for k in ("sha256", "bytes", "input", "output")}, indent=1))
    for n, s in sizes.items():
        print(f"  {n}  {s} B")
    sys.exit(0 if ok_all else 1)


if __name__ == "__main__":
    main()
