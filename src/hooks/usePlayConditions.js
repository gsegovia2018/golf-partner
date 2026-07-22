import { useMemo } from 'react';
import { useAppSettings } from './useAppSettings';
import { conditionFactor, playsLike, describeConditions } from '../lib/playConditions';

// Live playing-conditions for a course. Reads the toggle + per-course elevation
// from settings and the current month, and hands back the carry `factor`, a
// `plays(target)` helper (real metres → plays-like metres), and a `describe`
// summary. When the toggle is off (or no course), `factor` is 1 and `plays` is
// identity so callers can use it unconditionally.
export function usePlayConditions(courseName) {
  const { conditionsEnabled, courseAltitudes } = useAppSettings();
  const altitudeM = (courseName && courseAltitudes && courseAltitudes[courseName]) || 0;
  const month = new Date().getMonth();

  return useMemo(() => {
    if (!conditionsEnabled) {
      return { enabled: false, altitudeM: 0, factor: 1, plays: (d) => d, describe: null };
    }
    const factor = conditionFactor({ month, altitudeM });
    return {
      enabled: true,
      altitudeM,
      factor,
      plays: (d) => playsLike(d, factor),
      describe: describeConditions({ month, altitudeM }),
    };
  }, [conditionsEnabled, altitudeM, month]);
}
