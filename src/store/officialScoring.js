// Pure logic for official tournaments — no I/O, no app imports.
// Round-robin markers, party auto-balance, discrepancy state, withdrawal
// re-link. Every function here is unit-tested in officialScoring.test.js.

// Fallback 18-hole layout for official rounds whose `course` JSONB is empty
// or missing — keeps the scorecard and leaderboard usable until course data
// lands. Par 4 throughout, stroke index ascending by hole number.
export function defaultOfficialHoles() {
  return Array.from({ length: 18 }, (_, i) => ({
    number: i + 1,
    par: 4,
    strokeIndex: i + 1,
  }));
}

// Map an official round's `course` JSONB to the casual `round.holes` shape
// ({ number, par, strokeIndex }). The JSONB may store either a bare holes
// array or a { holes: [...] } object; tolerate both, fall back to default.
export function officialHolesFromCourse(course) {
  const raw = Array.isArray(course)
    ? course
    : (Array.isArray(course?.holes) ? course.holes : null);
  if (!raw || raw.length === 0) return defaultOfficialHoles();
  return raw.map((h, i) => ({
    number: h.number ?? i + 1,
    par: h.par ?? 4,
    strokeIndex: h.strokeIndex ?? h.stroke_index ?? i + 1,
  }));
}

// Each player marks the next player by seat order; the last wraps to the
// first. Returns [{ rosterId, marksRosterId }] in seat order.
export function assignRoundRobinMarkers(members) {
  const sorted = [...members].sort((a, b) => a.seat - b.seat);
  const n = sorted.length;
  if (n === 0) return [];
  return sorted.map((m, i) => ({
    rosterId: m.rosterId,
    marksRosterId: sorted[(i + 1) % n].rosterId,
  }));
}

// Split a roster into parties. mode 'handicap' snake-deals sorted players so
// each party gets a balanced spread; mode 'random' shuffles then deals.
// `rng` is injectable for deterministic tests.
export function autoBalanceParties(
  roster, { partySize = 4, mode = 'handicap', rng = Math.random } = {},
) {
  const players = [...roster];
  const partyCount = Math.max(1, Math.ceil(players.length / partySize));
  const parties = Array.from({ length: partyCount }, () => []);

  if (mode === 'random') {
    for (let i = players.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [players[i], players[j]] = [players[j], players[i]];
    }
    players.forEach((p, i) => parties[i % partyCount].push(p));
    return parties;
  }

  players.sort((a, b) => (a.handicap ?? 0) - (b.handicap ?? 0));
  let idx = 0, dir = 1;
  for (const p of players) {
    parties[idx].push(p);
    idx += dir;
    if (idx === partyCount) { idx = partyCount - 1; dir = -1; }
    else if (idx < 0) { idx = 0; dir = 1; }
  }
  return parties;
}

// Mean handicap of a pair's two players.
export function pairAverageHandicap(pair) {
  const hs = pair.players.map((p) => p.handicap ?? 0);
  return hs.reduce((s, h) => s + h, 0) / hs.length;
}

// Snake-deal pre-formed pairs into parties so each party's pairs are balanced
// on average handicap. Used when a round's format is 'pairs'.
export function balancePartiesFromPairs(pairs, { pairsPerParty = 2 } = {}) {
  const sorted = [...pairs].sort(
    (a, b) => pairAverageHandicap(a) - pairAverageHandicap(b),
  );
  const partyCount = Math.max(1, Math.ceil(sorted.length / pairsPerParty));
  const parties = Array.from({ length: partyCount }, () => []);
  let idx = 0, dir = 1;
  for (const pair of sorted) {
    parties[idx].push(pair);
    idx += dir;
    if (idx === partyCount) { idx = partyCount - 1; dir = -1; }
    else if (idx < 0) { idx = 0; dir = 1; }
  }
  return parties;
}

// Classify one player's hole given the two entries.
//   empty       — neither entered
//   waiting     — exactly one entered (the other side hasn't scored yet)
//   agreed      — both entered and equal
//   discrepancy — both entered and unequal
export function scoreCellState(selfStrokes, markerStrokes) {
  const hasSelf = selfStrokes != null;
  const hasMarker = markerStrokes != null;
  if (!hasSelf && !hasMarker) return 'empty';
  if (hasSelf !== hasMarker) return 'waiting';
  return selfStrokes === markerStrokes ? 'agreed' : 'discrepancy';
}

// Holes (ascending) where a subject's self/marker entries disagree. `scores`
// is the flat row list returned by get_round_state.
export function cardDiscrepancyHoles(scores, subjectRosterId) {
  const byHole = new Map();
  for (const s of scores) {
    if (s.subject_roster_id !== subjectRosterId) continue;
    const e = byHole.get(s.hole) || {};
    e[s.source] = s.strokes;
    byHole.set(s.hole, e);
  }
  return [...byHole.entries()]
    .filter(([, e]) => scoreCellState(e.self, e.marker) === 'discrepancy')
    .map(([hole]) => hole)
    .sort((a, b) => a - b);
}

// Round-robin chain over only the players still in the round. Withdrawn
// players drop out and the chain re-closes around the remainder.
export function activeMarkerChain(members, withdrawnRosterIds = []) {
  const withdrawn = new Set(withdrawnRosterIds);
  const active = members.filter((m) => !withdrawn.has(m.rosterId));
  return assignRoundRobinMarkers(active);
}
