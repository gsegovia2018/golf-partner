// Spanish catalogue, assembled from the per-area modules in ./es/.
// Flat keys, 'area.screen.what'. See docs/i18n.md. Add strings to an area module, not here.
// A plural entry is { one, other } and reads {count}.
import auth from './es/auth';
import common from './es/common';
import courses from './es/courses';
import holeMap from './es/holeMap';
import feed from './es/feed';
import leagueBoard from './es/leagueBoard';
import leagueCards from './es/leagueCards';
import leagueMembers from './es/leagueMembers';
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

import home from './es/home';
import setup from './es/setup';
import rounds from './es/rounds';
import official from './es/official';

export const AREAS = {
  auth,
  common,
  courses,
  holeMap,
  feed,
  leagueBoard,
  leagueCards,
  leagueMembers,
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
};

export default {
  ...auth,
  ...common,
  ...courses,
  ...holeMap,
  ...feed,
  ...leagueBoard,
  ...leagueCards,
  ...leagueMembers,
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
};
