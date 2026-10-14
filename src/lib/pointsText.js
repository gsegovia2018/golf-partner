// The unit a score is shown in. Boards carry it as a code ('pts' | 'holes',
// see tournamentLeaderboardResolved); these helpers turn it into words in the
// active language. Call at render time.
import { t, formatNumber } from '../i18n';

// "pts" / "ptos", "holes" / "hoyos".
export function unitText(unit = 'pts') {
  return t(unit === 'holes' ? 'shared.unit.holes' : 'shared.unit.pts');
}

// "38 pts" / "38 ptos". Non-numeric values ('-') are shown as given.
export function pointsText(points, unit = 'pts') {
  const value = typeof points === 'number' ? formatNumber(points) : String(points ?? '-');
  return `${value} ${unitText(unit)}`;
}
