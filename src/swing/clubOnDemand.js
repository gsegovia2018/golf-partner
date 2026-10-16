// A clubhead proposal on the frame the golfer chose (plan 2026-10-16-swing-club-on-demand): the
// seam between the marking canvas and native.detectClub. It reads the frame's still from disk,
// asks the warm detector, and answers normalised like pass 2's proposals. It never rejects: no
// still, no model or a failed frame is just "no proposal" (the head stays Missing, as before).
import { getStill } from './frames';
import { detectClub, releaseClub, clubOnDemandSupport } from './native';

let unavailable = false; // ERR_CLUB (no runtime or model on this binary): ask no more this session

/** Can the canvas ask for proposals (the binary has detectClub and has not said the model is missing)? */
export const canProposeClub = () => !unavailable && clubOnDemandSupport();

/** Tests only: forget the ERR_CLUB latch. */
export function resetClubOnDemand() { unavailable = false; }

/**
 * @param {{ swingId: string, frame: number, grip: [number, number] | null,
 *   video: { width: number, height: number }, pxPerCm: number | null,
 *   scenery?: Array<{ cls: string, box: number[] }> | null }} q  grip normalised
 * @returns {Promise<{ head: [number, number], hidden: false, conf: number, source: 'model' | 'model-shaft' } | null>}
 *   head normalised to the frame, or null
 */
export async function proposeClub({
  swingId, frame, grip, video, pxPerCm, scenery,
}) {
  if (!canProposeClub()) return null;
  const still = getStill(swingId, frame);
  if (!still) return null;
  try {
    const out = await detectClub({
      frames: [{ frame, still, grip: grip ?? null }],
      video: { width: video.width, height: video.height },
      pxPerCm: pxPerCm ?? null,
      scenery: scenery ?? [],
    });
    const r = out?.frames?.[frame];
    if (!r?.head || !r.source) return null;
    return {
      head: [r.head[0] / video.width, r.head[1] / video.height], hidden: false, conf: r.conf ?? null, source: r.source,
    };
  } catch (e) {
    if (e?.code === 'ERR_CLUB') unavailable = true;
    return null;
  }
}

/** Opens the detector ahead of the first proposal (≈ 0.5 s of GPU init), so the tap finds it warm. */
export function warmClub() {
  if (!canProposeClub()) return;
  detectClub({ frames: [], video: { width: 1, height: 1 }, pxPerCm: null, scenery: [] }).catch((e) => {
    if (e?.code === 'ERR_CLUB') unavailable = true;
  });
}

/** Closes the warm detector (the canvas unmounts); never throws. */
export function releaseClubDetector() {
  if (!clubOnDemandSupport()) return;
  Promise.resolve(releaseClub()).catch(() => {});
}
