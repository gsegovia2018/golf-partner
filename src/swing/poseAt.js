// Landmarks of a stored pose.json (analyzePose output, normalised) at any frame: the sample
// itself, or a linear blend of its two neighbours when native skipped that frame (the dead
// time before and after the swing is sampled sparsely, plan 4.2).

/** @returns {number[][]|null} 33 x [x, y, visibility], normalised, or null outside the samples */
export function poseAtFrame(pose, frame) {
  const fr = (pose?.frames || []).filter((f) => f && Array.isArray(f.lm) && f.lm.length === 33);
  if (!fr.length) return null;
  let lo = 0;
  let hi = fr.length - 1;
  if (frame < fr[lo].i || frame > fr[hi].i) return null;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (fr[m].i <= frame) lo = m; else hi = m;
  }
  const a = fr[lo];
  const b = fr[hi];
  if (a.i === frame || b.i === a.i) return a.lm;
  if (b.i === frame) return b.lm;
  const t = (frame - a.i) / (b.i - a.i);
  return a.lm.map((p, j) => p.map((v, c) => v + (b.lm[j][c] - v) * t));
}
