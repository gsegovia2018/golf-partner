// Spanish catalogue, assembled from the per-area modules in ./es/.
// Flat keys, 'area.screen.what'. See docs/i18n.md. Add strings to an area module, not here.
// A plural entry is { one, other } and reads {count}.
import achievements from './es/achievements';
import auth from './es/auth';
import common from './es/common';
import courses from './es/courses';
import holeMap from './es/holeMap';
import feed from './es/feed';
import leagueBoard from './es/leagueBoard';
import leagueCards from './es/leagueCards';
import leagueErrors from './es/leagueErrors';
import leagueJoin from './es/leagueJoin';
import leagueMembers from './es/leagueMembers';
import leagueMisc from './es/leagueMisc';
import leagueScoring from './es/leagueScoring';
import leagueShare from './es/leagueShare';
import leagueTimeline from './es/leagueTimeline';
import marker from './es/marker';
import notifications from './es/notifications';
import onboarding from './es/onboarding';
import players from './es/players';
import profile from './es/profile';
import scorecard from './es/scorecard';
import scoring from './es/scoring';
import settings from './es/settings';
import shots from './es/shots';
import shared from './es/shared';
import tour from './es/tour';
import statsScreen from './es/statsScreen';
import statExplainers from './es/statExplainers';
import statsTabs from './es/statsTabs';
import myStats from './es/myStats';
import playerStats from './es/playerStats';
import swing from './es/swing';
import swingChecks from './es/swingChecks';
import swingCoach from './es/swingCoach';
import swingCues from './es/swingCues';
import swingDrills from './es/swingDrills';
import appMisc from './es/appMisc';
import gameCore from './es/gameCore';
import statsData from './es/statsData';
import gameStats from './es/gameStats';
import coach from './es/coach';

import home from './es/home';
import setup from './es/setup';
import rounds from './es/rounds';
import official from './es/official';

export const AREAS = {
  achievements,
  auth,
  common,
  courses,
  holeMap,
  feed,
  leagueBoard,
  leagueCards,
  leagueErrors,
  leagueJoin,
  leagueMembers,
  leagueMisc,
  leagueScoring,
  leagueShare,
  leagueTimeline,
  marker,
  notifications,
  onboarding,
  players,
  profile,
  scorecard,
  scoring,
  settings,
  shots,
  shared,
  tour,
  home,
  setup,
  rounds,
  official,
  statsScreen,
  statExplainers,
  statsTabs,
  myStats,
  playerStats,
  swing,
  swingChecks,
  swingCoach,
  swingCues,
  swingDrills,
  statsData,
  gameStats,
  coach,
  gameCore,
  appMisc,
};

export default {
  ...achievements,
  ...auth,
  ...common,
  ...courses,
  ...holeMap,
  ...feed,
  ...leagueBoard,
  ...leagueCards,
  ...leagueErrors,
  ...leagueJoin,
  ...leagueMembers,
  ...leagueMisc,
  ...leagueScoring,
  ...leagueShare,
  ...leagueTimeline,
  ...marker,
  ...notifications,
  ...onboarding,
  ...players,
  ...profile,
  ...scorecard,
  ...scoring,
  ...settings,
  ...shots,
  ...shared,
  ...tour,
  ...home,
  ...setup,
  ...rounds,
  ...official,
  ...statsScreen,
  ...statExplainers,
  ...statsTabs,
  ...myStats,
  ...playerStats,
  ...swing,
  ...swingChecks,
  ...swingCoach,
  ...swingCues,
  ...swingDrills,
  ...statsData,
  ...gameStats,
  ...coach,
  ...gameCore,
  ...appMisc,
};
