// Dot-encoded path helpers. Paths look like "rounds.r1.scores.p7.h5".
//
// Two conventions the raw path doesn't match 1:1 against the data:
//   1. `rounds` is an array indexed by position, but meta paths address
//      rounds by their string `id` (e.g. "r1744..."). resolveKey falls
//      back to finding an array element by its `id` attribute when the
//      segment isn't a numeric index.
//   2. Score paths encode hole numbers as `h<N>` (e.g. "h5") while the
//      underlying data stores them as numeric keys ("5"). resolveKey
//      strips the `h` prefix when the parent doesn't own the literal key.
//
// Without this, LWW-merging round-scoped paths silently dropped the local
// value — every score edit was wiped by the next remote refresh.
function resolveKey(cur, seg) {
  if (cur == null) return { ok: false, key: seg };
  if (Array.isArray(cur)) {
    if (/^\d+$/.test(seg)) {
      const idx = Number(seg);
      return idx < cur.length ? { ok: true, key: idx } : { ok: false, key: seg };
    }
    const idx = cur.findIndex((x) => x && x.id === seg);
    if (idx >= 0) return { ok: true, key: idx };
    return { ok: false, key: seg };
  }
  if (Object.prototype.hasOwnProperty.call(cur, seg)) {
    return { ok: true, key: seg };
  }
  // Score-path convention: "h<N>" addresses hole <N>.
  if (typeof seg === 'string' && seg.length > 1 && seg[0] === 'h' && /^\d+$/.test(seg.slice(1))) {
    return { ok: true, key: seg.slice(1) };
  }
  return { ok: false, key: seg };
}

export function getAtPath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    const r = resolveKey(cur, p);
    if (!r.ok) return undefined;
    cur = cur[r.key];
  }
  return cur;
}

export function setAtPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const seg = parts[i];
    const r = resolveKey(cur, seg);
    const key = r.ok ? r.key : seg;
    if (cur[key] == null || typeof cur[key] !== 'object') cur[key] = {};
    cur = cur[key];
  }
  const lastSeg = parts[parts.length - 1];
  const r = resolveKey(cur, lastSeg);
  cur[r.ok ? r.key : lastSeg] = value;
}

function deepClone(o) {
  return o == null ? o : JSON.parse(JSON.stringify(o));
}

// LWW merge. Compares _meta[path] on both sides; higher ts wins; ties go to local
// (local has an in-flight mutation not yet pushed).
//
// Returns { merged, conflicts } where `conflicts` is the subset of paths where
// BOTH sides had a _meta ts AND remote's ts was strictly higher (i.e. remote
// overwrote a value the user had also written). Ties, one-sided-ts cases, and
// local-wins cases do not emit conflict entries.
export function mergeTournaments(local, remote) {
  if (!remote) return { merged: local, conflicts: [] };
  if (!local) return { merged: remote, conflicts: [] };

  const merged = deepClone(remote);
  const mergedMeta = { ...(remote._meta ?? {}) };
  const localMeta = local._meta ?? {};
  const paths = new Set([...Object.keys(localMeta), ...Object.keys(mergedMeta)]);
  const conflicts = [];
  const detectedAt = Date.now();

  for (const path of paths) {
    const lTs = localMeta[path] ?? 0;
    const rTs = mergedMeta[path] ?? 0;
    const bothHadTs = localMeta[path] != null && mergedMeta[path] != null;

    if (lTs >= rTs) {
      setAtPath(merged, path, getAtPath(local, path));
      mergedMeta[path] = lTs;
    } else if (bothHadTs && !path.includes('.scoreConflicts.')) {
      // Remote wins AND local had also written this path → same-cell conflict.
      conflicts.push({
        path,
        localTs: lTs,
        remoteTs: rTs,
        winnerValue: getAtPath(remote, path),
        losingValue: getAtPath(local, path),
        tournamentId: remote.id ?? local.id ?? null,
        detectedAt,
      });
    }
  }

  // ── Score conflict markers ─────────────────────────────────────────────────
  // When two devices wrote the same score cell with genuinely different values,
  // the LWW above silently kept one. Record the other in a conflict marker
  // stored in the blob (round.scoreConflicts[pid][hole]) so every device can
  // see and resolve it. This runs as a pass after LWW so it reads the settled
  // `merged` / `mergedMeta`, free of loop-order effects. `remote._meta` is the
  // remote's original (pre-merge) meta.
  const originalRemoteMeta = remote._meta ?? {};
  const SCORE_PATH = /^rounds\.([^.]+)\.scores\.([^.]+)\.h(\d+)$/;
  for (const path of paths) {
    const sm = path.match(SCORE_PATH);
    if (!sm) continue;
    const [, rid, pid, holeStr] = sm;
    const lTs = localMeta[path] ?? 0;
    const rTs = originalRemoteMeta[path] ?? 0;
    // Only a remote-wins, both-sides-wrote case can be a same-cell conflict.
    if (!(rTs > lTs)) continue;
    if (localMeta[path] == null) continue;
    const winnerValue = getAtPath(remote, path);
    const loserValue = getAtPath(local, path);
    // A cleared cell (null) or two equal values is not a conflict.
    if (winnerValue == null || loserValue == null) continue;
    if (winnerValue === loserValue) continue;

    const cPath = `rounds.${rid}.scoreConflicts.${pid}.h${holeStr}`;
    // Already flagged → leave the existing marker untouched.
    if (getAtPath(merged, cPath) != null) continue;
    // Resolved after the losing value was written → do not resurrect it.
    // This relies on conflict.resolve stamping _meta[cPath] with the
    // resolution timestamp (see store/mutate.js) — a resolution that cleared
    // the marker without stamping _meta would let a stale value re-flag here.
    const cMeta = mergedMeta[cPath];
    if (cMeta != null && cMeta >= lTs) continue;

    const markerDetectedAt = Date.now();
    setAtPath(merged, cPath, {
      candidates: [
        { value: winnerValue, ts: rTs },
        { value: loserValue, ts: lTs },
      ],
      detectedAt: markerDetectedAt,
    });
    mergedMeta[cPath] = markerDetectedAt;
  }

  merged._meta = mergedMeta;

  // Apply structural deletion tombstones. Path-based LWW alone can't tell
  // "round was deleted" from "round was never written" — without a tombstone,
  // the next remote refresh deepClones remote's full rounds list and silently
  // resurrects anything the user removed. We stamp `rounds.<id>._deleted` in
  // _meta when a deletion mutation runs; here we drop those rounds from the
  // merged result. Tombstones are kept in _meta so subsequent merges still
  // honor the deletion.
  if (Array.isArray(merged.rounds) && merged.rounds.length > 0) {
    const tombstoned = new Set();
    for (const path of Object.keys(mergedMeta)) {
      const m = path.match(/^rounds\.([^.]+)\._deleted$/);
      if (m) tombstoned.add(m[1]);
    }
    if (tombstoned.size > 0) {
      merged.rounds = merged.rounds.filter((r) => !tombstoned.has(r?.id));
    }
  }

  return { merged, conflicts };
}
