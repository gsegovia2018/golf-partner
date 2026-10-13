import { supabase } from '../lib/supabase';

// The public league board (/league-board/:token). Deliberately separate from
// leagueStore so the signed-out page never imports the member store. Only the
// anon-granted RPC lives here (supabase/migrations/20261017000000_league_public_board.sql).

export class PublicBoardError extends Error {
  constructor(message, { offline = false } = {}) {
    super(message);
    this.name = 'PublicBoardError';
    this.offline = offline;
  }
}

// The whitelisted payload ({ league, members, cards }), or null for an
// unknown or switched-off link. Throws PublicBoardError on a failed request.
export async function getPublicLeagueBoard(token) {
  if (!token) return null;
  let res;
  try {
    res = await supabase.rpc('get_public_league_board', { p_token: token });
  } catch (e) {
    throw new PublicBoardError(e?.message || 'Request failed', { offline: true });
  }
  if (res.error) throw new PublicBoardError(res.error.message || 'Request failed', { offline: !res.error.code });
  return res.data ?? null;
}
