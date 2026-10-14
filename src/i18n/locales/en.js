// English catalogue, assembled from the per-area modules in ./en/.
// Flat keys, 'area.screen.what'. See docs/i18n.md. Add strings to an area module, not here.
// A plural entry is { one, other } and reads {count}.
import auth from './en/auth';
import common from './en/common';
import leagueBoard from './en/leagueBoard';
import leagueCards from './en/leagueCards';
import leagueMembers from './en/leagueMembers';
import leagueShare from './en/leagueShare';
import leagueTimeline from './en/leagueTimeline';
import marker from './en/marker';
import onboarding from './en/onboarding';
import profile from './en/profile';
import scorecard from './en/scorecard';
import settings from './en/settings';
import tour from './en/tour';

export const AREAS = {
  auth,
  common,
  leagueBoard,
  leagueCards,
  leagueMembers,
  leagueShare,
  leagueTimeline,
  marker,
  onboarding,
  profile,
  scorecard,
  settings,
  tour,
};

export default {
  ...auth,
  ...common,
  ...leagueBoard,
  ...leagueCards,
  ...leagueMembers,
  ...leagueShare,
  ...leagueTimeline,
  ...marker,
  ...onboarding,
  ...profile,
  ...scorecard,
  ...settings,
  ...tour,
};
