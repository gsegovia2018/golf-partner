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
