import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../lib/supabase';
import { assignRoundRobinMarkers } from './officialScoring';

// Create an official tournament shell. Reuses the tournaments table; kind
// flags it official. Returns the new tournament id.
export async function createOfficialTournament({ name }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  // tournaments.id is a non-defaulted text primary key — the client owns id
  // generation here, same as createTournament in tournamentStore.js.
  const id = uuidv4();
  const { data, error } = await supabase
    .from('tournaments')
    .insert({ id, name, kind: 'official', created_by: user.id, data: {} })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

// Add a roster player. Each gets a unique magic token used as their link.
export async function addRosterPlayer(tournamentId, { displayName, handicap }) {
  const { data, error } = await supabase
    .from('tournament_roster')
    .insert({
      tournament_id: tournamentId, display_name: displayName,
      handicap: handicap ?? 0, magic_token: uuidv4(),
    })
    .select('id, display_name, handicap, magic_token, withdrawn')
    .single();
  if (error) throw error;
  return data;
}

export async function listRoster(tournamentId) {
  const { data, error } = await supabase
    .from('tournament_roster')
    .select('id, display_name, handicap, magic_token, withdrawn, user_id')
    .eq('tournament_id', tournamentId)
    .order('created_at');
  if (error) throw error;
  return data;
}

// Issue a fresh token for a player (used when a link leaks).
export async function regenerateToken(rosterId) {
  const token = uuidv4();
  const { error } = await supabase
    .from('tournament_roster').update({ magic_token: token }).eq('id', rosterId);
  if (error) throw error;
  return token;
}

export async function withdrawPlayer(rosterId, withdrawn = true) {
  const { error } = await supabase
    .from('tournament_roster').update({ withdrawn }).eq('id', rosterId);
  if (error) throw error;
}

// Merge keys into an official tournament's config blob without clobbering
// existing keys. `existingData` is the current `data` object (caller-held).
export async function saveTournamentData(tournamentId, existingData, patch) {
  const { error } = await supabase
    .from('tournaments')
    .update({ data: { ...existingData, ...patch } })
    .eq('id', tournamentId);
  if (error) throw error;
}

// Create a round in 'setup' status.
export async function createRound(tournamentId, { roundIndex, course, format }) {
  const { data, error } = await supabase
    .from('tournament_rounds')
    .insert({ tournament_id: tournamentId, round_index: roundIndex,
              course: course ?? {}, format: format ?? 'stableford' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

// Persist a round's party layout. `parties` is [[rosterId,...], ...]; each
// inner array is one party in seat order. Markers are derived round-robin.
// Replaces any existing parties for the round (only valid while status=setup).
export async function saveParties(tournamentId, roundId, parties) {
  const { error: delErr } = await supabase
    .from('tournament_parties').delete().eq('round_id', roundId);
  if (delErr) throw delErr;
  for (let i = 0; i < parties.length; i++) {
    if (!parties[i] || parties[i].length === 0) continue;
    const { data: party, error: pErr } = await supabase
      .from('tournament_parties')
      .insert({ round_id: roundId, tournament_id: tournamentId, number: i + 1 })
      .select('id')
      .single();
    if (pErr) throw pErr;
    const members = parties[i].map((rosterId, seat) => ({ rosterId, seat: seat + 1 }));
    const markers = assignRoundRobinMarkers(members);
    const rows = members.map((m) => ({
      party_id: party.id,
      roster_id: m.rosterId,
      seat: m.seat,
      marks_roster_id: markers.find((x) => x.rosterId === m.rosterId).marksRosterId,
    }));
    const { error: mErr } = await supabase.from('tournament_party_members').insert(rows);
    if (mErr) throw mErr;
  }
}

// Admin override: set who a player marks.
export async function overrideMarker(partyId, rosterId, marksRosterId) {
  const { error } = await supabase
    .from('tournament_party_members')
    .update({ marks_roster_id: marksRosterId })
    .eq('party_id', partyId).eq('roster_id', rosterId);
  if (error) throw error;
}

export async function startRound(roundId) {
  const { error } = await supabase
    .from('tournament_rounds').update({ status: 'live' }).eq('id', roundId);
  if (error) throw error;
}

// Force-resolve a discrepancy: write both score rows to the agreed value.
export async function forceResolve(roundId, hole, subjectRosterId, strokes, adminRosterId) {
  for (const source of ['self', 'marker']) {
    const { error: scoreErr } = await supabase.from('tournament_scores').upsert({
      round_id: roundId, hole, subject_roster_id: subjectRosterId,
      source, author_roster_id: adminRosterId, strokes, updated_at: new Date().toISOString(),
    }, { onConflict: 'round_id,hole,subject_roster_id,source' });
    if (scoreErr) throw scoreErr;
    const { error: auditErr } = await supabase.from('tournament_score_audit').insert({
      round_id: roundId, hole, subject_roster_id: subjectRosterId,
      source, strokes, author_roster_id: adminRosterId,
    });
    if (auditErr) throw auditErr;
  }
}

export async function forceFinalizeParty(partyId) {
  const { error } = await supabase
    .from('tournament_parties').update({ locked: true }).eq('id', partyId);
  if (error) throw error;
}

export async function listNotifications(tournamentId) {
  const { data, error } = await supabase
    .from('tournament_notifications')
    .select('id, kind, body, created_at')
    .eq('tournament_id', tournamentId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}
