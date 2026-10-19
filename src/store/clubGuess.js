import {
  conditionFactor, playsLike, describeConditions, windComponents, windFactor,
} from '../lib/playConditions';
import { holeFeatures, bearingDeg } from '../lib/geo';
import { recommendClub } from '../lib/shotStats';
import { getShots } from './shotStore';
import { weatherAt } from './weatherStore';

// The one place a club gets guessed. Every club tip, preselection and shot
// guess (header, measure button, map card, shot tracker, detected shots)
// goes through guessClub, so they always agree: same plays-like distance
// (when Playing conditions is on), same driver rule. Distances shown stay
// real metres; only the club is picked for the plays-like one.

const OFF = { enabled: false, altitudeM: 0, factor: 1, plays: (d) => d, breakdown: null, describe: null, wind: null, source: null };

// Playing conditions now for a course and a shot direction (`bearing`,
// compass degrees; null for no wind), from `settings` (conditionsEnabled,
// courseAltitudes) and the cached forecast, falling back to the month
// estimate. `plays(m)` turns real metres into plays-like metres. `source`:
// 'live' (fresh forecast) | 'forecast' (older, offline) | 'estimate'.
export function playConditionsFor({ courseName, bearing = null, settings, now = Date.now() }) {
  if (!settings?.conditionsEnabled) return OFF;
  const w = weatherAt(courseName, now);
  // A set elevation wins; otherwise the forecast's ground elevation.
  const altitudeM = (courseName && settings.courseAltitudes?.[courseName]) || w?.elevationM || 0;
  const month = new Date(now).getMonth();
  const tempC = w?.tempC;
  const factor = conditionFactor({ month, altitudeM, tempC });
  // Whole degrees, so a hook and a one-off guess for the same shot agree.
  const wind = w && Number.isFinite(bearing) ? windComponents(w.windKmh, w.windFromDeg, Math.round(bearing)) : null;
  const windMult = wind && wind.kind !== 'calm' ? windFactor(wind.headKmh) : 1;
  return {
    enabled: true,
    source: w ? (w.fresh ? 'live' : 'forecast') : 'estimate',
    fetchedAt: w?.fetchedAt ?? null,
    gustKmh: w?.gustKmh ?? null,
    altitudeM,
    factor,
    wind,
    plays: (d) => (Number.isFinite(d) ? playsLike(d, factor) * windMult : d),
    breakdown: (d) => {
      if (!Number.isFinite(d)) return null;
      const air = playsLike(d, factor);
      return { measured: d, air: air - d, wind: air * windMult - air, plays: air * windMult };
    },
    describe: describeConditions({ month, altitudeM, tempC }),
  };
}

// Direction of a shot toward a hole's green centre from `from` (the tee when
// null), or null when the hole has no mapped green.
export function shotBearing(courseName, holeNumber, from = null) {
  const f = courseName ? holeFeatures(courseName, holeNumber) : null;
  const start = from ?? f?.start;
  return start && f?.greenCenter ? bearingDeg(start, f.greenCenter) : null;
}

// The club for a shot of `meters` (real) along `bearing`. The driver is a
// candidate only when the shot is played from the tee (`fromTee`).
// Returns recommendClub's result ({ club, label, ... }) or null.
export function guessClub({
  meters, bearing = null, courseName, settings, fromTee = false, shots = getShots(), now = Date.now(),
}) {
  const cond = playConditionsFor({ courseName, bearing, settings, now });
  return recommendClub(cond.plays(meters), settings?.bag, shots, settings?.clubDistances, { excludeDriver: !fromTee });
}
