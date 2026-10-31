// Swing sharing, the network part (plan docs/superpowers/plans/2026-10-31-swing-share.md).
// A swing leaves the phone only through shareSwing(), on the golfer's tap; unshareSwing()
// deletes everything it uploaded. The public page reads with getPublicSwing() (anon).
// RPCs and the bucket: supabase/migrations/20261031000000_swing_shares.sql.

import { supabase } from '../lib/supabase';
import { ensureStills } from '../swing/frames';
import {
  getSwing, readAnalysis, readPose, readSwingBytes, setSwingShare, hasCustomName, deleteSwing,
} from './swingStore';
import {
  shareFrames, sharePayload, sharePaths, parseSharePayload,
} from './swingShare';

export const SWING_SHARE_BUCKET = 'swing-shares';

export class SwingShareError extends Error {
  constructor(message, { offline = false, code = null } = {}) {
    super(message);
    this.name = 'SwingShareError';
    this.offline = offline;
    this.code = code;
  }
}

const bucket = () => supabase.storage.from(SWING_SHARE_BUCKET);

// supabase-js takes an ArrayBuffer; a Uint8Array view may sit inside a bigger buffer.
const bufferOf = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

async function rpc(name, args) {
  let res;
  try {
    res = await supabase.rpc(name, args);
  } catch (e) {
    throw new SwingShareError(e?.message || 'Request failed', { offline: true });
  }
  if (res.error) throw new SwingShareError(res.error.message || 'Request failed', { offline: !res.error.code, code: res.error.code });
  return res.data;
}

async function upload(path, body, contentType) {
  let res;
  try {
    res = await bucket().upload(path, body, { contentType, upsert: true });
  } catch (e) {
    throw new SwingShareError(e?.message || 'Upload failed', { offline: true });
  }
  if (res.error) throw new SwingShareError(res.error.message || 'Upload failed');
}

/**
 * Uploads the swing (video, share.json, one still per key frame) under its link and opens it.
 * onProgress({ done, total }) after each file. Resolves to the token; the swing's row keeps it.
 * Sharing a swing again replaces its files and keeps its link.
 */
export async function shareSwing(swingId, { onProgress } = {}) {
  const row = getSwing(swingId);
  if (!row) throw new SwingShareError('Swing not found');
  const analysis = await readAnalysis(swingId);
  if (!analysis || analysis.error) throw new SwingShareError('Swing not analysed');
  const pose = await readPose(swingId);
  const frames = shareFrames(analysis);
  await ensureStills(swingId, frames);
  const video = await readSwingBytes(swingId, 'video.mp4');
  if (!video) throw new SwingShareError('Video missing');

  const token = await rpc('start_swing_share', {
    p_swing_id: swingId,
    p_title: hasCustomName(row) ? row.name : null,
    p_club: row.club ?? null,
    p_recorded_at: row.createdAt ?? null,
  });

  const stills = [];
  for (const f of frames) {
    // a frame without a still on disk is shown without its picture, never blocks the share
    const bytes = await readSwingBytes(swingId, `frames/${f}.jpg`);
    if (bytes) stills.push([f, bytes]);
  }
  const total = 2 + stills.length;
  let done = 0;
  const step = () => { done += 1; onProgress?.({ done, total }); };
  onProgress?.({ done, total });

  await upload(sharePaths.video(token), bufferOf(video), 'video/mp4');
  step();
  for (const [f, bytes] of stills) {
    await upload(sharePaths.still(token, f), bufferOf(bytes), 'image/jpeg');
    step();
  }
  const payload = sharePayload({ analysis, pose, frames: stills.map(([f]) => f) });
  await upload(sharePaths.json(token), JSON.stringify(payload), 'application/json');
  step();

  await rpc('finish_swing_share', { p_token: token });
  await setSwingShare(swingId, { token, at: new Date().toISOString() });
  return token;
}

/** Deletes the link's files, then the link. The swing on the phone stays. No-op when not shared. */
export async function unshareSwing(swingId) {
  const token = getSwing(swingId)?.share?.token;
  if (!token) return;
  const paths = [sharePaths.video(token), sharePaths.json(token)];
  let listed;
  try {
    listed = await bucket().list(`${token}/frames`, { limit: 1000 });
  } catch (e) {
    throw new SwingShareError(e?.message || 'Request failed', { offline: true });
  }
  if (listed.error) throw new SwingShareError(listed.error.message || 'Request failed');
  (listed.data ?? []).forEach((o) => paths.push(`${token}/frames/${o.name}`));
  let removed;
  try {
    removed = await bucket().remove(paths);
  } catch (e) {
    throw new SwingShareError(e?.message || 'Request failed', { offline: true });
  }
  if (removed.error) throw new SwingShareError(removed.error.message || 'Request failed');
  await rpc('end_swing_share', { p_token: token });
  await setSwingShare(swingId, null);
}

/**
 * The public page's data: { meta: {sharer, title, club, recorded_at, shared_at}, analysis, pose,
 * frames, videoUrl, stillUrl(frame) }, or null for a link that is closed or unknown.
 * Throws SwingShareError (offline when the network failed).
 */
export async function getPublicSwing(token) {
  if (!token) return null;
  const meta = await rpc('get_public_swing', { p_token: token });
  if (!meta) return null;
  const url = (path) => bucket().getPublicUrl(path).data.publicUrl;
  let json;
  try {
    const res = await fetch(url(sharePaths.json(token)), { cache: 'no-store' });
    if (res.status === 400 || res.status === 404) return null; // closed while we were reading
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json();
  } catch (e) {
    throw new SwingShareError(e?.message || 'Request failed', { offline: true });
  }
  const payload = parseSharePayload(json);
  if (!payload) return null;
  const have = new Set(payload.frames);
  return {
    meta,
    ...payload,
    videoUrl: url(sharePaths.video(token)),
    stillUrl: (frame) => (have.has(Math.round(frame)) ? url(sharePaths.still(token, frame)) : null),
  };
}

/** Deletes a shared swing: closes its link first, and keeps the swing when that fails (throws). */
export async function deleteSharedSwing(swingId) {
  await unshareSwing(swingId);
  await deleteSwing(swingId);
}
