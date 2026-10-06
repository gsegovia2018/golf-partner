import { supabase } from '../lib/supabase';

// Anonymous marker page (/m/:token). Deliberately separate from leagueStore so
// the public page never imports the member store. Only the two anon-granted
// RPCs live here. Server errors are the single words 'expired', 'used',
// 'invalid' or 'changed', surfaced as `reason`.

export const MARKER_REASONS = ['expired', 'used', 'invalid', 'changed'];

export class MarkerCardError extends Error {
  constructor(message, { reason = null, offline = false } = {}) {
    super(message);
    this.name = 'MarkerCardError';
    this.reason = reason;
    this.offline = offline;
  }
}

function toMarkerError(error) {
  const message = error?.message ?? 'Request failed';
  if (!error?.code) return new MarkerCardError('You need a connection to do this.', { offline: true });
  return new MarkerCardError(message, { reason: MARKER_REASONS.includes(message) ? message : null });
}

async function rpc(fn, args) {
  let res;
  try {
    res = await supabase.rpc(fn, args);
  } catch (e) {
    throw toMarkerError({ message: e?.message });
  }
  if (res.error) throw toMarkerError(res.error);
  return res.data;
}

/**
 * Whitelisted view of one card. Throws MarkerCardError with `reason`.
 * @returns {Promise<{playerFirstName:string, course:string, tee:string|null,
 *   slope:number|null, rating:number|null, date:string|null,
 *   playingHandicap:number|null, gross:number|null, points:number|null,
 *   differential:number|null, netDifferential:number|null, expiresAt:string,
 *   holes:Array<{n:number, par:number, si:number, strokes:number|null}>}>}
 */
export async function getMarkerCard(token) {
  const d = await rpc('get_marker_card', { p_token: token });
  return {
    playerFirstName: d.player_first_name,
    course: d.course,
    tee: d.tee ?? null,
    slope: d.slope == null ? null : Number(d.slope),
    rating: d.rating == null ? null : Number(d.rating),
    date: d.date ?? null,
    playingHandicap: d.playing_handicap ?? null,
    gross: d.gross ?? null,
    points: d.points ?? null,
    differential: d.differential == null ? null : Number(d.differential),
    netDifferential: d.net_differential == null ? null : Number(d.net_differential),
    expiresAt: d.expires_at,
    holes: (d.holes ?? []).map((h) => ({ n: h.n, par: h.par, si: h.si, strokes: h.strokes ?? null })),
  };
}

/**
 * Single use. `ok` confirms the card; not ok sends it back with `note`.
 * @returns {Promise<{status:'confirmed'|'returned'}>}
 */
export async function confirmMarkerCard(token, markerName, ok, note = null) {
  const d = await rpc('confirm_marker_card', {
    p_token: token, p_marker_name: markerName, p_ok: ok, p_note: note,
  });
  return { status: d.status };
}
