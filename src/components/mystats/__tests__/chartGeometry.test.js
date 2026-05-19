import { scalePoints, toSegments } from '../chartGeometry';

const BOX = { width: 100, height: 100, padX: 0, padTop: 0, padBottom: 0 };

describe('scalePoints', () => {
  test('returns one point per input value', () => {
    expect(scalePoints([1, 2, 3], BOX)).toHaveLength(3);
  });

  test('a single value is centred horizontally', () => {
    const [p] = scalePoints([5], BOX);
    expect(p.x).toBe(50);
  });

  test('min value maps to the bottom, max to the top', () => {
    const pts = scalePoints([10, 20], BOX);
    expect(pts[0].y).toBe(100); // min -> bottom
    expect(pts[1].y).toBe(0);   // max -> top
  });

  test('a flat series maps every point to the same y', () => {
    const pts = scalePoints([7, 7, 7], BOX);
    expect(pts.every((p) => p.y === pts[0].y)).toBe(true);
  });

  test('null values keep an x but carry a null y', () => {
    const pts = scalePoints([10, null, 20], BOX);
    expect(pts[1].y).toBeNull();
    expect(typeof pts[1].x).toBe('number');
  });

  test('empty input returns an empty array', () => {
    expect(scalePoints([], BOX)).toEqual([]);
  });
});

describe('toSegments', () => {
  test('splits a polyline on null gaps', () => {
    const pts = [
      { x: 0, y: 1 }, { x: 1, y: 2 },
      { x: 2, y: null },
      { x: 3, y: 3 },
    ];
    const segs = toSegments(pts);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toHaveLength(2);
    expect(segs[1]).toHaveLength(1);
  });
});
