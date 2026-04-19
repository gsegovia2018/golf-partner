// Dot-encoded path helpers. Paths look like "rounds.r1.scores.p7.h5".
export function getAtPath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

export function setAtPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
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
    } else if (bothHadTs) {
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

  merged._meta = mergedMeta;
  return { merged, conflicts };
}
