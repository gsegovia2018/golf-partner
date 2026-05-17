// Pure data and logic for the scoring modes. Deliberately free of React /
// React Native imports so it stays unit-testable in isolation.
// ScoringModePicker.js re-exports SCORING_MODES / isScoringModeAllowed /
// fallbackScoringMode so existing call sites keep their import path.
//
// Order is fixed: solo modes first, then head-to-head, then team modes.

export const SCORING_MODES = [
  {
    key: 'individual',
    label: 'Stableford',
    subtitle: 'Highest points wins',
    icon: 'user',
    category: 'Solo',
    // Solo ranking — needs at least 2 players to be a contest.
    isAllowed: (count) => count >= 2,
    requirement: 'Requires 2+ players',
  },
  {
    key: 'stableford',
    label: 'Stableford with Partners',
    subtitle: 'Random partners each round',
    icon: 'users',
    category: 'Solo',
    // Needs 3+ so there is an opposing side: 2 players form a single pair
    // (the whole field — no contest), and randomPairs would yield 1 pair.
    isAllowed: (count) => count >= 3,
    requirement: 'Requires 3+ players',
  },
  {
    key: 'matchplay',
    label: 'Match Play',
    subtitle: 'Head-to-head, hole by hole',
    icon: 'flag',
    category: 'Head-to-head',
    // Match play is strictly 1-vs-1.
    isAllowed: (count) => count === 2,
    requirement: 'Requires exactly 2 players',
  },
  {
    key: 'bestball',
    label: 'Best Ball / Worst Ball',
    subtitle: 'Two pairs, best & worst score',
    icon: 'award',
    category: 'Teams',
    // Two pairs of two.
    isAllowed: (count) => count === 4,
    requirement: 'Requires exactly 4 players',
  },
];

// Returns true when `mode` is valid for the given player count.
export function isScoringModeAllowed(mode, playerCount) {
  const def = SCORING_MODES.find((m) => m.key === mode);
  return def ? def.isAllowed(playerCount) : false;
}

// Picks a safe fallback mode when the current one becomes invalid.
export function fallbackScoringMode(playerCount) {
  return isScoringModeAllowed('stableford', playerCount) ? 'stableford' : 'individual';
}

// Returns the mode definition for `key`, or the first mode as a defensive
// default so the UI can always render something.
export function getScoringMode(key) {
  return SCORING_MODES.find((m) => m.key === key) ?? SCORING_MODES[0];
}

// Groups SCORING_MODES into ordered { category, modes } sections, preserving
// declaration order for both the categories and the modes within them.
export function scoringModeCategories() {
  const sections = [];
  for (const mode of SCORING_MODES) {
    let section = sections.find((s) => s.category === mode.category);
    if (!section) {
      section = { category: mode.category, modes: [] };
      sections.push(section);
    }
    section.modes.push(mode);
  }
  return sections;
}

// Builds the note shown when the player count forced a mode change.
// Returns null when either key is unknown.
export function fallbackNoticeText(prevKey, nextKey) {
  const prev = SCORING_MODES.find((m) => m.key === prevKey);
  const next = SCORING_MODES.find((m) => m.key === nextKey);
  if (!prev || !next) return null;
  const reason = prev.requirement.replace(/^Requires/, 'needs');
  return `${prev.label} ${reason} — switched to ${next.label}.`;
}
