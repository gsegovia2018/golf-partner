// Pure decisions of the warm decoder and the scrub proxies, ported from modules/golf-swing
// Stills.kt (FramePlan, SampleTable, Lru), Proxies.kt and ClubWarm.kt.

/** Pure decisions of the warm decoder. Times are presentation µs (JS numbers). */
export const FramePlan = {
  /** No output decoded since the last (re)start or seek (Kotlin Long.MIN_VALUE). */
  NONE: -Infinity,
  /** The decoder reached the end of the stream: any further target needs a seek (Kotlin Long.MAX_VALUE). */
  AT_END: Infinity,

  /**
   * Where to seek before decoding up to `target` (presentation µs), or null to go on decoding
   * forward from `lastOut` (the last output's time, NONE or AT_END). Forward is free while no
   * sync sample lies in (lastOut, target]; past one, seeking to it skips the frames in between; a
   * target at or before lastOut needs the sync at or before it.
   */
  seekFor(target, lastOut, syncs) {
    const sync = FramePlan.lastAtOrBefore(syncs, target) ?? (syncs.length ? syncs[0] : null);
    if (sync == null) return null;
    if (lastOut === FramePlan.NONE || lastOut === FramePlan.AT_END || target <= lastOut) return sync;
    return sync > lastOut ? sync : null;
  },

  /** The greatest element of the sorted `a` that is ≤ `t`, or null. */
  lastAtOrBefore(a, t) {
    let lo = 0;
    let hi = a.length - 1;
    let best = null;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (a[mid] <= t) {
        best = a[mid];
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  },
};

/**
 * A clip's sample table: presentation times in frame order, sync-sample times, display rotation
 * (the pure part of Stills.kt's SampleTable; reading it from a file is the caller's).
 */
export class SampleTable {
  constructor(pts, syncs, rotation) {
    this.pts = pts;
    this.syncs = syncs;
    this.rotation = rotation;
    /** The frame index of each presentation time. */
    this.frameOf = new Map();
    for (let i = 0; i < pts.length; i += 1) this.frameOf.set(pts[i], i);
  }
}

/** A small least-recently-used map (access order): the sample tables of the last few clips. */
export class Lru {
  constructor(max) {
    this.max = max;
    this.map = new Map();
  }

  getOrPut(key, make) {
    if (this.map.has(key)) {
      const v = this.map.get(key);
      // access order: a hit moves to the most recent end
      this.map.delete(key);
      this.map.set(key, v);
      if (v != null) return v;
    }
    const v = make();
    this.map.set(key, v);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
    return v;
  }

  get keys() { return new Set(this.map.keys()); }
}

/**
 * Low-resolution scrub proxies (plan D28): every `every`-th frame of the whole clip as a small
 * JPEG. The marking canvas shows the nearest one under the finger while the golfer drags the
 * whole-clip track, and swaps in the full-resolution still on release.
 */
export const Proxies = {
  /** The short side of a proxy, px (a 9:16 portrait clip gives 240 × 427; 160 up to apiVersion 5). */
  SHORT_SIDE: 240,
  JPEG_QUALITY: 70,

  /**
   * The proxy frames of a clip of `n` frames: the multiples of `every` inside `range` ([first,
   * last], inclusive; clamped to the clip; null = the whole clip), so the JS finds one by rounding
   * to `every`. None when `every` < 1.
   */
  frames(n, every, range = null) {
    if (every < 1 || n < 1) return [];
    const clamp = (v) => Math.min(Math.max(v, 0), n - 1);
    const lo = clamp(range ? range[0] : 0);
    const hi = clamp(range ? range[1] : n - 1);
    if (lo > hi) return [];
    const first = Math.trunc((lo + every - 1) / every) * every;
    const out = [];
    for (let f = first; f <= hi; f += every) out.push(f);
    return out;
  },

  /** Proxy size [w, h] for a display-oriented frame, short side SHORT_SIDE, never larger than the frame. */
  size(dispW, dispH) {
    const s = Math.min(1, Proxies.SHORT_SIDE / Math.max(1, Math.min(dispW, dispH)));
    // Kotlin roundToInt: ties toward +∞, like Math.round
    return [Math.max(1, Math.round(dispW * s)), Math.max(1, Math.round(dispH * s))];
  },
};

const isThenable = (v) => v != null && typeof v.then === 'function';

/**
 * A warm instance (the club detector of detectClub, plan 2026-10-16 on demand §3.1; the warm
 * frame decoder): opened on the first `use`, reused afterwards, closed `idleMs` after the last
 * call, on `release`. `open()` returns the instance (with a `close()`), or a promise of it.
 * `scheduler.schedule(delayMs, task)` runs `task` once after `delayMs` and returns a function
 * that cancels it if it has not run yet.
 */
export class ClubWarm {
  static IDLE_MS = 60000;

  constructor(open, scheduler, idleMs = ClubWarm.IDLE_MS) {
    this.open = open;
    this.scheduler = scheduler;
    this.idleMs = idleMs;
    this.instance = null;
    this.opening = null;
    this.cancelIdle = null;
    /** Bumped on every arm / release: an idle task that fires late for an older generation does nothing. */
    this.generation = 0;
  }

  get isOpen() { return this.instance != null; }

  /** The open instance, or null (it stays open: no idle re-arm). */
  get current() { return this.instance; }

  /**
   * `block(instance, warm)` with the instance (opened now when none: an `open` failure propagates
   * and leaves nothing open) and whether it was already open; the idle close is re-armed
   * afterwards, also when `block` throws. Synchronous when `open` and `block` are; a promise
   * otherwise (the re-arm then waits for it to settle).
   */
  use(block) {
    this.disarm();
    if (this.instance != null) return this.run(this.instance, true, block);
    if (this.opening == null) {
      const o = this.open();
      if (!isThenable(o)) {
        this.instance = o;
        return this.run(o, false, block);
      }
      this.opening = Promise.resolve(o).then(
        (d) => { this.opening = null; this.instance = d; return d; },
        (e) => { this.opening = null; throw e; },
      );
      return this.opening.then((d) => this.run(d, false, block));
    }
    // a use while another opens: it waited for the open, so it is not warm
    return this.opening.then((d) => this.run(d, false, block));
  }

  run(d, warm, block) {
    let r;
    try {
      r = block(d, warm);
    } catch (e) {
      this.arm();
      throw e;
    }
    if (isThenable(r)) {
      return Promise.resolve(r).finally(() => this.arm());
    }
    this.arm();
    return r;
  }

  /** Closes the instance now (a no-op when none is open). */
  release() {
    this.disarm();
    const d = this.instance;
    if (d == null) return;
    this.instance = null;
    try {
      d.close();
    } catch {
      // a failing close leaves nothing to do
    }
  }

  arm() {
    const g = ++this.generation;
    this.cancelIdle = this.scheduler.schedule(this.idleMs, () => { if (g === this.generation) this.release(); });
  }

  disarm() {
    this.generation += 1;
    this.cancelIdle?.();
    this.cancelIdle = null;
  }
}

/** The browser's scheduler for ClubWarm: setTimeout / clearTimeout. */
export const timeoutScheduler = {
  schedule(delayMs, task) {
    const id = setTimeout(task, delayMs);
    return () => clearTimeout(id);
  },
};
