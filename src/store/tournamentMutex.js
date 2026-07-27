// Per-tournament promise-chain mutex, shared by every writer that does a
// read-modify-write over the whole cached tournament blob.
//
// saveLocal (tournamentStore.js) persists the ENTIRE object, so any two
// overlapping readLocal → modify → saveLocal sequences lose one side's work
// outright — last writer wins. Two such writers exist and used to run
// completely unserialized against each other:
//
//   realtimeSync.makeHandler   readLocal → patch one game_* row → saveLocal
//   tournamentStore refreshes  fetch get_game_tournament → overlay → saveLocal
//
// In a live round with several devices scoring, both fire constantly. The
// field symptom was a roster that flickered while someone joined mid-round: a
// claim applied by realtime got overwritten by a fetch whose snapshot predated
// it, then re-applied by the next event.
//
// The refresh paths take this lock around the FETCH TOO, not just the save.
// Locking only the save still lets a snapshot taken before a realtime row was
// applied land afterwards and revert it; holding from before the fetch starts
// forces the row event to be applied strictly after, on top of the snapshot
// that missed it. Realtime delivery is ordered relative to the commit, so
// "after the fetch" is always the correct place for it.
//
// Keyed by tournament id rather than a single global chain so unrelated
// tournaments (loadAllTournaments overlays the whole list concurrently) never
// queue behind each other. Modeled on syncQueue.js's runExclusive: the chain
// promise itself must never reject — a rejection would break the chain for
// every subsequent op for that id — so failures are swallowed on the chain but
// still propagate to the caller via the returned promise. Entries are pruned
// once their chain empties so this map never grows unbounded across a long
// session's tournaments.
const _chains = new Map();

export function runExclusiveForTournament(id, fn) {
  const prev = _chains.get(id) ?? Promise.resolve();
  const result = prev.then(fn, fn);
  const settled = result.then(() => undefined, () => undefined);
  _chains.set(id, settled);
  settled.then(() => {
    if (_chains.get(id) === settled) _chains.delete(id);
  });
  return result;
}
