"""Face-on ball flight and clubhead speed (plan 2026-10-30 §5): the lab reference for BallFlight.kt.

    python ball_flight.py <clip> --impact F --top F --ball X,Y,D --fps 240 [--dir 1] [--sheet out.jpg]

The ball at rest at (X, Y), diameter D px (display px). From the frame after impact, the ball is
a blob brighter than the background (the per-pixel median of the frames around the top, when the
club is in the air) in a corridor toward the target; the longest chain of blobs with a constant
step is the flight. A least-squares line through it gives px per captured frame -> m/s at the
ball's own scale (4.27 cm over D px), and the launch angle against the image horizontal.
"""
import argparse
import json
import math

import cv2
import numpy as np

BALL_CM = 4.27
# corridor: from the ball toward the target, this far (ball diameters), this much above / below
CORRIDOR_D = 35
UP_DEG = 40        # steepest launch looked for
DOWN_D = 1.5       # below the ball's resting centre, diameters (a topped ball, the ground line)
FLIGHT_FRAMES = 10  # frames after impact searched
DIFF_MIN = 22      # grey levels brighter than the background
AREA_RANGE = (0.25, 6.0)  # blob area / the ball's area (a blurred ball is a streak)
MIN_CHAIN = 3


STEP = 1  # frame px per sample (--step): the app samples so the ball spans >= 8 samples


def grey(cap, f, step=None):
    cap.set(cv2.CAP_PROP_POS_FRAMES, f)
    ok, img = cap.read()
    if not ok:
        return None
    s = STEP if step is None else step
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.int16)[::s, ::s]


def diameter(bg, ball, d):
    """The ball's own diameter on the static background (the median around the top: sharp, no
    club): the pixels at least half way from the ground (the patch's median) to the ball's
    brightest, connected to its centre within +-1.2 d; their widest extent. The patch (+-2 d) is clipped to
    the frame. (centre x, centre y, diameter) display px; None when the ball is not inside it."""
    bx, by = int(round(ball[0])), int(round(ball[1]))
    H, W = bg.shape
    if not (d <= bx < W - d and d <= by < H - d):
        return None
    h = max(2, int(round(2 * d)))
    x0, y0 = max(0, bx - h), max(0, by - h)
    p = bg[y0:min(H, by + h + 1), x0:min(W, bx + h + 1)].astype(float)
    lx, ly = bx - x0, by - y0  # the guess in patch px
    r = max(1, int(round(0.5 * d)))
    s3 = cv2.blur(p, (3, 3))
    wy0, wx0 = max(0, ly - r), max(0, lx - r)
    win = s3[wy0:ly + r + 1, wx0:lx + r + 1]
    j, i = np.unravel_index(np.argmax(win), win.shape)
    cy, cx = wy0 + j, wx0 + i
    top = p[max(0, cy - r):cy + r + 1, max(0, cx - r):cx + r + 1].max()
    lvl = (top + np.median(p)) / 2
    k = int(round(1.2 * d))
    m = np.zeros(p.shape, np.uint8)
    m[max(0, cy - k):cy + k + 1, max(0, cx - k):cx + k + 1] = 1
    m &= (p >= lvl).astype(np.uint8)
    _, lab = cv2.connectedComponents(m, connectivity=8)
    if not lab[cy, cx]:
        return None
    ys, xs = np.nonzero(lab == lab[cy, cx])
    # In sunlight only one half of the ball is bright, but a half-lit sphere still spans the whole
    # diameter along its terminator: the widest extent over four directions, not the area.
    ext = max((v.max() - v.min()) / n + 1 for v, n in ((xs, 1), (ys, 1), ((xs + ys), math.sqrt(2)), ((xs - ys), math.sqrt(2))))
    return float(xs.mean() + x0), float(ys.mean() + y0), float(ext)


def candidates(g, bg, ball, d, sgn):
    """Bright blobs in the corridor ahead of the ball: [(x, y, area)] in display px."""
    bx, by = ball
    h, w = g.shape
    x0 = int(max(0, min(bx, bx + sgn * CORRIDOR_D * d)))
    x1 = int(min(w, max(bx, bx + sgn * CORRIDOR_D * d)))
    y0 = int(max(0, by - math.tan(math.radians(UP_DEG)) * CORRIDOR_D * d))
    y1 = int(min(h, by + DOWN_D * d))
    diff = (g[y0:y1, x0:x1] - bg[y0:y1, x0:x1]) > DIFF_MIN
    n, _, stats, cents = cv2.connectedComponentsWithStats(diff.astype(np.uint8), connectivity=8)
    area_ball = math.pi * d * d / 4
    out = []
    for k in range(1, n):
        a = stats[k, cv2.CC_STAT_AREA]
        if not (AREA_RANGE[0] * area_ball <= a <= AREA_RANGE[1] * area_ball):
            continue
        cx, cy = cents[k][0] + x0, cents[k][1] + y0
        ahead = (cx - bx) * sgn
        up = by - cy
        if ahead < 0.5 * d:
            continue
        if up > math.tan(math.radians(UP_DEG)) * ahead + d:
            continue
        out.append((cx, cy, int(a)))
    return out


ORIGIN_D = 1.5  # the flight's line passes this close to the ball at rest (ball diameters)


def through_rest(run, ball, d):
    """Does the line through the run's first and last blob pass within ORIGIN_D of the ball at rest?"""
    (x0, y0), (x1, y1) = run[0][1][:2], run[-1][1][:2]
    L = math.hypot(x1 - x0, y1 - y0)
    if L == 0:
        return False
    return abs((x1 - x0) * (ball[1] - y0) - (y1 - y0) * (ball[0] - x0)) / L <= ORIGIN_D * d


def speed_of(run):
    return math.hypot(run[-1][1][0] - run[0][1][0], run[-1][1][1] - run[0][1][1]) / (run[-1][0] - run[0][0])


MAX_BALL_MS = 94.0  # 210 mph: a faster run is noise
LEAVE_FRAMES = 4  # the flight leaves the ball's spot within this of impact (a pose-timed impact is off by a few frames)


def chain(cands, ball, d, sgn, max_step=float('inf'), impact=None):
    """Of the runs of blobs (one per consecutive frame, a near-constant step) of at least MIN_CHAIN
    whose line passes through the ball at rest, fits a straight line within half a ball and moves
    under `max_step` px a frame and leaves the ball's spot within LEAVE_FRAMES of `impact`, the one
    that covers the most ground (first to last blob): the ball outruns the club and the turf, and a
    fast ball leaves the corridor first, so neither the longest nor the fastest run is it. Ties: the longer."""
    frames = sorted(cands)
    runs = []
    for i, f0 in enumerate(frames):
        for a in cands[f0]:
            for b in cands.get(f0 + 1, []):
                step = (b[0] - a[0], b[1] - a[1])
                if step[0] * sgn < d:  # must move toward the target, at least a ball a frame
                    continue
                if -step[1] < -0.2 * abs(step[0]) or -step[1] > math.tan(math.radians(UP_DEG)) * abs(step[0]):
                    continue
                run = [(f0, a), (f0 + 1, b)]
                f, p = f0 + 1, b
                while f + 1 in cands:
                    pred = (p[0] + step[0], p[1] + step[1])
                    tol = 0.25 * math.hypot(*step) + d
                    near = [c for c in cands[f + 1] if math.hypot(c[0] - pred[0], c[1] - pred[1]) <= tol]
                    if not near:
                        break
                    c = min(near, key=lambda c: math.hypot(c[0] - pred[0], c[1] - pred[1]))
                    step = ((c[0] - run[0][1][0]) / (f + 1 - run[0][0]), (c[1] - run[0][1][1]) / (f + 1 - run[0][0]))
                    run.append((f + 1, c))
                    f, p = f + 1, c
                if len(run) >= MIN_CHAIN and through_rest(run, ball, d):
                    runs.append(run)
    best, best_v = [], 0.0  # best_v: the ground covered
    for run in runs:
        vx, vy, res, _ = fit(run, d)
        v = math.hypot(vx, vy)
        if res > 0.5 * d or v > max_step:
            continue
        if impact is not None:
            # when the line is at the ball's spot (along its direction of travel)
            f0, p0 = run[0]
            t0 = f0 - ((p0[0] - ball[0]) * vx + (p0[1] - ball[1]) * vy) / (v * v)
            if abs(t0 - (impact + 0.5)) > LEAVE_FRAMES:
                continue
        span = math.hypot(run[-1][1][0] - run[0][1][0], run[-1][1][1] - run[0][1][1])
        if not best or span > best_v + 1e-9 or (abs(span - best_v) <= 1e-9 and len(run) > len(best)):
            best, best_v = run, span
    return best


# clubhead: the 3 frames before impact, in a band just above the ground behind the ball
CLUB_FRAMES = 3
CLUB_BAND_UP_D = 4.0     # the head stays within this many ball diameters of the ground near impact
CLUB_BAND_DOWN_D = 1.0
CLUB_BEHIND_D = 25       # how far behind the ball (away from the target) the head is looked for
MOVE_MIN = 30            # grey change from the previous frame: the head is moving fast
CLUB_MIN_AREA = 0.15     # the head blob's area / the ball's, at least


def club_edge(g, prev, bg, ball, d, sgn):
    """The leading x (toward the target) of the largest moving, brighter-than-background blob in the
    band behind the ball; None when none."""
    bx, by = ball
    h, w = g.shape
    x0 = int(max(0, min(bx + sgn * d, bx - sgn * CLUB_BEHIND_D * d)))
    x1 = int(min(w, max(bx + sgn * d, bx - sgn * CLUB_BEHIND_D * d)))
    y0 = int(max(0, by - CLUB_BAND_UP_D * d))
    y1 = int(min(h, by + CLUB_BAND_DOWN_D * d))
    sl = (slice(y0, y1), slice(x0, x1))
    m = ((np.abs(g[sl] - prev[sl]) > MOVE_MIN) & (g[sl] - bg[sl] > DIFF_MIN)).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    if n < 2:
        return None
    k = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    if stats[k, cv2.CC_STAT_AREA] < CLUB_MIN_AREA * math.pi * d * d / 4:
        return None
    ys, xs = np.nonzero(lab == k)
    i = int(np.argmax(xs * sgn))
    return float(xs[i] + x0), float(ys[i] + y0)


def contact_frame(run, ball, impact):
    """The impact the flight says: the frame nearest the moment its line is at the ball's spot (the
    last one with the ball on it, as ballGoneFrame - 1; a pose-timed impact is off by a few frames
    and the club fit needs the exact one), within LEAVE_FRAMES of `impact`; `impact` without a flight."""
    if len(run) < MIN_CHAIN:
        return impact
    f = np.array([r[0] for r in run], float)
    vx, x0 = np.polyfit(f, [r[1][0] for r in run], 1)
    vy, y0 = np.polyfit(f, [r[1][1] for r in run], 1)
    t0 = ((ball[0] - x0) * vx + (ball[1] - y0) * vy) / (vx * vx + vy * vy)
    return int(min(max(round(t0), impact - LEAVE_FRAMES), impact + LEAVE_FRAMES))


def club_speed(cap, impact, bg, ball, d, sgn):
    pts = []
    for f in range(impact - CLUB_FRAMES, impact):
        g, prev = grey(cap, f), grey(cap, f - 1)
        e = club_edge(g, prev, bg, ball, d, sgn)
        if e is not None:
            pts.append((f, e))
    if len(pts) < 2:
        return None, pts
    f = np.array([p[0] for p in pts], float)
    x = np.array([p[1][0] for p in pts], float)
    y = np.array([p[1][1] for p in pts], float)
    vx, vy = np.polyfit(f, x, 1)[0], np.polyfit(f, y, 1)[0]
    return (math.hypot(vx, vy) if vx * sgn > 0 else None), pts


def fit(run, d):
    """Least-squares line x(f), y(f); the worst point is dropped while it sits more than half a ball
    off the line and MIN_CHAIN would remain (the first blob after contact can merge with the club).
    (vx, vy, max residual, points kept), sample units."""
    pts = list(run)
    while True:
        f = np.array([r[0] for r in pts], float)
        x = np.array([r[1][0] for r in pts], float)
        y = np.array([r[1][1] for r in pts], float)
        vx, x0 = np.polyfit(f, x, 1)
        vy, y0 = np.polyfit(f, y, 1)
        res = np.hypot(x - (vx * f + x0), y - (vy * f + y0))
        k = int(np.argmax(res))
        if res[k] <= 0.5 * d or len(pts) <= MIN_CHAIN:
            return vx, vy, float(res[k]), len(pts)
        pts.pop(k)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('clip')
    ap.add_argument('--impact', type=int, required=True)
    ap.add_argument('--top', type=int, required=True)
    ap.add_argument('--ball', required=True, help='X,Y,D display px')
    ap.add_argument('--fps', type=float, required=True)
    ap.add_argument('--dir', type=int, default=1, help='+1 target to the right of the picture')
    ap.add_argument('--sheet')
    ap.add_argument('--step', type=int, default=1)
    a = ap.parse_args()
    global STEP
    STEP = a.step
    bx, by, d = map(float, a.ball.split(','))
    cap = cv2.VideoCapture(a.clip)
    full = np.median(np.stack([grey(cap, f, 1) for f in range(a.top - 6, a.top + 7, 2)]), axis=0).astype(np.int16)
    meas = diameter(full, (bx, by), d)
    if meas:
        bx, by, d = meas
    bg = full[::STEP, ::STEP]
    D_FULL = d
    bx, by, d = bx / STEP, by / STEP, d / STEP  # sample units from here on
    cands = {}
    for f in range(a.impact + 1 - LEAVE_FRAMES, a.impact + 1 + FLIGHT_FRAMES):
        g = grey(cap, f)
        if g is not None:
            cands[f] = candidates(g, bg, (bx, by), d, a.dir)
    max_step = MAX_BALL_MS * 100 * (D_FULL / BALL_CM) / a.fps / STEP  # samples a frame
    run = chain(cands, (bx, by), d, a.dir, max_step, a.impact)
    out = {'ball': [round(bx * STEP, 1), round(by * STEP, 1), round(D_FULL, 2)], 'candidates': {f: len(c) for f, c in cands.items()}, 'chain': [(f, round(p[0], 1), round(p[1], 1)) for f, p in run]}
    if len(run) >= MIN_CHAIN:
        vx, vy, res, kept = fit(run, d)
        vx, vy, res = vx * STEP, vy * STEP, res * STEP
        out['kept'] = kept
        px_per_cm = D_FULL / BALL_CM
        v = math.hypot(vx, vy) * a.fps / px_per_cm / 100
        out.update(pxPerFrame=round(math.hypot(vx, vy), 1), residualPx=round(res, 1), ballMs=round(v, 1),
                   ballMph=round(v * 2.23694), launchDeg=round(math.degrees(math.atan2(-vy, vx * a.dir)), 1))
    contact = contact_frame(run, (bx, by), a.impact)
    out['contact'] = contact
    vx, pts = club_speed(cap, contact, bg, (bx, by), d, a.dir)
    out['club'] = [(f, round(p[0]), round(p[1])) for f, p in pts]
    if vx and vx > 0:
        vx *= STEP
        v = vx * a.fps / (D_FULL / BALL_CM) / 100
        out.update(clubPxPerFrame=round(vx, 1), clubMs=round(v, 1), clubMph=round(v * 2.23694))
        if out.get('ballMs'):
            out['smash'] = round(out['ballMs'] / v, 2)
    print(json.dumps(out))
    bx, by, d = bx * STEP, by * STEP, D_FULL
    run = [(f, (p[0] * STEP, p[1] * STEP, p[2])) for f, p in run]
    if a.sheet:
        tiles = []
        for f in range(a.impact, a.impact + 1 + FLIGHT_FRAMES):
            cap.set(cv2.CAP_PROP_POS_FRAMES, f)
            ok, img = cap.read()
            if not ok:
                break
            for rf, p in run:
                if rf == f:
                    cv2.circle(img, (int(p[0]), int(p[1])), int(d), (0, 0, 255), 2)
            x0 = int(max(0, bx - 4 * d if a.dir > 0 else bx - CORRIDOR_D * d))
            x1 = int(min(img.shape[1], bx + CORRIDOR_D * d if a.dir > 0 else bx + 4 * d))
            y0 = int(max(0, by - 20 * d))
            y1 = int(min(img.shape[0], by + 4 * d))
            c = img[y0:y1, x0:x1].copy()
            cv2.putText(c, str(f), (4, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
            tiles.append(c)
        cv2.imwrite(a.sheet, np.vstack(tiles))


if __name__ == '__main__':
    main()
