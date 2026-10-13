// The loupe's geometry (D20): where it sits and which part of the still it shows.
import {
  LOUPE_SIZE, LOUPE_ZOOM, LOUPE_OFFSET, LOUPE_FLASH_MS, loupePlacement, loupeImage,
} from '../loupe';
import { fitRect } from '../../components/swing/SwingOverlay';

const R = LOUPE_SIZE / 2;

describe('constants', () => {
  test('about 120 px across at 3x, 80 px clear of the finger, a nudge keeps it up 600 ms', () => {
    expect([LOUPE_SIZE, LOUPE_ZOOM, LOUPE_OFFSET, LOUPE_FLASH_MS]).toEqual([120, 3, 80, 600]);
  });
});

describe('loupePlacement', () => {
  const rect = { w: 300, h: 500 };

  test('sits above the finger, its centre LOUPE_OFFSET up, so the fingertip never covers it', () => {
    const p = loupePlacement([150, 300], rect);
    expect(p.placement).toBe('above');
    expect([p.cx, p.cy]).toEqual([150, 220]);
    expect([p.left, p.top]).toEqual([150 - R, 220 - R]);
    expect(p.top + LOUPE_SIZE).toBeLessThan(300); // the whole circle is above the finger point
  });

  test('flips below when there is no room above (near the top edge)', () => {
    const p = loupePlacement([150, 100], rect); // 100 - 80 - 60 < 0
    expect(p.placement).toBe('below');
    expect(p.cy).toBe(180);
    expect(p.top).toBeGreaterThan(100); // clear of the finger on the other side
  });

  test('the flip is exact at the boundary: it still fits above at 140 px, flips just under it', () => {
    expect(loupePlacement([150, 140], rect).placement).toBe('above');
    expect(loupePlacement([150, 139], rect).placement).toBe('below');
  });

  test('clamps horizontally so the whole circle stays inside the still', () => {
    expect(loupePlacement([5, 300], rect).left).toBe(0);
    expect(loupePlacement([298, 300], rect).left).toBe(300 - LOUPE_SIZE);
    expect(loupePlacement([150, 300], rect).left).toBe(90);
  });

  test('a corner: top-left flips below and clamps, and never leaves the picture', () => {
    const p = loupePlacement([0, 0], rect);
    expect(p.placement).toBe('below');
    expect(p.left).toBe(0);
    expect(p.top).toBeGreaterThanOrEqual(0);
    expect(p.top + LOUPE_SIZE).toBeLessThanOrEqual(rect.h);
  });

  test('a still shorter than the loupe still gets a position inside it (clamped)', () => {
    const p = loupePlacement([50, 30], { w: 200, h: 100 });
    expect(p.top).toBeGreaterThanOrEqual(0);
  });
});

describe('loupeImage', () => {
  // The video pixel under the centre of the loupe, whatever the picture's size.
  const pixelAtCentre = (img, videoW, videoH) => [
    ((R - img.left) / img.width) * videoW,
    ((R - img.top) / img.height) * videoH,
  ];

  test('is the whole picture at 3x', () => {
    const img = loupeImage([0.5, 0.5], { w: 200, h: 400 });
    expect([img.width, img.height]).toEqual([600, 1200]);
  });

  test('puts the marked pixel at the centre: the mark at the middle of the picture', () => {
    const img = loupeImage([0.5, 0.5], { w: 200, h: 400 });
    expect([img.left, img.top]).toEqual([R - 300, R - 600]);
  });

  test('a mark at the top-left corner shows the corner at the centre of the loupe', () => {
    const img = loupeImage([0, 0], { w: 200, h: 400 });
    expect([img.left, img.top]).toEqual([R, R]);
  });

  test('a mark moving right by d view px moves the image left by 3 d: it magnifies the move', () => {
    const rect = { w: 200, h: 400 };
    const a = loupeImage([0.5, 0.5], rect);
    const b = loupeImage([0.5 + 10 / rect.w, 0.5], rect); // 10 view px to the right
    expect(a.left - b.left).toBeCloseTo(30, 9);
    expect(a.top).toBe(b.top);
  });

  test.each([
    ['a portrait clip in a wider box (pillar-boxed)', [440, 667], [478, 850]],
    ['a landscape clip in a tall box (letter-boxed)', [440, 667], [1920, 1080]],
    ['a clip that exactly fills its box', [478, 850], [478, 850]],
  ])('letterbox / contain offsets do not shift the magnified point: %s', (_n, [boxW, boxH], [vw, vh]) => {
    const rect = fitRect(boxW, boxH, vw, vh);
    [[0.5, 0.5], [0.12, 0.8], [0.93, 0.07], [0, 1]].forEach((mark) => {
      // The mark in the box is rect.x + n * rect.w (offsets included) ...
      const inBox = [rect.x + mark[0] * rect.w, rect.y + mark[1] * rect.h];
      // ... and a touch there, taken back into the picture, is the same normalised mark.
      const back = [(inBox[0] - rect.x) / rect.w, (inBox[1] - rect.y) / rect.h];
      expect(back[0]).toBeCloseTo(mark[0], 9);
      expect(back[1]).toBeCloseTo(mark[1], 9);
      // The loupe centre shows exactly that video pixel.
      const [px, py] = pixelAtCentre(loupeImage(mark, { w: rect.w, h: rect.h }), vw, vh);
      expect(px).toBeCloseTo(mark[0] * vw, 6);
      expect(py).toBeCloseTo(mark[1] * vh, 6);
    });
  });

  test('the letterbox offset itself is not part of the image shift (the loupe has its own frame)', () => {
    const rect = fitRect(440, 667, 1920, 1080); // y offset > 0
    expect(rect.y).toBeGreaterThan(0);
    const img = loupeImage([0.5, 0.5], { w: rect.w, h: rect.h });
    expect(img.top).toBeCloseTo(R - 0.5 * rect.h * 3, 9);
  });
});

describe('D28: the loupe in the corner opposite the mark', () => {
  const { loupeCorner, loupeSide, LOUPE_MARGIN } = require('../loupe');
  const rect = { w: 320, h: 570 };

  test('right-hand corners, inside the picture', () => {
    expect(loupeCorner(0, rect)).toEqual({ left: 320 - LOUPE_SIZE - LOUPE_MARGIN, top: LOUPE_MARGIN });
    expect(loupeCorner(1, rect)).toEqual({ left: 320 - LOUPE_SIZE - LOUPE_MARGIN, top: 570 - LOUPE_SIZE - LOUPE_MARGIN });
  });

  test('a mark in the top half gets the bottom corner (clubhead at Top), one in the bottom half the top corner (ball, clubhead at impact)', () => {
    expect(loupeSide([240, 120], rect)).toBe(1);
    expect(loupeSide([110, 480], rect)).toBe(0);
  });

  test('it stays put during a drag until the mark comes near the ring', () => {
    expect(loupeSide([110, 200], rect, LOUPE_SIZE, 0)).toBe(0); // top half, far from the top-right ring
    const at = loupeCorner(0, rect);
    expect(loupeSide([at.left + 60, at.top + 60], rect, LOUPE_SIZE, 0)).toBe(1);
    expect(loupeSide([at.left - 20, at.top + 60], rect, LOUPE_SIZE, 0)).toBe(1); // 80 px from the centre: within ring + clearance (84)
    expect(loupeSide([at.left - 30, at.top + 60], rect, LOUPE_SIZE, 0)).toBe(0);
  });
});
