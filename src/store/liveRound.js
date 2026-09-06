// When is a round LIVE — being played right now — rather than merely
// unfinished? A round abandoned after three holes in July is unfinished for
// ever; it must not wear a LIVE pill in September. Play has started, not
// everyone has finished, nothing has archived it, and the last hole anyone
// published is recent. A day on the course with a long lunch is still one
// round, so the window is generous.
export const LIVE_WINDOW_MS = 6 * 60 * 60 * 1000;

// `lastActivityAt` is ms, or null when unknown (offline cache-only build):
// unknown recency does not demote a round that otherwise looks live.
export function isRoundLive({
  finished, holesPlayed, totalHoles, lastActivityAt = null, now = Date.now(),
}) {
  if (finished) return false;
  if (!(holesPlayed > 0) || !(holesPlayed < totalHoles)) return false;
  if (lastActivityAt == null) return true;
  return now - lastActivityAt <= LIVE_WINDOW_MS;
}
