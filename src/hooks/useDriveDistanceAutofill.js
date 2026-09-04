import { useEffect, useRef, useSyncExternalStore } from 'react';
import { subscribeShots, getShotsVersion, getShots } from '../store/shotStore';
import { longestCarryByHole } from '../lib/shotStats';
import { driveDistBucketFor } from '../components/scorecard/constants';

// A marked tee shot has already measured the drive — walking off a range and
// then picking that same range by hand on the scorecard is asking twice. This
// fills the shot detail's Drive distance bucket from the hole's first measured
// carry (the tee shot, once its landing is marked).
//
// The fill stays a suggestion, not a lock: it only writes into an empty bucket,
// or over a bucket it wrote itself and that a fresh measurement has since
// changed (dragging a pin corrects the drive). The moment the player picks or
// clears a bucket by hand, that hole is theirs and this leaves it alone.
//
// Par 3s are skipped — the drive row doesn't render there.
export function useDriveDistanceAutofill({
  roundId, roundIndex, meId, holes, shotDetails, onSetShot, enabled = true,
}) {
  const applied = useRef(new Map()); // `round|index|hole` -> bucket this hook wrote
  const shotsVersion = useSyncExternalStore(subscribeShots, getShotsVersion, getShotsVersion);

  useEffect(() => {
    if (!enabled || roundId == null || !meId || !onSetShot) return;
    const carries = longestCarryByHole(getShots(), {
      roundKeys: new Set([`${roundId}|${roundIndex}`]),
      teeOnly: true,
    });
    for (const [holeNumber, carry] of carries) {
      if (holes?.find((h) => h.number === holeNumber)?.par === 3) continue;
      const bucket = driveDistBucketFor(carry.meters);
      if (!bucket) continue;
      const key = `${roundId}|${roundIndex}|${holeNumber}`;
      const mine = applied.current.get(key) ?? null;
      const current = shotDetails?.[meId]?.[holeNumber]?.driveDistBucket ?? null;
      // Never auto-filled here: only fill a blank. Auto-filled before: only
      // update while the value is still the one this hook put there.
      if (mine == null ? current != null : current !== mine) continue;
      if (current === bucket) continue;
      applied.current.set(key, bucket);
      onSetShot(meId, holeNumber, { driveDistBucket: bucket });
    }
  }, [shotsVersion, roundId, roundIndex, meId, holes, shotDetails, onSetShot, enabled]);
}
