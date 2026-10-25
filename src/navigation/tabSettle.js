// A tab screen's focus work (reloads, clocks) waits for the bar's slide to
// end. Every tab refetches on focus, and its re-render used to land mid-slide
// and stall it (100-300 ms on a Pixel 8 Pro). Outside a tab switch it runs
// at once, so stack screens and returning from a push are unchanged.
export const TAB_SETTLE_MS = 520;
let settleAt = 0;

export function markTabSwitch(now = Date.now()) {
  settleAt = now + TAB_SETTLE_MS;
}

// Runs fn once the slide has settled; returns a cancel.
export function afterTabSettles(fn) {
  const wait = settleAt - Date.now();
  if (wait <= 0) {
    fn();
    return () => {};
  }
  const id = setTimeout(fn, wait);
  return () => clearTimeout(id);
}
