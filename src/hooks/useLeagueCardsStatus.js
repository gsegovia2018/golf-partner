import { useCallback, useEffect, useState } from 'react';
import { getLeagueGameStatus, getLeagueMonthMembers } from '../store/leagueStore';
import { cardMonth } from '../store/leagueRules';
import { membersFromMonth } from '../store/leagueGameCards';

// The members' month status for the "League cards" list (D5), read live once
// per league/round (announcing needs the server anyway). Returns
// { members: [{ userId, hasCard, thisRound, isMe? }], loading, error, retry }.
//
// - Before the game exists (Setup): the league's members and their cards this
//   month (getLeagueMonthMembers).
// - For a saved game (Start Round N, the scorecard): get_league_game_status
//   for that round, which also says whose card is this round's.
export function useLeagueCardsStatus({ leagueId, tournamentId = null, roundId = null, saved = false, enabled = true }) {
  const active = !!enabled && !!leagueId && (!saved || (!!tournamentId && !!roundId));
  const [state, setState] = useState({ members: [], loading: active, error: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active) {
      setState({ members: [], loading: false, error: false });
      return undefined;
    }
    let cancelled = false;
    setState((st) => ({ ...st, loading: true, error: false }));
    (async () => {
      try {
        let members;
        if (saved) {
          members = await getLeagueGameStatus(leagueId, tournamentId, roundId);
        } else {
          const { members: list, cards } = await getLeagueMonthMembers(leagueId, cardMonth(new Date()));
          members = membersFromMonth(list, cards);
        }
        if (!cancelled) setState({ members, loading: false, error: false });
      } catch {
        if (!cancelled) setState({ members: [], loading: false, error: true });
      }
    })();
    return () => { cancelled = true; };
  }, [active, leagueId, tournamentId, roundId, saved, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
