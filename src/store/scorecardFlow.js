// Pure helpers behind ScorecardScreen: resume position, entry clamping, back
// navigation, finish gating and the conflict-sheet row adapter. Kept out of
// the screen so they are unit-testable without mounting it.
import { t as tNow } from '../i18n';
import { clampScoreInput, resolvePlayerHandicap, holeCountOf } from './scoring';

// How far this phone had already scored when a round is re-opened. The only
// evidence a fresh session has is MY OWN published card — never the shown
// card, which also carries whatever a peer published while this phone was
// closed. `myScores` is my card's entries as { [playerId]: { [hole]: n } }.
export function resumeVerifiedUpTo(holes, players, myScores) {
  let last = 0;
  for (const h of holes ?? []) {
    const marked = (players ?? []).some((p) => myScores?.[p.id]?.[h.number] != null);
    if (!marked) break;
    last = h.number;
  }
  return last;
}

// Where a re-opened round lands. A live round resumes at the first hole THIS
// phone hasn't marked — NOT at the first hole empty on the merged card. A
// scorer who opens the round after a peer filled the front nine still owes
// their own entries for those holes; landing where the peer's card ends would
// skip them past work only they can do.
// A round already complete — or a finished tournament — has nothing left to
// enter and still opens on the last hole, the way it always did.
export function resumeHole(holes, verifiedUpTo, { complete = false } = {}) {
  const lastHole = holes[holes.length - 1].number;
  if (complete) return lastHole;
  return holes.find((h) => h.number > verifiedUpTo)?.number ?? lastHole;
}

// Clamp a raw entered stroke count for one hole to the recordable range
// [1, pickup], per the silent-clamp product decision. Shared by both entry
// paths (setScore text field + stepScore +/-) so they can never diverge, and
// exported so the clamp — including the handicap-fallback edge case — is unit
// testable without mounting the whole screen. Handicap is resolved via the
// SAME resolvePlayerHandicap fallback the store setter uses: a round with no
// per-player handicap entry (legacy / pre-normalization) falls back to the
// player's base handicap, NOT scratch, so a legitimately high score with real
// extra shots isn't over-clamped. Returns the raw value untouched when the
// hole can't be found (defensive) — including a cleared cell (null/undefined),
// which clampScoreInput itself passes through.
export function clampEnteredScore(round, players, playerId, holeNumber, rawValue) {
  const hole = round?.holes?.find((h) => h.number === holeNumber);
  if (!hole) return rawValue;
  return clampScoreInput(
    rawValue, hole.par, resolvePlayerHandicap(round, players, playerId), hole.strokeIndex,
    holeCountOf(round),
  );
}

export function getScorecardBackTarget({
  official,
  viewOnly,
  canGoBack,
  requestedBackTarget,
}) {
  if (official) return 'previous';
  if (requestedBackTarget === 'tournament') return 'tournament';
  if (requestedBackTarget === 'home') return 'home';
  if (viewOnly) return 'home';
  return canGoBack ? 'previous' : 'tournament';
}

export function buildScorecardTournamentBackState(state) {
  return {
    ...state,
    routes: [
      { name: 'Main', params: { screen: 'Home', params: { viewMode: 'list' } } },
      { name: 'Tournament', params: { viewMode: 'tournament' } },
    ],
    index: 1,
  };
}

export function shouldMarkTournamentFinishedFromScorecard({ tournament }) {
  if (!tournament || tournament.kind === 'official') return false;
  return tournament.kind === 'game';
}

export function canShowQuickFinish({ tournament, official, viewOnly }) {
  return !official && !viewOnly && tournament?.kind === 'game';
}

// The one adapter from the engine's `discrepancies(round)` output to the
// ConflictWizardSheet row shape. Every conflict surface — the leave-hole
// prompt, the peer-arrival prompt and the finish gate — filters this list
// rather than deriving its own rows, so a resolution recorded on any phone
// clears the row everywhere on the next render.
// `authorId` on a candidate is the engine's scorerKey; the sheet renders the
// ones in `localAuthorIds` as "You". A blank is not an opinion (blank rule),
// so `blankAuthors` is always empty here.
export function buildConflictRows({ disputes, cells, round, players, names }) {
  const rows = [];
  for (const { hole, rows: holeRows } of disputes ?? []) {
    for (const { playerId, values } of holeRows) {
      rows.push({
        playerId,
        hole,
        par: round?.holes?.[hole - 1]?.par ?? null,
        playerName: (players ?? []).find((p) => p.id === playerId)?.name ?? tNow('scorecard.conflict.playerFallback'),
        currentValue: cells?.[playerId]?.[String(hole)]?.shown ?? null,
        candidates: values.map((v) => ({
          value: v.value,
          ts: v.ts,
          authorId: v.scorerKey,
          authorName: v.name ?? names?.[v.scorerKey] ?? tNow('scorecard.conflict.anotherPhone'),
        })),
        blankAuthors: [],
      });
    }
  }
  return rows;
}

// Message descriptors (rendered with tr); the count picks has/have.
export function roundDecisionNoticeForPair(pair) {
  const namedPlayers = Array.isArray(pair)
    ? pair.map((p) => p?.name).filter(Boolean)
    : [];
  const message = namedPlayers.length
    ? { key: 'scorecard.roundDecided.message', params: { names: namedPlayers.join(' & '), count: namedPlayers.length > 1 ? 2 : 1 } }
    : { key: 'scorecard.roundDecided.leading' };
  return { title: { key: 'scorecard.roundDecided.title' }, message };
}
