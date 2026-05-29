import {
  CENTER_ROUTE_NAME,
  SCORECARD_ROUTE_NAME,
  TAB_ROUTE_NAMES,
  getTabBarItem,
  isCenterTab,
} from '../tabBarModel';

describe('tabBarModel', () => {
  test('defines the approved navbar route order', () => {
    expect(TAB_ROUTE_NAMES).toEqual([
      'Feed',
      'MyStats',
      'Home',
      'History',
      'Profile',
    ]);
  });

  test('maps secondary routes to modern MaterialCommunityIcons metadata', () => {
    expect(getTabBarItem('Feed')).toMatchObject({
      routeName: 'Feed',
      targetRouteName: 'Feed',
      label: 'Feed',
      icon: 'newspaper-variant-outline',
      center: false,
    });
    expect(getTabBarItem('MyStats')).toMatchObject({
      routeName: 'MyStats',
      targetRouteName: 'MyStats',
      label: 'Stats',
      icon: 'chart-bar',
      center: false,
    });
    expect(getTabBarItem('History')).toMatchObject({
      routeName: 'History',
      targetRouteName: 'History',
      label: 'History',
      icon: 'history',
      center: false,
    });
    expect(getTabBarItem('Profile')).toMatchObject({
      routeName: 'Profile',
      targetRouteName: 'Profile',
      label: 'Profile',
      icon: 'account-circle-outline',
      center: false,
    });
  });

  test('uses Home as the center tab route', () => {
    expect(CENTER_ROUTE_NAME).toBe('Home');
    expect(isCenterTab('Home')).toBe(true);
    expect(isCenterTab('Feed')).toBe(false);
  });

  test('center action opens Home as Play when no round is live', () => {
    expect(getTabBarItem('Home', { roundLive: false })).toMatchObject({
      routeName: 'Home',
      targetRouteName: CENTER_ROUTE_NAME,
      label: 'Play',
      icon: 'flag-variant',
      center: true,
      live: false,
    });
  });

  test('center action opens Scorecard as Score when a round is live', () => {
    expect(SCORECARD_ROUTE_NAME).toBe('Scorecard');
    expect(getTabBarItem('Home', { roundLive: true })).toMatchObject({
      routeName: 'Home',
      targetRouteName: SCORECARD_ROUTE_NAME,
      label: 'Score',
      icon: 'scoreboard-outline',
      center: true,
      live: true,
    });
  });
});
