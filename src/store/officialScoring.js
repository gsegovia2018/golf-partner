// Pure logic for official tournaments — no I/O, no app imports.
// Round-robin markers, party auto-balance, discrepancy state, withdrawal
// re-link. Every function here is unit-tested in officialScoring.test.js.

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
