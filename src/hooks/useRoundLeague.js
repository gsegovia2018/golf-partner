import { useMemo, useState } from 'react';
import { useSetupLeagues } from './useSetupLeagues';
import { useLeagueCardsStatus } from './useLeagueCardsStatus';
import { isScrambleMode, roundScoringMode } from '../store/scoring';
import { isLeagueLength, isLeagueRated, leagueCardOf } from '../store/leagueSetup';
import { leagueCardRows, showsLeagueList } from '../store/leagueGameCards';

// Start Round N of a casual tournament (R17, D5 B): may this round be my
// league card, and who else in the game is in that league? Each round is
// opted in on its own; official tournaments and scrambles never count.
//
// Returns { mode, league, rows, list, state, on, setOn, meId, retry }:
//   mode 'hidden'    nothing to show (no league with a free month, not my game…)
//        'nineHoles' the round is 9 holes: say it can't count
//        'cards'     the list (or, with only me in the league, my row alone)
//   state 'loading' | 'error' | 'ready' (the members' status read)
export function useRoundLeague({ tournament, round, userId }) {
  const casual = !!tournament && tournament.kind === 'tournament';
  const meId = useMemo(() => {
    if (!tournament || !userId) return null;
    return tournament.players?.find((p) => p.user_id && p.user_id === userId)?.id ?? null;
  }, [tournament, userId]);
  const scramble = !!round && isScrambleMode(roundScoringMode(tournament, round));
  const possible = casual && !!round && !!meId && !scramble;
  const { leagues } = useSetupLeagues(possible, userId);
  const league = leagues[0] ?? null;
  const eighteen = isLeagueLength(round);
  const status = useLeagueCardsStatus({
    leagueId: league?.id ?? null,
    tournamentId: tournament?.id ?? null,
    roundId: round?.id ?? null,
    saved: true,
    enabled: possible && !!league && eighteen,
  });
  const [on, setOn] = useState(false);

  const rows = useMemo(() => leagueCardRows({
    players: tournament?.players ?? [],
    userId,
    members: status.members,
    round,
    tournament,
  }), [tournament, userId, status.members, round]);

  let mode = 'hidden';
  if (possible && league) mode = eighteen ? 'cards' : 'nineHoles';
  const already = !!meId && !!round && !!leagueCardOf(tournament, meId, round.id);
  if (already) mode = 'hidden';
  const state = status.loading ? 'loading' : status.error ? 'error' : 'ready';
  const rated = !!round && !!meId && isLeagueRated(round, meId);
  return {
    mode,
    league,
    rows: showsLeagueList(rows) ? rows : rows.filter((r) => r.kind === 'me'),
    list: showsLeagueList(rows),
    state,
    rated,
    on: on && mode === 'cards' && state === 'ready' && rated,
    setOn,
    meId,
    retry: status.retry,
  };
}
