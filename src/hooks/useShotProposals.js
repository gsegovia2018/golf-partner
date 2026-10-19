import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useAppSettings } from './useAppSettings';
import { useCourseGeometry } from './useCourseGeometry';
import {
  subscribeShotProposals, getShotProposalsVersion, getRoundStops, loadShotProposals,
  confirmProposals, dismissProposal, undoProposal, getProposalUi,
} from '../store/shotProposalStore';
import { proposalsForHole } from '../store/shotDetection';
import { holeRefs } from '../lib/gpsTrailStops';
import { subscribeShots, getShotsVersion, getShots, shotsForHole } from '../store/shotStore';
import { recommendClub } from '../lib/shotStats';

const EMPTY = [];

// The automatically detected shots for one hole of my round, and the actions
// on them. `enabled` is the caller's gate (my own card, not scramble, not
// official); the "Record GPS trail (test)" setting gates the rest. Each
// proposal carries `club`: the same distance-based guess the shot tracker
// makes (driver only off the tee), tagged on the shot when it is confirmed.
export function useShotProposals({ roundId, roundIndex, holeNumber, courseName, enabled }) {
  const settings = useAppSettings();
  const on = !!enabled && settings.recordGpsTrail === true && roundId != null;
  useEffect(() => { if (on) loadShotProposals(roundId, roundIndex); }, [on, roundId, roundIndex]);
  const pv = useSyncExternalStore(subscribeShotProposals, getShotProposalsVersion, getShotProposalsVersion);
  const sv = useSyncExternalStore(subscribeShots, getShotsVersion, getShotsVersion);
  const course = useCourseGeometry(on ? courseName : null);

  const green = useMemo(() => {
    const geo = course?.holes?.find((h) => h.number === holeNumber);
    return geo ? holeRefs(geo)?.green ?? null : null;
  }, [course, holeNumber]);

  const proposals = useMemo(() => {
    if (!on) return EMPTY;
    const all = getRoundStops(roundId, roundIndex);
    if (!all.length) return EMPTY;
    const shots = shotsForHole(roundId, roundIndex, holeNumber);
    return proposalsForHole(all, { holeNumber, course, shots })
      .map((p) => ({
        ...p,
        // Added: the club saved on its shot. Open: the guess it will be saved with.
        club: p.status === 'added'
          ? shots.find((sh) => sh.id === p.shotId)?.club ?? null
          : p.toGreen != null
            ? recommendClub(p.toGreen, settings.bag, getShots(), settings.clubDistances, { excludeDriver: !p.fromTee })?.club ?? null
            : null,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, roundId, roundIndex, holeNumber, course, pv, sv, settings.bag, settings.clubDistances]);

  const open = useMemo(() => proposals.filter((p) => p.status === 'open'), [proposals]);
  const confirm = useCallback((list) => confirmProposals({
    roundId, roundIndex, holeNumber, proposals: list, green, clubFor: (p) => p.club ?? null,
  }), [roundId, roundIndex, holeNumber, green]);
  const dismiss = useCallback((id) => dismissProposal(roundId, roundIndex, id), [roundId, roundIndex]);
  const undo = useCallback((id) => undoProposal(roundId, roundIndex, id), [roundId, roundIndex]);

  return {
    ui: getProposalUi(), proposals, open, hasGreen: !!green, confirm, dismiss, undo,
  };
}
