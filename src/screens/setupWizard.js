// Pure helpers for the New Game / Tournament setup wizard.
//
// The wizard is a sequence of steps whose membership depends on the
// tournament kind and roster size: the Scoring step only exists once there
// are 2+ players (a solo game is always solo play, so there is nothing to
// choose). The 'official' kind uses a fixed roster-based flow independent of
// player count. Keeping this logic pure makes it unit-testable in isolation.
//
// Step sequence for game/tournament kinds:
//   course (or rounds) → players → tees → [scoring] → review
//
// The 'tees' step lets each player select a tee colour and records their
// handicap index. It depends on the course + players being chosen first
// (so it can display the available tees and pre-fill player details).
// It is always valid — every player receives a default tee and auto handicap,
// so the Next button is never blocked.

/**
 * Ordered list of step keys for the current setup.
 * @param {'game'|'tournament'|'official'} kind
 * @param {number} playerCount
 * @param {{ showTeamsStep?: boolean }} [options] showTeamsStep inserts a
 *   dedicated 'teams' step (same-teams-every-round + random/choose-myself)
 *   right after 'scoring' — used for multi-round tournaments whose format
 *   is played in teams, so the choice isn't buried per-round.
 * @returns {string[]}
 */
export function wizardSteps(kind, playerCount, options = {}) {
  if (kind === 'official') {
    return ['roster', 'rounds', 'format', 'review'];
  }
  const courseStep = kind === 'tournament' ? 'rounds' : 'course';
  const steps = [courseStep, 'players', 'tees'];
  if (playerCount >= 2) steps.push('scoring');
  if (options.showTeamsStep) steps.push('teams');
  steps.push('review');
  return steps;
}

/**
 * Initial wizard index for prefilled flows. Unknown or unavailable requested
 * steps fall back to the first step so navigation never opens past the active
 * step list.
 * @param {string[]} steps
 * @param {string | null | undefined} requestedStep
 * @returns {number}
 */
export function initialStepIndex(steps, requestedStep) {
  if (!requestedStep) return 0;
  const index = steps.indexOf(requestedStep);
  return index >= 0 ? index : 0;
}

function cloneObject(value) {
  if (!value || typeof value !== 'object') return value;
  return { ...value };
}

function cloneOwnedRoundValue(value) {
  if (Array.isArray(value)) return [...value];
  if (value instanceof Map) return new Map(value);
  return cloneObject(value);
}

function clonePrefilledRound(round) {
  if (!round || typeof round !== 'object') return round;
  return {
    ...round,
    holes: cloneOwnedRoundValue(round.holes),
    tees: cloneOwnedRoundValue(round.tees),
    playerHandicaps: cloneOwnedRoundValue(round.playerHandicaps),
    playerTees: cloneOwnedRoundValue(round.playerTees),
    manualHandicaps: cloneOwnedRoundValue(round.manualHandicaps),
  };
}

/**
 * Normalized setup state from optional prefill route params. Prefilled values
 * are cloned so the setup screen owns the mutable state it edits.
 * @param {{ players?: any[], rounds?: any[], settings?: object } | null | undefined} prefill
 * @returns {{ players: any[], rounds: any[] | null, settingsPatch: object, hasPrefilledPlayers: boolean }}
 */
export function setupPrefillState(prefill) {
  const players = Array.isArray(prefill?.players)
    ? prefill.players.map(cloneObject)
    : [];
  const rounds = Array.isArray(prefill?.rounds) && prefill.rounds.length > 0
    ? prefill.rounds.map(clonePrefilledRound)
    : null;
  const settingsPatch = prefill?.settings && typeof prefill.settings === 'object'
    ? { ...prefill.settings }
    : {};

  return {
    players,
    rounds,
    settingsPatch,
    hasPrefilledPlayers: players.length > 0,
  };
}

/**
 * Whether a just-created setup should offer the shared editor invite.
 * @param {'game'|'tournament'|'official'} kind
 * @param {Array<{ user_id?: string | null }>} players
 * @param {string | null | undefined} currentUserId
 * @returns {boolean}
 */
export function shouldOfferPostCreateEditorInvite(kind, players, currentUserId) {
  if (kind !== 'game' || !Array.isArray(players) || players.length <= 1) return false;
  return players.some((p) => {
    if (p?.user_id && p.user_id === currentUserId) return false;
    return !p?.user_id;
  });
}

/**
 * Whether the given step's requirements are satisfied. Gates the Next button.
 * @param {string} stepKey
 * @param {{ players: any[], rounds: { courseName?: string }[], roster?: { displayName?: string }[] }} state
 * @returns {boolean}
 */
export function isStepValid(stepKey, { players, rounds, roster }) {
  switch (stepKey) {
    case 'players':
      return players.length >= 1;
    case 'course':
    case 'rounds':
      return rounds.every((r) => (r.courseName || '').trim().length > 0);
    case 'tees':
    case 'scoring':
    case 'teams':
    case 'review':
      return true;
    case 'roster':
      return Array.isArray(roster) && roster.length > 0 && roster.every((r) => (r.displayName || '').trim().length > 0);
    case 'format':
      return true;
    default:
      return true;
  }
}
