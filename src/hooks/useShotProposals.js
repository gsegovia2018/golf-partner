import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useAppSettings } from './useAppSettings';
import { useCourseGeometry } from './useCourseGeometry';
import {
  subscribeShotProposals, getShotProposalsVersion, getRoundStops, loadShotProposals,
  confirmProposals, dismissProposal,
} from '../store/shotProposalStore';
import { proposalsForHole, missingShots } from '../store/shotDetection';
import { holeRefs, onGreen } from '../lib/gpsTrailStops';
import {
  subscribeShots, getShotsVersion, getShots, shotsForHole, insertShotAfter,
} from '../store/shotStore';
import { recommendClub } from '../lib/shotStats';

const EMPTY = [];

// The automatically detected shots for one hole of my round, the actions on
// them, and how many shots the hole's score says are still missing.
// `enabled` is the caller's gate (my own card, not scramble, not official);
// the "Record GPS trail (test)" setting gates the rest. `strokes`, `putts` and
// `pickedUp` are my score and shot detail for the hole (see missingShots).
// Each open proposal carries `club`: the shot tracker's distance-based guess
// (driver only off the tee), which the golfer can change before adding.
export function useShotProposals({
  roundId, roundIndex, holeNumber, courseName, enabled,
  strokes = null, putts = null, pickedUp = false,
}) {
  const settings = useAppSettings();
  const on = !!enabled && settings.recordGpsTrail === true && roundId != null;
  useEffect(() => { if (on) loadShotProposals(roundId, roundIndex); }, [on, roundId, roundIndex]);
  const pv = useSyncExternalStore(subscribeShotProposals, getShotProposalsVersion, getShotProposalsVersion);
  const sv = useSyncExternalStore(subscribeShots, getShotsVersion, getShotsVersion);
  const course = useCourseGeometry(on ? courseName : null);

  const refs = useMemo(() => {
    const geo = course?.holes?.find((h) => h.number === holeNumber);
    return geo ? holeRefs(geo) : null;
  }, [course, holeNumber]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shots = useMemo(() => (on ? shotsForHole(roundId, roundIndex, holeNumber) : EMPTY), [on, roundId, roundIndex, holeNumber, sv]);

  const open = useMemo(() => {
    if (!on) return EMPTY;
    const all = getRoundStops(roundId, roundIndex);
    if (!all.length) return EMPTY;
    return proposalsForHole(all, { holeNumber, course, shots })
      .filter((p) => p.status === 'open')
      .map((p) => ({
        ...p,
        club: p.toGreen != null
          ? recommendClub(p.toGreen, settings.bag, getShots(), settings.clubDistances, { excludeDriver: !p.fromTee })?.club ?? null
          : null,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, roundId, roundIndex, holeNumber, course, shots, pv, settings.bag, settings.clubDistances]);

  const missing = useMemo(() => (on ? missingShots({
    strokes, putts, pickedUp, spots: shots, isOnGreen: (sh) => !!refs && onGreen([sh.lat, sh.lng], refs),
  }) : null), [on, strokes, putts, pickedUp, shots, refs]);

  // Adds proposals as shots (each with its own `club`); resolves to the shots.
  const confirm = useCallback((list) => confirmProposals({
    roundId, roundIndex, holeNumber, proposals: list, green: refs?.green ?? null, clubFor: (p) => p.club ?? null,
  }), [roundId, roundIndex, holeNumber, refs]);
  const dismiss = useCallback((id) => dismissProposal(roundId, roundIndex, id), [roundId, roundIndex]);
  // "+1 from here": the proposal becomes a shot and a second one is played
  // from the same spot (a duff, a re-tee, a provisional, a drop).
  const plusOne = useCallback(async (p) => {
    const [shot] = await confirm([p]);
    if (shot) await insertShotAfter(shot.id, [p.lat, p.lng], p.club ?? null);
  }, [confirm]);

  return { open, missing, confirm, dismiss, plusOne };
}
