// Hole briefing (aim-tips spec §2.2/§2.3): what the golfer sees on ARRIVAL at
// a hole. The data is entered after the hole, so the approach distance is the
// EXPECTED one: hole length minus the average drive (par 4/5), the hole length
// itself on a par 3. Pure: stats + the hole's geometry in, tips out.
import { aimTip, aimHazards } from './aimTip';
import { haversineMeters } from '../lib/geo';

// Same edges as the logged approach buckets (components/scorecard/constants).
const BUCKET_EDGES = [[50, '0-50'], [100, '50-100'], [150, '100-150'], [200, '150-200']];
const bucketOf = (m) => (BUCKET_EDGES.find(([edge]) => m < edge)?.[1] ?? '200+');

// Straight tee -> green-centre line in metres, or null when the hole is not
// mapped with both. (The course data model carries no per-hole length.)
export function holeLengthM(geometry) {
  if (!geometry?.start || !geometry?.greenCenter) return null;
  return haversineMeters(geometry.start, geometry.greenCenter);
}

// Expected approach distance in metres, or null when it cannot be told.
function expectedApproachM({ par, holeLength, avgDrive }) {
  if (!(holeLength > 0)) return null;
  if (par === 3) return holeLength;
  if (!(avgDrive > 0)) return null;
  return Math.max(0, holeLength - avgDrive);
}

export function expectedApproachBucket(input = {}) {
  const m = expectedApproachM(input);
  return m == null ? null : bucketOf(m);
}

export function holeBriefing({ par, holeLength, stats, geometry, handedness } = {}) {
  const none = { tee: null, approach: null, approachMeters: null };
  if (!stats) return none;
  const length = holeLength ?? holeLengthM(geometry);
  const avgDrive = stats.driveDistance?.avgDistance ?? null;
  const from = geometry?.start ?? null;
  const greenCentre = geometry?.greenCenter ?? null;

  const tee = par >= 4
    ? aimTip({
      shot: 'tee',
      par,
      stats,
      handedness,
      hazards: aimHazards({ shot: 'tee', holeGeometry: geometry, from, greenCentre, driveDistance: avgDrive }),
    })
    : null;

  const metres = expectedApproachM({ par, holeLength: length, avgDrive });
  const approach = aimTip({
    shot: 'approach',
    par,
    bucket: metres == null ? null : bucketOf(metres),
    stats,
    handedness,
    hazards: aimHazards({ shot: 'approach', holeGeometry: geometry, from, greenCentre }),
  });

  return {
    tee,
    approach,
    approachMeters: approach && metres != null ? Math.round(metres / 10) * 10 : null,
  };
}
