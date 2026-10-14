import { t } from '../i18n';

export const CENTER_ROUTE_NAME = 'Home';

export const TAB_ROUTE_NAMES = [
  'Feed',
  'MyStats',
  CENTER_ROUTE_NAME,
  'History',
  'Profile',
];

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
