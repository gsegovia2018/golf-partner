import { mutate } from './mutate';

// Reopen a finished game or tournament. A game IS its one round, so every
// stamp that ends it goes: the archive stamp, the round's own stamp and each
// player's Finish tap — otherwise the round stays ended (finishStamp.js) and
// Home never shows it live again. A tournament's played rounds keep theirs.
export async function reopenGame(tournament) {
  let t = await mutate(tournament, { type: 'tournament.setFinished', finishedAt: null });
  if (t.kind !== 'game') return t;
  const round = t.rounds?.[0];
  if (!round) return t;
  if (round.finishedAt) {
    t = await mutate(t, { type: 'round.setFinished', roundId: round.id, finishedAt: null });
  }
  const finishedIds = Object.keys(round.finishedBy ?? {});
  if (finishedIds.length > 0) {
    t = await mutate(t, { type: 'round.setPlayerFinished', roundId: round.id, playerIds: finishedIds, finishedAt: null });
  }
  return t;
}
