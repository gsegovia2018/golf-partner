import {
  BAR_HEIGHT, COLLAPSE_AFTER, STRIP_GAP, STRIP_HEIGHT, barBottom, nextCollapsed, tabBarClearance,
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
