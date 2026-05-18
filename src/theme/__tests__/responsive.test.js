import {
  BREAKPOINTS,
  CONTENT_MAX_WIDTH,
  deriveResponsive,
} from '../responsive';

describe('constants', () => {
  test('breakpoints and content cap have expected values', () => {
    expect(BREAKPOINTS).toEqual({ md: 600, lg: 960 });
    expect(CONTENT_MAX_WIDTH).toBe(960);
  });
});

describe('deriveResponsive', () => {
  test('phone width is compact, 1 column, not wide', () => {
    const r = deriveResponsive(390);
    expect(r.isCompact).toBe(true);
    expect(r.isWide).toBe(false);
    expect(r.gridColumns).toBe(1);
    expect(r.width).toBe(390);
  });

  test('599 is still compact (boundary)', () => {
    expect(deriveResponsive(599).isCompact).toBe(true);
    expect(deriveResponsive(599).gridColumns).toBe(1);
  });

  test('600 is regular: not compact, not wide, 2 columns', () => {
    const r = deriveResponsive(600);
    expect(r.isCompact).toBe(false);
    expect(r.isWide).toBe(false);
    expect(r.gridColumns).toBe(2);
  });

  test('959 is still regular (boundary)', () => {
    const r = deriveResponsive(959);
    expect(r.isWide).toBe(false);
    expect(r.gridColumns).toBe(2);
  });

  test('960 is wide: 3 columns', () => {
    const r = deriveResponsive(960);
    expect(r.isCompact).toBe(false);
    expect(r.isWide).toBe(true);
    expect(r.gridColumns).toBe(3);
  });
});
