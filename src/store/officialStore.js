import { supabase } from '../lib/supabase';

// Pure: build the queued RPC payload for one score write. Kept separate so
// it is unit-testable without touching the network or the queue.
export function buildScorePayload({ token, roundId, hole, subjectRosterId, source, strokes }) {
  if (source !== 'self' && source !== 'marker') throw new Error('bad source');
  return {
    fn: 'submit_score',
    args: {
      p_token: token, p_round_id: roundId, p_hole: hole,
      p_subject: subjectRosterId, p_source: source, p_strokes: strokes,
    },
  };
}

// Fetch the full round state for the token holder's party.
export async function getRoundState(token, roundId) {
  const { data, error } = await supabase.rpc('get_round_state', {
    p_token: token, p_round_id: roundId,
  });
  if (error) throw error;
  return data;
}

// Write one score cell. Enqueued through the offline queue so play works
// without signal; the sync worker drains it.
//
// The queue entry carries no `tournamentId` (this is not a tournament-blob
// mutation) so it drains via the library/independent path; the `mutation`
// uses type `rpc.call` so the worker dispatches it through supabase.rpc.
export async function submitScore(params) {
  const payload = buildScorePayload(params);
  // Lazy require keeps this module's pure surface (buildScorePayload)
  // loadable without pulling in the queue / native deps.
  const { syncQueue } = require('./syncQueue');
  const { isOnline } = require('../lib/connectivity');
  await syncQueue.enqueue({
    tournamentId: null,
    mutation: { type: 'rpc.call', fn: payload.fn, args: payload.args },
    path: null,
  });
  const { scheduleSync } = require('./syncWorker');
  if (isOnline()) scheduleSync();
}

// Attest the caller's card. Online-only: attestation is a deliberate,
// terminal action, so surface failure immediately rather than queueing.
export async function attestCard(token, roundId) {
  const { error } = await supabase.rpc('attest_card', {
    p_token: token, p_round_id: roundId,
  });
  if (error) throw error;
}
