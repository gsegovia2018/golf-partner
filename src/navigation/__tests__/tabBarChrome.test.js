import {
  BAR_COLLAPSED, BAR_HEIGHT, COLLAPSE_AFTER, SHRUNK_GAP, STRIP_GAP, STRIP_HEIGHT, barBottom, nextCollapsed, shrunkLayout, tabBarClearance,
} from '../tabBarChrome';

describe('nextCollapsed', () => {
  test('stays open near the top whatever the direction', () => {
    expect(nextCollapsed(false, COLLAPSE_AFTER - 1, 40)).toBe(false);
    expect(nextCollapsed(true, 0, -2)).toBe(false);
  });

  test('scrolling down collapses, scrolling up opens', () => {
    expect(nextCollapsed(false, 200, 10)).toBe(true);
    expect(nextCollapsed(true, 200, -12)).toBe(false);
  });

  test('ignores small jitters either way', () => {
    expect(nextCollapsed(false, 200, 3)).toBe(false);
    expect(nextCollapsed(true, 200, -5)).toBe(true);
  });
});

describe('tabBarClearance', () => {
  test('clears the bar, plus the strip when a round is live', () => {
    const base = tabBarClearance(0, false);
    expect(base).toBe(barBottom(0) + BAR_HEIGHT + 16);
    expect(tabBarClearance(0, true) - base).toBe(STRIP_GAP + STRIP_HEIGHT);
  });

  test('follows the gesture-bar inset once it is taller than the minimum gap', () => {
    expect(barBottom(0)).toBe(barBottom(12));
    expect(barBottom(34)).toBe(barBottom(12) + 22);
  });
});

describe('shrunkLayout', () => {
  const frame = { windowWidth: 390, left: 16, barWidth: 358 };

  test('without a live round the two circles pair up in the middle', () => {
    const { tab, play } = shrunkLayout({ ...frame, hasLive: false });
    expect(play - (tab + BAR_COLLAPSED)).toBe(SHRUNK_GAP);
    expect((tab + play + BAR_COLLAPSED) / 2).toBe(195);
  });

  test('with a live round they sit at the bar ends around the strip', () => {
    expect(shrunkLayout({ ...frame, hasLive: true })).toEqual({ tab: 16, play: 16 + 358 - BAR_COLLAPSED });
  });
});
