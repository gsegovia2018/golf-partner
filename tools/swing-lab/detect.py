#!/usr/bin/env python3
"""Swing lab — automatic detection (the "auto" half).

Implements, as faithfully as practical, the processing the plan specifies for the Android app
(docs/superpowers/plans/2026-10-11-swing-analyzer.md):

  §4.2  adaptive pose sampling (quiet / moving / fast) driven by wrist speed
  §4.4  slow-motion factor (metadata, else from the top->impact duration)
  §4.5  wrist gate + One-Euro smoothing of the hands
  §4.6  pixel -> cm scale from the leg segments at address
  §5.1  phase rules (12 checkpoints in the plan, 9 kept here; see CHECKPOINT_MAP)
  §4.3  assisted club heuristics: ball blob at address, ballGoneFrame, radial shaft search with
        temporal tracking and an explicit hidden state

The point of the lab is to MEASURE THE PLANNED ALGORITHM, so where the plan is explicit this code
follows it even when a better idea exists; where it is silent the simplest reasonable choice is
made and marked with "PLAN-GAP:" in a comment (collected in the eval report).

Usage:
    ~/.venvs/swing-lab/bin/python -I detect.py <clip-name> [--model heavy|full] [--reuse-pose] [--dense]

Writes out/<clip>/auto.json and out/<clip>/frames/<n>.jpg (see CONTRACT.md).
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
import time
from pathlib import Path

import cv2
import numpy as np

LAB = Path(__file__).resolve().parent

# Contract keys (CONTRACT.md) <- plan §5.1 checkpoint names. lateBackswing, preImpact and
# followThrough are not part of the lab contract and are not computed.
CHECKPOINT_MAP = {
    "address": "address",
    "takeaway": "takeaway",
    "leadArm": "leadArmParallel",
    "top": "top",
    "transition": "transition",
    "shaftDown": "shaftParallelDown",
    "impact": "impact",
    "trailArm": "postImpact / trailArmParallel",
    "finish": "finish",
}
KEYS = list(CHECKPOINT_MAP)
# D22: d15 also detects P8 (shaft parallel after impact) between impact and trailArm. The
# older variants do not, so they keep the nine contract keys.
KEYS_D15 = KEYS[:KEYS.index("trailArm")] + ["shaftThrough"] + KEYS[KEYS.index("trailArm"):]
NEIGHBOURS = 2  # stills saved at checkpoint ±2 (plan D4)

# MediaPipe pose landmark indices.
NOSE = 0
L_SH, R_SH, L_EL, R_EL, L_WR, R_WR = 11, 12, 13, 14, 15, 16
L_HIP, R_HIP, L_KNEE, R_KNEE, L_ANK, R_ANK = 23, 24, 25, 26, 27, 28
L_TOE, R_TOE = 31, 32

# ---- constants straight from the plan -------------------------------------------------------
SLOWMO_FACTORS = (1, 2, 4, 8)          # §4.4
DOWNSWING_S = 0.27                     # §4.4 typical top->impact
V_STILL_K = 0.03                       # §4.2 v_still = 0.03 x body height px / s
# Variant "fixed": v_still must clear the pose noise. The One-Euro-smoothed hands of a golfer
# standing still move at ~0.15-0.18 H/s at 240 fps (measured on the address and finish holds,
# no ground truth involved); 2x that is ~0.3 H/s.
V_STILL_K_FIXED = 0.3
SAMPLING_EVERY = {"quiet": 8, "moving": 2, "fast": 1}
HYSTERESIS_FRAMES = 6
EURO_HANDS = dict(min_cutoff=1.5, beta=0.05, d_cutoff=1.0)   # §4.5
EURO_BODY = dict(min_cutoff=1.0, beta=0.05, d_cutoff=1.0)
LEG_FRACTION = 0.49                    # §4.6 hip-joint-to-ankle / height
BALL_CM = 4.27
SHAFT_CM = 105.0                       # §4.3 expectedShaftPx = 105 cm x px/cm
DEFAULT_HEIGHT_CM = 176


# =============================================================================================
# Probe
# =============================================================================================
def probe(path: Path) -> dict:
    """Container facts + capture fps from metadata when present (plan §3 probeVideo)."""
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS)
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    ok, f = cap.read()
    cap.release()
    if not ok:
        sys.exit(f"cannot read {path}")
    h, w = f.shape[:2]  # OpenCV applies the rotation tag, so this is display orientation
    capture_fps = None
    if shutil.which("ffprobe"):
        # Android stock cameras write com.android.capture.fps; WhatsApp copies strip it.
        out = subprocess.run(["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format",
                              "-show_streams", str(path)], capture_output=True, text=True).stdout
        try:
            meta = json.loads(out)
            tags = dict(meta.get("format", {}).get("tags", {}))
            for s in meta.get("streams", []):
                tags.update(s.get("tags", {}))
            for k, v in tags.items():
                if "capture.fps" in k or "capture_fps" in k:
                    capture_fps = float(v)
        except (ValueError, TypeError):
            pass
    return {"w": w, "h": h, "frames": n, "containerFps": fps, "captureFps": capture_fps}


def duplicate_frame_ratio(diffs: np.ndarray) -> float:
    """Share of near-identical consecutive frames in a 60-frame window (plan §3, §4.4 step 3).

    PLAN-GAP: the plan probes "60 frames" without saying where. A still golfer at 240 fps also
    gives near-identical frames, so the window is the 60 frames with the most motion, and a frame
    counts as a duplicate when its difference is < 25 % of that window's median difference.
    """
    if len(diffs) < 60:
        return 0.0
    run = np.convolve(diffs, np.ones(60), "valid")
    s = int(np.argmax(run))
    win = diffs[s:s + 60]
    med = float(np.median(win))
    if med < 0.5:  # no motion at all -> undecidable, call it real
        return 0.0
    return float(np.mean(win < 0.25 * med))


# =============================================================================================
# Pass 1 — pose with the adaptive sampling policy (§4.2)
# =============================================================================================
class SamplingPolicy:
    """quiet / moving / fast state machine on raw wrist speed.

    PLAN-GAPs:
    - Speed needs a time base but the slow-mo factor is only known after phases. The policy
      assumes each container frame is one capture frame at captureFps (metadata) or 240 fps.
      For a real-time 30 fps clip that only over-samples (costs time, never accuracy).
    - Between v_still and 3·v_still the state is held (it is a hysteresis band).
    - Upgrades (towards denser sampling) are immediate: a frame skipped during the downswing can't
      be recovered. Downgrades need the lower state to hold for 6 frames ("hysteresis of 6 frames").
    - "Hands descending after a reversal": the hands rose by ≥ 0.15 H since motion began and are
      now moving down (y increasing) at least 0.02 H below their highest point.
    - Body height H = landmark bounding-box height of the first detected pose.
    """

    def __init__(self, assumed_fps: float, vstill_k: float, smoothed: bool):
        self.fps = assumed_fps
        self.vstill_k = vstill_k
        # Variant (not the plan): run the §4.5 One-Euro on the hands before measuring speed.
        self.euro = OneEuro(**EURO_HANDS) if smoothed else None
        self.state = "quiet"
        self.lower_since: int | None = None
        self.prev: tuple[int, np.ndarray] | None = None
        self.body_h: float | None = None
        self.motion_y0: float | None = None
        self.min_y: float | None = None

    def step(self) -> int:
        return SAMPLING_EVERY[self.state]

    def update(self, i: int, lm_px: np.ndarray | None) -> None:
        if lm_px is None:
            return
        if self.body_h is None:
            self.body_h = float(lm_px[:, 1].max() - lm_px[:, 1].min())
        hands = (lm_px[L_WR, :2] + lm_px[R_WR, :2]) / 2
        if self.euro is not None:
            hands = self.euro(i / self.fps, hands).copy()
        if self.prev is None:
            self.prev = (i, hands)
            return
        pi, ph = self.prev
        self.prev = (i, hands)
        v = float(np.linalg.norm(hands - ph)) / ((i - pi) / self.fps)
        vs = self.vstill_k * self.body_h
        descending = False
        if self.state != "quiet":
            if self.motion_y0 is None:
                self.motion_y0 = float(ph[1])
                self.min_y = float(ph[1])
            self.min_y = min(self.min_y, float(hands[1]))
            rose = self.motion_y0 - self.min_y >= 0.15 * self.body_h
            descending = rose and hands[1] > ph[1] and hands[1] > self.min_y + 0.02 * self.body_h
        else:
            self.motion_y0 = self.min_y = None

        if v >= 12 * vs or descending:
            want = "fast"
        elif v >= 3 * vs:
            want = "moving"
        elif v < vs:
            want = "quiet"
        else:
            want = self.state
        order = ["quiet", "moving", "fast"]
        if order.index(want) > order.index(self.state):
            self.state, self.lower_since = want, None
        elif order.index(want) < order.index(self.state):
            if self.lower_since is None:
                self.lower_since = i
            elif i - self.lower_since >= HYSTERESIS_FRAMES:
                self.state, self.lower_since = want, None
        else:
            self.lower_since = None


def run_pose(path: Path, info: dict, model: str, dense: bool, vstill_k: float,
             smoothed_policy: bool) -> dict:
    """Decode every frame (cheap gray diffs for the duplicate probe), run pose on sampled ones."""
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    model_path = LAB / f"pose_landmarker_{model}.task"
    opts = vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(model_path)),
        running_mode=vision.RunningMode.VIDEO, num_poses=1)
    lmk = vision.PoseLandmarker.create_from_options(opts)
    policy = SamplingPolicy(info["captureFps"] or 240.0, vstill_k, smoothed_policy)
    w, h, fps = info["w"], info["h"], info["containerFps"]

    cap = cv2.VideoCapture(str(path))
    samples: dict[int, list] = {}
    diffs, prev_small = [], None
    next_i, i = 0, 0
    infer_s = 0.0
    t0 = time.perf_counter()
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        small = cv2.cvtColor(cv2.resize(frame, (w // 4, h // 4)), cv2.COLOR_BGR2GRAY).astype(np.int16)
        diffs.append(float(np.mean(np.abs(small - prev_small))) if prev_small is not None else 0.0)
        prev_small = small
        if dense or i == next_i:
            t1 = time.perf_counter()
            img = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            r = lmk.detect_for_video(img, int(round(i * 1000 / fps)))
            infer_s += time.perf_counter() - t1
            if r.pose_landmarks:
                lm = [[p.x * w, p.y * h, p.visibility] for p in r.pose_landmarks[0]]
                samples[i] = lm
                policy.update(i, np.array(lm))
            next_i = i + policy.step()
        i += 1
    cap.release()
    lmk.close()
    total_s = time.perf_counter() - t0
    return {
        "model": model, "dense": dense, "samples": samples, "diffs": diffs,
        "bodyH": policy.body_h,
        "timings": {"poseMs": round(infer_s * 1000), "pass1Ms": round(total_s * 1000),
                    "inferences": len(samples)},
    }


# =============================================================================================
# Pass 1, sparse165 — the native app's sampling policy (plan §4.2, owner decision 2026-10-12)
# =============================================================================================
# Validated on marcos-2026-10-10 against the owner truth (PR #130): every 4th after impact moved
# finish from -6 (pass) to -8 (fail), so impact -> finish is every 2nd; a 12-frame top back-fill
# did not reach top − 6 (the top is seen ~14 frames after it), 20 does.
SPARSE_EVERY = 16      # before motion start, after the finish
MID_EVERY = 4          # motion start -> top
FOLLOW_EVERY = 2       # impact + 6 -> finish
DENSE_MARGIN = 6       # every frame from top − 6 to impact + 6
TOP_BACK = 20          # back-fill reaches this far behind the frame the top is seen at


def _median_pt(pts: list[np.ndarray]) -> np.ndarray:
    return np.array([float(np.median([p[0] for p in pts])), float(np.median([p[1] for p in pts]))])


def _diff_sigma(xs: np.ndarray) -> float:
    if len(xs) < 3:
        return float("nan")
    return robust_sigma(np.diff(xs)) / math.sqrt(2)


def grip_point(lm: np.ndarray, k: float = 0.35) -> np.ndarray:
    """Single-sample grip with the visibility half of the wrist gate (Kotlin Grip.point)."""
    l = lm[L_WR, :2] + k * (lm[L_WR, :2] - lm[L_EL, :2])
    r = lm[R_WR, :2] + k * (lm[R_WR, :2] - lm[R_EL, :2])
    lv, rv = lm[L_WR, 2] >= 0.5, lm[R_WR, 2] >= 0.5
    if lv and not rv:
        return l
    if rv and not lv:
        return r
    return (l + r) / 2


class SparsePolicy:
    """Mirror of the Kotlin SamplingPolicy (modules/golf-swing/.../SamplingPolicy.kt); keep the two
    in step. Zones and strides: STILL every 16th -> (trigger: grip left its rolling still
    reference by 3σ√2) BACKSWING every 4th -> (top: risen >= 0.2 H, then the grip dropped 3σ√2
    below its highest sample) DOWNSWING every frame, back-filled from the frame the top was seen
    at − TOP_BACK -> (impact: bottom of the descent, as before) every frame to impact + 6, then
    FOLLOW every 2nd -> (grip and nose stopped for 0.15 s, or 1.5 s) DONE every 16th.
    The trigger back-fills the frames lost to the 16-stride at the 4-stride."""

    def __init__(self, fps: float, sparse: int = SPARSE_EVERY, mid: int = MID_EVERY,
                 margin: int = DENSE_MARGIN, top_back: int = TOP_BACK, follow: int = FOLLOW_EVERY):
        self.sparse, self.mid, self.margin, self.top_back, self.follow = sparse, mid, margin, top_back, follow
        self.hold = max(2, math.ceil(0.15 * fps))
        self.calib = math.ceil(0.5 * fps)
        self.after_max = math.ceil(1.5 * fps)
        self.dense_max = math.ceil(3.0 * fps)
        self.zone = "still"
        self.origin = 0
        self.dense_until = -1
        self.last = -1
        self.still: list[tuple] = []
        self.calibrated = False
        self.sigma = self.sigma_nose = self.stop_g = self.stop_n = self.body_h = float("nan")
        self.window: list[tuple] = []
        self.ref_y = 0.0
        self.top_y = self.top_frame = None
        self.bottom_y, self.bottom_frame = -1e9, -1
        self.risen = False
        self.trigger = self.top_seen = self.impact = self.after_from = -1

    def every(self) -> int:
        return {"still": self.sparse, "done": self.sparse, "backswing": self.mid,
                "downswing": 1, "follow": self.follow}[self.zone]

    def wants(self, f: int) -> bool:
        if f < self.origin:
            return False
        if self.zone == "follow" and f <= self.dense_until:
            return True
        return (f - self.origin) % self.every() == 0

    def move_radius(self, s: float) -> float:
        return 3 * math.sqrt(2) * s

    def observe(self, f: int, grip: np.ndarray, nose: np.ndarray, body_h: float):
        if f <= self.last:
            return None
        self.last = f
        o = (f, grip, nose, body_h)
        return getattr(self, "_" + self.zone)(o) if self.zone != "done" else None

    def _calibrate(self, now: int) -> None:
        st = self.still
        if len(st) < 4 or (now - st[0][0] < self.calib and len(st) < self.calib // self.sparse):
            return
        c = [o for o in st if o[0] - st[0][0] <= self.calib]
        c = c if len(c) >= 4 else st
        self.body_h = float(np.median([o[3] for o in c]))
        floor = max(0.5, 0.003 * self.body_h)

        def sig(j):
            P = np.array([o[j] for o in c])
            return max(floor, _diff_sigma(P[:, 0]), _diff_sigma(P[:, 1]))
        self.sigma, self.sigma_nose = sig(1), sig(2)
        lag = max(1, int(math.floor(self.hold / self.sparse + 0.5)))

        def stop(j, s):
            d = [float(np.linalg.norm(c[i][j] - c[i + lag][j])) for i in range(max(0, len(c) - lag))]
            p25 = float(np.percentile(d, 25)) if d else 0.0
            return max(3 * p25, self.move_radius(s))
        self.stop_g, self.stop_n = stop(1, self.sigma), stop(2, self.sigma_nose)
        self.calibrated = True

    def _still(self, o):
        if not self.calibrated:
            self._calibrate(o[0])
        if self.calibrated and len(self.still) >= 4:
            ref = _median_pt([s[1] for s in self.still[-4:]])
            if float(np.linalg.norm(o[1] - ref)) > self.move_radius(self.sigma):
                self.zone, self.origin, self.trigger = "backswing", o[0], o[0]
                self.ref_y, self.top_y, self.top_frame = float(ref[1]), float(o[1][1]), o[0]
                self.risen = False
                self.window = [o]
                return ("trigger", o[0], o[0] - (self.sparse - self.mid))
        self.still.append(o)
        return None

    def _push(self, o):
        self.window.append(o)
        while len(self.window) > 1 and self.window[0][0] < o[0] - self.hold:
            self.window.pop(0)

    def _stopped(self, nose_too: bool) -> bool:
        w = self.window
        if len(w) < 4 or w[-1][0] - w[0][0] < self.hold - self.mid:
            return False

        def end(j, i0):
            return _median_pt([w[i][j] for i in range(i0, i0 + 3)])
        g_ok = float(np.linalg.norm(end(1, 0) - end(1, len(w) - 3))) <= self.stop_g
        n_ok = not nose_too or float(np.linalg.norm(end(2, 0) - end(2, len(w) - 3))) <= self.stop_n
        return g_ok and n_ok

    def _capped(self, o):
        if o[0] - self.trigger > self.dense_max:
            self.zone, self.origin, self.after_from, self.dense_until = "follow", o[0], o[0], o[0]
            self.window = []
            return ("capped", o[0])
        return None

    def _backswing(self, o):
        self._push(o)
        e = self._capped(o)
        if e:
            return e
        g = float(o[1][1])
        if not self.risen:
            if g < self.top_y:
                self.top_y, self.top_frame = g, o[0]
            if self.ref_y - self.top_y >= 0.2 * self.body_h:
                self.risen = True
            elif self._stopped(False):
                self.zone, self.origin = "still", o[0]
                self.still = list(self.window)
                self.window = []
                return ("reset", o[0])
            return None
        if g < self.top_y:
            self.top_y, self.top_frame = g, o[0]
            return None
        if g > self.top_y + self.move_radius(self.sigma):
            self.zone, self.origin, self.top_seen = "downswing", o[0], o[0]
            self.bottom_y, self.bottom_frame = g, o[0]
            return ("top", o[0], o[0] - self.top_back)
        return None

    def _downswing(self, o):
        self._push(o)
        e = self._capped(o)
        if e:
            return e
        g = float(o[1][1])
        if g < self.top_y:
            self.top_y, self.bottom_y = g, -1e9
            return None
        if g > self.bottom_y:
            self.bottom_y, self.bottom_frame = g, o[0]
        if self.bottom_y - self.top_y >= 0.2 * self.body_h and g < self.bottom_y - 0.02 * self.body_h:
            self.impact = self.after_from = self.bottom_frame
            self.dense_until = max(o[0], self.impact + self.margin)
            self.zone, self.origin = "follow", self.dense_until
            self.window = []
            return ("impact", self.impact)
        return None

    def _follow(self, o):
        self._push(o)
        if (o[0] > self.dense_until and self._stopped(True)) or o[0] - self.after_from > self.after_max:
            self.zone, self.origin = "done", o[0]
            return ("done", o[0])
        return None


def run_pose_sparse(path: Path, info: dict, model: str, top_back: int = TOP_BACK,
                    follow: int = FOLLOW_EVERY, still: int = SPARSE_EVERY) -> dict:
    """sparse165: the native analyzer's loop. One sequential decode into a ring of the last
    RING frames; pose on the frames the SparsePolicy wants; a trigger or top re-runs the ring
    from its back-fill frame on a fresh VIDEO-mode landmarker (timestamps must increase per
    instance), the transition frame included, exactly like the app's spare instance."""
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    RING = 24
    model_path = LAB / f"pose_landmarker_{model}.task"

    def new():
        return vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(model_path)),
            running_mode=vision.RunningMode.VIDEO, num_poses=1))
    policy = SparsePolicy(info["captureFps"] or 240.0, sparse=still, top_back=top_back, follow=follow)
    w, h, fps = info["w"], info["h"], info["containerFps"]
    cap = cv2.VideoCapture(str(path))
    samples: dict[int, list] = {}
    ring: dict[int, np.ndarray] = {}
    diffs, prev_small = [], None
    state = {"lmk": new(), "n": 0, "s": 0.0, "instances": 1}
    events = []

    def infer(f: int):
        t1 = time.perf_counter()
        img = mp.Image(image_format=mp.ImageFormat.SRGB, data=ring[f])
        r = state["lmk"].detect_for_video(img, int(round(f * 1000 / fps)))
        state["s"] += time.perf_counter() - t1
        state["n"] += 1
        if not r.pose_landmarks:
            samples.pop(f, None)
            return None
        lm = [[p.x * w, p.y * h, p.visibility] for p in r.pose_landmarks[0]]
        samples[f] = lm
        return np.array(lm)

    def observe(f: int, L: np.ndarray):
        H = float(L[:, 1].max() - L[:, 1].min())
        return policy.observe(f, grip_point(L), L[NOSE, :2].copy(), H)

    def refill(lo: int, cur: int, stride: int):
        state["lmk"].close()
        state["lmk"] = new()
        state["instances"] += 1
        for f in range(max(lo, cur - RING + 1, 0), cur + 1):
            if (cur - f) % stride == 0 and f in ring:
                L = infer(f)
                if L is not None:
                    observe(f, L)   # ignored by the policy (older than its last frame)

    i = 0
    t0 = time.perf_counter()
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        small = cv2.cvtColor(cv2.resize(frame, (w // 4, h // 4)), cv2.COLOR_BGR2GRAY).astype(np.int16)
        diffs.append(float(np.mean(np.abs(small - prev_small))) if prev_small is not None else 0.0)
        prev_small = small
        ring[i] = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        ring.pop(i - RING, None)
        if policy.wants(i):
            L = infer(i)
            e = observe(i, L) if L is not None else None
            if e:
                events.append(list(e))
                if e[0] == "trigger":
                    refill(e[2], i, policy.mid)
                elif e[0] == "top":
                    refill(e[2], i, 1)
        i += 1
    cap.release()
    state["lmk"].close()
    total_s = time.perf_counter() - t0
    print(f"[sparse165] events={events} sigma={policy.sigma:.2f} bodyH={policy.body_h:.1f} "
          f"topDelta={policy.move_radius(policy.sigma):.2f} instances={state['instances']}")
    return {
        "model": model, "dense": False, "sampling": "sparse165", "samples": samples, "diffs": diffs,
        "bodyH": policy.body_h, "events": events,
        "timings": {"poseMs": round(state["s"] * 1000), "pass1Ms": round(total_s * 1000),
                    "inferences": state["n"], "withPose": len(samples)},
    }


# =============================================================================================
# Smoothing (§4.5)
# =============================================================================================
class OneEuro:
    """One-Euro filter for irregular sampling (t in seconds of captured time, x in px)."""

    def __init__(self, min_cutoff: float, beta: float, d_cutoff: float):
        self.mc, self.beta, self.dc = min_cutoff, beta, d_cutoff
        self.x = self.dx = self.t = None

    @staticmethod
    def _alpha(cutoff: float, dt: float) -> float:
        tau = 1.0 / (2 * math.pi * cutoff)
        return 1.0 / (1.0 + tau / dt)

    def __call__(self, t: float, x: np.ndarray) -> np.ndarray:
        if self.x is None:
            self.x, self.dx, self.t = x.astype(float), np.zeros_like(x, float), t
            return self.x
        dt = max(t - self.t, 1e-6)
        dx = (x - self.x) / dt
        self.dx = self.dx + self._alpha(self.dc, dt) * (dx - self.dx)
        cutoff = self.mc + self.beta * np.abs(self.dx)
        a = np.array([self._alpha(c, dt) for c in np.atleast_1d(cutoff)])
        self.x = self.x + a * (x - self.x)
        self.t = t
        return self.x


def gated_hands(idx: np.ndarray, L: np.ndarray, fixed: bool = False,
                pts: np.ndarray | None = None) -> np.ndarray:
    """Hands = midpoint of the wrists after the §4.5 gate.

    A wrist sample is rejected when visibility < 0.5 AND it jumped more than 1.5 x forearm
    length since the previous accepted sample. PLAN-GAP: forearm length = median elbow->wrist
    distance of that arm over the clip (a single frame's forearm can be the broken one).
    Rejected samples are not averaged in: hands = the passing wrist, or the mean of both when
    both pass, or linear interpolation in frame index when neither passes.
    Variant "fixed": a wrist with visibility < 0.5 is also rejected (without any jump) when the
    other wrist is visible (>= 0.5). Down the line, the lead wrist is hidden behind the body for
    most of the swing; MediaPipe then returns a stable but wrong guess that never "jumps".
    pts (variant "d15"): per-side points (n, 2 sides [left, right], 2) combined instead of the
    wrists themselves (the per-arm grip estimates); the gate still judges the wrists.
    """
    P = np.stack([L[:, L_WR, :2], L[:, R_WR, :2]], axis=1) if pts is None else pts
    n = len(idx)
    ok = np.ones((n, 2), bool)
    for side, (wr, el) in enumerate(((L_WR, L_EL), (R_WR, R_EL))):
        fore = np.median(np.linalg.norm(L[:, wr, :2] - L[:, el, :2], axis=1))
        last = L[0, wr, :2]
        for k in range(n):
            jump = np.linalg.norm(L[k, wr, :2] - last)
            other = L[k, R_WR if wr == L_WR else L_WR, 2]
            if L[k, wr, 2] < 0.5 and (jump > 1.5 * fore or (fixed and other >= 0.5)):
                ok[k, side] = False
            else:
                last = L[k, wr, :2]
    hands = np.full((n, 2), np.nan)
    both = ok.all(1)
    hands[both] = (P[both, 0] + P[both, 1]) / 2
    only_l, only_r = ok[:, 0] & ~ok[:, 1], ok[:, 1] & ~ok[:, 0]
    hands[only_l] = P[only_l, 0]
    hands[only_r] = P[only_r, 1]
    bad = np.isnan(hands[:, 0])
    if bad.any() and (~bad).any():
        for c in range(2):
            hands[bad, c] = np.interp(idx[bad], idx[~bad], hands[~bad, c])
    return hands


def smooth_series(t: np.ndarray, xy: np.ndarray, params: dict) -> np.ndarray:
    f = OneEuro(**params)
    return np.array([f(tk, xk) for tk, xk in zip(t, xy)])


# =============================================================================================
# Phases (§5.1) + slow-mo factor (§4.4)
# =============================================================================================
def seg_angle_above_h(p: np.ndarray, q: np.ndarray) -> np.ndarray:
    """§5.2 angleAboveHorizontal(p, q) = atan2(-(q.y-p.y), |q.x-p.x|) in degrees."""
    d = q - p
    return np.degrees(np.arctan2(-d[..., 1], np.abs(d[..., 0])))


def runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """[start, end] (inclusive) index pairs of True runs."""
    out, s = [], None
    for k, m in enumerate(mask):
        if m and s is None:
            s = k
        if not m and s is not None:
            out.append((s, k - 1))
            s = None
    if s is not None:
        out.append((s, len(mask) - 1))
    return out


def series(pose: dict, info: dict, factor: int, handed: str, fixed: bool = False) -> dict:
    """Smoothed series in captured time for one candidate slow-mo factor."""
    idx = np.array(sorted(pose["samples"]))
    L = np.array([pose["samples"][i] for i in idx])               # (n, 33, 3) px
    eff_fps = info["containerFps"] * factor
    t = idx / eff_fps
    hands = smooth_series(t, gated_hands(idx, L, fixed), EURO_HANDS)
    lead_sh, lead_wr = (L_SH, L_WR) if handed == "right" else (R_SH, R_WR)
    trail_sh, trail_wr = (R_SH, R_WR) if handed == "right" else (L_SH, L_WR)
    body = {k: smooth_series(t, L[:, k, :2], EURO_BODY) for k in (lead_sh, trail_sh)}
    # PLAN-GAP: the plan smooths only hands/hips/shoulders/nose; the arm-angle rules also need
    # the lead and trail wrists, which get the hands filter (they are hands).
    body[lead_wr] = smooth_series(t, L[:, lead_wr, :2], EURO_HANDS)
    body[trail_wr] = smooth_series(t, L[:, trail_wr, :2], EURO_HANDS)
    v = np.r_[0.0, np.linalg.norm(np.diff(hands, axis=0), axis=1) / np.diff(t)]
    return {"idx": idx, "t": t, "L": L, "hands": hands, "speed": v, "body": body,
            "lead": (lead_sh, lead_wr), "trail": (trail_sh, trail_wr), "effFps": eff_fps}


def at_frame(idx: np.ndarray, arr: np.ndarray, frame: float) -> np.ndarray:
    """Linear interpolation of a sampled series at an arbitrary frame index."""
    if arr.ndim == 1:
        return np.interp(frame, idx, arr)
    return np.array([np.interp(frame, idx, arr[:, c]) for c in range(arr.shape[1])])


def nearest_k(idx: np.ndarray, frame: float) -> int:
    return int(np.argmin(np.abs(idx - frame)))


def largest_descent(y: np.ndarray, tol: float) -> tuple[int, int]:
    """(start, end) sample indices of the descending run of y (image y grows downwards) with the
    largest total drop; up-moves smaller than `tol` px don't end a run. Scale-free: no time."""
    best, start, k_max = (0, 0, 0.0), 0, 0
    for k in range(1, len(y)):
        if y[k] > y[k_max]:
            k_max = k
        if y[k] < y[k_max] - tol or k == len(y) - 1:
            drop = y[k_max] - y[start]
            if drop > best[2]:
                best = (start, k_max, drop)
            start = k_max = k
    return best[0], best[1]


def downswing_anchor(S: dict, body_h: float) -> tuple[int, int]:
    """PLAN-GAP: the downswing = the largest sustained descent of the hands (2 % H tolerance);
    anchor = its fastest downward sample. Single-frame pose glitches and the follow-through
    (hands going up) can't win, unlike a plain argmax of speed. Returns (anchor, run end)."""
    y = S["hands"][:, 1]
    a, b = largest_descent(y, 0.02 * body_h)
    vy = np.r_[0.0, np.diff(y) / np.diff(S["t"])]
    return a + int(np.argmax(vy[a:b + 1])), b


def detect_phases(S: dict, body_h: float, vstill_k: float, fixed: bool = False) -> dict:
    """§5.1 rules on the smoothed series. Returns frame numbers (container = capture frames)."""
    idx, hands, v, fps = S["idx"], S["hands"], S["speed"], S["effFps"]
    y = hands[:, 1]
    vs = vstill_k * body_h
    conf: dict[str, float] = {}
    notes: list[str] = []

    # --- top: dominant-axis velocity reversal after ≥ 80 % of max height, refined to argmin(y).
    # PLAN-GAPs: the downswing is anchored by downswing_anchor(). "Max height" is the rise above
    # the lowest hands position before that anchor (the finish is usually higher than the top).
    # Dominant axis = the axis with the larger travel in that span.
    k_peak, k_bottom = downswing_anchor(S, body_h)
    span = slice(0, k_peak + 1)
    rise = y[span].max() - y[span]
    k80 = int(np.argmax(rise >= 0.8 * rise.max()))
    travel = np.abs(np.diff(hands[span], axis=0)).sum(0)
    ax = int(np.argmax(travel))
    d = np.diff(hands[:, ax])
    sgn0 = np.sign(d[max(k80 - 1, 0)]) or -1.0
    k_rev = next((k for k in range(k80, k_peak) if np.sign(d[k]) == -sgn0), k80)
    win = (idx >= idx[k_rev] - 10) & (idx <= idx[k_rev] + 10)
    k_top = int(np.flatnonzero(win)[np.argmin(y[win])])
    top = int(idx[k_top])
    if fixed:
        # Variant "fixed": the hands sit on a plateau at the top (here ~20 frames within 2 px),
        # so argmin(y) is decided by pose noise. Take the centre of the contiguous plateau of
        # samples within 1 % H of the minimum around the argmin.
        a = b = k_top
        while a > 0 and y[a - 1] <= y[k_top] + 0.01 * body_h:
            a -= 1
        while b < len(y) - 1 and y[b + 1] <= y[k_top] + 0.01 * body_h:
            b += 1
        top = int(round((idx[a] + idx[b]) / 2))

    # --- motionStart: first sample of the continuous ≥ 3·v_still run that leads to the top.
    # PLAN-GAP: "first frame with speed ≥ 3·v_still sustained 10 frames" is taken within the
    # backswing (searching back from half-height), so a waggle or walking in earlier is skipped.
    k_half = int(np.argmax(rise >= 0.5 * rise.max()))
    k_ms = k_half
    while k_ms > 0 and v[k_ms - 1] >= 3 * vs:
        k_ms -= 1
    motion_start = int(idx[k_ms])
    if idx[k_half] - motion_start < 10:
        notes.append("motionStart run shorter than 10 frames")

    # --- address: longest quiet run before motionStart, 0.15 s before the run ends.
    # Variant "fixed": the LAST quiet run of >= 0.1 s before motionStart instead of the longest
    # (golfers hold address, look at the target, waggle; the longest still spell is often the
    # early part of that, not the settled moment before the takeaway).
    quiet = v < vs
    qr = [(a, b) for a, b in runs(quiet[:k_ms]) if b > a]   # a run needs >= 2 samples
    if fixed:
        qr = [r for r in qr if run_seconds(idx, r[0], r[1], fps) >= 0.1][-1:]
    if qr:
        a, b = max(qr, key=lambda r: run_seconds(idx, r[0], r[1], fps))
        address = int(round(max(idx[a], idx[b] - 0.15 * fps)))
        addr_run = (int(idx[a]), int(idx[b]))
        conf["address"] = 0.9
    else:
        address = int(round(max(idx[0], motion_start - 0.15 * fps)))
        addr_run = (address, address)
        conf["address"] = 0.3
        notes.append("no quiet run before motionStart: address = motionStart - 0.15 s")
    hands_addr_y = at_frame(idx, y, address)

    # --- impact: first downswing frame with hands y within ±5 % H of address y and speed ≥ 70 %
    # of the downswing peak. PLAN-GAP: the downswing (for its peak and the search) is top -> the
    # bottom of the hands' largest descent (+2 samples), so the follow-through can't set the peak.
    ds = (idx > top) & (idx <= idx[min(k_bottom + 2, len(idx) - 1)])
    peak = v[ds].max() if ds.any() else v.max()
    cand = np.flatnonzero(ds & (np.abs(y - hands_addr_y) <= 0.05 * body_h) & (v >= 0.7 * peak))
    if len(cand):
        impact = int(idx[cand[0]])
        conf["impact"] = 0.8
    else:
        impact = int(idx[np.flatnonzero(ds)[np.argmax(v[ds])]]) if ds.any() else int(idx[k_peak])
        conf["impact"] = 0.4
        notes.append("impact fallback: fastest downswing sample")

    # --- lead arm parallel: lead shoulder->wrist within ±8° of horizontal, first in backswing.
    sh, wr = S["lead"]
    ang = seg_angle_above_h(S["body"][sh], S["body"][wr])
    bs = np.flatnonzero((idx >= motion_start) & (idx <= top) & (np.abs(ang) <= 8))
    if len(bs):
        lead_arm, conf["leadArm"] = int(idx[bs[0]]), 0.8
    else:
        lead_arm, conf["leadArm"] = int(round(motion_start + 0.6 * (top - motion_start))), 0.3
        notes.append("leadArm fallback: 60 % of backswing")

    P = {
        "motionStart": motion_start, "address": address, "addressRun": addr_run,
        "leadArm": lead_arm, "top": top, "impact": impact, "backswing": top - motion_start,
        "conf": conf, "notes": notes, "descentEnd": int(idx[k_bottom]), "vStill": vs,
    }
    derive_after_impact(P, S)
    return P


def run_seconds(idx: np.ndarray, a: int, b: int, fps: float) -> float:
    """Duration of the sample run a..b, counting the last sample's own interval (sparse
    sampling would otherwise make a 2-sample quiet run at every-8th-frame last 8 frames, not 16)."""
    end = idx[b + 1] if b + 1 < len(idx) else idx[b]
    return (end - idx[a]) / fps


def derive_after_impact(P: dict, S: dict) -> None:
    """Checkpoints defined relative to top/impact; re-run whenever impact moves (ballGoneFrame)."""
    idx, fps = S["idx"], S["effFps"]
    top, impact = P["top"], P["impact"]
    P["downswing"] = impact - top
    P["transition"] = int(round(top + 0.10 * P["downswing"]))

    # --- post-impact: impact + 10 frames; relabelled trailArmParallel if the trail arm crosses
    # horizontal within ±6 frames (label only, the frame stays).
    P["trailArm"] = impact + 10
    tsh, twr = S["trail"]
    tang = seg_angle_above_h(S["body"][tsh], S["body"][twr])
    near = (idx >= P["trailArm"] - 6) & (idx <= P["trailArm"] + 6)
    P["trailArmCrosses"] = bool(near.any() and np.sign(tang[near]).min() != np.sign(tang[near]).max())

    # --- finish: start of the first quiet run ≥ 0.3 s after impact, + 0.2 s; else last frame.
    quiet = S["speed"] < P["vStill"]
    P["finish"], P["conf"]["finish"] = int(idx[-1]), 0.3
    for a, b in runs(quiet & (idx > impact)):
        if run_seconds(idx, a, b, fps) >= 0.3:
            P["finish"], P["conf"]["finish"] = int(round(min(idx[a] + 0.2 * fps, idx[-1]))), 0.8
            break
    else:
        P["notes"].append("finish fallback: no quiet run >= 0.3 s after impact -> last frame")


def provisional_factor(pose: dict, info: dict, handed: str) -> int:
    """Scale-free first guess of the slow-mo factor (no thresholds in seconds involved).

    PLAN-GAP: §4.4 step 2 derives the factor from top->impact, but the phase rules themselves
    need captured time (v_still in px/s, "0.15 s before", One-Euro cutoffs in Hz). So: smooth the
    gated hands with a centred 5-sample median, take the largest sustained descent of the hands
    (top -> bottom of the hand path, which is ~impact) and use its length. The factor from that
    seeds the real phase run, whose own top->impact then re-checks it (choose_factor()).
    """
    idx = np.array(sorted(pose["samples"]))
    L = np.array([pose["samples"][i] for i in idx])
    y = gated_hands(idx, L)[:, 1]
    yp = np.pad(y, 2, mode="edge")
    y = np.median(np.lib.stride_tricks.sliding_window_view(yp, 5), axis=1)
    a, b = largest_descent(y, 0.02 * pose["bodyH"])
    return factor_from_downswing(idx[b] - idx[a], info["containerFps"])


def factor_from_downswing(frames: float, container_fps: float) -> int:
    """§4.4 step 2: the factor in {1,2,4,8} that makes the downswing closest to 0.27 s."""
    return min(SLOWMO_FACTORS, key=lambda c: abs(frames / container_fps / c - DOWNSWING_S))


def choose_factor(pose: dict, info: dict, handed: str, vstill_k: float,
                  fixed: bool) -> tuple[int, dict, dict, str]:
    """§4.4: metadata if present; else a scale-free provisional factor, phases with it, and the
    factor recomputed from the detected top->impact (one re-run if it changed)."""
    fps = info["containerFps"]
    if info["captureFps"]:
        f, src = max(1, int(round(info["captureFps"] / fps))), "metadata"
    else:
        f, src = provisional_factor(pose, info, handed), "downswing-duration"
    for _ in range(2):
        S = series(pose, info, f, handed, fixed)
        P = detect_phases(S, pose["bodyH"], vstill_k, fixed)
        if src == "metadata":
            break
        f2 = factor_from_downswing(P["downswing"], fps)
        if f2 == f:
            break
        f = f2
    return f, S, P, src


# =============================================================================================
# Variant "d15" — phase rules that implement the plan §5.1 D15 checkpoint definitions
# =============================================================================================
# Every threshold below comes from the clip (pose jitter, image noise, body size, fps) or from
# anatomy / the definitions themselves. Nothing was tuned on the labelled clip, with the explicit
# exception noted at GRIP_K (none so far).
#
# GRIP_K — hands are marked at the middle of the grip, MediaPipe gives wrist joints. Grip point
# per arm = wrist + k·(wrist − elbow), i.e. k forearm lengths further along the forearm (in the
# image, so the extension is foreshortened exactly like the forearm). Anatomy (Winter, Biomechanics
# and Motor Control of Human Movement, segment lengths as a fraction of height): forearm 0.146 H,
# hand 0.108 H → hand ≈ 0.74 forearm. The shaft crosses the palm at about half the hand length
# from the wrist crease, so k ≈ 0.74 × 0.5 ≈ 0.37 → 0.35. Prior from anatomy, NOT fitted (see the
# k sweep in the eval report). Ignores wrist hinge (the hand is not in line with the forearm at
# the top), which is the main limitation.
GRIP_K = 0.35
# NOISE_MULT — a signal counts as "moving" when it leaves NOISE_MULT × its measured noise
# (3σ: ~0.3 % false alarms for Gaussian jitter). Statistical convention, not tuned.
NOISE_MULT = 3.0
# LEVEL_TOL_DEG — "arm level": the wrist is within ±LEVEL_TOL_DEG of the shoulder's height, as
# a fraction of the (unforeshortened) arm length. 5° ≈ the smallest tilt people notice by eye on
# a short segment; the labeller marks the first frame that LOOKS level, i.e. entering this band.
LEVEL_TOL_DEG = 5.0
FINISH_HOLD_S = 0.15     # task brief: stopped for >= 0.15 s of real time
ONSET_SUSTAIN_S = 0.02   # clubhead motion must last >= 0.02 s (5 frames at 240 fps): a single
                         # compression pop (WhatsApp re-encode) can't count as the takeaway


def robust_sigma(x: np.ndarray) -> float:
    """1.4826 × median absolute deviation (σ for Gaussian noise, ignores outliers)."""
    x = np.asarray(x, float).ravel()
    return float(1.4826 * np.median(np.abs(x - np.median(x))))


def smooth_zero_lag(t: np.ndarray, xy: np.ndarray, params: dict) -> np.ndarray:
    """One-Euro run forwards and backwards in time, averaged. The analysis is offline (whole
    clip in hand), so the causal filter's lag — ~25 frames at 240 fps when the hands move slowly,
    e.g. the takeaway — is an avoidable bias in every "first frame that ..." rule."""
    fwd = smooth_series(t, xy, params)
    bwd = smooth_series(-t[::-1], xy[::-1], params)[::-1]
    return (fwd + bwd) / 2


def series_d15(pose: dict, info: dict, factor: int, handed: str, grip_k: float) -> dict:
    """Smoothed series for d15. hands = grip estimate (not the wrists).

    - grip: per-arm wrist + k·(wrist − elbow), combined with the fixed-variant wrist gate
      (a hidden lead wrist doesn't drag the point), then One-Euro (§4.5 hands parameters).
    - arm end points for the "arm level" rules: that arm's wrist blended with the gated wrist
      midpoint by the wrist's visibility (down the line the lead wrist is hidden much of the time;
      both hands are on the club, so the midpoint is a sound stand-in within a hand's width).
    - jitter σ (px) of the grip and the nose: robust σ of raw − smoothed (measured per clip).
    """
    idx = np.array(sorted(pose["samples"]))
    L = np.array([pose["samples"][i] for i in idx])
    eff_fps = info["containerFps"] * factor
    t = idx / eff_fps
    per_side = np.stack([L[:, L_WR, :2] + grip_k * (L[:, L_WR, :2] - L[:, L_EL, :2]),
                         L[:, R_WR, :2] + grip_k * (L[:, R_WR, :2] - L[:, R_EL, :2])], axis=1)
    grip_raw = gated_hands(idx, L, True, per_side)
    wr_mid = gated_hands(idx, L, True)
    grip = smooth_zero_lag(t, grip_raw, EURO_HANDS)
    right = handed == "right"
    lead_sh, lead_wr = (L_SH, L_WR) if right else (R_SH, R_WR)
    trail_sh, trail_wr = (R_SH, R_WR) if right else (L_SH, L_WR)
    trail_hip = R_HIP if right else L_HIP
    lead_hip = L_HIP if right else R_HIP
    body = {k: smooth_zero_lag(t, L[:, k, :2], EURO_BODY) for k in (lead_sh, trail_sh, trail_hip, lead_hip, NOSE)}

    def arm_end(wr):
        v = np.clip(L[:, wr, 2:3], 0, 1)
        return smooth_zero_lag(t, v * L[:, wr, :2] + (1 - v) * wr_mid, EURO_HANDS)
    ends = {"lead": arm_end(lead_wr), "trail": arm_end(trail_wr)}
    # unforeshortened arm length: the 95th percentile of the projected shoulder->wrist distance
    # over the clip (at address the arms hang nearly in the image plane)
    arm_px = max(float(np.percentile(np.linalg.norm(ends[s] - body[sh], axis=1), 95))
                 for s, sh in (("lead", lead_sh), ("trail", trail_sh)))
    v = np.r_[0.0, np.linalg.norm(np.diff(grip, axis=0), axis=1) / np.diff(t)]
    return {"idx": idx, "t": t, "L": L, "hands": grip, "speed": v, "body": body, "ends": ends,
            "lead": (lead_sh, lead_wr), "trail": (trail_sh, trail_wr), "trailHip": trail_hip, "leadHip": lead_hip,
            "effFps": eff_fps, "armPx": arm_px,
            "sigmaGrip": robust_sigma(grip_raw - grip), "sigmaHead": robust_sigma(L[:, NOSE, :2] - body[NOSE])}


def first_frame(frames: np.ndarray, cond: np.ndarray, lo: float, hi: float) -> int | None:
    """First frame in [lo, hi] where cond holds (cond evaluated on every frame)."""
    m = cond & (frames >= lo) & (frames <= hi)
    return int(frames[np.argmax(m)]) if m.any() else None


def net_speed(P: np.ndarray, w: int, fps: float) -> np.ndarray:
    """Speed averaged over the next w frames: |P[k+w] − P[k]| / (w / fps), px/s (NaN at the end).
    Averaging over the hold window makes it robust to a one-sample pose glitch that comes back."""
    v = np.full(len(P), np.nan)
    v[:-w] = np.linalg.norm(P[w:] - P[:-w], axis=1) / (w / fps)
    return v


def still_threshold(v: np.ndarray) -> float:
    """Per-clip "stopped" speed: NOISE_MULT × the 25th percentile of the windowed speed over
    the whole clip. Assumes >= ~half the clip is held still (address + finish), which a swing
    clip is; the 25th percentile is then the typical speed of a body that is not moving
    (pose jitter + balance sway), measured on this clip, not a constant."""
    return NOISE_MULT * float(np.nanpercentile(v, 25))


def descents(y: np.ndarray, tol: float) -> list[tuple[int, int]]:
    """All descending runs (start, end) of y, same segmentation as largest_descent()."""
    out, start, k_max = [], 0, 0
    for k in range(1, len(y)):
        if y[k] > y[k_max]:
            k_max = k
        if y[k] < y[k_max] - tol or k == len(y) - 1:
            if k_max > start:
                out.append((start, k_max))
            start = k_max = k
    return out


def downswing_d15(S: dict, body_h: float) -> tuple[int, int]:
    """The downswing = the FASTEST (mean speed = drop / duration) descent of the grip among the
    descents that drop at least 0.2 H. A downswing takes the hands from above the shoulders to
    about hip height (>= ~0.3 H); 0.2 H rejects pose glitches. Mean speed separates it from the
    golfer lowering the club after the finish, which can be a bigger but ~10x slower drop (it
    beat the downswing in largest_descent() once the grip, not the wrists, is tracked).
    Returns (fastest sample, run end) like downswing_anchor()."""
    y, t = S["hands"][:, 1], S["t"]
    runs_ = [(a, b) for a, b in descents(y, 0.02 * body_h) if y[b] - y[a] >= 0.2 * body_h]
    if not runs_:
        return downswing_anchor(S, body_h)
    a, b = max(runs_, key=lambda r: (y[r[1]] - y[r[0]]) / (t[r[1]] - t[r[0]]))
    vy = np.r_[0.0, np.diff(y) / np.diff(t)]
    return a + int(np.argmax(vy[a:b + 1])), b


def detect_phases_d15(S: dict, body_h: float) -> dict:
    """D15 rules on pose; impact from pose here, refined by ballGoneFrame and address by the
    clubhead onset in main(). Returns frame numbers."""
    idx, fps = S["idx"], S["effFps"]
    F = np.arange(idx[0], idx[-1] + 1)            # every frame: crossings at frame resolution

    def dense(arr):
        return np.stack([np.interp(F, idx, arr[:, c]) for c in range(arr.shape[1])], axis=1)
    grip, nose = dense(S["hands"]), dense(S["body"][NOSE])
    gy = grip[:, 1]
    lead_dy = dense(S["ends"]["lead"])[:, 1] - dense(S["body"][S["lead"][0]])[:, 1]
    trail_dy = dense(S["ends"]["trail"])[:, 1] - dense(S["body"][S["trail"][0]])[:, 1]
    hip_y = dense(S["body"][S["trailHip"]])[:, 1]
    lead_hip_y = dense(S["body"][S["leadHip"]])[:, 1]
    r_grip = NOISE_MULT * S["sigmaGrip"]
    band = S["armPx"] * math.sin(math.radians(LEVEL_TOL_DEG))
    hold_w = int(math.ceil(FINISH_HOLD_S * fps))
    vg, vn = net_speed(grip, hold_w, fps), net_speed(nose, hold_w, fps)
    tg, tn = still_threshold(vg), still_threshold(vn)
    conf: dict[str, float] = {}
    notes: list[str] = []
    fi = lambda f: int(f - F[0])  # frame -> row of the dense arrays

    # --- P4 top. Hands' highest point before the downswing (the largest sustained descent, as
    # in the other variants), then the END of the plateau: the last frame before the grip drops
    # more than its noise radius below that height. The club keeps going back after the hands
    # stop and turns when the hands start down, so the end of the hands' plateau is the earliest
    # frame the club can have reversed; the start of the plateau (argmin) is always too early.
    k_anchor, k_bottom = downswing_d15(S, body_h)
    a_anchor = fi(idx[k_anchor])
    k_hi = int(np.argmin(gy[:a_anchor + 1]))
    drop = np.flatnonzero(gy[k_hi:a_anchor + 1] > gy[k_hi] + r_grip)
    top = int(F[k_hi + drop[0] - 1]) if len(drop) else int(F[k_hi])
    hands_top = int(F[k_hi])

    # --- motion start (pose): walking back from the half-rise point of the backswing, the last
    # frame whose preceding FINISH_HOLD_S were still (windowed grip speed below the threshold).
    half_y = (gy[:k_hi + 1].max() + gy[k_hi]) / 2
    # first frame of the final rise to the top that is above half height
    k_half = next((k + 1 for k in range(k_hi, -1, -1) if gy[k] > half_y), 0)
    k_ms = k_half
    while k_ms > hold_w and not vg[k_ms - hold_w] <= tg:
        k_ms -= 1
    motion_start = int(F[k_ms])
    k_run = k_ms

    # --- P7 impact (pose): the bottom of the hands' largest descent (the grip is lowest at
    # impact); replaced by ballGoneFrame − 1 in main() when the ball is seen to leave.
    impact = int(idx[k_bottom])
    conf["impact"] = 0.5

    # Window for the image-based address: the clubhead can start back before the grip moves
    # measurably; bound the lead by the backswing's own duration (scale-free).
    k_run = min(k_run, max(0, k_ms - (k_hi - k_ms)))
    P = {"motionStart": motion_start, "address": motion_start, "addressRun": (int(F[k_run]), motion_start),
         "top": top, "handsTop": hands_top, "impact": impact, "conf": conf, "notes": notes,
         "descentEnd": int(idx[k_bottom]), "vStill": r_grip * fps / hold_w, "trailArmCrosses": None,
         "_d": dict(F=F, gy=gy, lead_dy=lead_dy, trail_dy=trail_dy, hip_y=hip_y, lead_hip_y=lead_hip_y, vg=vg, vn=vn, tg=tg, tn=tn,
                    r_grip=r_grip, band=band, hold_w=hold_w)}
    conf["address"] = 0.5
    conf["top"] = 0.7
    d15_rules(P)
    return P


def d15_rules(P: dict) -> None:
    """Checkpoints between address and finish given top and impact (re-run when impact moves)."""
    d = P["_d"]
    F, gy, hip_y, band = d["F"], d["gy"], d["hip_y"], d["band"]
    top, impact, ms = P["top"], P["impact"], P["motionStart"]
    conf, notes = P["conf"], P["notes"]

    def pick(key, f, lo, hi, why):
        if f is None:
            f = int(round((lo + hi) / 2))
            conf[key] = 0.2
            notes.append(f"{key} fallback: no {why} in [{lo}, {hi}] -> window midpoint")
        else:
            conf[key] = 0.7
        P[key] = f

    # P2 takeaway: shaft level going back. Shaft level with the lead arm hanging from the
    # shoulder puts the grip at about trail-hip height (P-system: P2 and P6 are mirror images,
    # P6 "hands ~ trail hip"). First frame the grip rises to the trail hip's height.
    pick("takeaway", first_frame(F, gy <= hip_y, ms, top), ms, top, "grip at trail-hip height")
    # P3 lead arm level: first frame the lead wrist rises to within the level band of the lead
    # shoulder's height (band = arm length × sin 5°).
    pick("leadArm", first_frame(F, d["lead_dy"] <= band, P["takeaway"], top), P["takeaway"], top,
         "lead wrist at shoulder height")
    # P5 lead arm level again on the way down: first frame after the top the lead wrist has come
    # down into the band.
    pick("transition", first_frame(F, d["lead_dy"] >= -band, top + 1, impact), top + 1, impact,
         "lead wrist back at shoulder height")
    # P6 shaft level coming down: first frame the grip falls to trail-hip height (approximate:
    # the shaft is end-on there, so no image check is possible).
    pick("shaftDown", first_frame(F, gy >= hip_y, P["transition"], impact), P["transition"], impact,
         "grip at trail-hip height")
    # P9 trail arm level after impact: first frame the trail wrist rises into the band.
    pick("trailArm", first_frame(F, d["trail_dy"] <= band, impact + 1, F[-1]), impact + 1, int(F[-1]),
         "trail wrist at shoulder height")
    # P8 shaft level after impact (D22), the mirror of P6: first frame the grip rises back to the
    # lead hip's height, searched impact -> trailArm.
    pick("shaftThrough", first_frame(F, gy <= d["lead_hip_y"], impact + 1, P["trailArm"]), impact + 1, P["trailArm"],
         "grip at lead-hip height")
    # P10 finish: first frame after trailArm from which the grip AND the head move slower than
    # their per-clip "stopped" speed, averaged over the next FINISH_HOLD_S of real time.
    fin = first_frame(F, (d["vg"] <= d["tg"]) & (d["vn"] <= d["tn"]), P["trailArm"], F[-1])
    if fin is None:
        P["finish"], conf["finish"] = int(F[-1]), 0.2
        notes.append("finish fallback: never still for 0.15 s after trailArm -> last frame")
    else:
        P["finish"], conf["finish"] = fin, 0.7
    P["downswing"] = impact - top
    P["backswing"] = top - ms


def enforce_order(P: dict) -> None:
    """P1 < P2 < ... < P10 (D15 order): a checkpoint at or before its predecessor moves to the
    predecessor + 1 (noted, confidence capped)."""
    for a, b in zip(KEYS_D15, KEYS_D15[1:]):
        if P[b] <= P[a]:
            P["notes"].append(f"order: {b} {P[b]} <= {a} {P[a]} -> {P[a] + 1}")
            P[b] = P[a] + 1
            P["conf"][b] = min(P["conf"].get(b, 0.2), 0.2)


def choose_factor_d15(pose: dict, info: dict, handed: str, grip_k: float) -> tuple[int, dict, dict, str]:
    """Same §4.4 logic as choose_factor(), with the d15 series and rules."""
    fps = info["containerFps"]
    if info["captureFps"]:
        f, src = max(1, int(round(info["captureFps"] / fps))), "metadata"
    else:
        f, src = provisional_factor(pose, info, handed), "downswing-duration"
    for _ in range(2):
        S = series_d15(pose, info, f, handed, grip_k)
        P = detect_phases_d15(S, pose["bodyH"])
        if src == "metadata":
            break
        f2 = factor_from_downswing(P["downswing"], fps)
        if f2 == f:
            break
        f = f2
    return f, S, P, src


def clubhead_onset(path: Path, ball: dict, px_cm: float, run: tuple[int, int], latest: int,
                   static: tuple[int, int], fps: float) -> tuple[int | None, dict]:
    """P1 address from the image: the last frame before the clubhead starts moving back.

    At address the clubhead is soled against the ball, so motion of the clubhead shows up as
    change in a patch of ±1.5 ball diameters around the ball. Signal = mean absolute frame-to-
    frame difference of that patch, 3-frame median filtered (kills single-frame compression
    pops). Noise ceiling = the max of the same signal while the ball sits alone (lead arm ->
    top: club in the air, scene static) — measured on this clip. Onset = start of the LAST run of
    >= ONSET_SUSTAIN_S above the ceiling that starts inside the hands' still run (waggles come
    earlier); address = onset − 1.
    """
    half = max(3, int(round(1.5 * BALL_CM * px_cm)))
    bx, by = int(round(ball["x"])), int(round(ball["y"]))
    want = set(range(run[0] - 1, run[1] + 1)) | set(range(static[0] - 1, static[1] + 1))
    cap = cv2.VideoCapture(str(path))
    cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, min(want)))
    f, patches = max(0, min(want)), {}
    while f <= max(want):
        ok, frame = cap.read()
        if not ok:
            break
        if f in want:
            g = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).astype(np.float32)
            patches[f] = g[max(0, by - half):by + half + 1, max(0, bx - half):bx + half + 1]
        f += 1
    cap.release()

    def sig(a, b):
        fr = [x for x in range(a, b + 1) if x in patches and x - 1 in patches]
        fd = np.array([np.mean(np.abs(patches[x] - patches[x - 1])) for x in fr])
        m3 = np.array([np.median(fd[max(0, i - 1):i + 2]) for i in range(len(fd))])
        return np.array(fr), m3
    _, ms = sig(static[0], static[1])
    fr, m3 = sig(run[0], run[1])
    info = {"patchHalfPx": half, "noiseCeiling": None, "runs": []}
    if not len(ms) or not len(fr):
        return None, info
    ceil_ = float(ms.max())
    info["noiseCeiling"] = round(ceil_, 2)
    need = max(2, int(math.ceil(ONSET_SUSTAIN_S * fps)))
    starts = [fr[a] for a, b in runs(m3 > ceil_) if b - a + 1 >= need and fr[a] <= latest]
    info["runs"] = [int(s) for s in starts]
    return (int(starts[-1]) - 1 if starts else None), info


# =============================================================================================
# Scale (§4.6)
# =============================================================================================
def leg_scale(L_frames: list[np.ndarray], handed: str, height_cm: float) -> dict:
    """pxPerCm = legPx / (0.49 x heightCm); legPx = median (hip->knee + knee->ankle) of the
    camera-nearer leg. PLAN-GAP: "camera-nearer" = the trail leg (right leg for a right-hander,
    the same rule the plan uses for the trail shoulder in a down-the-line view)."""
    hip, knee, ank = (R_HIP, R_KNEE, R_ANK) if handed == "right" else (L_HIP, L_KNEE, L_ANK)
    legs = [np.linalg.norm(L[hip, :2] - L[knee, :2]) + np.linalg.norm(L[knee, :2] - L[ank, :2])
            for L in L_frames]
    leg_px = float(np.median(legs))
    return {"legPx": round(leg_px, 1), "pxPerCm": round(leg_px / (LEG_FRACTION * height_cm), 4),
            "heightCm": height_cm}


# =============================================================================================
# Club heuristics (§4.3)
# =============================================================================================
def work_gray(frame: np.ndarray, ws: float) -> np.ndarray:
    g = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    if ws != 1.0:
        g = cv2.resize(g, None, fx=ws, fy=ws, interpolation=cv2.INTER_AREA)
    return g.astype(np.float32)


def detect_ball(grays: list[np.ndarray], poses: list[np.ndarray], hands: np.ndarray,
                info: dict, px_per_cm: float, ws: float, handed: str) -> dict | None:
    """Ball on the address frames: brightest-2 % connected component in a pose-derived ROI.

    ROI: x from the lead-foot toe to hands x + 0.3 W; y from ankle y - 0.1 H to ankle y + 0.05 H
    (W, H = frame size). Candidates: area within ±50 % of the expected ball area, circularity > 0.7,
    closest to the extension of the address shaft. Median over the frames.
    PLAN-GAPs:
    - "the extension of the address shaft (hands -> down-and-toward-the-target)": the shaft isn't
      known yet (its search is seeded by the ball), so it is the ray from the hands 45° below
      horizontal towards the ball side (+x for a right-hander filmed down the line).
    - For blobs of a few pixels circularity from a contour is meaningless, so it is computed as
      area / (pi x (max(bbox w,h)/2)^2) (fill of the enclosing circle).
    - Confidence = 0.5 x circularity + 0.5 x min(1, contrast / 60 grey levels).
    """
    W, H = info["w"], info["h"]
    sgn = 1 if handed == "right" else -1
    toe = L_TOE if handed == "right" else R_TOE
    exp_d = BALL_CM * px_per_cm * ws
    exp_area = math.pi * (exp_d / 2) ** 2
    found = []
    for g, L in zip(grays, poses):
        ank_y = (L[L_ANK, 1] + L[R_ANK, 1]) / 2
        xs = sorted([L[toe, 0], hands[0] + sgn * 0.3 * W])
        x0, x1 = int(max(0, xs[0] * ws)), int(min(g.shape[1], xs[1] * ws))
        y0, y1 = int(max(0, (ank_y - 0.1 * H) * ws)), int(min(g.shape[0], (ank_y + 0.05 * H) * ws))
        roi = g[y0:y1, x0:x1]
        if roi.size == 0:
            continue
        thr = np.percentile(roi, 98)
        mask = (roi >= thr).astype(np.uint8)
        n, lab, stats, cents = cv2.connectedComponentsWithStats(mask, connectivity=8)
        best = None
        for c in range(1, n):
            area = stats[c, cv2.CC_STAT_AREA]
            if not (0.5 * exp_area <= area <= 1.5 * exp_area):
                continue
            bw, bh = stats[c, cv2.CC_STAT_WIDTH], stats[c, cv2.CC_STAT_HEIGHT]
            circ = area / (math.pi * (max(bw, bh) / 2) ** 2)
            if circ <= 0.7:
                continue
            cx, cy = cents[c][0] + x0, cents[c][1] + y0
            # distance to the ray from the hands, 45° down towards the ball side
            hx, hy = hands[0] * ws, hands[1] * ws
            dvec = np.array([sgn, 1.0]) / math.sqrt(2)
            rel = np.array([cx - hx, cy - hy])
            along = max(0.0, rel @ dvec)
            dist = float(np.linalg.norm(rel - along * dvec))
            ring = cv2.dilate(mask, np.ones((5, 5), np.uint8))[stats[c, 1]:stats[c, 1] + bh + 4,
                                                                stats[c, 0]:stats[c, 0] + bw + 4]
            inside = roi[lab == c].mean()
            y_a, x_a = max(0, stats[c, 1] - 3), max(0, stats[c, 0] - 3)
            around = roi[y_a:stats[c, 1] + bh + 3, x_a:stats[c, 0] + bw + 3]
            contrast = inside - np.median(around)
            del ring
            if best is None or dist < best[0]:
                best = (dist, cx / ws, cy / ws, circ, contrast)
        if best:
            found.append(best)
    if not found:
        return None
    arr = np.array(found)
    circ, contrast = float(np.median(arr[:, 3])), float(np.median(arr[:, 4]))
    return {"x": round(float(np.median(arr[:, 1])), 1), "y": round(float(np.median(arr[:, 2])), 1),
            "r": round(exp_d / ws / 2, 1),
            "conf": round(0.5 * min(1.0, circ) + 0.5 * min(1.0, max(0.0, contrast) / 60), 2),
            "nFrames": len(found)}


def ball_gone_frame(patches: dict[int, np.ndarray], quiet_frames: list[int], top: int) -> int | None:
    """§4.3 impact refinement: first frame after top whose ball-patch difference to the previous
    frame exceeds 4x the quiet-window noise. PLAN-GAPs:
    - noise = the MAX frame-to-frame patch difference over the address quiet window (floor 0.5
      grey levels). Re-encoded clips (WhatsApp) have keyframe "pops" every ~10-30 frames that are
      ~8x the mean difference; a mean-based noise fires on them long before impact.
    - patch = the ball's own footprint (1 diameter square, >= 5 px), so the clubhead arriving
      next to the ball doesn't count."""
    def d(a, b):
        return float(np.mean(np.abs(patches[a] - patches[b])))
    q = [d(f, f - 1) for f in quiet_frames if f in patches and f - 1 in patches]
    if not q:
        return None
    noise = max(float(np.max(q)), 0.5)
    for f in sorted(patches):
        if f > top and f - 1 in patches and d(f, f - 1) > 4 * noise:
            return f
    return None


class ShaftSearch:
    """Radial gradient search from the hands (§4.3 "Shaft").

    For each of 360 rays (1° steps) sample r in [0.15, 1.0] x expectedShaftPx and score
    sum(|grad . n|) - sum(|grad . d|) (perpendicular minus parallel gradient, n = ray normal).
    PLAN-GAPs:
    - Sampling is bilinear at 1 px radial steps on the working grey image after a 3x3 Sobel.
    - "Sustained score" for the length: the per-radius profile along the best ray is averaged
      over a 5 % x expected window; length = first radius past the profile peak where the average
      drops below 35 % of the peak.
    - Clubhead blob: the most contrasting pixel (|blurred - window median|) within a window of
      1.5 x ball diameter around the shaft end.
    - conf = clip((best/median - 1) / 4, 0, 1) scaled by min(1, length / expected).
    """

    def __init__(self, gray: np.ndarray, expected_px: float, ball_d_px: float):
        self.g = gray
        gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
        self.gx, self.gy = gx, gy
        self.exp = expected_px
        self.ball_d = ball_d_px

    def profiles(self, hx: float, hy: float) -> tuple[np.ndarray, np.ndarray]:
        th = np.radians(np.arange(360.0))
        r = np.arange(max(2.0, 0.15 * self.exp), self.exp + 1e-6, 1.0)
        dx, dy = np.cos(th)[:, None], np.sin(th)[:, None]   # image coords (y down)
        X = (hx + dx * r[None, :]).astype(np.float32)
        Y = (hy + dy * r[None, :]).astype(np.float32)
        gx = cv2.remap(self.gx, X, Y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        gy = cv2.remap(self.gy, X, Y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        par = np.abs(gx * dx + gy * dy)
        perp = np.abs(-gx * dy + gy * dx)
        return perp - par, r

    def search(self, hx: float, hy: float, center_deg: float | None, half_width: float = 15) -> dict:
        prof, r = self.profiles(hx, hy)
        score = prof.sum(1)
        med = float(np.median(score))
        if center_deg is None:
            cand = np.arange(360)
        else:
            cand = np.round(center_deg + np.arange(-half_width, half_width + 1)).astype(int) % 360
        k = int(cand[np.argmax(score[cand])])
        best = float(score[k])
        ratio = best / med if med > 0 else (np.inf if best > 0 else 0.0)
        # length along the best ray
        win = max(3, int(round(0.05 * self.exp)))
        p = np.convolve(prof[k], np.ones(win) / win, "same")
        kp = int(np.argmax(p))
        below = np.flatnonzero((np.arange(len(p)) > kp) & (p < 0.35 * p[kp]))
        length = float(r[below[0]]) if len(below) else float(r[-1])
        ex, ey = hx + math.cos(math.radians(k)) * length, hy + math.sin(math.radians(k)) * length
        head = self.blob(ex, ey)
        conf = float(np.clip((ratio - 1) / 4, 0, 1) * min(1.0, length / self.exp))
        hidden = bool(ratio < 2.5 or length < 0.3 * self.exp)
        return {"angleDeg": k, "lengthPx": length, "ratio": round(float(ratio), 2),
                "end": (ex, ey), "head": head, "hidden": hidden, "conf": round(conf, 2)}

    def blob(self, x: float, y: float) -> tuple[float, float]:
        half = max(2, int(round(0.75 * self.ball_d)))
        x0, y0 = int(round(x)) - half, int(round(y)) - half
        x1, y1 = x0 + 2 * half + 1, y0 + 2 * half + 1
        if x0 < 0 or y0 < 0 or x1 > self.g.shape[1] or y1 > self.g.shape[0]:
            return (x, y)
        patch = cv2.GaussianBlur(self.g[y0:y1, x0:x1], (3, 3), 0)
        dev = np.abs(patch - np.median(patch))
        yy, xx = np.unravel_index(int(np.argmax(dev)), dev.shape)
        return (float(x0 + xx), float(y0 + yy))


# =============================================================================================
# Pass 2 — sequential decode of the checkpoint span: stills, ball, shaft tracking
# =============================================================================================
def pass2(path: Path, info: dict, S: dict, P: dict, scale: dict, out_dir: Path, ws: float,
          handed: str, ball_mode: str) -> dict:
    idx, hands_s = S["idx"], S["hands"]
    fps = S["effFps"]
    px_cm = scale["pxPerCm"]
    exp_px = SHAFT_CM * px_cm * ws
    ball_d = BALL_CM * px_cm * ws

    def hands_at(f):
        return at_frame(idx, hands_s, f)

    def pose_at(f):
        """Raw landmarks at frame f: the sample itself, or linear interpolation of neighbours."""
        L = S["L"]
        if f in set(idx.tolist()):
            return L[int(np.flatnonzero(idx == f)[0])]
        return np.stack([np.stack([np.interp(f, idx, L[:, j, c]) for c in range(3)])
                         for j in range(33)])

    cps = {k: P[k] for k in ("address", "leadArm", "top", "transition", "impact", "trailArm", "finish")}
    a0, b_run = P["addressRun"]
    if ball_mode == "address":
        # Plan §4.3: three address-window frames (8 frames apart = the quiet sampling step).
        ball_frames = sorted({max(0, P["address"] - 8), P["address"], min(info["frames"] - 1, P["address"] + 8)})
    else:
        # Variant: in a down-the-line view the soled clubhead hides the ball at address, so look
        # once the club has left it (lead-arm parallel -> top). Camera, ball and feet are static,
        # so the ROI still comes from the address pose and hands.
        mid = (P["leadArm"] + P["top"]) // 2
        ball_frames = sorted({P["leadArm"], mid, P["top"]})
    # Tracked ranges (plan §3 trackRanges): backswing every 2, transition->post-impact every 1.
    # PLAN-GAP: the backswing track starts at address (where the seed is defined) and the dense
    # track starts at the top, so the angle is carried continuously through the transition.
    track = list(range(P["address"], P["top"], 2)) + list(range(P["top"], P["trailArm"] + NEIGHBOURS + 1))
    # Noise window for ballGoneFrame: the address quiet run (plan). Variant: the frames where the
    # ball was actually looked for (lead arm -> top) — at address the clubhead covers the ball,
    # so that window measures the clubhead's waggle, not the ball patch's noise.
    quiet_frames = list(range(a0 + 1, b_run + 1)) if ball_mode == "address" else \
        list(range(P["leadArm"] + 1, P["top"] + 1))
    first = min([*track, *ball_frames, *quiet_frames, *(f - NEIGHBOURS for f in cps.values())])
    last = max([*track, *(f + NEIGHBOURS for f in cps.values())])
    save = {f for c in cps.values() for f in range(c - NEIGHBOURS, c + NEIGHBOURS + 1)
            if 0 <= f < info["frames"]} | set(ball_frames)   # CONTRACT: plus the ball frames

    frames_dir = out_dir / "frames"   # shared by all variants: a still is just frame n of the clip
    frames_dir.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(str(path))
    cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, first))
    f = max(0, first)
    grays: dict[int, np.ndarray] = {}
    ball_grays = []
    t_jpeg = t_shaft = 0.0
    while f <= last:
        ok, frame = cap.read()
        if not ok:
            break
        if f in save:
            t1 = time.perf_counter()
            cv2.imwrite(str(frames_dir / f"{f}.jpg"), frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
            t_jpeg += time.perf_counter() - t1
        if f in ball_frames or f in track or f in save or f >= quiet_frames[0] - 1:
            g = work_gray(frame, ws)
            if f in ball_frames:
                ball_grays.append((f, g))
            grays[f] = g
        f += 1
    cap.release()

    # ---- ball (address frames)
    roi_pose = (lambda fr: pose_at(fr)) if ball_mode == "address" else (lambda fr: pose_at(P["address"]))
    ball = detect_ball([g for _, g in ball_grays], [roi_pose(fr) for fr, _ in ball_grays],
                       hands_at(P["address"]), info, px_cm, ws, handed)
    # ---- ballGoneFrame
    bgf = None
    if ball:
        half = max(2, int(round(0.5 * ball_d)))
        bx, by = int(round(ball["x"] * ws)), int(round(ball["y"] * ws))
        patches = {fr: g[by - half:by + half + 1, bx - half:bx + half + 1]
                   for fr, g in grays.items() if fr >= quiet_frames[0] - 1}
        bgf = ball_gone_frame(patches, quiet_frames, P["top"])

    # ---- shaft tracking
    t1 = time.perf_counter()
    sgn = 1 if handed == "right" else -1
    h_addr = hands_at(P["address"])
    if ball:
        seed = math.degrees(math.atan2(ball["y"] - h_addr[1], ball["x"] - h_addr[0])) % 360
    else:  # PLAN-GAP: no ball -> seed 45° down towards the ball side
        seed = 45.0 if sgn > 0 else 135.0
    # Variant: once lost (the shaft is end-on / behind the body around the top) the ±15° window
    # never finds it again, so re-seed with the plan's own impact prior (hands -> ball) two frames
    # before the impact estimate (ballGoneFrame - 1 when it lies in the downswing).
    reseed = None
    if ball_mode != "address" and ball:
        imp = bgf - 1 if (bgf is not None and P["top"] < bgf <= P["descentEnd"] + 4) else P["impact"]
        reseed = imp - NEIGHBOURS
    shaft: dict[int, dict] = {}
    prev = seed
    for fr in track:
        if fr not in grays:
            continue
        if fr == reseed:
            h = hands_at(fr)
            prev = math.degrees(math.atan2(ball["y"] - h[1], ball["x"] - h[0])) % 360
        hx, hy = hands_at(fr) * ws
        res = ShaftSearch(grays[fr], exp_px, ball_d).search(hx, hy, prev)
        shaft[fr] = res
        prev = res["angleDeg"]  # hidden frames keep their angle as the prior for the next one
    # checkpoints outside the tracked ranges (finish): full 360° search
    for key in ("finish",):
        fr = cps[key]
        if fr not in shaft and fr in grays:
            hx, hy = hands_at(fr) * ws
            shaft[fr] = ShaftSearch(grays[fr], exp_px, ball_d).search(hx, hy, None)
    t_shaft = time.perf_counter() - t1

    return {"ball": ball, "ballGoneFrame": bgf, "shaft": shaft, "saved": sorted(save),
            "poseAt": pose_at, "handsAt": hands_at, "expectedShaftPx": exp_px / ws,
            "timings": {"jpegMs": round(t_jpeg * 1000), "shaftMs": round(t_shaft * 1000),
                        "shaftFrames": len(shaft)}}


def refine_with_shaft(P: dict, shaft: dict, exp_px_work: float) -> None:
    """§5.1 takeaway / shaftParallelDown from the pass-2 tracked shaft lengths.

    takeaway: first backswing frame whose shaft is end-on (lengthPx < 0.35 x expected).
    shaftParallelDown: the same in the downswing ("end-on again"). Fallbacks per the plan.
    PLAN-GAPs: "end-on" is the length rule only (not the hidden ratio rule). Checkpoints are
    kept in swing order: the takeaway is searched motionStart -> leadArm (the shaft is behind the
    body near the top and reads "short" there), shaftDown transition -> impact.
    """
    def end_on(fr):
        return shaft[fr]["lengthPx"] < 0.35 * exp_px_work

    bs = [fr for fr in sorted(shaft) if P["motionStart"] <= fr < P["leadArm"] and end_on(fr)]
    if bs:
        P["takeaway"], P["conf"]["takeaway"], P["takeawaySource"] = bs[0], 0.6, "shaft"
    else:
        P["takeaway"] = int(round(P["motionStart"] + 0.12 * P["backswing"]))
        P["conf"]["takeaway"], P["takeawaySource"] = 0.3, "fallback"
    ds = [fr for fr in sorted(shaft) if P["transition"] < fr < P["impact"] and end_on(fr)]
    if ds:
        P["shaftDown"], P["conf"]["shaftDown"], P["shaftDownSource"] = ds[0], 0.6, "shaft"
    else:
        P["shaftDown"] = int(round(P["top"] + 0.65 * P["downswing"]))
        P["conf"]["shaftDown"], P["shaftDownSource"] = 0.3, "fallback"


# =============================================================================================
# Main
# =============================================================================================
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("clip", help="clip name (clips/<clip>.mp4)")
    ap.add_argument("--model", choices=["heavy", "full"], default="full",
                    help="pose model; the plan bundles 'full' (default)")
    ap.add_argument("--handedness", choices=["right", "left"], default="right")
    ap.add_argument("--height-cm", type=float, default=DEFAULT_HEIGHT_CM)
    ap.add_argument("--work-scale", type=float, default=None,
                    help="grey working scale for club heuristics; default 0.5 when the short side "
                         ">= 720 px (the plan's half-resolution copy), else 1.0")
    ap.add_argument("--dense", action="store_true", help="run pose on every frame (ignores §4.2)")
    ap.add_argument("--sampling", choices=["policy", "sparse165"], default="policy",
                    help="pass-1 sampling: policy = the §4.2 speed policy of the variant; sparse165 = the "
                         "native app's policy (every 16th still, every 4th to the top, every frame "
                         "top-6 .. impact+6, every 2nd to the finish), with its ring back-fill")
    ap.add_argument("--top-back", type=int, default=TOP_BACK,
                    help=f"sparse165: frames re-run behind the frame the top is seen at (default {TOP_BACK})")
    ap.add_argument("--still-every", type=int, default=SPARSE_EVERY,
                    help=f"sparse165: stride before motion start and after the finish (default {SPARSE_EVERY})")
    ap.add_argument("--follow-every", type=int, default=FOLLOW_EVERY,
                    help=f"sparse165: stride from impact + 6 to the finish (default {FOLLOW_EVERY})")
    ap.add_argument("--reuse-pose", action="store_true", help="reuse cached pass-1 pose if present")
    ap.add_argument("--out-suffix", default=None,
                    help="write auto<suffix>.json; default '' for the plan with the full model, plus "
                         "'-fixed' / '-heavy' / '-dense' as applicable (use --out-suffix=-x)")
    ap.add_argument("--variant", choices=["plan", "fixed", "d15"], default="plan",
                    help="plan = the plan as written; fixed = plan + the recommended changes "
                         "(noise-floor v_still, smoothed sampling speed, ball after takeaway); "
                         "d15 = fixed's pass 1 + phase rules implementing the D15 definitions "
                         "and hands = grip estimate")
    ap.add_argument("--grip-k", type=float, default=GRIP_K,
                    help=f"d15: grip = wrist + k x (wrist - elbow); default {GRIP_K} (anatomy)")
    ap.add_argument("--vstill-k", type=float, default=None,
                    help=f"v_still = k x body height px/s (plan {V_STILL_K}; fixed {V_STILL_K_FIXED})")
    a = ap.parse_args()
    d15 = a.variant == "d15"
    keys = KEYS_D15 if d15 else KEYS
    fixed = a.variant == "fixed"
    # d15 reuses the fixed variant's pass 1 (sampling policy) unchanged; only its phase rules differ
    vstill_k = a.vstill_k or (V_STILL_K_FIXED if (fixed or d15) else V_STILL_K)
    suffix = a.out_suffix if a.out_suffix is not None else \
        ("-fixed" if fixed else "-d15" if d15 else "") + ("-heavy" if a.model == "heavy" else "") + \
        ("-dense" if a.dense else "")

    t_start = time.perf_counter()
    path = LAB / "clips" / f"{a.clip}.mp4"
    out_dir = LAB / "out" / a.clip
    out_dir.mkdir(parents=True, exist_ok=True)
    info = probe(path)
    print(f"[probe] {info['w']}x{info['h']} {info['frames']} frames @ {info['containerFps']:.3f} fps, "
          f"captureFps={info['captureFps']}")

    sparse = a.sampling == "sparse165" and not a.dense
    tag = "dense" if a.dense else (f"sparse165-s{a.still_every}-b{a.top_back}-f{a.follow_every}" if sparse else
                                   "policy-fixed" if (fixed or d15) else "policy-plan")
    cache = out_dir / f".pose-{a.model}-{tag}.json"
    if a.reuse_pose and cache.exists():
        pose = json.loads(cache.read_text())
        pose["samples"] = {int(k): v for k, v in pose["samples"].items()}
        print(f"[pass1] reused {cache.name}")
    else:
        pose = run_pose_sparse(path, info, a.model, a.top_back, a.follow_every, a.still_every) if sparse else \
            run_pose(path, info, a.model, a.dense, vstill_k, smoothed_policy=fixed or d15)
        cache.write_text(json.dumps(pose))
    tp = pose["timings"]
    print(f"[pass1] model={a.model} inferences={tp['inferences']}/{info['frames']} "
          f"pose={tp['poseMs']} ms pass1={tp['pass1Ms']} ms")

    dup = duplicate_frame_ratio(np.array(pose["diffs"]))
    t_an = time.perf_counter()
    if d15:
        factor, S, P, factor_src = choose_factor_d15(pose, info, a.handedness, a.grip_k)
    else:
        factor, S, P, factor_src = choose_factor(pose, info, a.handedness, vstill_k, fixed)
    interpolated = dup > 0.4
    # PLAN-GAP: a frame-doubled clip's effective fps halves (§4.4 step 3); phases still run on
    # the container frames, only the reported captureFps / approximate flag change.
    capture_fps = info["containerFps"] * factor / (2 if interpolated else 1)
    print(f"[fps] factor={factor} ({factor_src}) captureFps~{capture_fps:.0f} dupRatio={dup:.2f}")

    # scale from the address quiet window
    a0, a1 = P["addressRun"]
    addr_L = [S["L"][k] for k in np.flatnonzero((S["idx"] >= a0) & (S["idx"] <= a1))] or \
             [S["L"][nearest_k(S["idx"], P["address"])]]
    scale = leg_scale(addr_L, a.handedness, a.height_cm)
    print(f"[scale] legPx={scale['legPx']} pxPerCm={scale['pxPerCm']}")

    ws = a.work_scale or (0.5 if min(info["w"], info["h"]) >= 720 else 1.0)
    t2 = time.perf_counter()
    R = pass2(path, info, S, P, scale, out_dir, ws, a.handedness, "backswing" if (fixed or d15) else "address")
    pass2_ms = round((time.perf_counter() - t2) * 1000)

    # impact refinement with ballGoneFrame (§5.1), then the shaft-based takeaway / shaftDown
    # (the latter searches transition -> impact, so it must see the final impact).
    bgf = R["ballGoneFrame"]
    # Variant "fixed": the ball leaving is the direct signal, so it wins anywhere in the downswing
    # (top -> bottom of the hands' descent + 4 frames), not only within 4 frames of the pose guess.
    # d15: same window, its slack expressed in time (0.02 s ≈ the pose impact's sampling slack).
    slack = int(math.ceil(ONSET_SUSTAIN_S * S["effFps"])) if d15 else 4
    in_window = (P["top"] < bgf <= P["descentEnd"] + slack) if ((fixed or d15) and bgf is not None) else \
                (bgf is not None and abs(bgf - P["impact"]) <= 4)
    if in_window:
        P["impact"], P["impactSource"] = bgf - 1, "ballGoneFrame"
        P["conf"]["impact"] = 0.9
        if d15:
            d15_rules(P)
        else:
            derive_after_impact(P, S)
    else:
        P["impactSource"] = "pose"
    onset_info = None
    if d15:
        P["takeawaySource"] = P["shaftDownSource"] = "grip-at-trail-hip"
        # P1 address: clubhead onset in the ball patch (image), else the pose motion start
        if R["ball"]:
            hold = P["_d"]["hold_w"]
            onset, onset_info = clubhead_onset(path, R["ball"], scale["pxPerCm"],
                                               (P["addressRun"][0], P["motionStart"] + hold), P["motionStart"],
                                               (P["leadArm"], P["top"]), S["effFps"])
            if onset is not None:
                P["address"], P["conf"]["address"], P["addressSource"] = onset, 0.8, "clubhead-onset"
        P.setdefault("addressSource", "pose-motionStart")
        enforce_order(P)
    else:
        refine_with_shaft(P, R["shaft"], R["expectedShaftPx"] * ws)

    # takeaway / shaftDown / impact may have moved -> make sure their stills exist (in the app
    # these come from the same pass-2 decode; here a short second read keeps the code simple).
    missing = sorted({f for k in keys for f in range(P[k] - NEIGHBOURS, P[k] + NEIGHBOURS + 1)
                      if 0 <= f < info["frames"]} - set(R["saved"]))
    if missing:
        cap = cv2.VideoCapture(str(path))
        for f in missing:
            cap.set(cv2.CAP_PROP_POS_FRAMES, f)
            ok, frame = cap.read()
            if ok:
                cv2.imwrite(str(out_dir / "frames" / f"{f}.jpg"), frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
        cap.release()
    saved = sorted(set(R["saved"]) | set(missing))

    # assemble checkpoints
    checkpoints = {}
    for k in keys:
        fr = int(P[k])
        hx, hy = R["handsAt"](fr)
        sh = R["shaft"].get(fr)
        if sh is None:  # frame not tracked (e.g. a checkpoint moved by refinement): search now
            g = work_gray(cv2.imread(str(out_dir / "frames" / f"{fr}.jpg")), ws)
            # d15: address/impact seed the ±15° window with the plan's prior (hands -> ball, §4.3)
            # instead of a free 360° search (the address moves after pass 2, so it is untracked).
            seed = math.degrees(math.atan2(R["ball"]["y"] - hy, R["ball"]["x"] - hx)) % 360 \
                if (d15 and R["ball"] and k in ("address", "impact")) else None
            sh = ShaftSearch(g, R["expectedShaftPx"] * ws, BALL_CM * scale["pxPerCm"] * ws) \
                .search(hx * ws, hy * ws, seed)
        head = None if sh["hidden"] else {"x": round(sh["head"][0] / ws, 1), "y": round(sh["head"][1] / ws, 1)}
        checkpoints[k] = {
            "frame": fr,
            "hands": {"x": round(float(hx), 1), "y": round(float(hy), 1)},
            "head": head,
            "hidden": sh["hidden"],
            "conf": sh["conf"],
            "phaseConf": P["conf"].get(k, 0.6),
            "shaft": {"angleDeg": sh["angleDeg"], "lengthPx": round(sh["lengthPx"] / ws, 1),
                      "ratio": sh["ratio"], "end": [round(sh["end"][0] / ws, 1), round(sh["end"][1] / ws, 1)]},
        }

    pose_out = {str(f): [[round(float(x), 1), round(float(y), 1), round(float(v), 3)]
                         for x, y, v in R["poseAt"](f)] for f in saved}
    total_ms = round((time.perf_counter() - t_start) * 1000)
    auto = {
        "clip": a.clip,
        "source": "auto",
        "video": {"w": info["w"], "h": info["h"], "frames": info["frames"],
                  "playbackFps": round(info["containerFps"], 3), "captureFps": round(capture_fps),
                  "slowmoFactor": factor, "interpolated": interpolated},
        "handedness": a.handedness,
        "heightCm": a.height_cm,
        "ball": R["ball"],
        "checkpoints": checkpoints,
        "pose": pose_out,
        "timings": {"poseMs": tp["poseMs"], "pass1Ms": tp["pass1Ms"], "inferences": tp["inferences"],
                    "analysisMs": round((t2 - t_an) * 1000), "pass2Ms": pass2_ms,
                    **R["timings"], "totalMs": total_ms},
        # lab-only diagnostics (not part of the app contract)
        "debug": {
            "variant": a.variant, "sampling": "dense" if a.dense else a.sampling, "vStillK": vstill_k, "model": a.model, "dense": a.dense, "workScale": ws, "factorSource": factor_src,
            "duplicateFrameRatio": round(dup, 3), "scale": scale, "bodyHPx": round(pose["bodyH"], 1),
            "vStillPxPerS": round(P["vStill"], 2), "motionStart": P["motionStart"],
            "addressRun": list(P["addressRun"]), "ballGoneFrame": bgf,
            "impactSource": P["impactSource"], "takeawaySource": P["takeawaySource"],
            "shaftDownSource": P["shaftDownSource"], "trailArmCrosses": P["trailArmCrosses"],
            "expectedShaftPx": round(R["expectedShaftPx"], 1), "notes": P["notes"],
            **({"d15": {"gripK": a.grip_k, "addressSource": P["addressSource"], "clubheadOnset": onset_info,
                        "handsTop": P["handsTop"], "sigmaGripPx": round(S["sigmaGrip"], 2),
                        "sigmaHeadPx": round(S["sigmaHead"], 2), "armPx": round(S["armPx"], 1),
                        "levelBandPx": round(P["_d"]["band"], 1), "holdFrames": P["_d"]["hold_w"],
                        "stillGripPxS": round(P["_d"]["tg"], 1), "stillHeadPxS": round(P["_d"]["tn"], 1)}}
               if d15 else {}),
            "sampledFrames": [int(i) for i in S["idx"]],
            # per-frame series so eval can score hands / clubhead at the truth frame too
            "handsSeries": {str(int(f)): [round(float(x), 1), round(float(y), 1)]
                            for f, (x, y) in zip(S["idx"], S["hands"])},
            "track": {str(f): {"a": s["angleDeg"], "len": round(s["lengthPx"] / ws, 1),
                               "ratio": s["ratio"], "hidden": s["hidden"],
                               "head": [round(s["head"][0] / ws, 1), round(s["head"][1] / ws, 1)]}
                      for f, s in sorted(R["shaft"].items())},
        },
    }
    out = out_dir / f"auto{suffix}.json"
    out.write_text(json.dumps(auto, indent=1))
    # frames/ is shared by the variants: drop stills no auto*.json references any more
    keep = set()
    for other in out_dir.glob("auto*.json"):
        keep |= {int(f) for f in json.loads(other.read_text()).get("pose", {})}
    for jpg in (out_dir / "frames").glob("*.jpg"):
        if int(jpg.stem) not in keep:
            jpg.unlink()
    print("[phases] " + "  ".join(f"{k}={checkpoints[k]['frame']}" for k in keys))
    print(f"[ball] {R['ball']}  ballGoneFrame={bgf}")
    print(f"[timings] {auto['timings']}")
    print(f"wrote {out.relative_to(LAB)} and {len(saved)} stills")


if __name__ == "__main__":
    main()
