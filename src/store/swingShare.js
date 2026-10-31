// Swing sharing, the pure part (plan docs/superpowers/plans/2026-10-31-swing-share.md):
// which frames a shared swing needs, the share.json it uploads, and the /s/<token> link.
// Network and files live in swingShareStore.js.

export const SWING_SHARE_PATH = 's';
export const SHARE_SCHEMA = 1;

/**
 * Every frame the read-only Results view can ask for: the checkpoints and the internal
 * key frames the highlights and fixes measure against. Sorted, unique, integers.
 */
export function shareFrames(analysis) {
  const out = new Set();
  const add = (v) => { if (Number.isFinite(v)) out.add(Math.round(v)); };
  Object.values(analysis?.checkpoints ?? {}).forEach((c) => add(c?.i));
  Object.values(analysis?.internal ?? {}).forEach(add);
  return [...out].sort((a, b) => a - b);
}

/** The pose with only the shared frames' landmarks: everything else in it is kept. */
export function trimPose(pose, frames) {
  if (!pose) return null;
  const keep = new Set(frames);
  return { ...pose, frames: (pose.frames ?? []).filter((f) => f && keep.has(f.i)) };
}

/** The share.json body. */
export function sharePayload({ analysis, pose, frames }) {
  return { v: SHARE_SCHEMA, analysis, pose: trimPose(pose, frames), frames };
}

/** Storage paths under the link's token. */
export const sharePaths = {
  video: (token) => `${token}/video.mp4`,
  json: (token) => `${token}/share.json`,
  still: (token, frame) => `${token}/frames/${Math.round(frame)}.jpg`,
};

/** The link for a token: `${origin}/s/<token>`. */
export function swingShareUrl(origin, token) {
  if (!token) return null;
  return `${String(origin ?? '').replace(/\/+$/, '')}/${SWING_SHARE_PATH}/${encodeURIComponent(token)}`;
}

/** The token in a /s/<token> path, or null. */
export function swingShareTokenFromPath(pathname) {
  const m = /^\/s\/([^/?#]+)/.exec(pathname || '');
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

/** Same, from a full URL or the golf:// scheme. */
export function swingShareTokenFromUrl(url) {
  if (!url) return null;
  const scheme = /^golf:\/\/s\/([^/?#]+)/i.exec(url);
  if (scheme) return swingShareTokenFromPath(`/s/${scheme[1]}`);
  try { return swingShareTokenFromPath(new URL(url).pathname); } catch { return null; }
}

/** A share.json read back from storage, or null when it is not one this build can show. */
export function parseSharePayload(json) {
  if (!json || typeof json !== 'object' || json.v !== SHARE_SCHEMA) return null;
  if (!json.analysis || !Array.isArray(json.frames)) return null;
  return { analysis: json.analysis, pose: json.pose ?? null, frames: json.frames };
}
