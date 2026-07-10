// Pure helpers for EditTeamsScreen's mode-specific team-editing UI.
// Kept free of React / React Native so the logic is unit-testable in
// isolation — screens stay thin per CLAUDE.md.

// scramble3v1: rebuilds the [three, solo] pairs shape after the user taps a
// player to send them solo. `players` is the full roster (roster order is
// preserved for the three-player side); `soloId` is the tapped player's id.
export function buildThreeVsOne(players, soloId) {
  const roster = players ?? [];
  const solo = roster.find((p) => p.id === soloId);
  const rest = roster.filter((p) => p.id !== soloId);
  return [rest, solo ? [solo] : []];
}

// pairsmatchplay: duels are index-derived (pairs[0][i] vs pairs[1][i] — see
// pairsMatchDuels in store/scoring.js), so reversing one pair's member order
// is the complete "other" matchup assignment. Leaves pairs[0] untouched.
export function swapDuelOrder(pairs) {
  if (!Array.isArray(pairs) || pairs.length !== 2) return pairs;
  return [pairs[0], [...(pairs[1] ?? [])].reverse()];
}

// pairsmatchplay: randomly draws one of the two possible duel assignments —
// with fixed 2x2 pairs, "keep" and "swap" (swapDuelOrder) are the whole
// space. `rand` is injectable so tests can pin the coin flip.
export function randomizeDuelOrder(pairs, rand = Math.random) {
  if (!Array.isArray(pairs) || pairs.length !== 2) return pairs;
  return rand() < 0.5 ? [pairs[0], [...(pairs[1] ?? [])]] : swapDuelOrder(pairs);
}
