import { captureMessage } from '../../lib/errorReporting';
import {
  _resetTabBarWatchForTests, noteTabBar, readTabBar, reportTabBarByUser, reportTabBarIfHidden,
  setTabBarProbe, tabBarLooksHidden,
} from '../tabBarWatch';

jest.mock('../../lib/errorReporting', () => ({ captureMessage: jest.fn() }));

const shownBar = { visible: true, shown: 1, mounted: true, keyboard: false, menuOpen: false, open: 0 };

describe('tabBarWatch', () => {
  beforeEach(() => {
    _resetTabBarWatchForTests();
    captureMessage.mockClear();
  });

  it('sees a bar that should show but is faded, unmounted or behind the keyboard', () => {
    expect(tabBarLooksHidden(shownBar)).toBe(false);
    expect(tabBarLooksHidden({ ...shownBar, shown: 0 })).toBe(true);
    expect(tabBarLooksHidden({ ...shownBar, mounted: false })).toBe(true);
    expect(tabBarLooksHidden({ ...shownBar, keyboard: true })).toBe(true);
    expect(tabBarLooksHidden({ ...shownBar, open: 1 })).toBe(true);
    expect(tabBarLooksHidden({ ...shownBar, visible: false, shown: 0 })).toBe(false);
  });

  it('merges the host and bar probes', () => {
    setTabBarProbe('host', () => ({ top: 'Main', visible: true, shown: 1 }));
    setTabBarProbe('bar', () => ({ mounted: true, tab: 'History' }));
    expect(readTabBar()).toEqual({ top: 'Main', visible: true, shown: 1, mounted: true, tab: 'History' });
  });

  it('reports a hidden bar once, with the trail', () => {
    noteTabBar('route', { top: 'Scorecard' });
    noteTabBar('route', { top: 'Tournament' });
    expect(reportTabBarIfHidden({ ...shownBar, shown: 0 })).toBe(true);
    expect(captureMessage).toHaveBeenCalledWith('Tab bar: hidden after navigation', expect.objectContaining({
      shown: 0,
      trail: [
        expect.objectContaining({ what: 'route', top: 'Scorecard' }),
        expect.objectContaining({ what: 'route', top: 'Tournament' }),
      ],
    }));
    expect(reportTabBarIfHidden({ ...shownBar, shown: 0 })).toBe(false);
    expect(captureMessage).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the bar looks right', () => {
    expect(reportTabBarIfHidden(shownBar)).toBe(false);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('sends a user report whatever the state says', () => {
    expect(reportTabBarByUser(shownBar)).toBe(true);
    expect(captureMessage).toHaveBeenCalledWith('Tab bar: reported by user', expect.objectContaining({ shown: 1 }));
  });
});
