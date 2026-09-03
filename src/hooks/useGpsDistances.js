import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Platform, AppState } from 'react-native';
import * as Location from 'expo-location';
import {
  findCourseGeometry, holeFeatures, haversineMeters,
  subscribeCourseGeometry, getCourseGeometryVersion,
} from '../lib/geo';
import { resolveScorecardDistances } from '../lib/flyoverModel';
import { subscribeAppSettings, getAppSettings } from '../store/settingsStore';

// Live GPS distances to the current hole's green, falling back to distances
// measured from the tee whenever a usable fix isn't in play. Resolution
// order: (1) the gpsEnabled setting is off — never request permission or
// start a watch, always resolve as if there were no fix; (2) permission
// denied — tee, if the hole has one; (3) fix is >1 km from the hole — tee
// (same anchorFor rule as the flyover map); (4) otherwise — gps. Returns
// { available, distances, accuracy, position, source, fixState, offTee } where
// `distances` is { front, center, back, pin, kind, hazards } in meters or null,
// `source` is 'gps' | 'tee', and `fixState` is the GPS health
// ('ok' | 'acquiring' | 'denied' | 'disabled') the header's status line reads.
// `available` is false when there is no geometry, or when location was
// denied/disabled and the hole has no tee to fall back to — callers render
// nothing in that case.
// A live fix farther than this from the hole's mapped tee point means the
// player is past the tee box — the driver stops being a sensible suggestion.
const OFF_TEE_METERS = 50;

// Browser geolocation options. expo-location's web wrappers are unusable for a
// live watch: getCurrentPositionAsync hardcodes maximumAge: Infinity (every
// call returns the cached fix), and watchPositionAsync forwards expo's own
// options object raw, so enableHighAccuracy is never set and the browser sits
// on coarse network location that rarely updates. On web we drive
// navigator.geolocation directly with these instead.
const WEB_GEO_OPTIONS = { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 };

// How long a wake gets to prove the location provider is still answering
// before we pay for a full watch restart. Long enough for a warm fix to come
// back, short enough that a genuinely suspended watch recovers promptly.
const WAKE_PROBE_MS = 3000;
// The wake probe only asks "does the provider still answer?", so unlike
// WEB_GEO_OPTIONS it accepts a few seconds of cache — a pristine fix is the
// watch's job, and forcing maximumAge: 0 here would make a live provider look
// suspended for exactly as long as a cold re-lock takes.
const WEB_PROBE_OPTIONS = { enableHighAccuracy: true, maximumAge: 5000, timeout: WAKE_PROBE_MS };
// One return to the foreground can fire two wake signals (visibilitychange and
// pageshow); collapse them so they can't restart the watch twice, the second
// killing the acquisition the first just started.
const WAKE_COALESCE_MS = 1000;

export function useGpsDistances(courseName, holeNumber) {
  const geomVersion = useSyncExternalStore(subscribeCourseGeometry, getCourseGeometryVersion);
  // geomVersion bumps when hydration swaps in live geometry — recompute then.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geometry = useMemo(() => findCourseGeometry(courseName), [courseName, geomVersion]);
  const appSettings = useSyncExternalStore(subscribeAppSettings, getAppSettings, getAppSettings);
  const gpsEnabled = appSettings.gpsEnabled !== false;
  const [denied, setDenied] = useState(false);
  // Bumped when a previously denied permission is observed granted (system or
  // browser settings changed mid-round) — re-runs the watch effect so the
  // header recovers without a remount or a settings toggle.
  const [permRetry, setPermRetry] = useState(0);
  // Bumped when a wake finds the location provider unresponsive. Both
  // platforms suspend a location watch while hidden (screen off, tab or app
  // switch) and frequently never resume it — the watch stays registered but
  // silent, which is why the fix froze until a reload. Restarting the whole
  // effect is what a reload did, minus the reload; the wake effect below is
  // what decides a restart is actually warranted.
  const [wakeEpoch, setWakeEpoch] = useState(0);
  const [fix, setFix] = useState(null); // { pos: [lat, lng], accuracy }
  const lastFixAt = useRef(0);
  // Set by the watch effect to a one-shot "is the provider still answering?"
  // request, and null whenever no watch is running. The wake handler below
  // fires it instead of restarting on faith.
  const probeFix = useRef(null);
  const lastWakeAt = useRef(0);
  // Counts fixes actually delivered by the provider. The wake probe compares
  // this rather than lastFixAt, which the watch also stamps on (re)start and
  // which two events inside one millisecond can't tell apart.
  const fixSeq = useRef(0);
  // Only whether the course HAS geometry gates the location watch — not the
  // geometry object's identity. Hydration (e.g. saving the geometry editor)
  // bumps geomVersion and returns a fresh object; keying the effect on that
  // would tear down and rebuild the watch on every save.
  const hasGeometry = !!geometry;

  useEffect(() => {
    let probeTimer = null;
    // A restart is expensive: it drops a watch that may be perfectly healthy
    // and forces a cold high-accuracy re-lock (WEB_GEO_OPTIONS pins
    // maximumAge: 0), which is seconds of stale distance every time the phone
    // comes out of a pocket. So a wake doesn't restart on faith — it pokes the
    // provider and restarts only if nothing answers within WAKE_PROBE_MS,
    // which is the suspended-watch case this wake-up exists for. Any fix in
    // that window (probe or watch) means the provider is alive; a live-but-
    // quiet watch is what the 6s poll below has always covered.
    const wake = () => {
      const now = Date.now();
      if (now - lastWakeAt.current < WAKE_COALESCE_MS) return;
      lastWakeAt.current = now;
      const before = fixSeq.current;
      probeFix.current?.();
      if (probeTimer) clearTimeout(probeTimer);
      probeTimer = setTimeout(() => {
        probeTimer = null;
        if (fixSeq.current === before) setWakeEpoch((n) => n + 1);
      }, WAKE_PROBE_MS);
    };
    // Native: a locked screen or an app switch suspends the expo-location
    // watch the same way a hidden tab suspends the browser one, and pocketing
    // the phone between shots is the single most common thing that happens
    // during a round. ScorecardScreen and lib/supabase already resume off this
    // same event. Web is handled below with DOM listeners rather than AppState
    // because pageshow — Safari's back/forward cache, which restores without a
    // visibilitychange — has no AppState equivalent.
    if (typeof document === 'undefined') {
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') wake();
      });
      return () => {
        sub.remove();
        if (probeTimer) clearTimeout(probeTimer);
      };
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') wake();
    };
    // pageshow fires on every normal page load too, not only on the bfcache
    // restore it is here for — and the listener is attached before `load`, so
    // without this guard a cold start wakes itself and restarts the watch it
    // is still acquiring. `persisted` is true only for the bfcache case.
    const onPageShow = (e) => {
      if (e.persisted) onVisible();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onPageShow);
      if (probeTimer) clearTimeout(probeTimer);
    };
  }, []);

  useEffect(() => {
    if (!hasGeometry || !gpsEnabled) return undefined;
    let cancelled = false;
    let sub = null;
    let webWatchId = null;
    let poll = null;
    const apply = (loc) => {
      if (cancelled || !loc) return;
      lastFixAt.current = Date.now();
      fixSeq.current += 1;
      setFix({
        pos: [loc.coords.latitude, loc.coords.longitude],
        accuracy: loc.coords.accuracy ?? null,
      });
    };
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (status !== 'granted') {
          setDenied(true);
          // Permission can be granted later from system/browser settings.
          // Poll the non-prompting status check and re-run this effect (via
          // permRetry) the moment it flips — `denied` is otherwise sticky
          // until the scorecard remounts.
          poll = setInterval(async () => {
            try {
              const cur = await Location.getForegroundPermissionsAsync();
              if (!cancelled && cur?.status === 'granted') setPermRetry((n) => n + 1);
            } catch { /* keep waiting */ }
          }, 5000);
          return;
        }
        setDenied(false);
        // The quiet-watch polls below measure their 6s from here. A restart
        // would otherwise inherit a timestamp from before the phone went into
        // a pocket, and stack a redundant high-accuracy request on top of the
        // acquisition this run has already started.
        lastFixAt.current = Date.now();
        if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.geolocation) {
          // See WEB_GEO_OPTIONS — the expo-location web path only ever yields
          // one coarse cached fix. GeolocationPosition has the same
          // { coords: { latitude, longitude, accuracy } } shape apply() reads.
          navigator.geolocation.getCurrentPosition(apply, () => {}, WEB_GEO_OPTIONS);
          webWatchId = navigator.geolocation.watchPosition(apply, () => {}, WEB_GEO_OPTIONS);
          probeFix.current = () => {
            navigator.geolocation.getCurrentPosition(apply, () => {}, WEB_PROBE_OPTIONS);
          };
          // Safety net for browsers whose watch goes silent (backgrounded tab,
          // some mobile vendors) — force a fresh read after 6s of quiet.
          poll = setInterval(() => {
            if (cancelled || Date.now() - lastFixAt.current < 6000) return;
            navigator.geolocation.getCurrentPosition(apply, () => {}, WEB_GEO_OPTIONS);
          }, 5000);
          return;
        }
        // Fast first fix — the watch below can take several seconds to emit.
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
          .then(apply).catch(() => {});
        probeFix.current = () => {
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
            .then(apply).catch(() => {});
        };
        sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            distanceInterval: 1,
            timeInterval: 1000,
          },
          apply,
        );
        // Desktop browsers and some Android vendors deliver one fix and then
        // go silent — poll whenever the watch has been quiet for 6s.
        poll = setInterval(() => {
          if (cancelled || Date.now() - lastFixAt.current < 6000) return;
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
            .then(apply).catch(() => {});
        }, 5000);
      } catch {
        if (!cancelled) setDenied(true);
      }
    })();
    return () => {
      cancelled = true;
      probeFix.current = null;
      // expo-location's web subscription.remove() calls
      // LocationEventEmitter.removeSubscription, which doesn't exist on
      // react-native-web — it throws and takes down the tree via the error
      // boundary. Swallow it; the watch is being discarded anyway.
      try { sub?.remove?.(); } catch { /* web removeSubscription missing */ }
      if (webWatchId != null) navigator.geolocation.clearWatch(webWatchId);
      if (poll) clearInterval(poll);
    };
  }, [hasGeometry, gpsEnabled, permRetry, wakeEpoch]);

  const resolved = useMemo(() => {
    if (!geometry) return { distances: null, source: 'gps' };
    return resolveScorecardDistances({
      courseName,
      holeNumber,
      fix: gpsEnabled ? (fix?.pos ?? null) : null, // disabled = pretend no fix → tee path
    });
  }, [geometry, fix, courseName, holeNumber, gpsEnabled]);

  // True only when a live fix puts the player clearly past this hole's tee —
  // club recommendations then exclude the driver (a tee-only club). False
  // whenever we can't tell (no fix, no mapped tee), keeping the recommendation
  // unrestricted in planning/tee contexts.
  const offTee = useMemo(() => {
    const pos = gpsEnabled ? (fix?.pos ?? null) : null;
    if (!pos || !geometry) return false;
    const start = holeFeatures(courseName, holeNumber)?.start;
    return !!start && haversineMeters(pos, start) > OFF_TEE_METERS;
  }, [geometry, fix, courseName, holeNumber, gpsEnabled]);

  // GPS health, independent of which distance `source` won. Lets the header
  // tell "working but far away" apart from "no fix / denied / off" — all of
  // which resolve to a tee distance and would otherwise look identical.
  // 'disabled' → the setting is off (surface nothing); 'denied' → permission
  // blocked; 'ok' → a live fix is held; 'acquiring' → granted, still waiting.
  const fixState = !gpsEnabled ? 'disabled'
    : denied ? 'denied'
      : fix ? 'ok'
        : 'acquiring';

  return {
    // Denied + no tee fallback would leave the header stuck on the fix
    // spinner — hide it, exactly like the pre-tee-fallback behavior. Also
    // hide once we HAVE a fix but there's no distance to show (off the hole,
    // no tee): resolveScorecardDistances returns null there, and we must not
    // sit on the "Getting GPS fix" spinner forever.
    available: !!geometry
      && (gpsEnabled ? (!denied || resolved.source === 'tee') : resolved.source === 'tee')
      && !(fix != null && resolved.distances == null),
    // True whenever the course has mapped geometry at all — independent of the
    // live fix/permission state that gates `available`. Shot-marking UI keys
    // off this: with no map there is nowhere to place a shot.
    hasMap: hasGeometry,
    distances: resolved.distances,
    source: resolved.source, // 'gps' | 'tee' — the header renders FROM TEE for 'tee'
    fixState, // 'ok' | 'acquiring' | 'denied' | 'disabled' — GPS health for the status line
    accuracy: gpsEnabled ? (fix?.accuracy ?? null) : null,
    position: gpsEnabled ? (fix?.pos ?? null) : null, // [lat, lng] — shared with the hole map
    offTee, // past this hole's tee → club recommendations exclude the driver
  };
}
