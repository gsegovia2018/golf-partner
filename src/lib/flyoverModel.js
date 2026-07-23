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

// Distances for the scorecard header. Two honest states only:
//   - On the hole (anchorFor's 1 km GPS rule): live distance to the green.
//   - Off the hole: the hole measured FROM THE TEE, when the hole has one.
// When you're off the hole and there is no tee to measure from, show NOTHING
// (null) — never a straight-line distance from your far-away GPS position to
// the green. `source` is 'tee' only for the tee case.
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
  // Live distance to the green, but only while the fix is ON the hole. For a
  // greens-mode course there's no per-hole green for anchorFor to gauge, so
  // decide by the measured distance itself: within 1 km = on a hole (show it),
  // beyond = off the hole (show nothing — never a far straight-line GPS line).
  if (fix) {
    const d = courseTargetDistances(fix, courseName, holeNumber);
    if (d && d.center <= ANCHOR_MAX_GPS_METERS) return { distances: d, source: 'gps' };
  }
  return { distances: null, source: 'gps' };
}
