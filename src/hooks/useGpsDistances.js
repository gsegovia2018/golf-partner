import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as Location from 'expo-location';
import {
  findCourseGeometry, courseTargetDistances,
  subscribeCourseGeometry, getCourseGeometryVersion,
} from '../lib/geo';

// Live GPS distances to the current hole's green. Only asks for location
// permission when the round's course actually has geometry data; returns
// { available, distances, accuracy } where `distances` is
// { front, center, back, pin, kind } in meters, or null until a fix arrives.
// `available` is false when there is no geometry, permission was denied, or
// location is unsupported — callers render nothing in that case.
export function useGpsDistances(courseName, holeNumber) {
  const geomVersion = useSyncExternalStore(subscribeCourseGeometry, getCourseGeometryVersion);
  // geomVersion bumps when hydration swaps in live geometry — recompute then.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geometry = useMemo(() => findCourseGeometry(courseName), [courseName, geomVersion]);
  const [denied, setDenied] = useState(false);
  const [fix, setFix] = useState(null); // { pos: [lat, lng], accuracy }
  const lastFixAt = useRef(0);
  // Only whether the course HAS geometry gates the location watch — not the
  // geometry object's identity. Hydration (e.g. saving the geometry editor)
  // bumps geomVersion and returns a fresh object; keying the effect on that
  // would tear down and rebuild the watch on every save.
  const hasGeometry = !!geometry;

  useEffect(() => {
    if (!hasGeometry) return undefined;
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
  }, [hasGeometry]);

  const distances = useMemo(() => {
    if (!geometry || !fix) return null;
    return courseTargetDistances(fix.pos, courseName, holeNumber);
  }, [geometry, fix, courseName, holeNumber]);

  return {
    available: !!geometry && !denied,
    distances,
    accuracy: fix?.accuracy ?? null,
    position: fix?.pos ?? null, // [lat, lng] — shared with the hole map
  };
}
