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

// pairsmatchplay: draws a genuinely random duel assignment for the CURRENT
// teams by shuffling the second pair's member order (teams and their
// membership stay put; only who-faces-who changes). This is a true random
// draw — with a 2-player team it is a coin flip, so it may return the current
// line-up unchanged. `rand` is injectable so tests can pin the draw.
export function randomizeDuelOrder(pairs, rand = Math.random) {
  if (!Array.isArray(pairs) || pairs.length !== 2) return pairs;
  const second = pairs[1] ?? [];
  if (second.length < 2) return pairs;
  const next = [...second];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return [pairs[0], next];
}

// Re-rolls the whole matchup: redistributes every player across the two sides
// while preserving each side's size (so a 2v2 stays 2v2 and a 3v1 stays 3v1).
// For pairsmatchplay the new member order also re-draws the duels. Retries a
// bounded number of times so the result differs from the input when the roster
// allows one — the control should never look like it did nothing. `rand` is
// injectable so tests can pin the shuffle.
export function shuffleTeams(pairs, rand = Math.random) {
  if (!Array.isArray(pairs) || pairs.length !== 2) return pairs;
  const flat = pairs.flat();
  if (flat.length < 2) return pairs;
  const sizes = pairs.map((p) => p.length);
  const key = (prs) => prs.map((p) => p.map((x) => x.id).join(',')).join('|');
  const before = key(pairs);
  const redistribute = (order) => {
    let i = 0;
    return sizes.map((sz) => order.slice(i, i += sz));
  };
  let result = pairs;
  for (let attempt = 0; attempt < 12; attempt++) {
    const next = [...flat];
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    result = redistribute(next);
    if (key(result) !== before) break;
  }
  return result;
}
