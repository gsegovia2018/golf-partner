// The analysis pipeline for one stored swing (plan 4.1): probe -> pose (pass 1) -> analyze()
// -> first save -> stills and club seeds (pass 2) -> analyze() again -> final save.
//
// The first save keeps the swing `pending`; pass 2 then fills in the stills and the address /
// impact clubhead seeds (D16) and the final save makes it ready. Only then can the marking pass
// (D26) start or resume, so pass 2 never writes over the golfer's marks or club. Everything native goes through
// frames.nativeApi(); see the contract at the top of frames.js.
//
// Never throws. Resolves to
//   { analysis, pass2: 'done' | 'failed' }     success (pass 2 failing is not an error: the club
//                                               checks just wait for the user's marks)
//   { error: 'no_pose' | 'partial_pose' | 'too_long' | 'update' | 'failed' }   (D12)
//   { cancelled: true }

import { Paths, Directory } from 'expo-file-system';
import { analyze, CLUB_KEYS } from './analyze';
import {
  nativeApi, getStill, proxyDir, proxyWindow, PROXY_EVERY,
} from './frames';
import { expectedShaftPx } from './scale';
import { marksForAnalyze } from './labels';
import { frameOfKey } from './checkpointChecks';
import { APPROX_FPS } from './fpsModel';
import {
  getSwing, getSwingProfile, swingVideoUri, saveAnalysis, markSwingFailed, readMarks,
} from '../store/swingStore';

// The frames pass 2 decodes and asks the club detector about: the seven positions and the finish
// (swing checks v2). Native's scenery vote (ClubRules.dropStatic) then has 8 places, not 11.
export const PASS2_KEYS = CLUB_KEYS;

// The swing profile drives the native ball search side and the expected ball size, and the
// probe gives the sampling policy its time base. Unknown values are left out (never sent as
// null): native then uses its defaults (right-handed, 176 cm, the file's capture-rate tag or
// 240 fps). Native clamps the height to 120-230 cm.
export function poseOptions(profile, probe) {
  const opts = { model: 'full', handedness: profile?.handedness === 'left' ? 'left' : 'right' };
  const h = Number(profile?.heightCm);
  if (profile?.heightCm != null && Number.isFinite(h) && h > 0) opts.heightCm = h;
  const fps = policyFps(probe);
  if (fps) opts.captureFps = fps;
  return opts;
}

// Capture frames per second of one container frame step, before any pose exists (plan 4.2):
// the capture-rate tag when the file has one; a high-rate container (>= 100 fps) is its own
// capture rate; otherwise unknown (a 30 fps container may be 8x slow motion).
export function policyFps(probe) {
  const capture = Number(probe?.captureFps);
  if (Number.isFinite(capture) && capture > 0) return capture;
  const container = Number(probe?.containerFps);
  if (Number.isFinite(container) && container >= APPROX_FPS) return container;
  return null;
}

// The ball pass 2 seeds the clubhead from: the golfer's own ball mark ([x, y, r] normalised,
// Edit marks) wins over native's pass-1 proposal, also when native found none.
export function pass2Ball(userBall, nativeBall) {
  if (Array.isArray(userBall) && userBall.length >= 2 && userBall.slice(0, 2).every(Number.isFinite)) {
    return { x: userBall[0], y: userBall[1], r: Number.isFinite(userBall[2]) ? userBall[2] : nativeBall?.r ?? 0 };
  }
  return nativeBall ?? null;
}

export async function runAnalysis(swingId, { onProgress = () => {}, onPartial = () => {}, isCancelled = () => false } = {}) {
  const api = nativeApi();
  if (!api) return { error: 'update' };
  const row = getSwing(swingId);
  if (!row) return { error: 'failed' };
  const profile = getSwingProfile();
  const path = swingVideoUri(swingId);
  let first = null; // set once the first save landed: from then on the swing is usable
  const fail = async (error) => { await markSwingFailed(swingId, error); return { error }; };

  try {
    const saved = await readMarks(swingId);
    const base = {
      swingId,
      createdAt: row.createdAt,
      handedness: profile.handedness,
      heightCm: profile.heightCm,
      club: row.club,
      source: row.source,
      marks: marksForAnalyze(saved),
      ball: saved?.ball?.final ?? undefined,
    };

    onProgress({ stage: 'reading' });
    let probe = await api.probeVideo(path);
    if (isCancelled()) return { cancelled: true };
    onProgress({ stage: 'reading', probe });

    onProgress({ stage: 'pose', done: 0, total: 0, probe });
    let posing = false;
    const sub = api.addListener?.('progress', (e) => {
      // Native interleaves decode and pose events; once pose frames arrive, stay on pose.
      if (e?.stage !== 'decode') posing = true;
      else if (posing) return;
      onProgress({ stage: e?.stage === 'decode' ? 'reading' : 'pose', done: e?.done ?? 0, total: e?.total ?? 0, probe });
    });
    let pose;
    try {
      pose = await api.analyzePose(path, poseOptions(profile, probe));
    } finally {
      sub?.remove?.();
    }
    if (isCancelled()) return { cancelled: true };
    // the duplicate-frame check runs inside analyzePose (it decodes every frame anyway)
    if (typeof pose?.duplicateFrameRatio === 'number') probe = { ...probe, duplicateFrameRatio: pose.duplicateFrameRatio };

    onProgress({ stage: 'planes', probe });
    const opts = { ...base, probe };
    const a1 = analyze(pose, opts);
    if (a1.error) return await fail(a1.error);
    await saveAnalysis(swingId, a1, { pose, probe, status: 'pending' });
    first = a1;
    onPartial(first);

    // Pass 2 (stills + the address / impact clubhead seeds). Failing here is survivable.
    let final = first;
    let pass2 = 'failed';
    try {
      const dir = new Directory(Paths.document, 'swings', swingId, 'frames');
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
      // D28: an apiVersion 3 binary also writes the scrub proxies; an older one is not asked
      // over the swing window only, so the decode span stays close to the checkpoints' one
      const proxies = api.proxySupport?.()
        ? { proxyEvery: PROXY_EVERY, proxyDir: proxyDir(swingId).uri, proxyRange: proxyWindow(first, pose.video?.frameCount ?? 0) }
        : {};
      // apiVersion 4: also ask for the learned club detector; an older binary is not asked
      const club = api.clubModelSupport?.() ? { clubModel: true } : {};
      const r = await api.extractCheckpoints(path, {
        frames: PASS2_KEYS.map((key) => ({
          key, i: frameOfKey(first, key), hands: first.clubMarks[key].hands, neighbours: 2,
        })),
        ball: pass2Ball(saved?.ball?.final, pose.ball),
        expectedShaftPx: expectedShaftPx(first.scale.pxPerCm),
        addressSearch: first.addressSearch ?? null,
        outDir: dir.uri,
        ...proxies,
        ...club,
      });
      if (isCancelled()) return { cancelled: true };
      const p2 = { shaft: r?.shaft ?? {}, addressFrame: r?.addressFrame ?? null };
      if (r?.timings) p2.timings = r.timings;
      // the proxies written ({ every, from, to, count, failed }): stored with the pose, which every
      // re-analysis reads back, so the canvas knows them without looking at the disk
      if (r?.proxies) p2.proxies = r.proxies;
      // what ran ({ model, input, conf, nms }) or null: says whether a stored swing was analysed with the model
      p2.club = r?.club ?? null;
      // The club and marks as they are now, not as they were when the run started.
      const latest = await readMarks(swingId);
      const second = analyze(pose, {
        ...opts,
        pass2: p2,
        club: getSwing(swingId)?.club ?? opts.club,
        marks: marksForAnalyze(latest),
        ball: latest?.ball?.final ?? opts.ball,
      });
      if (!second.error) {
        final = second;
        pass2 = 'done';
        await saveAnalysis(swingId, second, {
          pose: { ...pose, pass2: p2 },
          probe,
          thumb: getStill(swingId, frameOfKey(second, 'impact')),
        });
      }
    } catch { /* keep the first analysis; the clubhead waits for the user's marks */ }
    if (isCancelled()) return { cancelled: true }; // a cancelled pass 2 often fails too: it is not a finished swing
    if (pass2 !== 'done') await saveAnalysis(swingId, first, { thumb: getStill(swingId, frameOfKey(first, 'impact')) });
    return { analysis: final, pass2 };
  } catch {
    if (!first) return fail('failed');
    try { await saveAnalysis(swingId, first); } catch { /* the row stays pending and is analysed again */ }
    return { analysis: first, pass2: 'failed' };
  }
}
