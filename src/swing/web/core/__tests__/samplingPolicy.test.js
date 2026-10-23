// Port of SamplingPolicyTest.kt.

import { pt } from '../geom';
import { SamplingPolicy } from '../samplingPolicy';

const { Zone, Event, Obs } = SamplingPolicy;
const bodyH = 400;

/** Deterministic ±0.6 px jitter around a point. */
const jitter = (i) => 0.6 * Math.sin(i * 2.3);

const obs = (i, gx, gy) => new Obs(i, pt(gx + jitter(i), gy + jitter(i + 7)), pt(200 + jitter(i + 3), 100 + jitter(i + 5)), bodyH);

/** Drives the policy like the analyzer: only wanted frames are observed; back-fill is the caller's job. */
function run(p, frames, grip) {
  const events = [];
  for (let i = 0; i < frames; i += 1) {
    if (!p.wants(i)) continue;
    const [x, y] = grip(i);
    const e = p.observe(obs(i, x, y));
    if (e !== Event.None) events.push([i, e]);
  }
  return events;
}

/** Still until 400, backswing up 150 px by 480, downswing to 560, follow-through up, still from 650. */
function swing(i) {
  if (i < 400) return [300, 600];
  if (i < 480) return [300 - (i - 400) * 0.3, 600 - ((i - 400) * 150) / 80];
  if (i < 560) return [276 + (i - 480) * 0.3, 450 + ((i - 480) * 150) / 80];
  if (i < 650) return [300 - (i - 560) * 0.5, 600 - ((i - 560) * 200) / 90];
  return [255, 400];
}

const first = (events, type) => events.find(([, e]) => e.type === type);
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);

describe('SamplingPolicy', () => {
  it('goes sparse, then every fourth, then dense from the top, then every second, then sparse', () => {
    const p = new SamplingPolicy(240.0);
    const events = run(p, 1000, swing);
    const trigger = first(events, 'Trigger');
    // trigger within one 16-stride of motion start
    expect(trigger[0]).toBeGreaterThanOrEqual(400);
    expect(trigger[0]).toBeLessThanOrEqual(416);
    expect(trigger[1].from).toBe(trigger[0] - 12);
    const top = first(events, 'Top');
    // the grip turns at 480; seen once it is 3σ√2 below its top, on the 4-stride
    expect(top[0]).toBeGreaterThanOrEqual(481);
    expect(top[0]).toBeLessThanOrEqual(492);
    expect(top[1].from).toBe(top[0] - 20);
    const impact = first(events, 'Impact')[1];
    expect(impact.frame).toBeGreaterThanOrEqual(555);
    expect(impact.frame).toBeLessThanOrEqual(565);
    const done = first(events, 'Done')[0];
    expect(done).toBeGreaterThanOrEqual(650);
    expect(done).toBeLessThanOrEqual(720);
    expect(p.zone).toBe(Zone.DONE);
    expect(events.map(([, e]) => e.type)).toEqual(['Trigger', 'Top', 'Impact', 'Done']);
  });

  it('keeps the stride of each zone', () => {
    const p = new SamplingPolicy(240.0);
    const seen = [];
    let done = -1;
    for (let i = 0; i < 1000; i += 1) {
      if (!p.wants(i)) continue;
      seen.push(i);
      const [x, y] = swing(i);
      if (p.observe(obs(i, x, y)).type === 'Done') done = i;
    }
    const gaps = (a, b) => {
      const s = seen.filter((f) => f >= a && f <= b);
      const out = new Set();
      for (let k = 0; k + 1 < s.length; k += 1) out.add(s[k + 1] - s[k]);
      return [...out].sort((u, v) => u - v);
    };
    const impact = p.impactFrame;
    expect(done).toBeGreaterThan(impact);
    expect(gaps(0, p.triggerFrame)).toEqual([16]);
    expect(gaps(p.triggerFrame, p.topSeenFrame)).toEqual([4]);
    expect(gaps(p.topSeenFrame, impact + 6)).toEqual([1]);
    expect(gaps(impact + 6, done)).toEqual([2]);
    expect(gaps(done, 999)).toEqual([16]);
    // the back-fills (trigger: 3 frames, top: 19) come on top of these
    expect(seen.length).toBeGreaterThanOrEqual(150);
    expect(seen.length).toBeLessThanOrEqual(230);
  });

  it('wants frames by the zone', () => {
    const p = new SamplingPolicy(240.0);
    expect(p.wants(0)).toBe(true);
    expect(p.wants(8)).toBe(false);
    expect(p.wants(16)).toBe(true);
    run(p, 450, swing);
    expect(p.zone).toBe(Zone.BACKSWING);
    const t = p.triggerFrame;
    expect(p.wants(t + 52)).toBe(true);
    expect(p.wants(t + 53)).toBe(false);
    run(p, 500, swing);
    expect(p.zone).toBe(Zone.DOWNSWING);
    expect(range(501, 520).every((f) => p.wants(f))).toBe(true);
  });

  it('falls back to sparse after a waggle without rise', () => {
    const p = new SamplingPolicy(240.0);
    // a 12 px forward press at 300, then still again
    const events = run(p, 500, (i) => (i < 300 ? [300, 600] : [288, 600]));
    expect(events.some(([, e]) => e.type === 'Trigger')).toBe(true);
    expect(events.some(([, e]) => e.type === 'Reset')).toBe(true);
    expect(p.zone).toBe(Zone.STILL);
  });

  it('does not trigger on a slow drift at address', () => {
    const p = new SamplingPolicy(240.0);
    // 5 px over the first 120 frames, like the lab clip's address
    const events = run(p, 390, (i) => [300 + (5 * Math.min(i, 120)) / 120, 600]);
    expect(events).toEqual([]);
  });

  it('caps the dense zone at three seconds without an impact', () => {
    const p = new SamplingPolicy(240.0);
    // backswing to the top at 480, then the hands stay up for good (no downswing)
    const events = run(p, 2000, (i) => (i < 400 ? [300, 600] : [300, 600 - (Math.min(i - 400, 80) * 150) / 80]));
    const trigger = first(events, 'Trigger')[0];
    const capped = first(events, 'DenseCapped')[0];
    // first 4-stride sample more than 3 s (720 frames) after the trigger
    expect(capped).toBe(trigger + 724);
    expect(p.impactFrame).toBe(-1);
    expect(events.some(([, e]) => e.type === 'Impact' || e.type === 'Top')).toBe(false);
    expect([Zone.FOLLOW, Zone.DONE]).toContain(p.zone);
  });
});
