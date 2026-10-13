// Step 1 of the marking canvas (D28, "Find the frame"): the whole-clip track, the zoomed row
// and which picture the big image shows while the golfer scrubs. Pure, except the tiny store at
// the end, which carries the frame under the finger to the two components that draw it (the
// picture and the scrubber), so a drag never re-renders the canvas.
//
// The picture, in order of preference:
//   the full-resolution still of the frame, when it is already on disk (sharp, and cached);
//   while dragging, the nearest scrub proxy (blurry by design, the tag says "scrubbing");
//   otherwise the last still shown: an apiVersion 2 binary, or a swing analysed before D28,
//   has no proxies, so the picture waits for the release, where ensureStills() fills it in.

export const ZOOM_REACH = 4; // the zoomed row: the cursor ±4, every frame
export const TICK_SLOP = 14; // px: a tap this close to a position tick or the flag snaps to it

function clamp(v, lo, hi) {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
}

/** The frame at x px of a track `width` px wide over frames 0..maxFrame. */
export function trackFrame(x, width, maxFrame) {
  'worklet';
  if (!(width > 0) || !(maxFrame > 0)) return 0;
  return Math.round(clamp(x / width, 0, 1) * maxFrame);
}

/** Where a frame sits on the track, px. */
export function trackX(frame, width, maxFrame) {
  'worklet';
  if (!(width > 0) || !(maxFrame > 0)) return 0;
  return (clamp(frame, 0, maxFrame) / maxFrame) * width;
}

/**
 * A tap on the track: the nearest target frame (the six position ticks, the proposal flag)
 * within TICK_SLOP px, else the frame under the finger.
 */
export function snapFrame(x, width, maxFrame, targets, slop = TICK_SLOP) {
  'worklet';
  let best = -1;
  let bestD = slop + 1;
  for (let k = 0; k < targets.length; k += 1) {
    const d = Math.abs(trackX(targets[k], width, maxFrame) - x);
    if (d < bestD) { best = targets[k]; bestD = d; }
  }
  return best >= 0 ? best : trackFrame(x, width, maxFrame);
}

/** The zoomed row's frames: cursor ±reach, null where the clip ends (the slot stays, empty). */
export function zoomFrames(center, maxFrame, reach = ZOOM_REACH) {
  const out = [];
  for (let d = -reach; d <= reach; d += 1) {
    const f = center + d;
    out.push(f >= 0 && f <= maxFrame ? f : null);
  }
  return out;
}

/**
 * What the big picture shows for `frame`.
 * @param {{ frame:number, dragging:boolean, still:string|null, proxy:string|null,
 *   last:{ frame:number|null, uri:string|null } }} a
 *   still: the frame's full-res still if on disk; proxy: its nearest proxy if any; last: the still on screen
 * @returns {{ uri:string|null, kind:'still'|'proxy'|'last', exact:boolean }}
 *   exact = the picture is this frame at full resolution (marks may be placed on it)
 */
export function scrubSource({
  frame, dragging, still, proxy, last,
}) {
  if (still) return { uri: still, kind: 'still', exact: true };
  if (proxy) return { uri: proxy, kind: 'proxy', exact: false };
  return { uri: last?.uri ?? null, kind: 'last', exact: !dragging && last?.frame === frame && !!last?.uri };
}

/** A thumbnail of the zoomed row: the still, else the nearest proxy, else nothing yet. */
export const thumbSource = (still, proxy) => still ?? proxy ?? null;

/** The frame under the finger while the track is dragged (null when it is not). */
export function createScrub() {
  let frame = null;
  const listeners = new Set();
  return {
    get: () => frame,
    set: (f) => {
      if (f === frame) return;
      frame = f;
      listeners.forEach((l) => l());
    },
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
  };
}
