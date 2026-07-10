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

// Score cells (rounds.<rid>.scores.<pid>.h<hole>) are exempt from the generic
// LWW loop below and get dedicated always-mine handling instead: a cell this
// device wrote never silently changes value on merge, no matter what the
// remote timestamp says (device clocks skew, and a remote overwrite of a
// score you just entered reads as data loss, not "the other phone is right").
// Disagreements become a `scoreConflicts` marker instead of a generic
// `conflicts` log entry; an explicit resolution stamp (`scoreResolutions`,
// written by conflict.resolve) is the only thing that outranks a raw write.
const SCORE_PATH = /^rounds\.([^.]+)\.scores\.([^.]+)\.h(\d+)$/;

// LWW merge. Compares _meta[path] on both sides; higher ts wins; ties go to local
// (local has an in-flight mutation not yet pushed). Score cells are excluded
// from this loop — see the always-mine pass below.
//
// Returns { merged, conflicts } where `conflicts` is the subset of non-score
// paths where BOTH sides had a _meta ts AND remote's ts was strictly higher
// (i.e. remote overwrote a value the user had also written). Ties, one-sided-ts
// cases, and local-wins cases do not emit conflict entries.
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
    // `meId` is per-device identity ("which player is *me* on this phone"),
    // not collaborative state — restored from local below, never merged via
    // LWW, never flagged as a conflict. Skipping here prevents a joiner's
    // setMe push from overwriting the creator's meId on the next pull.
    if (path === 'meId') continue;
    // Score cells have dedicated always-mine semantics (pass below) — the
    // generic LWW loop must not touch them or log them as overwrites.
    if (SCORE_PATH.test(path)) continue;
    const lTs = localMeta[path] ?? 0;
    const rTs = mergedMeta[path] ?? 0;
    const bothHadTs = localMeta[path] != null && mergedMeta[path] != null;

    if (lTs >= rTs) {
      setAtPath(merged, path, getAtPath(local, path));
      mergedMeta[path] = lTs;
    } else if (
      bothHadTs
      && !path.includes('.scoreConflicts.')
      && !path.includes('.scoreResolutions.')
    ) {
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

  // ── Score cells: always-mine + explicit resolution ─────────────────────────
  // A score cell this device wrote NEVER silently changes: the local value is
  // kept regardless of timestamps (device clocks skew). If the other side wrote
  // a different value, it is recorded as a conflict marker candidate instead of
  // replacing the display. The only thing that outranks a raw write is an
  // explicit resolution (conflict.resolve stamps round.scoreResolutions) at or
  // after that write. Runs after the generic loop so markers/resolutions have
  // already LWW-settled into `merged`.
  const originalRemoteMeta = remote._meta ?? {};
  for (const path of paths) {
    const sm = path.match(SCORE_PATH);
    if (!sm) continue;
    const [, rid, pid, holeStr] = sm;
    const lTs = localMeta[path] ?? 0;
    const rTs = originalRemoteMeta[path] ?? 0;
    const localWrote = localMeta[path] != null;
    const remoteWrote = originalRemoteMeta[path] != null;
    const lVal = getAtPath(local, path) ?? null;
    const rVal = getAtPath(remote, path) ?? null;
    const cPath = `rounds.${rid}.scoreConflicts.${pid}.h${holeStr}`;
    const resPath = `rounds.${rid}.scoreResolutions.${pid}.h${holeStr}`;
    const lRes = getAtPath(local, resPath) ?? 0;
    const rRes = getAtPath(remote, resPath) ?? 0;

    // 1. Remote carries a resolution at/after my raw write (and at/after any
    //    resolution of mine): the resolved value is authoritative.
    if (remoteWrote && rRes > 0 && rRes >= lTs && rRes >= lRes) {
      mergedMeta[path] = rTs; // merged is a clone of remote — value already there
      if (getAtPath(merged, cPath) != null) {
        setAtPath(merged, cPath, null);
        mergedMeta[cPath] = Math.max(mergedMeta[cPath] ?? 0, rRes);
      }
      continue;
    }

    // 2. I wrote this cell → my value stays, whatever the timestamps say.
    if (localWrote) {
      setAtPath(merged, path, getAtPath(local, path));
      mergedMeta[path] = lTs;
      const bothDiffer = remoteWrote && lVal !== rVal;
      const cMeta = mergedMeta[cPath] ?? 0;
      // My resolution at/after their write means their value is already
      // settled history, not a new conflict. Likewise a marker-clear stamped
      // at/after their write.
      const resolvedPastTheirs = lRes > 0 && lRes >= rTs;
      const clearCoversTheirs = cMeta >= rTs && getAtPath(merged, cPath) == null;
      if (bothDiffer && !resolvedPastTheirs && !clearCoversTheirs) {
        const existing = getAtPath(merged, cPath);
        const markerDetectedAt = existing?.detectedAt ?? Date.now();
        setAtPath(merged, cPath, {
          candidates: [
            { value: lVal, ts: lTs },
            { value: rVal, ts: rTs },
          ],
          detectedAt: markerDetectedAt,
        });
        mergedMeta[cPath] = Math.max(cMeta, markerDetectedAt);
      } else if (!bothDiffer && getAtPath(merged, cPath) != null) {
        // Values agree (or theirs vanished): the dispute is over.
        setAtPath(merged, cPath, null);
        mergedMeta[cPath] = Date.now();
      }
      continue;
    }

    // 3. I never wrote it → remote's value (already in merged) stands.
  }

  merged._meta = mergedMeta;

  // `merged` started as deepClone(remote), so it already carries remote's
  // meId — restore the device-local value (including an explicit null when
  // the user has not claimed a player yet on this device).
  if (local && 'meId' in local) merged.meId = local.meId;

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
