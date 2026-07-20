import { haversineMeters, holeFeatures, courseTargetDistances } from './geo';

export const ANCHOR_MAX_GPS_METERS = 1000;

const valid = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);

// Where does the measuring line start? Live GPS wins while the player is
// within ANCHOR_MAX_GPS_METERS of the green; otherwise the tee; otherwise
// nothing (the flyover falls back to free drag-to-measure).
export function anchorFor({ player, tee, greenCenter }) {
  const playerDistance = valid(player) && valid(greenCenter)
    ? haversineMeters(player, greenCenter)
    : null;
  if (playerDistance != null && playerDistance <= ANCHOR_MAX_GPS_METERS) {
    return { anchor: player, source: 'gps', playerDistance };
  }
  if (valid(tee)) return { anchor: tee, source: 'tee', playerDistance };
  return { anchor: null, source: null, playerDistance };
}

// Distances for the scorecard header. Live GPS wins while the player is on
// the hole (anchorFor's 1 km rule); otherwise the tee, when the hole has one
// and it yields distances. `source` is 'tee' only in that case — every other
// path (no tee, greens-mode course, no geometry match) keeps the plain GPS
// behavior, including null distances before the first fix.
export function resolveScorecardDistances({ courseName, holeNumber, fix }) {
  const feat = holeFeatures(courseName, holeNumber);
  const r = anchorFor({
    player: fix,
    tee: feat?.start ?? null,
    greenCenter: feat?.greenCenter ?? null,
  });
  if (r.source === 'tee') {
    const d = courseTargetDistances(r.anchor, courseName, holeNumber);
    if (d) return { distances: d, source: 'tee' };
  }
  return {
    distances: fix ? courseTargetDistances(fix, courseName, holeNumber) : null,
    source: 'gps',
  };
}
