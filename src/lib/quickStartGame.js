import { defaultHoles } from '../store/libraryStore';
import {
  createTournament,
  DEFAULT_SETTINGS,
  deriveRoundPlayingHandicap,
  randomPairs,
} from '../store/tournamentStore';
import { middleTee, teeByLabel } from '../store/tees';
import {
  fallbackScoringMode,
  isScoringModeAllowed,
  scoringModeUsesTeams,
} from '../components/scoringModes';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COURSE_NAME_MAX = 22;

function cloneHoles(holes) {
  return (holes ?? []).map((h) => ({ ...h }));
}

function cloneTees(tees) {
  return (tees ?? []).map((t) => ({ ...t }));
}

function numericValue(value) {
  if (value === '' || value == null) return NaN;
  return Number(value);
}

function isHoleComplete(hole) {
  const number = numericValue(hole?.number);
  const par = numericValue(hole?.par);
  const strokeIndex = numericValue(hole?.strokeIndex);
  return Number.isInteger(number)
    && number >= 1
    && number <= 18
    && Number.isFinite(par)
    && par > 0
    && Number.isInteger(strokeIndex)
    && strokeIndex >= 1
    && strokeIndex <= 18;
}

function hasCompleteHoles(holes) {
  return Array.isArray(holes)
    && holes.length === 18
    && holes.every(isHoleComplete);
}

function namedTees(tees) {
  return (tees ?? []).filter((t) => String(t?.label ?? '').trim());
}

function teeSnapshot(tee) {
  return tee ? { label: tee.label, slope: tee.slope, rating: tee.rating } : null;
}

function teeOrderIndex(tees, label) {
  const key = String(label ?? '').trim().toLowerCase();
  const idx = tees.findIndex((t) => String(t?.label ?? '').trim().toLowerCase() === key);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

function validHistoryTee(tees, history) {
  return teeSnapshot(teeByLabel(tees, history?.label));
}

export function buildQuickStartGameName(courseName, date = new Date()) {
  const stamp = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  const trimmed = String(courseName ?? '').trim();
  if (!trimmed) return `Game · ${stamp}`;
  const shortCourse = trimmed.length > COURSE_NAME_MAX
    ? `${trimmed.slice(0, COURSE_NAME_MAX - 1).trimEnd()}…`
    : trimmed;
  return `${shortCourse} · ${stamp}`;
}

export function courseToQuickStartRound(course) {
  const holes = hasCompleteHoles(course?.holes)
    ? cloneHoles(course.holes)
    : defaultHoles();
  return {
    courseId: course?.id ?? null,
    courseName: String(course?.name ?? '').trim(),
    holes,
    tees: cloneTees(course?.tees),
    slope: course?.slope ?? null,
    courseRating: course?.rating ?? null,
    playerHandicaps: null,
    playerTees: null,
    manualHandicaps: {},
  };
}

export function resolveQuickStartPlayerTees({
  course,
  players = [],
  currentUserId = null,
  lastTeeByPlayer = {},
}) {
  const courseTees = namedTees(course?.tees);
  if (players.length === 0 || courseTees.length === 0) return {};

  const playerHistory = players.map((player) => ({
    player,
    tee: validHistoryTee(courseTees, lastTeeByPlayer[player.id]),
  }));
  const histories = playerHistory.filter((entry) => entry.tee);

  let groupTee = null;
  if (histories.length > 0) {
    const counts = new Map();
    histories.forEach(({ tee }) => {
      counts.set(tee.label, (counts.get(tee.label) ?? 0) + 1);
    });
    const maxCount = Math.max(...counts.values());
    const tiedLabels = [...counts.entries()]
      .filter(([, count]) => count === maxCount)
      .map(([label]) => label);
    const currentUserHistory = currentUserId
      ? histories.find(({ player }) => player.user_id === currentUserId)
      : null;
    const preferredLabel = currentUserHistory && tiedLabels.includes(currentUserHistory.tee.label)
      ? currentUserHistory.tee.label
      : tiedLabels.sort((a, b) => teeOrderIndex(courseTees, a) - teeOrderIndex(courseTees, b))[0];
    groupTee = teeSnapshot(teeByLabel(courseTees, preferredLabel));
  } else {
    groupTee = teeSnapshot(middleTee(courseTees));
  }

  if (!groupTee) return {};
  return Object.fromEntries(
    playerHistory.map(({ player, tee }) => [player.id, tee ?? groupTee]),
  );
}

export function buildQuickStartRound({ course, players, playerTees }) {
  const base = courseToQuickStartRound(course);
  const roundWithTees = {
    ...base,
    playerTees: Object.keys(playerTees ?? {}).length > 0 ? playerTees : null,
  };
  const playerHandicaps = Object.fromEntries(
    players.map((p) => [p.id, deriveRoundPlayingHandicap(p.handicap, roundWithTees, p.id)]),
  );
  return {
    ...roundWithTees,
    id: 'r0',
    playerHandicaps,
    playerTees: roundWithTees.playerTees,
    manualHandicaps: {},
    notes: '',
    scores: {},
  };
}

export function normalizeQuickStartSettings(settings, playerCount) {
  const merged = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
  const requested = merged.scoringMode;
  const scoringMode = isScoringModeAllowed(requested, playerCount)
    ? requested
    : fallbackScoringMode(playerCount);
  return {
    ...merged,
    scoringMode,
    bestBallValue: parseInt(merged.bestBallValue, 10) || 1,
    worstBallValue: parseInt(merged.worstBallValue, 10) || 1,
  };
}

export function buildQuickStartTournamentDraft({
  course,
  players,
  playerTees = {},
  settings = DEFAULT_SETTINGS,
  userId = null,
  now = new Date(),
}) {
  const normalizedSettings = normalizeQuickStartSettings(settings, players.length);
  const round = buildQuickStartRound({ course, players, playerTees });
  const pairs = scoringModeUsesTeams(normalizedSettings.scoringMode, players.length)
    ? randomPairs(players)
    : players.map((p) => [p]);
  const meId = players.find((p) => p.user_id && p.user_id === userId)?.id ?? null;
  return createTournament({
    kind: 'game',
    name: buildQuickStartGameName(course?.name, now),
    players,
    meId,
    rounds: [{ ...round, pairs }],
    settings: normalizedSettings,
  });
}
