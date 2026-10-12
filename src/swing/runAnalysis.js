// The analysis pipeline for one stored swing (plan 4.1): probe -> pose (pass 1) -> analyze()
// -> first save -> stills and club seeds (pass 2) -> analyze() again -> final save.
//
// The result screen opens after the first save with the club-dependent checks still
// unknown ("calculating"), exactly as the plan's budget table has it; pass 2 then fills in
// the stills and the address / impact clubhead seeds (D16). Everything native goes through
// frames.nativeApi(); see the contract at the top of frames.js.
//
// Never throws. Resolves to
//   { analysis, pass2: 'done' | 'failed' }     success (pass 2 failing is not an error: the club
//                                               checks just wait for the user's marks)
//   { error: 'no_pose' | 'partial_pose' | 'too_long' | 'update' | 'failed' }   (D12)
//   { cancelled: true }

import { Paths, Directory } from 'expo-file-system';
import { analyze } from './analyze';
import { nativeApi, getStill } from './frames';
import { expectedShaftPx } from './scale';
import { marksForAnalyze } from './labels';
import { frameOfKey } from './checkpointChecks';
import {
  getSwing, getSwingProfile, swingVideoUri, saveAnalysis, markSwingFailed, readMarks,
} from '../store/swingStore';

// The thirteen frames pass 2 decodes: the ten checkpoints (D22) plus the three internal ones.
const PASS2_KEYS = [
  'address', 'takeaway', 'leadArm', 'top', 'transition', 'shaftDown', 'impact', 'shaftThrough', 'trailArm', 'finish',
  'lateBackswing', 'preImpact', 'postImpact',
];

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
    const probe = await api.probeVideo(path);
    if (isCancelled()) return { cancelled: true };
    onProgress({ stage: 'reading', probe });

    onProgress({ stage: 'pose', done: 0, total: 0, probe });
    const sub = api.addListener?.('progress', (e) => {
      onProgress({ stage: e?.stage === 'decode' ? 'reading' : 'pose', done: e?.done ?? 0, total: e?.total ?? 0, probe });
    });
    let pose;
    try {
      pose = await api.analyzePose(path, { model: 'full' });
    } finally {
      sub?.remove?.();
    }
    if (isCancelled()) return { cancelled: true };

    onProgress({ stage: 'planes', probe });
    const opts = { ...base, probe };
    const a1 = analyze(pose, opts);
    if (a1.error) return await fail(a1.error);
    await saveAnalysis(swingId, a1, { pose, probe });
    first = a1;
    onPartial(first);

    // Pass 2 (stills + the address / impact clubhead seeds). Failing here is survivable.
    let final = first;
    let pass2 = 'failed';
    try {
      const dir = new Directory(Paths.document, 'swings', swingId, 'frames');
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
      const r = await api.extractCheckpoints(path, {
        frames: PASS2_KEYS.map((key) => ({
          key, i: frameOfKey(first, key), hands: first.clubMarks[key].hands, neighbours: 2,
        })),
        ball: pose.ball ?? null,
        expectedShaftPx: expectedShaftPx(first.scale.pxPerCm),
        outDir: dir.uri,
      });
      const p2 = { shaft: r?.shaft ?? {}, addressFrame: r?.addressFrame ?? null };
      const second = analyze(pose, { ...opts, pass2: p2 });
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
    return { analysis: final, pass2 };
  } catch {
    return first ? { analysis: first, pass2: 'failed' } : fail('failed');
  }
}
