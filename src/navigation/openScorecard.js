import { CommonActions } from '@react-navigation/native';
import { setActiveTournament } from '../store/tournamentStore';

// Push Tournament + Scorecard together so backing out of the scorecard
// lands on the tournament view, not Home. Omitting scorecardParams lets
// ScorecardScreen default to the tournament's current round. Works from a
// tab screen or the tab bar: both reach the root stack through getParent.
export function pushTournamentScorecard(navigation, scorecardParams) {
  const targetNavigation = navigation.getState?.().routeNames?.includes('Tournament')
    ? navigation
    : navigation.getParent?.() ?? navigation;
  targetNavigation.dispatch((state) => {
    const index = state.index ?? state.routes.length - 1;
    const baseRoutes = state.routes.slice(0, index + 1);
    const routes = [
      ...baseRoutes,
      { name: 'Tournament' },
      scorecardParams ? { name: 'Scorecard', params: scorecardParams } : { name: 'Scorecard' },
    ];
    return CommonActions.reset({ ...state, routes, index: routes.length - 1 });
  });
}

// The scorecard of a live round, from anywhere: the scorecard reads the
// active tournament, so the round's one becomes active first.
export async function openLiveScorecard(navigation, { tournamentId, roundIndex }) {
  await setActiveTournament(tournamentId);
  pushTournamentScorecard(navigation, { roundIndex, tournamentId });
}
