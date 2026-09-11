import { useEffect, useRef } from 'react';
import { setRoundTracking } from '../lib/roundTracking';
import { formatDistance, unitSuffix } from '../lib/units';

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
  const hole = `Hole ${holeNumber}`;
  const center = distances?.center ?? null;
  if (center == null) {
    return {
      title: `${hole} · Getting GPS fix`,
      body: `${courseName || 'Golf Partner'} · tap to open the scorecard`,
      center: null,
    };
  }
  const fmt = (m) => `${formatDistance(m, units)} ${unitSuffix(units)}`;
  const where = source === 'tee' ? 'from the tee' : 'to the centre';
  const parts = [];
  if (distances.front != null) parts.push(`${fmt(distances.front)} front`);
  if (distances.back != null) parts.push(`${fmt(distances.back)} back`);
  if (courseName) parts.push(courseName);
  return { title: `${hole} · ${fmt(center)} ${where}`, body: parts.join(' · '), center };
}

export function useRoundTracking({ active, courseName, holeNumber, distances, source, units }) {
  const last = useRef(null); // { holeNumber, source, center } of the last update sent

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
      && prev.center != null && text.center != null
      && Math.abs(prev.center - text.center) < NOTIFICATION_MIN_DELTA_M;
    if (sameSpot) return;
    last.current = { holeNumber, source, center: text.center };
    setRoundTracking({ title: text.title, body: text.body });
  }, [active, courseName, holeNumber, distances, source, units]);

  // Leaving the scorecard ends tracking whatever `active` last said.
  useEffect(() => () => setRoundTracking(null), []);
}
