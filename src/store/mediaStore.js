import { supabase } from '../lib/supabase';

const _subs = new Set();
function _emitChange() {
  _subs.forEach((fn) => { try { fn(); } catch (_) {} });
}

export function subscribeMediaChanges(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

function rowToMedia(row) {
  const { data: originalUrl } = supabase.storage
    .from('tournament-media')
    .getPublicUrl(row.storage_path);
  const { data: thumbUrl } = supabase.storage
    .from('tournament-media')
    .getPublicUrl(row.thumb_path);
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    roundId: row.round_id,
    holeIndex: row.hole_index,
    kind: row.kind,
    storagePath: row.storage_path,
    thumbPath: row.thumb_path,
    durationS: row.duration_s,
    caption: row.caption,
    uploaderLabel: row.uploader_label,
    // uploader_id is added by migration 20260516_feed_reactions_and_uploader.sql.
    // Safe to read before the migration lands: undefined when the column is absent.
    uploaderId: row.uploader_id ?? null,
    createdAt: row.created_at,
    url: originalUrl.publicUrl,
    thumbUrl: thumbUrl.publicUrl,
    status: 'uploaded',
  };
}

export async function loadTournamentMedia(tournamentId) {
  const { data, error } = await supabase
    .from('tournament_media')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(rowToMedia);
}

// Batch variant for the activity feed: one query for many tournaments
// instead of N round-trips. Returns newest-first across all of them.
export async function loadMediaForTournaments(tournamentIds) {
  const ids = [...new Set(tournamentIds)].filter(Boolean);
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('tournament_media')
    .select('*')
    .in('tournament_id', ids)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(rowToMedia);
}

export async function loadRoundMedia(roundId) {
  const { data, error } = await supabase
    .from('tournament_media')
    .select('*')
    .eq('round_id', roundId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(rowToMedia);
}

export async function insertMediaRow({
  id, tournamentId, roundId, holeIndex, kind,
  storagePath, thumbPath, durationS, caption, uploaderLabel,
}) {
  const { error } = await supabase.from('tournament_media').insert({
    id,
    tournament_id: tournamentId,
    round_id: roundId,
    hole_index: holeIndex ?? null,
    kind,
    storage_path: storagePath,
    thumb_path: thumbPath,
    duration_s: durationS ?? null,
    caption: caption ?? null,
    uploader_label: uploaderLabel ?? null,
  });
  if (error) throw error;
  _emitChange();
}

export async function deleteMedia(media) {
  const paths = [media.storagePath, media.thumbPath].filter(Boolean);
  await supabase.storage.from('tournament-media').remove(paths);
  const { error } = await supabase.from('tournament_media').delete().eq('id', media.id);
  if (error) throw error;
  _emitChange();
}

export function notifyMediaChange() {
  _emitChange();
}
