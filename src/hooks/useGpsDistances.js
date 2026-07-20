import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as Location from 'expo-location';
import {
  findCourseGeometry,
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
// { available, distances, accuracy, position, source } where `distances` is
// { front, center, back, pin, kind, hazards } in meters or null, and
// `source` is 'gps' | 'tee'. `available` is false when there is no
// geometry, or when location was denied/disabled and the hole has no tee to
// fall back to — callers render nothing in that case.
export function useGpsDistances(courseName, holeNumber) {
  const geomVersion = useSyncExternalStore(subscribeCourseGeometry, getCourseGeometryVersion);
  // geomVersion bumps when hydration swaps in live geometry — recompute then.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geometry = useMemo(() => findCourseGeometry(courseName), [courseName, geomVersion]);
  const appSettings = useSyncExternalStore(subscribeAppSettings, getAppSettings, getAppSettings);
  const gpsEnabled = appSettings.gpsEnabled !== false;
  const [denied, setDenied] = useState(false);
  const [fix, setFix] = useState(null); // { pos: [lat, lng], accuracy }
  const lastFixAt = useRef(0);
  // Only whether the course HAS geometry gates the location watch — not the
  // geometry object's identity. Hydration (e.g. saving the geometry editor)
  // bumps geomVersion and returns a fresh object; keying the effect on that
  // would tear down and rebuild the watch on every save.
  const hasGeometry = !!geometry;

  useEffect(() => {
    if (!hasGeometry || !gpsEnabled) return undefined;
    let cancelled = false;
    let sub = null;
    let poll = null;
    const apply = (loc) => {
      if (cancelled || !loc) return;
      lastFixAt.current = Date.now();
      setFix({
        pos: [loc.coords.latitude, loc.coords.longitude],
        accuracy: loc.coords.accuracy ?? null,
      });
    };
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (status !== 'granted') { setDenied(true); return; }
        setDenied(false);
        // Fast first fix — the watch below can take several seconds to emit.
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
          .then(apply).catch(() => {});
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
      // expo-location's web subscription.remove() calls
      // LocationEventEmitter.removeSubscription, which doesn't exist on
      // react-native-web — it throws and takes down the tree via the error
      // boundary. Swallow it; the watch is being discarded anyway.
      try { sub?.remove?.(); } catch { /* web removeSubscription missing */ }
      if (poll) clearInterval(poll);
    };
  }, [hasGeometry, gpsEnabled]);

  const resolved = useMemo(() => {
    if (!geometry) return { distances: null, source: 'gps' };
    return resolveScorecardDistances({
      courseName,
      holeNumber,
      fix: gpsEnabled ? (fix?.pos ?? null) : null, // disabled = pretend no fix → tee path
    });
  }, [geometry, fix, courseName, holeNumber, gpsEnabled]);

  return {
    // Denied + no tee fallback would leave the header stuck on the fix
    // spinner — hide it, exactly like the pre-tee-fallback behavior.
    available: !!geometry
      && (gpsEnabled ? (!denied || resolved.source === 'tee') : resolved.source === 'tee'),
    distances: resolved.distances,
    source: resolved.source, // 'gps' | 'tee' — the header renders FROM TEE for 'tee'
    accuracy: gpsEnabled ? (fix?.accuracy ?? null) : null,
    position: gpsEnabled ? (fix?.pos ?? null) : null, // [lat, lng] — shared with the hole map
  };
}
