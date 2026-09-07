// When was a round / game / tournament FINALIZED — the instant Finish was
// first tapped. Both the Feed and the History tab sort on this, so they must
// agree on it, and it must never move once written.
//
// `finishedAt` is written as an ISO string; the legacy tournament-level stamp
// also exists as an ms epoch number in older rows (see FinishedScreen).
export function parseFinishedAt(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const ms = Date.parse(value ?? '');
  return Number.isFinite(ms) ? ms : null;
}

// A round's finalization instant, in ms — or null when nothing stamped it.
//   1. round.finishedAt — stamped once by the Scorecard's finish action
//      (mutation `round.setFinished`, first-write-wins).
//   2. tournament.finishedAt + roundIndex — the archive stamp, covering
//      rounds finished before (1) existed. Every round of an archived
//      tournament shares it, so roundIndex keeps them in play order.
export function roundFinalizedAt(tournament, round, roundIndex = 0) {
  const roundFinished = parseFinishedAt(round?.finishedAt);
  if (roundFinished != null) return roundFinished;
  const tournamentFinished = parseFinishedAt(tournament?.finishedAt);
  if (tournamentFinished != null) return tournamentFinished + roundIndex;
  return null;
}

// A history entry's finalization instant, in ms — or null when unstamped.
// A game IS its one round, so it finalizes when that round does; a
// multi-round tournament finalizes when it is archived.
export function tournamentFinalizedAt(tournament) {
  if (!tournament) return null;
  if (tournament.kind === 'game') {
    return roundFinalizedAt(tournament, tournament.rounds?.[0], 0);
  }
  return parseFinishedAt(tournament.finishedAt);
}

// When this round STARTED, for durations: stamped once by the Scorecard on
// the first score tap (mutation `round.setStarted`, first-write-wins) — the
// closest thing to a tee time the data has. Null on rounds played before
// the stamp existed; roundDuration.js falls back to creation / the first
// hole left for those.
export function roundStartedAt(round) {
  return parseFinishedAt(round?.startedAt);
}

// When this round ENDED, for durations: the round's own stamp, else — for a
// game, which IS its one round — the archive stamp. A tournament's archive
// stamp says nothing about when round 2 of 4 ended, so it is not used there.
export function roundEndedAt(tournament, round) {
  const roundFinished = parseFinishedAt(round?.finishedAt);
  if (roundFinished != null) return roundFinished;
  if (tournament?.kind === 'game') return parseFinishedAt(tournament.finishedAt);
  return null;
}
