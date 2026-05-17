// Pure display-ordering helpers. These reorder players ONLY for rendering —
// never pass their output to scoring functions that label results by array
// index (matchPlayRoundTally, sindicatoHolePoints, etc.).

// Returns a new array with the `meId` player moved to the front; every other
// player keeps its existing relative order. A null/unknown `meId` yields the
// players in their original order (still a fresh copy).
export function playersMeFirst(players, meId) {
  if (!Array.isArray(players)) return [];
  const me = players.find((p) => p.id === meId);
  if (!me) return [...players];
  return [me, ...players.filter((p) => p.id !== meId)];
}

// Flattens `pairs` (an array of player-arrays) for display: the pair that
// contains `meId` comes first, `playersMeFirst` is applied within every pair,
// and the result is a single flat player array. A null/unknown `meId` yields
// the pairs flattened in their original order.
export function pairsMeFirst(pairs, meId) {
  if (!Array.isArray(pairs)) return [];
  const mePairIdx = pairs.findIndex((pr) => pr.some((p) => p.id === meId));
  const seq = mePairIdx > 0
    ? [pairs[mePairIdx], ...pairs.filter((_, i) => i !== mePairIdx)]
    : pairs;
  return seq.flatMap((pr) => playersMeFirst(pr, meId));
}
