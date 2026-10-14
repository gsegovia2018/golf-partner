// Step 1's scrub logic (D28): the whole-clip track, the zoomed row and which picture shows.
import {
  trackFrame, trackX, snapFrame, zoomFrames, scrubSource, thumbSource, createScrub, TICK_SLOP,
} from '../scrub';

describe('the whole-clip track', () => {
  test('maps the finger to any frame of the clip, both ends included, and back', () => {
    expect(trackFrame(0, 300, 959)).toBe(0);
    expect(trackFrame(300, 300, 959)).toBe(959);
    expect(trackFrame(150, 300, 959)).toBe(480);
    expect(trackFrame(-20, 300, 959)).toBe(0); // the finger slid off the left end
    expect(trackFrame(999, 300, 959)).toBe(959);
    expect(trackX(480, 300, 959)).toBeCloseTo(150.16, 2);
    for (let f = 0; f <= 959; f += 37) expect(trackFrame(trackX(f, 300, 959), 300, 959)).toBe(f);
    expect(trackFrame(10, 0, 959)).toBe(0); // not laid out yet
  });

  test('a tap snaps to the nearest position tick or flag within the slop, else it is the frame under it', () => {
    const ticks = [300, 433, 495, 535, 556, 568];
    expect(snapFrame(trackX(495, 300, 959) + 5, 300, 959, ticks)).toBe(495);
    expect(snapFrame(trackX(300, 300, 959) - TICK_SLOP + 1, 300, 959, ticks)).toBe(300);
    expect(snapFrame(trackX(300, 300, 959) - TICK_SLOP - 2, 300, 959, ticks)).not.toBe(300);
    expect(snapFrame(trackX(556, 300, 959) + 1, 300, 959, ticks)).toBe(556); // 556 and 568 are 3.7 px apart: the nearer wins
    expect(snapFrame(10, 300, 959, ticks)).toBe(trackFrame(10, 300, 959));
  });
});

describe('the zoomed row', () => {
  test('the cursor ±4, every frame; empty slots past the ends of the clip', () => {
    expect(zoomFrames(500, 959)).toEqual([496, 497, 498, 499, 500, 501, 502, 503, 504]);
    expect(zoomFrames(1, 959)).toEqual([null, null, null, 0, 1, 2, 3, 4, 5]);
    expect(zoomFrames(958, 959).slice(-3)).toEqual([null, null, null]);
  });

  test('a thumbnail is the still, else the proxy, else nothing yet', () => {
    expect(thumbSource('s', 'p')).toBe('s');
    expect(thumbSource(null, 'p')).toBe('p');
    expect(thumbSource(null, null)).toBeNull();
  });
});

describe('the picture while scrubbing (proxy vs still)', () => {
  const last = { frame: 300, uri: 'still-300' };
  test('a full-res still on disk always wins, dragging or not', () => {
    expect(scrubSource({ frame: 302, dragging: true, still: 'still-302', proxy: 'proxy-304', last })).toEqual({ uri: 'still-302', kind: 'still', exact: true });
  });
  test('dragging onto a frame with no still: the nearest proxy', () => {
    expect(scrubSource({ frame: 530, dragging: true, still: null, proxy: 'proxy-532', last })).toEqual({ uri: 'proxy-532', kind: 'proxy', exact: false });
  });
  test('released on it, while the full-res still is being extracted: still the proxy, not exact', () => {
    expect(scrubSource({ frame: 530, dragging: false, still: null, proxy: 'proxy-532', last })).toMatchObject({ kind: 'proxy', exact: false });
  });
  test('apiVersion 2 / no proxies: the last still stays while dragging, and it is not this frame', () => {
    expect(scrubSource({ frame: 530, dragging: true, still: null, proxy: null, last })).toEqual({ uri: 'still-300', kind: 'last', exact: false });
    expect(scrubSource({ frame: 300, dragging: false, still: null, proxy: null, last })).toMatchObject({ kind: 'last', exact: true });
  });
});

describe('the scrub store', () => {
  test('tells its listeners when the frame under the finger changes, and only then', () => {
    const s = createScrub();
    const l = jest.fn();
    const off = s.subscribe(l);
    s.set(10);
    s.set(10);
    s.set(11);
    s.set(null);
    expect(l).toHaveBeenCalledTimes(3);
    expect(s.get()).toBeNull();
    off();
    s.set(12);
    expect(l).toHaveBeenCalledTimes(3);
  });
});
