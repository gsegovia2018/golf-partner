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
export function mergeTournaments(local, remote) {
  if (!remote) return local;
  if (!local) return remote;

  const merged = deepClone(remote);
  const mergedMeta = { ...(remote._meta ?? {}) };
  const localMeta = local._meta ?? {};
  const paths = new Set([...Object.keys(localMeta), ...Object.keys(mergedMeta)]);

  for (const path of paths) {
    const lTs = localMeta[path] ?? 0;
    const rTs = mergedMeta[path] ?? 0;
    if (lTs >= rTs) {
      setAtPath(merged, path, getAtPath(local, path));
      mergedMeta[path] = lTs;
    }
  }

  merged._meta = mergedMeta;
  return merged;
}
