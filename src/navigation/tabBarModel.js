export const CENTER_ROUTE_NAME = 'Home';
export const SCORECARD_ROUTE_NAME = 'Scorecard';

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
    icon: 'newspaper-variant-outline',
  },
  MyStats: {
    label: 'Stats',
    icon: 'chart-bar',
  },
  Home: {
    label: 'Play',
    icon: 'flag-variant',
  },
  History: {
    label: 'History',
    icon: 'history',
  },
  Profile: {
    label: 'Profile',
    icon: 'account-circle-outline',
  },
};

export function isCenterTab(routeName) {
  return routeName === CENTER_ROUTE_NAME;
}

export function getTabBarItem(routeName, { roundLive = false } = {}) {
  const base = TAB_BAR_ITEMS[routeName] ?? {
    label: routeName,
    icon: 'circle-outline',
  };
  const center = isCenterTab(routeName);

  if (!center) {
    return {
      ...base,
      routeName,
      targetRouteName: routeName,
      center: false,
    };
  }

  const live = Boolean(roundLive);
  return {
    ...base,
    routeName,
    targetRouteName: live ? SCORECARD_ROUTE_NAME : CENTER_ROUTE_NAME,
    label: live ? 'Score' : 'Play',
    icon: live ? 'scoreboard-outline' : 'flag-variant',
    center: true,
    live,
  };
}
