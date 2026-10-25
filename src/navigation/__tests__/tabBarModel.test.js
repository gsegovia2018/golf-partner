import {
  CENTER_ROUTE_NAME,
  TAB_ROUTE_NAMES,
  getTabBarItem,
  isCenterTab,
  showsTabBar,
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

  test('maps secondary routes to modern Feather icon metadata', () => {
    expect(getTabBarItem('Feed')).toMatchObject({
      routeName: 'Feed',
      targetRouteName: 'Feed',
      label: 'Feed',
      icon: 'rss',
      center: false,
    });
    expect(getTabBarItem('MyStats')).toMatchObject({
      routeName: 'MyStats',
      targetRouteName: 'MyStats',
      label: 'Stats',
      icon: 'bar-chart-2',
      center: false,
    });
    expect(getTabBarItem('History')).toMatchObject({
      routeName: 'History',
      targetRouteName: 'History',
      label: 'History',
      icon: 'clock',
      center: false,
    });
    expect(getTabBarItem('Profile')).toMatchObject({
      routeName: 'Profile',
      targetRouteName: 'Profile',
      label: 'Profile',
      icon: 'user',
      center: false,
    });
  });

  test('uses Home as the center tab route', () => {
    expect(CENTER_ROUTE_NAME).toBe('Home');
    expect(isCenterTab('Home')).toBe(true);
    expect(isCenterTab('Feed')).toBe(false);
  });

  test('center action always opens Home as Play — the Home live banner covers resuming a round', () => {
    expect(getTabBarItem('Home')).toMatchObject({
      routeName: 'Home',
      targetRouteName: CENTER_ROUTE_NAME,
      label: 'Play',
      icon: 'flag',
      center: true,
    });
  });

  test('the bar shows on the tabs and the browse screens over them', () => {
    ['Main', 'Stats', 'PlayerStats', 'CoursesLibrary', 'Tournament', 'LeagueBoard', 'Settings', 'SwingHome']
      .forEach((name) => expect(showsTabBar(name)).toBe(true));
  });

  test('the bar stays out of focused tasks', () => {
    ['Scorecard', 'SwingCapture', 'SwingEditMarks', 'SwingResults', 'CourseEditor', 'Setup',
      'OfficialCreate', 'CoursePicker', 'LeagueAddScore', 'JoinLeague', 'ResetPassword', 'LeagueBoardPublic']
      .forEach((name) => expect(showsTabBar(name)).toBe(false));
  });
});
