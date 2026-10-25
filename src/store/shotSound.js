// How sure we are that a detected stop (store/shotDetection) was my shot,
// from what the phone heard and felt there (lib/shotSense events):
//
//   'shot'  a strike while I stood there, and my phone swung with it;
//   'heard' a strike, but my phone stayed still (often a partner hitting);
//   'quiet' the phone was listening the whole stop and heard no strike;
//   null    no sound data for that time (listening off, older APK, web).
//
// The level only ranks proposals on the map; nothing is added or hidden by it.
// shortcut: the windows and motion thresholds are uncalibrated; the exported
// rounds (store/shotSoundExport) are what will tune them.
// Pure (scripts/analyzeShotSound.mjs imports it); store/shotSoundStore caches
// a round's events for the scorecard.
// Plan: docs/superpowers/plans/2026-10-25-shot-sound-confidence.md

// A stop ends when I have walked out of it, so the shot is inside it; a little
// slack either side for the clocks and a swing right as I arrive.
export const STRIKE_BEFORE_MS = 5000;
export const STRIKE_AFTER_MS = 10000;
// My own swing: the gyroscope (rad/s) or, on a phone without one, the
// accelerometer (m/s² from 1 g) around the strike.
export const OWN_GYRO_MIN = 3;
export const OWN_ACC_MIN = 8;

export const isOwnStrike = (s) => (s.gyroPeak ?? 0) >= OWN_GYRO_MIN || (s.accPeak ?? 0) >= OWN_ACC_MIN;

// When the phone was listening: from each 'start' to its 'stop', or to the
// last event before the next start (the process was killed: we only know it
// was alive until then).
export function listeningSpans(events) {
  const spans = [];
  let open = null;
  for (const e of events ?? []) {
    if (e.type === 'start') {
      if (open) spans.push(open);
      open = { from: e.t, to: e.t };
    } else if (open) {
      open.to = Math.max(open.to, e.t);
      if (e.type === 'stop') { spans.push(open); open = null; }
    }
  }
  if (open) spans.push(open);
  return spans;
}

// The parts of a session's events the levels need.
export function soundIndex(events) {
  const list = events ?? [];
  return { strikes: list.filter((e) => e.type === 'strike'), spans: listeningSpans(list) };
}

export function soundLevel(stop, index) {
  if (!stop || !index) return null;
  const from = stop.start - STRIKE_BEFORE_MS;
  const to = stop.end + STRIKE_AFTER_MS;
  const hits = index.strikes.filter((s) => s.t >= from && s.t <= to);
  if (hits.some(isOwnStrike)) return 'shot';
  if (hits.length) return 'heard';
  return index.spans.some((sp) => sp.from <= stop.start && sp.to >= stop.end) ? 'quiet' : null;
}
