import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useAppSettings } from './useAppSettings';
import { prefetchWeather, subscribeWeather, getWeatherVersion } from '../store/weatherStore';
import { playConditionsFor, shotBearing } from '../store/clubGuess';

// Live playing-conditions for a course and a shot direction (`bearingDeg`,
// compass degrees toward the target; omit for no wind) — see
// playConditionsFor. Re-reads when the forecast lands or the hour turns, and
// asks for the course's forecast while conditions are on.
export function usePlayConditions(courseName, bearingDeg = null) {
  const settings = useAppSettings();
  const { conditionsEnabled, courseAltitudes } = settings;
  const weatherVersion = useSyncExternalStore(subscribeWeather, getWeatherVersion, getWeatherVersion);
  useEffect(() => {
    if (conditionsEnabled && courseName) prefetchWeather(courseName);
  }, [conditionsEnabled, courseName]);
  const hour = Math.floor(Date.now() / 3600e3); // re-pick the forecast hour as the round goes on
  const bearing = Number.isFinite(bearingDeg) ? Math.round(bearingDeg) : null;

  return useMemo(
    () => playConditionsFor({ courseName, bearing, settings }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conditionsEnabled, courseAltitudes, courseName, bearing, weatherVersion, hour],
  );
}

// usePlayConditions for a shot on a hole: the wind is taken from `fromPos`
// (the live fix; the tee when null) to the hole's green centre.
export function useShotPlayConditions(courseName, holeNumber, fromPos) {
  const bearing = useMemo(
    () => shotBearing(courseName, holeNumber, fromPos),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [courseName, holeNumber, fromPos?.[0], fromPos?.[1]],
  );
  return usePlayConditions(courseName, bearing);
}
