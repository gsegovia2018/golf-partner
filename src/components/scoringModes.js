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
    // Each player competes solo — no partners/pairs to assign or reveal.
    teams: false,
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
    // Played in pairs — partners are assigned and revealed each round.
    teams: true,
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
    // 1-vs-1 — each player is their own side, no partners to assign.
    teams: false,
    // Match play is strictly 1-vs-1.
    isAllowed: (count) => count === 2,
    requirement: 'Requires exactly 2 players',
  },
  {
    key: 'sindicato',
    label: 'Sindicato',
    subtitle: 'Three-way points, hole by hole',
    icon: 'pie-chart',
    category: 'Head-to-head',
    // Each player competes solo — no partners/pairs to assign.
    teams: false,
    // Sindicato splits 6 points per hole between exactly three players.
    isAllowed: (count) => count === 3,
    requirement: 'Requires exactly 3 players',
  },
  {
    key: 'bestball',
    label: 'Best Ball / Worst Ball',
    subtitle: 'Two pairs, best & worst score',
    icon: 'award',
    category: 'Teams',
    // Two pairs of two — partners are assigned and revealed each round.
    teams: true,
    // Two pairs of two.
    isAllowed: (count) => count === 4,
    requirement: 'Requires exactly 4 players',
  },
  {
    key: 'scramblepairs',
    label: 'Scramble — Pairs',
    subtitle: 'Two teams, one ball each',
    icon: 'users',
    category: 'Teams',
    // Two teams of 2 — teams are assigned and revealed each round.
    teams: true,
    isAllowed: (count) => count === 4,
    requirement: 'Requires exactly 4 players',
  },
  {
    key: 'scramble3v1',
    label: 'Scramble — 3 vs 1',
    subtitle: 'Three-man scramble vs a solo player',
    icon: 'users',
    category: 'Teams',
    // A team of 3 against one individual — sides assigned and revealed.
    teams: true,
    isAllowed: (count) => count === 4,
    requirement: 'Requires exactly 4 players',
  },
  {
    key: 'scramble4',
    label: 'Scramble — 4-man',
    subtitle: 'One team, one ball, vs the course',
    icon: 'users',
    category: 'Teams',
    teams: true,
    isAllowed: (count) => count === 4,
    requirement: 'Requires exactly 4 players',
  },
  {
    key: 'pairsmatchplay',
    label: 'Pairs Match Play',
    subtitle: 'Two 1v1 duels, 2 points per hole',
    icon: 'flag',
    category: 'Teams',
    // Two pairs; each player duels one opponent from the other pair.
    teams: true,
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

// Scramble modes share one engine: the team plays a single ball, scored
// under the team captain. Used to route scoring, hide personal stats, and
// build non-2x2 team shapes.
export const SCRAMBLE_MODES = new Set(['scramblepairs', 'scramble3v1', 'scramble4']);

export function isScrambleMode(key) {
  return SCRAMBLE_MODES.has(key);
}

// True when the mode is played in partners/pairs (Stableford with Partners,
// Best Ball) — i.e. teams get assigned and revealed. Solo modes (Stableford,
// Match Play) return false. Unknown keys fall back to the first mode (solo),
// so a stray/legacy mode never wrongly surfaces team UI.
//
// When `playerCount` is supplied, the mode must ALSO be valid for that roster
// size. This catches legacy/degenerate games stuck on a team mode their
// roster can no longer support — e.g. a 1- or 2-player game still stored as
// 'stableford' — which have a "teams" mode on paper but no teams in practice.
export function scoringModeUsesTeams(key, playerCount) {
  if (!getScoringMode(key).teams) return false;
  if (playerCount != null && !isScoringModeAllowed(key, playerCount)) return false;
  return true;
}

// The two labels for the LEADERBOARD card's view toggle, per scoring mode.
// `left` is the mode's native view (the default), `right` is the alternate.
// Stableford-scored modes (individual, stableford) toggle to Stroke Play;
// every other mode toggles to Stableford. Labels are short toggle captions
// (e.g. 'Best Ball'), not the full SCORING_MODES labels.
export function leaderboardToggleLabels(scoringMode) {
  if (scoringMode === 'matchplay') return { left: 'Match Play', right: 'Stableford' };
  if (scoringMode === 'sindicato') return { left: 'Sindicato', right: 'Stableford' };
  if (scoringMode === 'bestball') return { left: 'Best Ball', right: 'Stableford' };
  if (scoringMode === 'pairsmatchplay') return { left: 'Match Play', right: 'Stableford' };
  if (isScrambleMode(scoringMode)) return { left: 'Scramble', right: 'Stroke Play' };
  return { left: 'Stableford', right: 'Stroke Play' };
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

// Merges a scoring-mode draft back into a tournament's settings object.
// The draft carries the mode key plus Best Ball point values, which the
// picker holds as strings (its inputs are TextInputs); this coerces them to
// positive integers, defaulting to 1 — the same normalization the Edit
// Tournament screen has always applied at save time.
export function mergeScoringSettings(currentSettings, draft) {
  return {
    ...(currentSettings ?? {}),
    scoringMode: draft.scoringMode,
    bestBallValue: parseInt(draft.bestBallValue, 10) || 1,
    worstBallValue: parseInt(draft.worstBallValue, 10) || 1,
    fixedTeams: Boolean(draft.fixedTeams),
    manualTeams: Boolean(draft.manualTeams),
  };
}

// True when the mode+settings combination should route the user through the
// team editor before play, instead of the random-draw reveal ceremony.
// scramble4 is excluded — it's a single team of everyone, so there is no
// meaningful "choice" and EditTeamsScreen doesn't support its shape.
export function needsManualTeamSetup(mode, playerCount, manualTeams) {
  if (mode === 'scramble4') return false;
  if (!scoringModeUsesTeams(mode, playerCount)) return false;
  return Boolean(manualTeams);
}
