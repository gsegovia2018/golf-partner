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
    label: 'Feed',
    icon: 'rss',
  },
  MyStats: {
    label: 'Stats',
    icon: 'bar-chart-2',
  },
  Home: {
    label: 'Play',
    icon: 'flag',
  },
  History: {
    label: 'History',
    icon: 'clock',
  },
  Profile: {
    label: 'Profile',
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
    label: routeName,
    icon: 'circle-outline',
  };
  return {
    ...base,
    routeName,
    targetRouteName: routeName,
    center: isCenterTab(routeName),
  };
}
