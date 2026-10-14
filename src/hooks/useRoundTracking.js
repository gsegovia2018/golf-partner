import { useEffect, useRef } from 'react';
import { setRoundTracking } from '../lib/roundTracking';
import { formatDistance, unitSuffix } from '../lib/units';
import { t, useT, getLanguage, formatNumber } from '../i18n';

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

export function useRoundTracking({ active, courseName, holeNumber, distances, source, units }) {
  const last = useRef(null); // { holeNumber, source, center, lang } of the last update sent
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

  // Leaving the scorecard ends tracking whatever `active` last said.
  useEffect(() => () => setRoundTracking(null), []);
}
