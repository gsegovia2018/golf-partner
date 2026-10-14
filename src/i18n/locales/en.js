// English catalogue, assembled from the per-area modules in ./en/.
// Flat keys, 'area.screen.what'. See docs/i18n.md. Add strings to an area module, not here.
// A plural entry is { one, other } and reads {count}.
import achievements from './en/achievements';
import auth from './en/auth';
import common from './en/common';
import courses from './en/courses';
import holeMap from './en/holeMap';
import feed from './en/feed';
import leagueBoard from './en/leagueBoard';
import leagueCards from './en/leagueCards';
import leagueErrors from './en/leagueErrors';
import leagueJoin from './en/leagueJoin';
import leagueMembers from './en/leagueMembers';
import leagueMisc from './en/leagueMisc';
import leagueScoring from './en/leagueScoring';
import leagueShare from './en/leagueShare';
import leagueTimeline from './en/leagueTimeline';
import marker from './en/marker';
import notifications from './en/notifications';
import onboarding from './en/onboarding';
import players from './en/players';
import profile from './en/profile';
import scorecard from './en/scorecard';
import scoring from './en/scoring';
import settings from './en/settings';
import shots from './en/shots';
import shared from './en/shared';
import tour from './en/tour';
import statsScreen from './en/statsScreen';
import statExplainers from './en/statExplainers';
import statsTabs from './en/statsTabs';
import myStats from './en/myStats';
import playerStats from './en/playerStats';
import swing from './en/swing';
import swingChecks from './en/swingChecks';
import swingCoach from './en/swingCoach';
import swingCues from './en/swingCues';
import swingDrills from './en/swingDrills';
import appMisc from './en/appMisc';
import gameCore from './en/gameCore';
import statsData from './en/statsData';
import coach from './en/coach';

import home from './en/home';
import setup from './en/setup';
import rounds from './en/rounds';
import official from './en/official';

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
  coach,
  statsData,
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
  ...coach,
  ...statsData,
  ...gameCore,
  ...appMisc,
};
