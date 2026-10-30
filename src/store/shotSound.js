// How sure we are that a detected stop (store/shotDetection) was my shot,
// from what the phone heard and felt there (lib/shotSense events):
//
//   'shot'  while I stood there my phone swung hard, with a sharp strike
//           right at the swing's peak;
//   'heard' a sharp strike, but no such swing (often a partner hitting);
//   'quiet' the phone was listening the whole stop and heard no strike;
//   null    no sound data for that time (listening off, older APK, web).
//
// The level only ranks proposals on the map; nothing is added or hidden by it.
// Calibrated on one exported round (2026-10-30, Lomas-Bosque, phone in a
// trouser pocket; scripts/analyzeShotSound.mjs): the listener logged ~30
// strikes and ~16 swings a minute, mostly footsteps and clothes, and the old
// rule (any strike up to 10 s after the stop, gyro >= 3 or acc >= 8) called
// every one of 133 stops a shot. Walking swings the thigh to ~5 rad/s, real
// swings peaked at ~9; the accelerometer was as high walking as swinging.
// The current rule keeps 37 of the 43 shots I added.
// Pure (scripts/analyzeShotSound.mjs imports it); store/shotSoundStore caches
// a round's events for the scorecard.
// Plan: docs/superpowers/plans/2026-10-25-shot-sound-confidence.md

// A stop ends when I have walked out of it, so the shot is inside it; a
// little slack before it for the clocks and a swing right as I arrive.
// Nothing after it: by then I am walking away, and walking with the phone in
// a pocket sets off the microphone and the motion sensors together.
export const STOP_BEFORE_MS = 2000;
// My own swing: a gyroscope 'swing' event at least this strong, rad/s.
export const OWN_SWING_GYRO = 6;
// The impact: a strike within this of that swing's peak...
export const SWING_STRIKE_MS = 300;
// ...that rises this fast. A ball struck rises in a few ms; steps and
// rubbing clothes rise slower. A strike logged without features counts.
export const SHARP_RISE_MS = 10;

export const isOwnSwing = (w) => (w.gyroPeak ?? 0) >= OWN_SWING_GYRO;
export const isSharpStrike = (s) => !((s.riseMs ?? 0) > SHARP_RISE_MS);

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
  return {
    strikes: list.filter((e) => e.type === 'strike' && isSharpStrike(e)),
    swings: list.filter((e) => e.type === 'swing' && isOwnSwing(e)),
    spans: listeningSpans(list),
  };
}

export function soundLevel(stop, index) {
  if (!stop || !index) return null;
  const from = stop.start - STOP_BEFORE_MS;
  const to = stop.end;
  const hits = index.strikes.filter((s) => s.t >= from && s.t <= to);
  const swung = (index.swings ?? []).some((w) => w.t >= from && w.t <= to
    && hits.some((s) => Math.abs(s.t - w.t) <= SWING_STRIKE_MS));
  if (swung) return 'shot';
  if (hits.length) return 'heard';
  return index.spans.some((sp) => sp.from <= stop.start && sp.to >= stop.end) ? 'quiet' : null;
}
