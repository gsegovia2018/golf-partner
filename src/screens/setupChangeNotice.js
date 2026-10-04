// Detects a setup change that arrived from ANOTHER phone while this scorecard
// was on screen, and words the notice for it (plan §6, fix 1).
//
// The scorecard cannot edit roster, teams, course or handicaps itself (those
// live on other screens), so while it is focused any change to them in the
// tournament it renders came from a peer's device via the setup sync. The
// screen keeps the signature it saw when it gained focus and compares every
// later one against it; a difference is worth a one-line banner.
//
// Scoring mode is deliberately NOT part of the signature — the screen already
// shows its own notice for that (fallbackNoticeText).

// The local copy Setup saves and the server's copy of the same game differ in
// shape only: jsonb hands object keys back in its own order (a tee snapshot
// written {label, rating, slope} returns as {label, slope, rating}), and pairs
// are stored as ids only (scoring.js thinPairs) while Setup builds them from
// whole player objects. Both are compared in a canonical form, so the server
// copy replacing the local one is not mistaken for a peer's edit.
const sortKeys = (v) => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  }
  return v;
};
const stable = (v) => JSON.stringify(sortKeys(v ?? null));
const pairIds = (pairs) => (Array.isArray(pairs)
  ? pairs.map((team) => (Array.isArray(team) ? team.map((m) => (m && typeof m === 'object' ? m.id ?? null : m)) : team))
  : pairs ?? null);

/**
 * A compact, comparable picture of the parts of setup a scorer would notice
 * changing under them mid-round.
 * @returns {{ players: string, teams: string, course: string, handicaps: string } | null}
 */
export function setupSignature(tournament, roundIndex = 0) {
  if (!tournament) return null;
  const rounds = tournament.rounds ?? [];
  const round = rounds[roundIndex] ?? null;
  return {
    players: stable((tournament.players ?? []).map((p) => [p?.id ?? null, p?.name ?? null])),
    teams: stable(rounds.map((r) => [r?.id ?? null, pairIds(r?.pairs)])),
    course: stable(round ? [round.courseId ?? null, round.courseName ?? null, (round.holes ?? []).length] : null),
    handicaps: stable(round ? [round.playerHandicaps ?? null, round.playerTees ?? null] : null),
  };
}

const LABELS = { players: 'Players', teams: 'Teams', course: 'Course', handicaps: 'Handicaps' };

/**
 * Human wording for what changed between two signatures, or null when nothing
 * a scorer cares about did. "Teams changed on another phone",
 * "Players and teams changed on another phone", ...
 */
export function describeSetupChange(prev, next) {
  if (!prev || !next) return null;
  const changed = Object.keys(LABELS).filter((k) => prev[k] !== next[k]);
  if (changed.length === 0) return null;
  const words = changed.map((k, i) => (i === 0 ? LABELS[k] : LABELS[k].toLowerCase()));
  const list = words.length === 1
    ? words[0]
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
  return `${list} changed on another phone`;
}
