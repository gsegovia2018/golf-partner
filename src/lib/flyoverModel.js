import { haversineMeters } from './geo';

export const ANCHOR_MAX_GPS_METERS = 700;

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
