import React from 'react';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import FairwayFan, {
  fanLayout, polarToCartesian, wedgePath, FAN_ARC_DEG, MIN_WEDGE_DEG,
} from '../FairwayFan';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => new Promise(() => {})),
  setItem: jest.fn(),
}));

jest.mock('react-native-reanimated', () => {
  const Reanimated = jest.requireActual('react-native-reanimated/mock');
  return {
    ...Reanimated,
    useReducedMotion: () => true,
  };
});

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('polarToCartesian', () => {
  test('0° points straight up from the origin', () => {
    const p = polarToCartesian(85, 142, 100, 0);
    expect(p.x).toBeCloseTo(85);
    expect(p.y).toBeCloseTo(42);
  });

  test('90° points right (clockwise-positive)', () => {
    const p = polarToCartesian(85, 142, 100, 90);
    expect(p.x).toBeCloseTo(185);
    expect(p.y).toBeCloseTo(142);
  });

  test('negative degrees point left', () => {
    const p = polarToCartesian(85, 142, 100, -90);
    expect(p.x).toBeCloseTo(-15);
    expect(p.y).toBeCloseTo(142);
  });
});

describe('wedgePath', () => {
  test('builds a closed arc path from the origin', () => {
    const d = wedgePath(85, 142, 100, -48, 48);
    expect(d.startsWith('M 85 142 L ')).toBe(true);
    expect(d).toContain('A 100 100');
    expect(d.endsWith('Z')).toBe(true);
  });
});

describe('fanLayout', () => {
  test('spans are proportional to each bucket share and fill the arc in spatial order', () => {
    const { wedges } = fanLayout({ left: 1, fairway: 2, super: 1 }, 4);
    expect(wedges.map((w) => w.key)).toEqual(['left', 'fairway', 'super']);
    expect(wedges[0].startDeg).toBeCloseTo(-FAN_ARC_DEG / 2);
    expect(wedges[0].endDeg - wedges[0].startDeg).toBeCloseTo(24);
    expect(wedges[1].endDeg - wedges[1].startDeg).toBeCloseTo(48);
    expect(wedges[2].endDeg).toBeCloseTo(FAN_ARC_DEG / 2);
    expect(wedges.map((w) => w.share)).toEqual([0.25, 0.5, 0.25]);
  });

  test('zero-count buckets are omitted', () => {
    const { wedges } = fanLayout({ left: 0, fairway: 3, super: 0, right: 1 }, 4);
    expect(wedges.map((w) => w.key)).toEqual(['fairway', 'right']);
  });

  test('a tiny nonzero bucket keeps the minimum span, shaved off larger wedges', () => {
    const { wedges } = fanLayout({ left: 1, fairway: 98, super: 1 }, 100);
    const spans = Object.fromEntries(wedges.map((w) => [w.key, w.endDeg - w.startDeg]));
    expect(spans.left).toBeCloseTo(MIN_WEDGE_DEG);
    expect(spans.super).toBeCloseTo(MIN_WEDGE_DEG);
    // Total still fills the whole arc.
    const total = wedges.reduce((sum, w) => sum + (w.endDeg - w.startDeg), 0);
    expect(total).toBeCloseTo(FAN_ARC_DEG);
    expect(spans.fairway).toBeCloseTo(FAN_ARC_DEG - 2 * MIN_WEDGE_DEG);
  });

  test('short drives become a centered stub, not a fan wedge', () => {
    const { wedges, short } = fanLayout({ fairway: 2, short: 2 }, 4);
    expect(wedges.map((w) => w.key)).toEqual(['fairway']);
    // The remaining fan bucket takes the full arc.
    expect(wedges[0].endDeg - wedges[0].startDeg).toBeCloseTo(FAN_ARC_DEG);
    expect(short.share).toBe(0.5);
    expect(short.startDeg).toBeCloseTo(-short.endDeg); // centered on the fairway line
  });

  test('all-short recordings leave no fan wedges but keep the stub', () => {
    const { wedges, short } = fanLayout({ short: 3 }, 3);
    expect(wedges).toEqual([]);
    expect(short.count).toBe(3);
  });

  test('no recorded drives ⇒ nothing to lay out', () => {
    expect(fanLayout({ fairway: 1 }, 0)).toEqual({ wedges: [], short: null });
  });
});

describe('FairwayFan component', () => {
  const drives = {
    recorded: 20,
    distribution: { fairway: 10, left: 4, right: 3, super: 2, short: 1 },
  };

  test('renders background, one wedge per nonzero bucket, stub, and tee dot', () => {
    const { getByTestId } = render(wrap(<FairwayFan drives={drives} />));
    expect(getByTestId('fan-background')).toBeTruthy();
    ['left', 'fairway', 'super', 'right', 'short'].forEach((key) => {
      expect(getByTestId(`fan-wedge-${key}`)).toBeTruthy();
    });
    expect(getByTestId('fan-tee')).toBeTruthy();
  });

  test('omits wedges and legend rows for zero buckets', () => {
    const { queryByTestId } = render(wrap(
      <FairwayFan drives={{ recorded: 5, distribution: { fairway: 5 } }} />
    ));
    expect(queryByTestId('fan-wedge-fairway')).toBeTruthy();
    expect(queryByTestId('fan-wedge-left')).toBeNull();
    expect(queryByTestId('fan-wedge-short')).toBeNull();
    expect(queryByTestId('fan-legend-fairway')).toBeTruthy();
    expect(queryByTestId('fan-legend-left')).toBeNull();
  });

  test('legend shows each bucket share of recorded drives', () => {
    const { getByText } = render(wrap(<FairwayFan drives={drives} />));
    expect(getByText('Fairway')).toBeTruthy();
    expect(getByText('50%')).toBeTruthy();  // 10 / 20
    expect(getByText('20%')).toBeTruthy();  // left 4 / 20
    expect(getByText('5%')).toBeTruthy();   // short 1 / 20
  });

  test('renders nothing without recorded drives', () => {
    const { toJSON } = render(wrap(
      <FairwayFan drives={{ recorded: 0, distribution: {} }} />
    ));
    expect(toJSON()).toBeNull();
  });
});
