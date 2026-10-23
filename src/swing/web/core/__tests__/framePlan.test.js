// Ports of modules/golf-swing StillsTest.kt, ProxiesTest.kt and ClubWarmTest.kt.

import {
  FramePlan, Lru, Proxies, ClubWarm, SampleTable,
} from '../framePlan';

describe('FramePlan (StillsTest)', () => {
  // a 240 fps clip with a sync sample every 1 s
  const syncs = [0, 1000000, 2000000, 3000000];

  test('a fresh decoder seeks to the sync before the target', () => {
    expect(FramePlan.seekFor(1500000, FramePlan.NONE, syncs)).toBe(1000000);
    expect(FramePlan.seekFor(10000, FramePlan.NONE, syncs)).toBe(0);
  });

  test('a target ahead with no keyframe between decodes on', () => {
    expect(FramePlan.seekFor(1600000, 1500000, syncs)).toBeNull();
    expect(FramePlan.seekFor(1999999, 1000000, syncs)).toBeNull(); // the sync AT lastOut is behind us
  });

  test('a keyframe between or a target behind seeks', () => {
    expect(FramePlan.seekFor(2100000, 1500000, syncs)).toBe(2000000); // skip 1.5 → 2.0 s
    expect(FramePlan.seekFor(1400000, 1500000, syncs)).toBe(1000000); // behind: back to its sync
    expect(FramePlan.seekFor(1500000, 1500000, syncs)).toBe(1000000); // the frame itself was passed
    expect(FramePlan.seekFor(3100000, FramePlan.AT_END, syncs)).toBe(3000000); // after the end of stream
  });

  test('lastAtOrBefore is a binary search', () => {
    expect(FramePlan.lastAtOrBefore(syncs, -1)).toBeNull();
    expect(FramePlan.lastAtOrBefore(syncs, 0)).toBe(0);
    expect(FramePlan.lastAtOrBefore(syncs, 2999999)).toBe(2000000);
    expect(FramePlan.lastAtOrBefore(syncs, Number.MAX_SAFE_INTEGER - 1)).toBe(3000000);
    expect(FramePlan.lastAtOrBefore([], 5)).toBeNull();
  });

  test('the sample tables keep the last few clips', () => {
    const made = [];
    const lru = new Lru(2);
    const get = (k) => lru.getOrPut(k, () => { made.push(k); return k.length; });
    get('a'); get('b'); get('a'); get('c'); // b is the least recently used
    expect(lru.keys).toEqual(new Set(['a', 'c']));
    get('a');
    expect(made).toEqual(['a', 'b', 'c']); // a was never re-read
  });

  test('a sample table maps each presentation time to its frame', () => {
    const t = new SampleTable([0, 4167, 8333], [0], 90);
    expect(t.frameOf.get(8333)).toBe(2);
    expect(t.rotation).toBe(90);
  });
});

describe('Proxies', () => {
  test('every fourth frame of the whole clip', () => {
    const f = Proxies.frames(960, 4);
    expect(f.length).toBe(240);
    expect(f.slice(0, 3)).toEqual([0, 4, 8]);
    expect(f[f.length - 1]).toBe(956);
    expect(Proxies.frames(9, 4)).toEqual([0, 4, 8]); // a partial last step still gets its frame
  });

  test('only the swing window, aligned to every', () => {
    expect(Proxies.frames(960, 4, [99, 110])).toEqual([100, 104, 108]);
    expect(Proxies.frames(960, 4, [950, 2000])).toEqual([952, 956]); // clamped to the clip
    expect(Proxies.frames(960, 4, [-50, 6])).toEqual([0, 4]);
    expect(Proxies.frames(960, 4, [500, 400])).toEqual([]);
  });

  test('every second frame inside the window', () => {
    // apiVersion 6: the JS asks for every 2nd frame (frames.js proxyEvery)
    expect(Proxies.frames(960, 2, [99, 110])).toEqual([100, 102, 104, 106, 108, 110]);
  });

  test('no proxies when off', () => {
    expect(Proxies.frames(960, 0)).toEqual([]);
    expect(Proxies.frames(0, 4)).toEqual([]);
  });

  test('the short side is 240 and the aspect is kept', () => {
    expect(Proxies.size(1080, 1920)).toEqual([240, 427]); // portrait 9:16
    expect(Proxies.size(720, 960)).toEqual([240, 320]); // the mock's 3:4
    expect(Proxies.size(1920, 1080)).toEqual([427, 240]); // landscape
    expect(Proxies.size(120, 200)).toEqual([120, 200]); // never upscaled
  });
});

describe('ClubWarm', () => {
  class Thing {
    constructor(id) {
      this.id = id;
      this.closed = false;
    }

    close() { this.closed = true; }
  }

  /** A manual clock: advance runs every task due, like the club executor would. */
  class FakeScheduler {
    constructor() {
      this.now = 0;
      this.pending = [];
      this.cancels = 0;
    }

    schedule(delayMs, task) {
      const e = [this.now + delayMs, task];
      this.pending.push(e);
      return () => {
        const i = this.pending.indexOf(e);
        if (i >= 0) {
          this.pending.splice(i, 1);
          this.cancels += 1;
        }
      };
    }

    advance(ms) {
      this.now += ms;
      const due = this.pending.filter((e) => e[0] <= this.now);
      this.pending = this.pending.filter((e) => !due.includes(e));
      due.forEach((e) => e[1]());
    }
  }

  let opened;
  let sched;
  let warm;
  beforeEach(() => {
    opened = [];
    sched = new FakeScheduler();
    warm = new ClubWarm(() => { const t = new Thing(opened.length); opened.push(t); return t; }, sched, 60000);
  });

  test('opens once across three uses and only the first is cold', () => {
    const seen = [0, 1, 2].map(() => warm.use((t, w) => [t.id, w]));
    expect(seen).toEqual([[0, false], [0, true], [0, true]]);
    expect(opened.length).toBe(1);
    expect(warm.isOpen).toBe(true);
  });

  test('every use re-arms the idle close', () => {
    warm.use(() => {});
    sched.advance(50000);
    warm.use(() => {});
    expect(sched.pending.length).toBe(1); // the first timer was cancelled, not stacked
    sched.advance(50000); // 100 s after the first use, 50 s after the last: still open
    expect(warm.isOpen).toBe(true);
    expect(opened[0].closed).toBe(false);
    sched.advance(10000);
    expect(warm.isOpen).toBe(false);
    expect(opened[0].closed).toBe(true);
  });

  test('release closes now and cancels the timer', () => {
    warm.use(() => {});
    warm.release();
    expect(warm.isOpen).toBe(false);
    expect(opened[0].closed).toBe(true);
    expect(sched.pending).toEqual([]);
    warm.release(); // a second release is a no-op
    expect(opened.length).toBe(1);
  });

  test('reopens after an idle close or a release', () => {
    warm.use(() => {});
    sched.advance(60000);
    expect(warm.use((t, w) => [t.id, w])).toEqual([1, false]);
    warm.release();
    expect(warm.use((t, w) => [t.id, w])).toEqual([2, false]);
    expect(opened.map((t) => t.closed)).toEqual([true, true, false]);
  });

  test('a stale idle task does not close the current instance', () => {
    // a scheduler whose cancel cannot stop a task already handed to the thread
    const late = [];
    const w = new ClubWarm(() => { const t = new Thing(opened.length); opened.push(t); return t; }, { schedule: (_, task) => { late.push(task); return () => {}; } }, 1);
    w.use(() => {});
    w.use(() => {});
    late[0](); // the first use's timer fires after the second use re-armed
    expect(w.isOpen).toBe(true);
    late[1]();
    expect(w.isOpen).toBe(false);
  });

  test('a failed open leaves nothing open and a failed block still arms the timer', () => {
    let fail = true;
    const w = new ClubWarm(() => {
      if (fail) throw new Error('no runtime');
      const t = new Thing(opened.length);
      opened.push(t);
      return t;
    }, sched, 1000);
    expect(() => w.use(() => {})).toThrow('no runtime');
    expect(w.isOpen).toBe(false);
    expect(sched.pending).toEqual([]);
    fail = false;
    expect(() => w.use(() => { throw new Error('frame'); })).toThrow('frame');
    expect(w.isOpen).toBe(true);
    sched.advance(1000);
    expect(w.isOpen).toBe(false);
  });

  // JS only: the browser opens the detector asynchronously and runs it asynchronously
  test('an async open and block open once and re-arm after the block settles', async () => {
    const w = new ClubWarm(async () => { const t = new Thing(opened.length); opened.push(t); return t; }, sched, 1000);
    const [a, b] = await Promise.all([w.use(async (t, wm) => [t.id, wm]), w.use(async (t, wm) => [t.id, wm])]);
    expect(a).toEqual([0, false]);
    expect(b[0]).toBe(0);
    expect(opened.length).toBe(1);
    expect(sched.pending.length).toBeGreaterThan(0);
    expect(await w.use(async (t, wm) => wm)).toBe(true);
    sched.advance(1000);
    expect(w.isOpen).toBe(false);
  });
});
