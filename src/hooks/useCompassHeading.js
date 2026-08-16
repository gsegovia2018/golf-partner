import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';

// Device compass heading for the flag finder's camera overlay: degrees
// clockwise from true north, smoothed so the arrow doesn't twitch. Returns
// { heading, lowAccuracy, status, requestPermission } where `heading` is null
// until the first reading lands, `lowAccuracy` drives the "wave your phone in
// a figure 8" hint, and `status` is the sensor's health
// ('ok' | 'acquiring' | 'needs-permission' | 'unavailable').
//
// The two platforms share nothing but the smoothing: native reads expo-location's
// heading watch, web reads raw DOM orientation events (see the web effect for
// why expo is not usable there).

// Low-pass factor for the sin/cos EMA. 0.25 keeps ~4 readings of memory: enough
// to kill the ±5–10° jitter a phone magnetometer emits while standing still,
// still fast enough that turning to face the flag doesn't feel laggy.
const SMOOTH_ALPHA = 0.25;

// Desktop browsers expose DeviceOrientationEvent but never fire it — there is
// no sensor and no error callback either, so silence is the only signal we get.
// Give the sensor 3s to produce something before declaring it unavailable.
const NO_EVENT_TIMEOUT_MS = 3000;

// expo-location grades heading accuracy 0–3 (3 = calibrated). 0 and 1 mean the
// magnetometer is confused — usually near metal, or freshly powered on — which
// is exactly when the figure-8 calibration hint helps.
const NATIVE_LOW_ACCURACY_MAX = 1;

// iOS reports its compass accuracy as ± degrees. Anything looser than 30° is
// worse than "roughly the right side of the fairway" and worth calibrating.
const WEB_LOW_ACCURACY_DEGREES = 30;

// Vector-space low-pass filter. Averaging degrees directly breaks at the wrap
// point — the mean of 359° and 1° is 180°, i.e. the arrow flips to point
// backwards every time the player crosses north. Keeping an EMA of the
// heading's unit vector (sin, cos) and reading the angle back out has no such
// discontinuity. `prev` is this function's own opaque state (null on the first
// reading); the returned object carries both the state and the smoothed `deg`.
export function smoothHeading(prev = null, nextDeg) {
  if (!Number.isFinite(nextDeg)) return prev;
  const rad = (nextDeg * Math.PI) / 180;
  const s = Math.sin(rad);
  const c = Math.cos(rad);
  // First reading: adopt it verbatim. Seeding the EMA from zero would drag the
  // first few frames of the arrow in from an arbitrary direction.
  if (!prev) return { s, c, deg: (nextDeg % 360 + 360) % 360 };
  const ns = prev.s + SMOOTH_ALPHA * (s - prev.s);
  const nc = prev.c + SMOOTH_ALPHA * (c - prev.c);
  const deg = (Math.atan2(ns, nc) * 180) / Math.PI;
  return { s: ns, c: nc, deg: (deg % 360 + 360) % 360 };
}

// Cheap, synchronous gate for the "find the flag" entry button — showing a
// button that leads to a dead camera screen is worse than not showing it.
// Native always has a magnetometer worth trying. On web, the constructor alone
// proves nothing (every desktop Chrome/Safari has it and no sensor behind it),
// so we use touch points as the mobile proxy: phones and tablets report > 0,
// desktops report 0. It's a heuristic, not a guarantee — the hook still falls
// back to 'unavailable' when no event actually arrives.
export function compassLikelyAvailable() {
  if (Platform.OS !== 'web') return true;
  return typeof window !== 'undefined'
    && 'DeviceOrientationEvent' in window
    && typeof navigator !== 'undefined'
    && (navigator.maxTouchPoints ?? 0) > 0;
}

// iOS 13+ Safari gates orientation events behind an explicit permission call
// that MUST originate from a user gesture — calling it from an effect is
// rejected silently. Everywhere else the events just flow.
function webNeedsPermission() {
  return typeof window !== 'undefined'
    && typeof window.DeviceOrientationEvent !== 'undefined'
    && typeof window.DeviceOrientationEvent.requestPermission === 'function';
}

export function useCompassHeading() {
  const [heading, setHeading] = useState(null);
  const [lowAccuracy, setLowAccuracy] = useState(false);
  const [status, setStatus] = useState('acquiring');
  // 'granted' everywhere except iOS Safari web, where it starts 'pending' and
  // only a tap on requestPermission can move it. Flipping it re-runs the
  // listener effect, which is how the tap starts the sensor.
  const [webPermission, setWebPermission] = useState(() => (
    Platform.OS === 'web' && webNeedsPermission() ? 'pending' : 'granted'
  ));
  // Smoothing state lives in a ref: it updates on every sensor tick (up to
  // ~60/s) and only the derived degrees belong in React state.
  const smoothRef = useRef(null);

  const requestPermission = useCallback(async () => {
    if (!webNeedsPermission()) return true;
    try {
      const result = await window.DeviceOrientationEvent.requestPermission();
      const granted = result === 'granted';
      // A denial stays 'needs-permission' rather than becoming a terminal
      // 'unavailable': iOS lets the user tap again and re-prompt, and the
      // first tap is often a mis-tap on the system dialog.
      setWebPermission(granted ? 'granted' : 'pending');
      return granted;
    } catch {
      // Thrown when the call didn't come from a user gesture, or on a browser
      // that half-implements the API. Either way there's nothing to listen to.
      setWebPermission('pending');
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Feeds every accepted reading through the smoother. `low` is passed
    // separately because only some platforms/events carry an accuracy signal.
    const apply = (rawDeg, low) => {
      if (cancelled || !Number.isFinite(rawDeg)) return;
      smoothRef.current = smoothHeading(smoothRef.current, rawDeg);
      setHeading(smoothRef.current.deg);
      setLowAccuracy(!!low);
      setStatus('ok');
    };

    if (Platform.OS !== 'web') {
      let sub = null;
      (async () => {
        try {
          // Android requires location permission for the magnetometer-backed
          // heading; iOS grants it with the same prompt. A refusal leaves us
          // with no sensor at all, which reads to the UI as 'unavailable'
          // (the 'needs-permission' status is the web re-prompt flow only).
          const { status: perm } = await Location.requestForegroundPermissionsAsync();
          if (cancelled) return;
          if (perm !== 'granted') {
            setStatus('unavailable');
            return;
          }
          sub = await Location.watchHeadingAsync((h) => {
            if (!h) return;
            // trueHeading is north-corrected by the device's declination model
            // but is -1 until a location fix exists; magHeading always has a
            // value and is off by the local declination (< 2° in Spain).
            const deg = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
            apply(deg, h.accuracy != null && h.accuracy <= NATIVE_LOW_ACCURACY_MAX);
          });
          // The subscription resolved after unmount — nothing will read it.
          if (cancelled) { try { sub?.remove?.(); } catch { /* see below */ } }
        } catch {
          if (!cancelled) setStatus('unavailable');
        }
      })();
      return () => {
        cancelled = true;
        // Same defensive cleanup as useGpsDistances: expo-location's
        // subscription.remove() reaches for LocationEventEmitter internals that
        // don't exist on every platform build, and a throw here takes down the
        // tree via the error boundary. The watch is being discarded anyway.
        try { sub?.remove?.(); } catch { /* removeSubscription may be missing */ }
      };
    }

    // --- web ---
    // Deliberately NOT expo-location's web heading path: it's built on the same
    // wrappers documented in useGpsDistances (cached, coarse, options dropped)
    // and on top of that derives heading from consecutive GPS fixes, so it only
    // ever reports course-over-ground — useless for a player standing still and
    // pointing a camera. Raw DOM orientation events are the only real compass.
    if (!compassLikelyAvailable()) {
      setStatus('unavailable');
      return undefined;
    }
    if (webPermission !== 'granted') {
      setStatus('needs-permission');
      return undefined;
    }

    let timer = null;
    const onOrientation = (event) => {
      if (cancelled || !event) return;
      if (typeof event.webkitCompassHeading === 'number') {
        // iOS Safari hands us the finished article: degrees clockwise from
        // magnetic north, already screen-orientation compensated. Do NOT apply
        // the 360 − alpha inversion here — that would send the arrow backwards.
        if (timer) { clearTimeout(timer); timer = null; }
        const acc = event.webkitCompassAccuracy;
        apply(event.webkitCompassHeading, typeof acc === 'number' && acc > WEB_LOW_ACCURACY_DEGREES);
        return;
      }
      // Chrome/Android: alpha is counter-clockwise from north, hence 360 − alpha.
      // Only absolute events are earth-referenced; a relative 'deviceorientation'
      // event measures drift from wherever the device happened to be and would
      // point the arrow at nothing, so it's discarded.
      const absolute = event.type === 'deviceorientationabsolute' || event.absolute === true;
      if (!absolute || typeof event.alpha !== 'number') return;
      // The sensor frame is fixed to the device, the UI frame rotates with the
      // screen. Adding the screen angle re-expresses the heading in the frame
      // the overlay is drawn in, so a landscape phone still points correctly.
      // Assumes the overlay follows the OS orientation (it does — no locked
      // portrait override); 0 is the right answer for a plain portrait phone.
      const screenAngle = window.screen?.orientation?.angle ?? 0;
      if (timer) { clearTimeout(timer); timer = null; }
      // No accuracy field outside iOS — report calibrated rather than nag with
      // a hint we have no evidence for.
      apply((360 - event.alpha + screenAngle) % 360, false);
    };

    // Both are registered: 'deviceorientationabsolute' is the Chromium-only
    // earth-referenced event, 'deviceorientation' is the one iOS fires (and
    // what some Android browsers fire with absolute === true instead).
    window.addEventListener('deviceorientationabsolute', onOrientation, true);
    window.addEventListener('deviceorientation', onOrientation, true);
    timer = setTimeout(() => {
      if (!cancelled) setStatus('unavailable');
    }, NO_EVENT_TIMEOUT_MS);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      // Guarded like the native remove(): react-native-web hands us the real
      // window here, but a stubbed/partial one in other hosts must not throw
      // during teardown.
      try {
        window.removeEventListener('deviceorientationabsolute', onOrientation, true);
        window.removeEventListener('deviceorientation', onOrientation, true);
      } catch { /* nothing left to detach */ }
    };
  }, [webPermission]);

  return {
    heading, // smoothed degrees 0–360 clockwise from north, null before the first reading
    lowAccuracy, // magnetometer needs a figure-8 calibration wave
    status, // 'ok' | 'acquiring' | 'needs-permission' | 'unavailable'
    requestPermission, // iOS Safari web only — must be called from a tap handler
  };
}
