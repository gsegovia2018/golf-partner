import { useEffect, useRef } from 'react';
import { setRoundTracking } from '../lib/roundTracking';
import { setActiveTrailRound, flushTrails } from '../store/gpsTrailStore';
import { setDetectionHole, proposalRoundKey } from '../store/shotProposalStore';
import { setShotListening } from '../lib/shotSense';
import { useAppSettings } from './useAppSettings';
import { formatDistance, unitSuffix } from '../lib/units';
import { t, useT, getLanguage, formatNumber } from '../i18n';
import { captureMessage } from '../lib/errorReporting';

// Drives the round tracker's persistent notification from the scorecard's
// state: what the header shows, in one title and one body line, so the
// distance can be read from the shade without unlocking. The service itself
// lives in lib/roundTracking; this hook only decides what it says and when.
//
// Text changes on a hole or source change, and when the centre distance has
// moved this far since the last update — the header follows every fix, the
// shade does not need to.
export const NOTIFICATION_MIN_DELTA_M = 5;

export function roundTrackingText({ courseName, holeNumber, distances, source, units }) {
  // Finished text in the language active now: this feeds the Android
  // foreground-service notification, which cannot re-render on its own.
  const hole = t('game.tracking.hole', { n: formatNumber(holeNumber) });
  const center = distances?.center ?? null;
  if (center == null) {
    return {
      title: t('game.tracking.titleNoFix', { hole }),
      body: t('game.tracking.bodyNoFix', { course: courseName || 'Golf Partner' }),
      center: null,
    };
  }
  const fmt = (m) => `${formatDistance(m, units)} ${unitSuffix(units)}`;
  const parts = [];
  if (distances.front != null) parts.push(t('game.tracking.front', { distance: fmt(distances.front) }));
  if (distances.back != null) parts.push(t('game.tracking.back', { distance: fmt(distances.back) }));
  if (courseName) parts.push(courseName);
  return {
    title: t(source === 'tee' ? 'game.tracking.titleTee' : 'game.tracking.titleCenter', { hole, distance: fmt(center) }),
    body: parts.join(' · '),
    center,
  };
}

// `trail` ({ userId, tournamentId, roundId, roundIndex }, or null when the
// signed-in user is not a player scoring on this phone) names the round the
// GPS trail experiment records under while tracking is active; whether it
// records at all is the `recordGpsTrail` setting, checked per fix in
// store/gpsTrailStore.
// A scorecard mounted again within this long of unmounting was rebuilt in
// place, not left and reopened.
export const REMOUNT_WINDOW_MS = 5000;
let lastUnmount = null; // { at, round } of the last live scorecard to unmount

// `why` ({ viewOnly, finished, hasMap, permissionGranted, fixState }) are the
// inputs `active` is made of, reported when tracking stops on its own.
export function useRoundTracking({ active, courseName, holeNumber, distances, source, units, trail, why }) {
  const last = useRef(null); // { holeNumber, source, center, lang } of the last update sent
  const settings = useAppSettings();
  useT(); // re-render (and re-send the text) when the language changes
  const lang = getLanguage();

  useEffect(() => {
    if (!active) {
      last.current = null;
      setRoundTracking(null);
      return;
    }
    const text = roundTrackingText({ courseName, holeNumber, distances, source, units });
    const prev = last.current;
    const sameSpot = prev
      && prev.holeNumber === holeNumber
      && prev.source === source
      && prev.lang === lang
      && prev.center != null && text.center != null
      && Math.abs(prev.center - text.center) < NOTIFICATION_MIN_DELTA_M;
    if (sameSpot) return;
    last.current = { holeNumber, source, center: text.center, lang };
    setRoundTracking({ title: text.title, body: text.body });
  }, [active, courseName, holeNumber, distances, source, units, lang]);

  // Shot detection stamps stops with the hole on screen (used when the
  // course has no geometry to place them by).
  useEffect(() => { setDetectionHole(holeNumber); }, [holeNumber]);

  // Leaving the scorecard ends tracking whatever `active` last said.
  useEffect(() => () => setRoundTracking(null), []);

  // Diagnostics. On 2026-10-30 tracking (GPS, trail and shot listening) stopped
  // twice mid-round with the app on screen, cause unknown: report which input
  // turned it off, a trail that dropped while tracking stayed on, and a
  // scorecard rebuilt in place. Leaving the scorecard is not reported.
  const whyRef = useRef(why);
  whyRef.current = why;
  const roundRef = useRef(null);
  roundRef.current = trail?.roundId ?? null;
  const wasActive = useRef(false);
  useEffect(() => {
    if (wasActive.current && !active) {
      captureMessage('round tracking stopped', { ...whyRef.current, hole: holeNumber });
    }
    wasActive.current = !!active;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Keyed by value, not identity: a fresh `trail` object per render must not
  // stop and restart the trail. Stopping (inactive, another round, unmount)
  // uploads what was recorded.
  const trailKey = active && trail?.userId && trail.tournamentId && trail.roundId && Number.isInteger(trail.roundIndex)
    ? JSON.stringify([trail.userId, trail.tournamentId, trail.roundId, trail.roundIndex])
    : null;
  const hadTrail = useRef(false);
  useEffect(() => {
    if (hadTrail.current && !trailKey && active) {
      captureMessage('round trail stopped', {
        user: !!trail?.userId, tournament: !!trail?.tournamentId, round: !!trail?.roundId,
        roundIndex: Number.isInteger(trail?.roundIndex), hole: holeNumber,
      });
    }
    hadTrail.current = !!trailKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trailKey]);
  useEffect(() => {
    if (!trailKey) return undefined;
    const [userId, tournamentId, roundId, roundIndex] = JSON.parse(trailKey);
    setActiveTrailRound({ userId, tournamentId, roundId, roundIndex });
    return () => {
      setActiveTrailRound(null).then(() => flushTrails());
    };
  }, [trailKey]);

  // Shot listening experiment: while the trail records, the phone also listens
  // for strikes under the same round (the shot proposals' key), when the
  // `listenForShots` setting is on. No-op without the native module.
  const listenKey = trailKey && settings.recordGpsTrail === true && settings.listenForShots === true ? trailKey : null;
  useEffect(() => {
    if (!listenKey) return undefined;
    const [, , roundId, roundIndex] = JSON.parse(listenKey);
    setShotListening(proposalRoundKey(roundId, roundIndex), t('shots.sense.notification'));
    return () => setShotListening(null);
  }, [listenKey]);

  // The round loads after the screen mounts, so check once its id is known.
  const roundId = trail?.roundId ?? null;
  useEffect(() => {
    if (!roundId || lastUnmount?.round !== roundId) return;
    const afterMs = Date.now() - lastUnmount.at;
    lastUnmount = null;
    if (afterMs < REMOUNT_WINDOW_MS) captureMessage('scorecard remounted', { afterMs, hole: holeNumber });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);
  useEffect(() => () => {
    if (wasActive.current) lastUnmount = { at: Date.now(), round: roundRef.current };
  }, []);
}
