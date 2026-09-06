// How long a round took, from the cards engine's hole timestamps.
//
// Every published hole carries `ts` — the instant the scorer left it (the
// cutover backfill stamped legacy holes with their score-entry time). The
// earliest hole across every scorer's card is the closest thing to a tee
// time the data has; the round ends at its finish stamp (finishStamp.js), or
// at the last hole published when nothing stamped it. Both ends are the
// round's own record, so the figure is the same on every phone.
//
// Caveats, by construction: a hole's ts is when it was LEFT, so the first
// hole's own play time is not counted; and a hole re-published later (a
// score fix) moves only that hole's ts, which the min/max over 18 holes
// absorbs.

const MIN_ROUND_MS = 10 * 60 * 1000;
const MAX_ROUND_MS = 10 * 60 * 60 * 1000;

// Earliest and latest hole publication across all cards, or null when no
// hole has been published yet.
export function roundSpan(cardsByAuthor) {
  let firstAt = Infinity;
  let lastAt = -Infinity;
  for (const card of Object.values(cardsByAuthor ?? {})) {
    for (const hole of Object.values(card?.holes ?? {})) {
      const ts = hole?.ts;
      if (!Number.isFinite(ts) || ts <= 0) continue;
      if (ts < firstAt) firstAt = ts;
      if (ts > lastAt) lastAt = ts;
    }
  }
  return firstAt === Infinity ? null : { firstAt, lastAt };
}

// Duration in ms, or null when it cannot be known or is implausible.
// Anything outside 10 min – 10 h is noise, not a round. The end is the later
// of the finish stamp and the last published hole — a phone that tapped
// Finish while another was still scoring must not cut the round short —
// unless that is implausible, in which case each on its own is tried: a
// score fixed days later must not stretch a stamped round, and a game
// archived from Home the next morning must not stretch an unstamped one.
export function roundDurationMs({ endAt = null, cardsByAuthor } = {}) {
  return spanDurationMs(roundSpan(cardsByAuthor), endAt);
}

// Same rule over a span computed elsewhere — the feed gets first/last hole
// per round from the get_round_activity RPC instead of pulling every card.
export function spanDurationMs(span, endAt = null) {
  if (!span || !Number.isFinite(span.firstAt) || !Number.isFinite(span.lastAt)) return null;
  const ends = endAt != null ? [Math.max(endAt, span.lastAt), endAt] : [];
  ends.push(span.lastAt);
  for (const end of ends) {
    const ms = end - span.firstAt;
    if (ms >= MIN_ROUND_MS && ms <= MAX_ROUND_MS) return ms;
  }
  return null;
}

// "48m", "4h", "3h 52m". Null in → null out, so callers can render nothing.
export function formatRoundDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
