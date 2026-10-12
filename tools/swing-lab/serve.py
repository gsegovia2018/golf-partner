#!/usr/bin/env python3
"""Swing lab server: serves editor/ at / and out/ at /out/, plus a tiny API. Stdlib only, 127.0.0.1 only.

  python3 serve.py [--port 8765] [--no-open] [--clip <name>]
"""
import argparse
import json
import mimetypes
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
EDITOR = os.path.join(ROOT, "editor")
OUT = os.path.join(ROOT, "out")
CLIP_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
CHECKPOINTS = ["address", "takeaway", "leadArm", "top", "transition", "shaftDown", "impact", "shaftThrough", "trailArm", "finish"]
MAX_BODY = 2 * 1024 * 1024
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")

PORT = 8765
FFMPEG = "/opt/homebrew/bin/ffmpeg"
FFPROBE = "/opt/homebrew/bin/ffprobe"
POSE_MAX_GAP = 30
_lock = threading.Lock()
_clip_locks = {}
_frame_counts = {}
_pose_cache = {}


def _clip_lock(clip):
    with _lock:
        return _clip_locks.setdefault(clip, threading.Lock())


def clip_video(clip):
    p = os.path.join(ROOT, "clips", clip + ".mp4")
    return p if CLIP_RE.match(clip) and os.path.isfile(p) else None


def frame_count(clip):
    """Frame count from auto*.json video.frames, else ffprobe (cached)."""
    if clip in _frame_counts:
        return _frame_counts[clip]
    n = None
    d = os.path.join(OUT, clip)
    for name in ("auto-fixed.json", "auto.json"):
        try:
            with open(os.path.join(d, name), encoding="utf-8") as f:
                v = json.load(f).get("video", {}).get("frames")
            if isinstance(v, int) and v > 0:
                n = v
                break
        except (OSError, ValueError, AttributeError):
            pass
    vid = clip_video(clip)
    if n is None and vid:
        try:
            r = subprocess.run([FFPROBE, "-v", "error", "-select_streams", "v:0", "-count_frames",
                                "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", vid],
                               capture_output=True, text=True, timeout=120)
            n = int(r.stdout.strip().split(",")[0])
        except Exception:
            n = None
    if n:
        _frame_counts[clip] = n
    return n


def frames_dir(clip):
    d = os.path.join(OUT, clip, "frames")
    os.makedirs(d, exist_ok=True)
    return d


def ensure_frame(clip, n):
    """Return the jpg path for frame n, extracting it with ffmpeg if missing. None on failure."""
    path = os.path.join(frames_dir(clip), "%d.jpg" % n)
    if os.path.isfile(path):
        return path
    vid = clip_video(clip)
    if not vid:
        return None
    with _clip_lock(clip):
        if os.path.isfile(path):
            return path
        tmp = path + ".tmp.jpg"
        r = subprocess.run([FFMPEG, "-v", "error", "-y", "-i", vid, "-vf", "select=eq(n\\,%d)" % n,
                            "-vsync", "0", "-frames:v", "1", "-q:v", "2", tmp],
                           capture_output=True, timeout=120)
        if r.returncode != 0 or not os.path.isfile(tmp) or os.path.getsize(tmp) == 0:
            if os.path.isfile(tmp):
                os.remove(tmp)
            return None
        os.replace(tmp, path)
        return path


def prefetch_frames(clip, a, b, step):
    """Extract frames a, a+step, ... <= b in ONE ffmpeg call. Returns the list of cached frame numbers."""
    vid = clip_video(clip)
    want = list(range(a, b + 1, step))
    fd = frames_dir(clip)
    missing = [n for n in want if not os.path.isfile(os.path.join(fd, "%d.jpg" % n))]
    if missing and vid:
        with _clip_lock(clip):
            missing = [n for n in want if not os.path.isfile(os.path.join(fd, "%d.jpg" % n))]
            if missing:
                lo, hi = missing[0], missing[-1]
                with tempfile.TemporaryDirectory(dir=fd, prefix=".pf-") as td:
                    expr = "between(n\\,%d\\,%d)*not(mod(n-%d\\,%d))" % (lo, hi, lo, step)
                    # missing frames sit on the same lo + k*step lattice, so output k maps to lo + k*step
                    subprocess.run([FFMPEG, "-v", "error", "-y", "-i", vid, "-vf", "select=%s" % expr,
                                    "-vsync", "0", "-q:v", "2", os.path.join(td, "%06d.jpg")],
                                   capture_output=True, timeout=300)
                    for k in range(len(range(lo, hi + 1, step))):
                        src = os.path.join(td, "%06d.jpg" % (k + 1))
                        dst = os.path.join(fd, "%d.jpg" % (lo + k * step))
                        if os.path.isfile(src) and not os.path.isfile(dst):
                            os.replace(src, dst)
    return [n for n in want if os.path.isfile(os.path.join(fd, "%d.jpg" % n))]


def pose_samples(clip):
    """Detector pose cache matching the auto-fixed run (full model, fixed policy); plan run as fallback."""
    if clip in _pose_cache:
        return _pose_cache[clip]
    out = None
    d = os.path.join(OUT, clip)
    for name in (".pose-full-policy-fixed.json", ".pose-full-policy-plan.json"):
        try:
            with open(os.path.join(d, name), encoding="utf-8") as f:
                smp = json.load(f).get("samples")
            if smp:
                out = {int(k): v for k, v in smp.items()}
                out["_keys"] = sorted(k for k in out)
                break
        except (OSError, ValueError, AttributeError):
            continue
    _pose_cache[clip] = out
    return out


def pose_at(clip, n):
    smp = pose_samples(clip)
    if not smp:
        return None
    keys = smp["_keys"]
    import bisect
    i = bisect.bisect_left(keys, n)
    if i < len(keys) and keys[i] == n:
        return smp[n]
    lo = keys[i - 1] if i > 0 else None
    hi = keys[i] if i < len(keys) else None
    if lo is not None and n - lo > POSE_MAX_GAP:
        lo = None
    if hi is not None and hi - n > POSE_MAX_GAP:
        hi = None
    if lo is None and hi is None:
        return None
    if lo is None or hi is None:
        return smp[lo if hi is None else hi]
    t = (n - lo) / (hi - lo)
    return [[a[j] + (b[j] - a[j]) * t for j in range(3)] for a, b in zip(smp[lo], smp[hi])]


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) < 1e7


def _xy(p):
    return isinstance(p, dict) and _num(p.get("x")) and _num(p.get("y"))


def validate_truth(d, clip):
    """Minimal shape check. Returns an error string or None."""
    if not isinstance(d, dict):
        return "body must be a JSON object"
    if d.get("clip") not in (None, clip):
        return "clip does not match URL"
    if d.get("handedness") not in (None, "right", "left"):
        return "handedness must be right or left"
    if "ball" in d and d["ball"] is not None and not _xy(d["ball"]):
        return "ball needs numeric x, y"
    cps = d.get("checkpoints")
    if not isinstance(cps, dict) or not cps:
        return "checkpoints object required"
    for k, c in cps.items():
        if k not in CHECKPOINTS:
            return "unknown checkpoint: %s" % k
        if not isinstance(c, dict):
            return "%s must be an object" % k
        if not isinstance(c.get("frame"), int) or isinstance(c.get("frame"), bool) or c["frame"] < 0:
            return "%s.frame must be a non-negative integer" % k
        if not _xy(c.get("hands")):
            return "%s.hands needs numeric x, y" % k
        if c.get("head") is not None and not _xy(c.get("head")):
            return "%s.head must be null or {x, y}" % k
        if "hidden" in c and not isinstance(c["hidden"], bool):
            return "%s.hidden must be boolean" % k
    return None


def _clean(v):
    if isinstance(v, float) and (v != v or v in (float("inf"), float("-inf"))):
        return None
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_clean(x) for x in v]
    return v


def strict_json(body):
    """detect.py writes bare NaN/Infinity (invalid for browsers' JSON.parse): serve them as null."""
    if b"NaN" not in body and b"Infinity" not in body:
        return body
    try:
        return json.dumps(_clean(json.loads(body))).encode()
    except ValueError:
        return body


def list_clips():
    clips = []
    if os.path.isdir(OUT):
        for name in sorted(os.listdir(OUT)):
            d = os.path.join(OUT, name)
            if not os.path.isdir(d) or not CLIP_RE.match(name):
                continue
            fr = os.path.join(d, "frames")
            clips.append({
                "clip": name,
                "hasAuto": os.path.isfile(os.path.join(d, "auto.json")),
                "hasTruth": os.path.isfile(os.path.join(d, "truth.json")),
                "frames": len([f for f in os.listdir(fr) if f.endswith(".jpg")]) if os.path.isdir(fr) else 0,
                "videoFrames": frame_count(name) if clip_video(name) else None,
            })
    return clips


class Handler(BaseHTTPRequestHandler):
    server_version = "SwingLab/1"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s\n" % (fmt % args))

    # -- helpers
    def _send(self, code, body=b"", ctype="application/json", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _host_ok(self):
        # Blocks DNS-rebinding: only accept our own loopback host names.
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]")
        return host in ("127.0.0.1", "localhost")

    def _file(self, base, rel):
        path = os.path.realpath(os.path.join(base, rel))
        if not (path == base or path.startswith(base + os.sep)) or not os.path.isfile(path):
            return self._send(404, {"error": "not found"})
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/json",):
            ctype += "; charset=utf-8"
        with open(path, "rb") as f:
            body = f.read()
        if path.endswith(".json"):
            body = strict_json(body)
        self._send(200, body, ctype)

    # -- routes
    def do_GET(self):
        self._route()

    do_HEAD = do_GET

    def _route(self):
        if not self._host_ok():
            return self._send(403, {"error": "bad host"})
        p = unquote(urlparse(self.path).path)
        if p == "/api/clips":
            return self._send(200, {"clips": list_clips()})
        m = re.match(r"^/out/([^/]+)/frames/(\d+)\.jpg$", p)
        if m:
            clip, n = m.group(1), int(m.group(2))
            path = os.path.join(OUT, clip, "frames", "%d.jpg" % n)
            if CLIP_RE.match(clip) and not os.path.isfile(path):
                total = frame_count(clip)
                if total is None or not 0 <= n < total or not clip_video(clip):
                    return self._send(404, {"error": "no such frame"})
                if not ensure_frame(clip, n):
                    return self._send(500, {"error": "ffmpeg failed"})
        m = re.match(r"^/api/frames/([^/]+)/prefetch$", p)
        if m:
            clip = m.group(1)
            q = parse_qs(urlparse(self.path).query)
            try:
                a, b, st = int(q["from"][0]), int(q["to"][0]), int(q.get("step", ["1"])[0])
            except (KeyError, ValueError, IndexError):
                return self._send(400, {"error": "from, to (int) and optional step required"})
            total = frame_count(clip) if CLIP_RE.match(clip) else None
            if total is None or not clip_video(clip):
                return self._send(404, {"error": "unknown clip"})
            a, b, st = max(0, a), min(total - 1, b), max(1, st)
            if a > b or (b - a) // st > 400:
                return self._send(400, {"error": "bad range"})
            return self._send(200, {"clip": clip, "frames": prefetch_frames(clip, a, b, st)})
        m = re.match(r"^/api/pose/([^/]+)/(\d+)$", p)
        if m:
            if not CLIP_RE.match(m.group(1)):
                return self._send(404, {"error": "unknown clip"})
            return self._send(200, {"frame": int(m.group(2)), "landmarks": pose_at(m.group(1), int(m.group(2)))})
        if p.startswith("/out/"):
            return self._file(os.path.realpath(OUT), p[len("/out/"):])
        if p in ("/", ""):
            p = "/index.html"
        return self._file(os.path.realpath(EDITOR), p.lstrip("/"))

    def do_POST(self):
        if not self._host_ok():
            return self._send(403, {"error": "bad host"})
        p = unquote(urlparse(self.path).path)
        m = re.match(r"^/api/truth/([^/]+)$", p)
        if not m:
            return self._send(404, {"error": "not found"})
        clip = m.group(1)
        origin = self.headers.get("Origin")
        if origin and urlparse(origin).netloc != self.headers.get("Host"):
            return self._send(403, {"error": "cross-origin"})
        if not CLIP_RE.match(clip) or not os.path.isdir(os.path.join(OUT, clip)):
            return self._send(404, {"error": "unknown clip"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if n <= 0 or n > MAX_BODY:
            return self._send(413, {"error": "bad body size"})
        try:
            data = json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            return self._send(400, {"error": "invalid JSON"})
        err = validate_truth(data, clip)
        if err:
            return self._send(422, {"error": err})
        data["clip"] = clip
        data.pop("pose", None)  # truth never carries pose
        target = os.path.join(OUT, clip, "truth.json")
        backup = None
        if os.path.isfile(target):
            backup = target + ".bak"
            shutil.copy2(target, backup)
        tmp = target + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=1)
            f.write("\n")
        os.replace(tmp, target)
        self._send(200, {"ok": True, "path": "out/%s/truth.json" % clip, "backup": backup is not None})


def pick_port(preferred):
    for port in list(range(preferred, preferred + 50)) + [0]:
        s = socket.socket()
        try:
            s.bind(("127.0.0.1", port))
            return s.getsockname()[1]
        except OSError:
            continue
        finally:
            s.close()
    raise SystemExit("no free port")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--no-open", action="store_true")
    ap.add_argument("--clip", help="clip to open first")
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    port = pick_port(a.port)
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = "http://127.0.0.1:%d/" % port + ("#" + a.clip if a.clip else "")
    print("Swing lab on %s  (Ctrl-C to stop)" % url, flush=True)
    if not a.no_open:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
