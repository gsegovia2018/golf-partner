// Spanish catalogue, assembled from the per-area modules in ./es/.
// Flat keys, 'area.screen.what'. See docs/i18n.md. Add strings to an area module, not here.
// A plural entry is { one, other } and reads {count}.
import auth from './es/auth';
import common from './es/common';
import courses from './es/courses';
import holeMap from './es/holeMap';
import leagueBoard from './es/leagueBoard';
import leagueCards from './es/leagueCards';
import leagueMembers from './es/leagueMembers';
import leagueShare from './es/leagueShare';
import leagueTimeline from './es/leagueTimeline';
import marker from './es/marker';
import onboarding from './es/onboarding';
import players from './es/players';
import profile from './es/profile';
import scorecard from './es/scorecard';
import settings from './es/settings';
import shots from './es/shots';
import tour from './es/tour';

export const AREAS = {
  auth,
  common,
  courses,
  holeMap,
  leagueBoard,
  leagueCards,
  leagueMembers,
  leagueShare,
  leagueTimeline,
  marker,
  onboarding,
  players,
  profile,
  scorecard,
  settings,
  shots,
  tour,
};

export default {
  ...auth,
  ...common,
  ...courses,
  ...holeMap,
  ...leagueBoard,
  ...leagueCards,
  ...leagueMembers,
  ...leagueShare,
  ...leagueTimeline,
  ...marker,
  ...onboarding,
  ...players,
  ...profile,
  ...scorecard,
  ...settings,
  ...shots,
  ...tour,
};
