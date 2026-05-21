// Resolves which team each player is on, for the halo and the summary.
// A team exists only when the round has exactly two multi-member pairs
// (Best Ball, random-partner Stableford). Solo, individual Stableford,
// Match Play (1v1) and Sindicato have no teams.

export function hasTeams(round) {
  const pairs = round?.pairs ?? [];
  return pairs.length === 2 && pairs.every((p) => Array.isArray(p) && p.length >= 2);
}

// { [playerId]: { index: 0|1, label: 'Pair A'|'Pair B' } }, or {} when no teams.
export function teamsByPlayer(round) {
  if (!hasTeams(round)) return {};
  const map = {};
  round.pairs.forEach((pair, index) => {
    pair.forEach((member) => {
      const id = member?.id ?? member;
      map[id] = { index, label: index === 0 ? 'Pair A' : 'Pair B' };
    });
  });
  return map;
}

// Team colour for a team index, from the theme.
export function teamColor(theme, index) {
  return index === 0 ? theme.pairA : theme.pairB;
}
