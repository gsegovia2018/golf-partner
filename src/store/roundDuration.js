// How long a round took, from the cards engine's hole timestamps.
//
// Every published hole carries `ts` — the instant the scorer left it (the
// cutover backfill stamped legacy holes with their score-entry time). The
// earliest hole across every scorer's card is the closest thing to a tee
// time the data has; the round ends at its finish stamp (finishStamp.js), or
// at the last hole published when nothing stamped it. Both ends are the
// round's own record, so the figure is the same on every phone.
//
// The start is the round's own stamp when it has one: `round.startedAt`,
// written on the first score tap (finishStamp.js). Rounds played before the
// stamp existed fall back to the cards. A hole's ts is when it was LEFT, so
// the first hole would be missing from the span — and a scorer who enters
// several holes in one go (Lomas 7 Sep: holes 1–7 left within two minutes,
// 86 min after creation) leaves nothing near the tee time at all. A game is
// normally created on the first tee, though: across the hosted data,
// creation runs 10–28 min before hole 1 is left. So creation is the start
// whenever it sits within START_WINDOW_MS before the first hole; a game set
// up the night before, or a tournament planned days ahead, falls outside it
// and the first hole stands in. A hole re-published later (a score fix)
// moves only that hole's ts, which the min/max over 18 holes absorbs.

const MIN_ROUND_MS = 10 * 60 * 1000;
const MAX_ROUND_MS = 10 * 60 * 60 * 1000;
const START_WINDOW_MS = 2 * 60 * 60 * 1000;
// A hole (re)published this soon after Finish is a fix to the card just
// closed — the round still ended at Finish. Later than this, the other
// phone was still out on the course and the stamp was premature.
const POST_FINISH_GRACE_MS = 30 * 60 * 1000;

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
// Anything outside 10 min – 10 h is noise, not a round.
//
// Start: the round's own stamp (`startedAt`, ms or ISO) when it has one and
// it precedes the last hole; else creation (`createdAt`, ISO or ms) when it
// falls within START_WINDOW_MS before the first published hole; else that
// hole.
// End: the finish stamp, unless holes were still being published more than
// POST_FINISH_GRACE_MS after it — then a phone that tapped Finish while
// another was still scoring must not cut the round short, and the last hole
// ends it. A hole fixed within the grace (hole 14 filled in right after the
// finish gate) keeps the stamp. If the chosen end is implausible, each is
// tried on its own: a score fixed days later must not stretch a stamped
// round, and a game archived from Home the next morning must not stretch
// an unstamped one.
//
// Pass either `span` ({ firstAt, lastAt }, e.g. from the get_round_activity
// RPC) or `cardsByAuthor` (the card store's snapshot) — the feed has the
// former without pulling every card, the screens have the latter.
export function roundDurationMs({
  span = null, cardsByAuthor = null, endAt = null, createdAt = null, startedAt = null,
} = {}) {
  const s = span ?? roundSpan(cardsByAuthor);
  if (!s || !Number.isFinite(s.firstAt) || !Number.isFinite(s.lastAt)) return null;
  const start = roundStartAt(s, createdAt, startedAt);
  const ends = [];
  if (endAt != null) {
    ends.push(s.lastAt - endAt <= POST_FINISH_GRACE_MS ? endAt : s.lastAt, endAt);
  }
  ends.push(s.lastAt);
  for (const end of ends) {
    const ms = end - start;
    if (ms >= MIN_ROUND_MS && ms <= MAX_ROUND_MS) return ms;
  }
  return null;
}

function roundStartAt(span, createdAt, startedAt) {
  const started = typeof startedAt === 'number' ? startedAt : Date.parse(startedAt ?? '');
  if (Number.isFinite(started) && started <= span.lastAt) return started;
  const created = typeof createdAt === 'number' ? createdAt : Date.parse(createdAt ?? '');
  if (!Number.isFinite(created)) return span.firstAt;
  const lead = span.firstAt - created;
  return lead >= 0 && lead <= START_WINDOW_MS ? created : span.firstAt;
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
