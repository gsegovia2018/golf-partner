import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { DeviceMotion, Magnetometer } from 'expo-sensors';

// Device compass heading for the flag finder's camera overlay: the direction
// the BACK CAMERA faces, in degrees clockwise from north, smoothed so the
// arrow doesn't twitch. Returns { heading, lowAccuracy, flat, status,
// requestPermission } where `heading` is null until the first reading lands,
// `lowAccuracy` drives the "wave your phone in a figure 8" hint, `flat` means
// the camera points at the ground/sky so it has no usable direction, and
// `status` is the sensor's health
// ('ok' | 'acquiring' | 'needs-permission' | 'unavailable').
//
// Camera axis, not top edge: a plain compass heading (expo-location's
// watchHeadingAsync on Android, Chrome's bare alpha) is the azimuth of the
// phone's top edge. Held upright to aim the camera, that edge points at the
// sky, its azimuth is decided by hand tremor, and the arrow spins. Every path
// below instead projects the device's -Z axis (out of the back) onto the
// horizon, which is well defined exactly when the phone is upright.
//
// Android reads expo-sensors' DeviceMotion (the fused rotation-vector sensor),
// iOS keeps expo-location's heading, web reads raw DOM orientation events (see
// the web effect for why expo is not usable there).

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

// The camera axis' horizontal component is sin of its tilt from vertical.
// Below 0.35 (camera within ~20° of straight down or up) the heading is
// mostly noise — the overlay asks the player to raise the phone instead.
const MIN_HORIZONTAL = 0.35;

// DeviceMotion tick. 50ms = 20Hz, which with SMOOTH_ALPHA gives the arrow a
// ~200ms time constant: steady, but still tracks a deliberate turn.
const MOTION_INTERVAL_MS = 50;

// Earth's field is 25–65µT everywhere. Readings outside a loose band mean
// nearby metal or an uncalibrated magnetometer — the figure-8 hint's cue.
// The rotation-vector sensor exposes no accuracy of its own.
const MAG_MIN_UT = 20;
const MAG_MAX_UT = 70;

// Heading (clockwise from north) of a device-frame vector whose world-frame
// east/north components are given, or `flat` when it barely leaves the
// vertical. Shared tail of both camera-heading functions below.
function headingOf(east, north) {
  if (Math.hypot(east, north) < MIN_HORIZONTAL) return { deg: null, flat: true };
  const deg = (Math.atan2(east, north) * 180) / Math.PI;
  return { deg: (deg + 360) % 360, flat: false };
}

// Android, from expo-sensors DeviceMotion `rotation` (radians). expo builds it
// from SensorManager.getOrientation on the rotation-vector matrix R and then
// flips signs: alpha = -azimuth, beta = -pitch, gamma = roll. Rebuilding the
// two entries of R we need (R[2], R[5]: east/north components of the device
// Z axis) from those angles is exact — the camera looks along -Z.
export function cameraHeadingFromDeviceMotion({ alpha, beta, gamma } = {}) {
  if (![alpha, beta, gamma].every(Number.isFinite)) return null;
  const a = -alpha;
  const p = -beta;
  const r = gamma;
  const r2 = Math.cos(a) * Math.sin(r) + Math.sin(a) * Math.sin(p) * Math.cos(r);
  const r5 = -Math.sin(a) * Math.sin(r) + Math.cos(a) * Math.sin(p) * Math.cos(r);
  return headingOf(-r2, -r5);
}

// Web (W3C DeviceOrientation, degrees): R = Rz(alpha)·Rx(beta)·Ry(gamma) in an
// east/north/up frame. The camera's world direction is minus R's third
// column — the same vector as the spec's own "compass heading" example.
export function cameraHeadingFromOrientation(alphaDeg, betaDeg, gammaDeg) {
  if (![alphaDeg, betaDeg, gammaDeg].every(Number.isFinite)) return null;
  const k = Math.PI / 180;
  const ca = Math.cos(alphaDeg * k);
  const sa = Math.sin(alphaDeg * k);
  const sb = Math.sin(betaDeg * k);
  const cg = Math.cos(gammaDeg * k);
  const sg = Math.sin(gammaDeg * k);
  return headingOf(-ca * sg - sa * sb * cg, -sa * sg + ca * sb * cg);
}

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
  const [flat, setFlat] = useState(false);
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
    // `low` undefined leaves lowAccuracy alone (Android sets it from its own
    // magnetometer listener).
    const apply = (rawDeg, low) => {
      if (cancelled || !Number.isFinite(rawDeg)) return;
      smoothRef.current = smoothHeading(smoothRef.current, rawDeg);
      setHeading(smoothRef.current.deg);
      setFlat(false);
      if (low !== undefined) setLowAccuracy(!!low);
      setStatus('ok');
    };
    // Camera-axis readings: a flat phone keeps the last heading (and the
    // smoother's state) but tells the UI to ask for an upright phone.
    const applyCamera = (result, low) => {
      if (cancelled || !result) return;
      if (result.flat) {
        setFlat(true);
        setStatus('ok');
        return;
      }
      apply(result.deg, low);
    };

    if (Platform.OS === 'android') {
      const subs = [];
      (async () => {
        try {
          if (!(await DeviceMotion.isAvailableAsync())) {
            if (!cancelled) setStatus('unavailable');
            return;
          }
          if (cancelled) return;
          DeviceMotion.setUpdateInterval(MOTION_INTERVAL_MS);
          subs.push(DeviceMotion.addListener((m) => {
            applyCamera(cameraHeadingFromDeviceMotion(m?.rotation));
          }));
          // Calibration hint only — a missing magnetometer listener must not
          // take the compass down with it.
          try {
            if (await Magnetometer.isAvailableAsync()) {
              if (cancelled) return;
              Magnetometer.setUpdateInterval(500);
              subs.push(Magnetometer.addListener(({ x, y, z }) => {
                const ut = Math.hypot(x, y, z);
                if (!cancelled && Number.isFinite(ut)) setLowAccuracy(ut < MAG_MIN_UT || ut > MAG_MAX_UT);
              }));
            }
          } catch { /* no hint, compass still works */ }
        } catch {
          if (!cancelled) setStatus('unavailable');
        }
      })();
      return () => {
        cancelled = true;
        subs.forEach((sub) => { try { sub?.remove?.(); } catch { /* already gone */ } });
      };
    }

    if (Platform.OS !== 'web') {
      let sub = null;
      (async () => {
        try {
          // iOS: Core Location's heading needs the location prompt. CLHeading
          // follows the device's interface orientation rather than the camera
          // axis; untested on an upright iPhone. A refusal leaves us
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
      // Chrome/Android: the full alpha/beta/gamma triple gives the camera axis
      // (alpha alone is the top edge's azimuth, which spins when upright). The
      // camera axis doesn't rotate with the screen, so no orientation angle.
      // Only absolute events are earth-referenced; a relative 'deviceorientation'
      // event measures drift from wherever the device happened to be and would
      // point the arrow at nothing, so it's discarded.
      const absolute = event.type === 'deviceorientationabsolute' || event.absolute === true;
      if (!absolute) return;
      const result = cameraHeadingFromOrientation(event.alpha, event.beta, event.gamma);
      if (!result) return;
      if (timer) { clearTimeout(timer); timer = null; }
      // No accuracy field outside iOS — report calibrated rather than nag with
      // a hint we have no evidence for.
      applyCamera(result, false);
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
    flat, // camera points at the ground or sky — no usable direction
    status, // 'ok' | 'acquiring' | 'needs-permission' | 'unavailable'
    requestPermission, // iOS Safari web only — must be called from a tap handler
  };
}
