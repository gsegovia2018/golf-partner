import { useCallback, useEffect, useRef, useState } from 'react';
import { getRoundState, submitScore } from '../store/officialStore';

// Poll interval for re-fetching round state while the scorecard is open.
// Official rounds are multi-device: other players' marks need to surface
// without a manual refresh. 20s keeps it live without hammering the RPC.
const POLL_MS = 20000;

/**
 * Data source for an official-tournament round.
 *
 * `getRoundState(token, roundId)` returns the token holder's view of one
 * round:
 *   {
 *     party_id,
 *     my_roster_id,
 *     round,                                     // round row (course JSONB etc.)
 *     members:      [{ roster_id, seat, marks_roster_id, pair_id,
 *                      display_name, handicap, withdrawn }],
 *     scores:       [{ hole, subject_roster_id, source, strokes }],
 *     attestations: [...],
 *   }
 *
 * The hook keeps that shape mostly raw — ScorecardScreen maps it to the
 * casual render shapes — and adds the optimistic write path + the per-card
 * write-permission helper.
 */
export function useOfficialRound({ token, roundId }) {
  const [round, setRound] = useState(null);
  const [members, setMembers] = useState([]);
  const [scores, setScores] = useState([]);
  const [attestations, setAttestations] = useState([]);
  const [partyId, setPartyId] = useState(null);
  const [myRosterId, setMyRosterId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Guards against a late poll/refresh response calling setState after the
  // component has unmounted (the classic "can't update unmounted" warning,
  // and worse, a stale overwrite of fresher local state).
  const mountedRef = useRef(true);

  // Apply one getRoundState payload to local state. Centralised so the
  // initial load, the poll, and refresh() all normalise identically.
  const applyState = useCallback((data) => {
    if (!mountedRef.current || !data) return;
    setRound(data.round ?? null);
    setMembers(Array.isArray(data.members) ? data.members : []);
    setScores(Array.isArray(data.scores) ? data.scores : []);
    setAttestations(Array.isArray(data.attestations) ? data.attestations : []);
    setPartyId(data.party_id ?? null);
    setMyRosterId(data.my_roster_id ?? null);
  }, []);

  // Re-fetch the full round state. Surfaces errors only on the very first
  // load; a transient poll/refresh failure must not blank a live round.
  const refresh = useCallback(async () => {
    if (!token || !roundId) {
      if (mountedRef.current) { setLoading(false); }
      return;
    }
    try {
      const data = await getRoundState(token, roundId);
      applyState(data);
      if (mountedRef.current) { setError(null); }
    } catch (e) {
      if (mountedRef.current) {
        // Only flip to a hard error if nothing is on screen yet.
        setError((prev) => prev ?? e);
      }
    } finally {
      if (mountedRef.current) { setLoading(false); }
    }
  }, [token, roundId, applyState]);

  // Initial load + 20s poll. The interval is cleared on unmount; mountedRef
  // blocks any in-flight response that resolves after unmount.
  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [refresh]);

  /**
   * The roster_id of the player THIS token holder marks. Round-robin marker
   * assignment (Task 3) gives each member exactly one markee. We find it by
   * locating our own member row and reading its `marks_roster_id`.
   */
  const myMarkeeRosterId = (() => {
    const me = members.find((m) => m.roster_id === myRosterId);
    return me?.marks_roster_id ?? null;
  })();

  /**
   * Which source THIS device may write for a given subject:
   *   - 'self'   for our own card,
   *   - 'marker' for the player we are assigned to mark,
   *   - null     for everyone else (read-only on this device).
   */
  const editableSource = useCallback((subjectRosterId) => {
    if (subjectRosterId == null) return null;
    if (subjectRosterId === myRosterId) return 'self';
    if (subjectRosterId === myMarkeeRosterId) return 'marker';
    return null;
  }, [myRosterId, myMarkeeRosterId]);

  /**
   * Write one score cell and optimistically reflect it locally so the UI
   * updates before the queued RPC drains. Replaces the matching
   * {hole, subject_roster_id, source} row or appends a new one.
   */
  const setScore = useCallback(async (subjectRosterId, hole, strokes, source) => {
    // Optimistic local update — keep the screen responsive offline.
    setScores((prev) => {
      const idx = prev.findIndex(
        (r) => r.hole === hole
          && r.subject_roster_id === subjectRosterId
          && r.source === source,
      );
      if (idx === -1) {
        return [...prev, { hole, subject_roster_id: subjectRosterId, source, strokes }];
      }
      const next = prev.slice();
      next[idx] = { ...next[idx], strokes };
      return next;
    });
    // submitScore enqueues through the offline sync queue, so this resolves
    // quickly even without signal; the sync worker drains it later.
    await submitScore({ token, roundId, hole, subjectRosterId, source, strokes });
  }, [token, roundId]);

  return {
    members,
    scores,
    round,
    partyId,
    attestations,
    myRosterId,
    loading,
    error,
    setScore,
    refresh,
    editableSource,
  };
}
