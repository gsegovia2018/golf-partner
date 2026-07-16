import { useEffect, useMemo, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { findCourseGeometry, courseTargetDistances } from '../lib/geo';

// Live GPS distances to the current hole's green. Only asks for location
// permission when the round's course actually has geometry data; returns
// { available, distances, accuracy } where `distances` is
// { front, center, back, pin, kind } in meters, or null until a fix arrives.
// `available` is false when there is no geometry, permission was denied, or
// location is unsupported — callers render nothing in that case.
export function useGpsDistances(courseName, holeNumber) {
  const geometry = useMemo(() => findCourseGeometry(courseName), [courseName]);
  const [denied, setDenied] = useState(false);
  const [fix, setFix] = useState(null); // { pos: [lat, lng], accuracy }
  const subRef = useRef(null);

  useEffect(() => {
    if (!geometry) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (status !== 'granted') { setDenied(true); return; }
        subRef.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            distanceInterval: 2,
            timeInterval: 2000,
          },
          (loc) => {
            if (cancelled) return;
            setFix({
              pos: [loc.coords.latitude, loc.coords.longitude],
              accuracy: loc.coords.accuracy ?? null,
            });
          },
        );
      } catch {
        if (!cancelled) setDenied(true);
      }
    })();
    return () => {
      cancelled = true;
      subRef.current?.remove?.();
      subRef.current = null;
    };
  }, [geometry]);

  const distances = useMemo(() => {
    if (!geometry || !fix) return null;
    return courseTargetDistances(fix.pos, courseName, holeNumber);
  }, [geometry, fix, courseName, holeNumber]);

  return {
    available: !!geometry && !denied,
    distances,
    accuracy: fix?.accuracy ?? null,
  };
}
