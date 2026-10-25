import { t } from '../i18n';

export const CENTER_ROUTE_NAME = 'Home';

export const TAB_ROUTE_NAMES = [
  'Feed',
  'MyStats',
  CENTER_ROUTE_NAME,
  'History',
  'Profile',
];

// Screens opened over the tabs that keep the bar: places you browse, where
// jumping to another tab is natural. Everything else (the scorecard, swing
// capture and marking, create / setup flows, pickers, joins) is a task the
// bar would only interrupt, so it fades out there.
export const BAR_ROUTE_NAMES = new Set([
  'Stats', 'MyStats', 'PlayerStats', 'CourseStats', 'ClubStat', 'LeagueStats',
  'CoursesLibrary', 'CourseLibraryDetail', 'PlayersLibrary', 'Players', 'Friends', 'Bag',
  'Tournament', 'LeagueBoard', 'LeagueMembers', 'PartyBoard', 'SharedBoard', 'RoundSummary', 'Finished',
  'Profile', 'Settings', 'Notifications', 'Gallery', 'SwingHome',
]);

// rootRouteName: the route on top of the root stack ('Main' is the tabs).
export function showsTabBar(rootRouteName) {
  return rootRouteName === 'Main' || BAR_ROUTE_NAMES.has(rootRouteName);
}

const TAB_BAR_ITEMS = {
  Feed: {
    labelKey: 'nav.tab.feed',
    icon: 'rss',
  },
  MyStats: {
    labelKey: 'nav.tab.stats',
    icon: 'bar-chart-2',
  },
  Home: {
    labelKey: 'nav.tab.play',
    icon: 'flag',
  },
  History: {
    labelKey: 'nav.tab.history',
    icon: 'clock',
  },
  Profile: {
    labelKey: 'nav.tab.profile',
    icon: 'user',
  },
};

export function isCenterTab(routeName) {
  return routeName === CENTER_ROUTE_NAME;
}

// The center action always lands on Home — Home's live-round banner is the
// way back into a scorecard, so the tab bar no longer redirects mid-round.
export function getTabBarItem(routeName) {
  const base = TAB_BAR_ITEMS[routeName] ?? {
    labelKey: null,
    icon: 'circle-outline',
  };
  return {
    ...base,
    label: base.labelKey ? t(base.labelKey) : routeName,
    routeName,
    targetRouteName: routeName,
    center: isCenterTab(routeName),
  };
}
