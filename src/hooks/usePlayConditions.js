import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useAppSettings } from './useAppSettings';
import {
  conditionFactor, playsLike, describeConditions, windComponents, windFactor,
} from '../lib/playConditions';
import {
  prefetchWeather, weatherAt, subscribeWeather, getWeatherVersion,
} from '../store/weatherStore';

const OFF = { enabled: false, altitudeM: 0, factor: 1, plays: (d) => d, breakdown: null, describe: null, wind: null, source: null };

// Live playing-conditions for a course and a shot direction (`bearingDeg`,
// compass degrees toward the target; omit for no wind). Reads the toggle +
// per-course elevation from settings and the cached forecast (weatherStore),
// falling back to the month estimate when there is none. Hands back
// `plays(target)` (real metres -> plays-like metres), `breakdown(target)`
// ({ measured, wind, air, plays } in metres), the wind relative to the shot,
// and `source`: 'live' (fresh forecast) | 'forecast' (older, offline) |
// 'estimate'. With the toggle off `plays` is identity, so callers can use it
// unconditionally.
export function usePlayConditions(courseName, bearingDeg = null) {
  const { conditionsEnabled, courseAltitudes } = useAppSettings();
  const weatherVersion = useSyncExternalStore(subscribeWeather, getWeatherVersion, getWeatherVersion);
  useEffect(() => {
    if (conditionsEnabled && courseName) prefetchWeather(courseName);
  }, [conditionsEnabled, courseName]);
  const setAltitude = courseName && courseAltitudes ? courseAltitudes[courseName] : null;
  const hour = Math.floor(Date.now() / 3600e3); // re-pick the forecast hour as the round goes on
  const bearingKey = Number.isFinite(bearingDeg) ? Math.round(bearingDeg) : null;

  return useMemo(() => {
    if (!conditionsEnabled) return OFF;
    const now = Date.now();
    const w = weatherAt(courseName, now);
    // A set elevation wins; otherwise the forecast's ground elevation.
    const altitudeM = setAltitude || w?.elevationM || 0;
    const month = new Date(now).getMonth();
    const tempC = w?.tempC;
    const factor = conditionFactor({ month, altitudeM, tempC });
    const wind = w && bearingKey != null ? windComponents(w.windKmh, w.windFromDeg, bearingKey) : null;
    const windMult = wind && wind.kind !== 'calm' ? windFactor(wind.headKmh) : 1;
    const plays = (d) => (Number.isFinite(d) ? playsLike(d, factor) * windMult : d);
    return {
      enabled: true,
      source: w ? (w.fresh ? 'live' : 'forecast') : 'estimate',
      fetchedAt: w?.fetchedAt ?? null,
      gustKmh: w?.gustKmh ?? null,
      altitudeM,
      factor,
      wind,
      plays,
      breakdown: (d) => {
        if (!Number.isFinite(d)) return null;
        const air = playsLike(d, factor);
        return { measured: d, air: air - d, wind: air * windMult - air, plays: air * windMult };
      },
      describe: describeConditions({ month, altitudeM, tempC }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conditionsEnabled, courseName, setAltitude, bearingKey, weatherVersion, hour]);
}
