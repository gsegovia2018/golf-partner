// Ported from modules/golf-swing Probe.kt (the pure parts; `run` is the platform's container scan).

import { Stats } from './geom';

const WINDOW = 60;

export const Probe = {
  meanAbsDiff(a, b) {
    let s = 0.0;
    for (let i = 0; i < a.length; i += 1) s += Math.abs(a[i] - b[i]);
    return s / a.length;
  },

  /**
   * detect.py `duplicate_frame_ratio`: in the 60-frame window with the most motion, the share
   * of consecutive-frame differences below 25 % of that window's median. A still scene
   * (median < 0.5 grey levels) is undecidable and reported as 0 (real).
   */
  duplicateRatio(diffs) {
    if (diffs.length < WINDOW) return 0.0;
    let best = 0;
    let bestSum = -1.0;
    let sum = 0.0;
    for (let i = 0; i < diffs.length; i += 1) {
      sum += diffs[i];
      if (i >= WINDOW) sum -= diffs[i - WINDOW];
      if (i >= WINDOW - 1 && sum > bestSum) {
        bestSum = sum;
        best = i - WINDOW + 1;
      }
    }
    const win = Array.prototype.slice.call(diffs, best, best + WINDOW);
    const med = Stats.median(win);
    if (med < 0.5) return 0.0;
    return win.filter((d) => d < 0.25 * med).length / WINDOW;
  },
};
