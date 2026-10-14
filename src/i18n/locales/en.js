// English catalogue, assembled from the per-area modules in ./en/.
// Flat keys, 'area.screen.what'. See docs/i18n.md. Add strings to an area module, not here.
// A plural entry is { one, other } and reads {count}.
import auth from './en/auth';
import common from './en/common';
import courses from './en/courses';
import holeMap from './en/holeMap';
import feed from './en/feed';
import leagueBoard from './en/leagueBoard';
import leagueCards from './en/leagueCards';
import leagueMembers from './en/leagueMembers';
import leagueShare from './en/leagueShare';
import leagueTimeline from './en/leagueTimeline';
import marker from './en/marker';
import notifications from './en/notifications';
import onboarding from './en/onboarding';
import players from './en/players';
import profile from './en/profile';
import scorecard from './en/scorecard';
import settings from './en/settings';
import shots from './en/shots';
import tour from './en/tour';
import statsScreen from './en/statsScreen';
import statExplainers from './en/statExplainers';
import statsTabs from './en/statsTabs';
import myStats from './en/myStats';
import playerStats from './en/playerStats';

import home from './en/home';
import setup from './en/setup';
import rounds from './en/rounds';
import official from './en/official';

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
  settings,
  shots,
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
  ...settings,
  ...shots,
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
