import { loadAllTournamentsWithFallback } from './tournamentStore';

// Shots (src/store/shotStore.js) reference the round they were marked on by
// `{ roundId, roundIndex }` only — they carry no course. This module rebuilds
// that missing context from the tournament list so a stats screen can reopen
// the hole map for a shot played weeks ago.
//
// Built from the raw tournaments rather than collectMyRounds: the shot log is
// already private to its author, and a round with a marked shot but no entered
// score would be dropped by the "is this my round" filter.

export function shotRoundKey(roundId, roundIndex) {
  return `${roundId}|${roundIndex}`;
}

// -> Map<`${roundId}|${roundIndex}`, { courseName, courseId, holes, tournamentName, tournamentDate }>
export function buildShotRoundIndex(tournaments) {
  const map = new Map();
  for (const t of tournaments || []) {
    (t.rounds || []).forEach((round, roundIndex) => {
      if (round?.id == null) return;
      map.set(shotRoundKey(round.id, roundIndex), {
        courseName: round.courseName || '',
        courseId: round.courseId ?? null,
        holes: round.holes || [],
        tournamentName: t.name || 'Tournament',
        tournamentDate: t.createdAt ?? null,
      });
    });
  }
  return map;
}

// Full map context for one shot-log carry ({ roundId, roundIndex, holeNumber }),
// or null when the round is unknown or its course has no name to match geometry
// against. `par`/`strokeIndex` come from the round's own hole list, so a course
// edited since the round still replays with the numbers it was played off.
export function shotRoundContext(index, carry) {
  if (!index || !carry) return null;
  const entry = index.get(shotRoundKey(carry.roundId, carry.roundIndex));
  if (!entry?.courseName) return null;
  const hole = entry.holes.find((h) => h.number === carry.holeNumber) ?? null;
  return {
    ...entry,
    holeNumber: carry.holeNumber,
    par: hole?.par ?? null,
    strokeIndex: hole?.strokeIndex ?? null,
  };
}

export async function loadShotRoundIndex() {
  const { list } = await loadAllTournamentsWithFallback();
  return buildShotRoundIndex(list);
}
