#!/usr/bin/env python3
"""Swing lab: find the swings inside a clip from its dense pose (face-on plan 2026-10-30, S0).

Web clips often hold a swing twice (real time, then a slow-motion replay) or start mid-swing, and
the d15 phases then lock onto the wrong copy. This lists every swing it finds in
out/<clip>/.pose-full-dense.json (written by `detect.py <clip> --variant d15 --dense`): the wrists'
height, in body heights above the ankles, goes from low (address) up past the head (top) and back down
(impact). For each swing it prints the frames of the still address, the top and the impact, how many
frames the downswing takes (a slow-motion copy has many more) and whether the address was held still.

Usage: ~/.venvs/swing-lab/bin/python -I swing_segments.py [--lab DIR] [clip ...]   (default: every web-* clip;
--lab: the lab directory holding out/, when this script runs from another checkout)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

LAB = Path(__file__).resolve().parent
NOSE, L_WR, R_WR, L_ANK, R_ANK = 0, 15, 16, 27, 28
TOP_ABOVE_NOSE = 0.0  # a top has the wrists at least at nose height
LOW_ABOVE = 0.1  # body heights over the clip's lowest hands (address / impact level): still 'low'


def series(clip: str):
    data = json.loads((LAB / 'out' / clip / '.pose-full-dense.json').read_text())
    frames = sorted(int(k) for k in data['samples'])
    out = []
    for f in frames:
        lm = data['samples'][str(f)]
        if not lm:
            out.append((f, None, None))
            continue
        ank = (lm[L_ANK][1] + lm[R_ANK][1]) / 2
        h = max(ank - lm[NOSE][1], 1.0)
        wr = (lm[L_WR][1] + lm[R_WR][1]) / 2
        out.append((f, (ank - wr) / h, (lm[NOSE][1] - wr) / h))  # wrists above ankles, above nose
    return out


def smooth(v, w=2):
    out = []
    for i in range(len(v)):
        win = [x for x in v[max(0, i - w):i + w + 1] if x is not None]
        out.append(sum(win) / len(win) if win else None)
    return out


def swings(clip: str):
    s = series(clip)
    fr = [f for f, _, _ in s]
    up = smooth([u for _, u, _ in s])
    nose = smooth([n for _, _, n in s])
    known = sorted(u for u in up if u is not None)
    LOW = known[len(known) // 20] + LOW_ABOVE  # the 5th percentile: where the hands sit at address
    found = []
    i = 0
    n = len(fr)
    while i < n:
        # a top: wrists above the nose, the highest point of that run
        if nose[i] is not None and nose[i] > TOP_ABOVE_NOSE:
            j = i
            while j < n and nose[j] is not None and nose[j] > TOP_ABOVE_NOSE:
                j += 1
            top = max(range(i, j), key=lambda k: up[k] if up[k] is not None else -9)
            # back to the address: the last low, still stretch before the top
            k = top
            while k > 0 and (up[k] is None or up[k] > LOW):
                k -= 1
            a_end = k
            still = 0  # frames the hands stay at the address level before the backswing
            while k > 0 and up[k - 1] is not None and up[k - 1] <= LOW:
                still += 1
                k -= 1
            # forward to impact: the first low point after the top, the lowest of that dip
            m = top
            while m < n - 1 and (up[m] is None or up[m] > LOW):
                m += 1
            imp = m
            while imp < n - 1 and up[imp + 1] is not None and up[imp + 1] <= up[imp]:
                imp += 1
            # a real swing comes back down to the address level; the finish's rise does not
            if a_end < top < imp and up[imp] is not None and up[imp] <= LOW:
                found.append({'address': fr[a_end], 'stillFrames': still, 'top': fr[top], 'impact': fr[imp],
                              'backswing': fr[top] - fr[a_end], 'downswing': fr[imp] - fr[top]})
            i = max(j, imp)
        else:
            i += 1
    return found, fr[0], fr[-1]


def main():
    global LAB
    args = sys.argv[1:]
    if args[:1] == ['--lab']:
        LAB = Path(args[1])
        args = args[2:]
    clips = args or sorted(p.name for p in (LAB / 'out').glob('web-*') if (p / '.pose-full-dense.json').exists())
    for c in clips:
        try:
            sw, f0, f1 = swings(c)
            auto = json.loads((LAB / 'out' / c / 'auto-d15-dense.json').read_text())
        except FileNotFoundError:
            print(f'{c}: no dense pose / detect.py output')
            continue
        cp = {k: v['frame'] for k, v in auto['checkpoints'].items()}
        print(f"{c}  frames {f0}-{f1}  d15: address {cp.get('address')} top {cp.get('top')} impact {cp.get('impact')}  fps {auto['video'].get('captureFps')}/{auto['video'].get('slowmoFactor')}")
        for k, w in enumerate(sw):
            print(f"   swing {k + 1}: address {w['address']} (still {w['stillFrames']}f) top {w['top']} impact {w['impact']}  back {w['backswing']}f down {w['downswing']}f")


if __name__ == '__main__':
    main()
