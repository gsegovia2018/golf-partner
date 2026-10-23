// Pass 2 on the web (Checkpoints.kt): one decode of the checkpoint span that writes the stills
// (checkpoint ± neighbours), the scrub proxies, grey strips around the ball for the image-based
// address (ClubheadTrack), the radial shaft search at address and impact, and the learned club
// detector on the checkpoint frames. Same request and result map as the native method.
//
// Differences from Android: one decoder (no split at a sync frame), JPEG encodes awaited a few at a
// time instead of a thread pool, the detector on LiteRT.js. A second short decode only when the
// address moved onto frames the first one didn't write.

import { pt, Rect, CancelledError } from './core/geom';
import { Ball } from './core/ball';
import { ShaftSearch, ClubheadTrack } from './core/clubhead';
import { ClubRules } from './core/clubRules';
import { ClubDecode } from './core/clubDecode';
import { Proxies } from './core/framePlan';
import {
  WebFrame, makeCanvas, canvasJpeg, decimation,
} from './webFrame';
import { MODEL } from './club';

const SHAFT_CM = 105;
const PRIOR_CONF = 0.1;
const STILL_QUALITY = 0.85;
/** Encodes waiting at once: each holds a full-size canvas. */
const IN_FLIGHT = 4;

const toDeg = (r) => (r * 180) / Math.PI;
const rint = (v) => {
  const f = Math.floor(v);
  const d = v - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
};

/**
 * @param clip     openClip() result
 * @param req      the native request (extractCheckpoints opts)
 * @param env      { cancelled, write(dirUri, name, blob) → Promise<uri>, openDetector() → Promise<detector> }
 */
export async function extractCheckpointsWeb(clip, req, { cancelled = () => false, write, openDetector }) {
  const t0 = performance.now();
  const { track } = clip;
  const n = track.ptsUs.length;
  const decim = decimation(track.dispW, track.dispH);
  const ws = Math.min(Math.min(track.dispW, track.dispH) >= 720 ? 0.5 : 1, 1 / decim);
  const step = Math.round(1 / (ws * decim));
  const workW = Math.round(track.dispW * ws);
  const workH = Math.round(track.dispH * ws);
  const frameW = Math.trunc(track.dispW / decim);
  const frameH = Math.trunc(track.dispH / decim);

  const disp = (p) => pt(p.x * track.dispW, p.y * track.dispH);
  const hands = (h) => (Array.isArray(h) && h.length >= 2 && Number.isFinite(h[0]) && Number.isFinite(h[1]) ? disp(pt(h[0], h[1])) : null);
  const cps = (req.frames ?? []).map((c) => ({
    key: c.key, frame: c.i, hands: hands(c.hands), neighbours: Math.min(10, Math.max(0, c.neighbours ?? 2)),
  }));
  const ball = req.ball && Number.isFinite(req.ball.x) && Number.isFinite(req.ball.y) ? disp(pt(req.ball.x, req.ball.y)) : null;
  const expPx = Number.isFinite(req.expectedShaftPx) && req.expectedShaftPx > 0 ? req.expectedShaftPx : null;
  const pxPerCm = expPx != null ? expPx / SHAFT_CM : null;
  const exp = (expPx ?? 0) * ws;
  const ballD = (pxPerCm ?? 0) * Ball.BALL_CM * ws;
  const ok = (c) => c && c.hands && ball && expPx != null;
  const addr = cps.find((c) => c.key === 'address');
  const imp = cps.find((c) => c.key === 'impact');
  const addrOk = ok(addr) ? addr : null;
  const impOk = ok(imp) ? imp : null;

  const span = (c) => {
    const out = [];
    for (let f = c.frame - c.neighbours; f <= c.frame + c.neighbours; f += 1) if (f >= 0 && f < n) out.push(f);
    return out;
  };
  const stills = new Set(cps.flatMap(span));
  const s = req.addressSearch;
  const search = addrOk && s && Array.isArray(s.run) && s.run.length === 2 && Array.isArray(s.quiet) && s.quiet.length === 2 ? s : null;
  const fps = Number.isFinite(req.captureFps) && req.captureFps > 0 ? req.captureFps : 240;
  const ballF = ball ? pt(ball.x / decim, ball.y / decim) : null;
  const pxCmF = (pxPerCm ?? 0) / decim;
  let addrRange = null;
  if (search) {
    const a = ClubheadTrack.start(search.run[0], fps);
    const b = Math.min(search.quiet[0], n - 1);
    if (a < b) addrRange = [a, b];
  }
  const inAddr = (f) => addrRange && f >= addrRange[0] && f <= addrRange[1];
  const strip = addrRange ? ClubheadTrack.stripRect(ballF.x, ballF.y, pxCmF, frameW, frameH) : null;
  const samples = addrRange && req.clubModel ? new Set(ClubheadTrack.samples(addrRange[0], addrRange[1])) : new Set();

  const roi = (h) => {
    const half = ShaftSearch.patchHalf(exp, ballD);
    const hx = rint(h.x * ws);
    const hy = rint(h.y * ws);
    return new Rect(Math.max(0, hx - half), Math.max(0, hy - half), Math.min(workW, hx + half + 1), Math.min(workH, hy + half + 1));
  };
  const addrRoi = addrOk ? roi(addrOk.hands) : null;
  const impRoi = impOk ? roi(impOk.hands) : null;
  const seeded = (g, h) => {
    const seed = (toDeg(Math.atan2(ball.y - h.y, ball.x - h.x)) + 360) % 360;
    return ShaftSearch.search(g, workW, workH, h.x * ws, h.y * ws, exp, ballD, seed);
  };

  const proxyDir = req.proxyEvery > 0 && req.proxyDir ? req.proxyDir : null;
  const proxyRange = Array.isArray(req.proxyRange) && req.proxyRange.length === 2 ? req.proxyRange : null;
  const proxyFrames = new Set(proxyDir ? Proxies.frames(n, Math.min(64, req.proxyEvery), proxyRange) : []);
  const clubFrames = new Set(req.clubModel ? [...cps.map((c) => c.frame), ...samples].filter((f) => f >= 0 && f < n) : []);

  const written = new Map(); // frame -> uri
  const strips = new Map();
  const addrGrays = new Map();
  const clubInputs = new Map();
  let impactShaft = null;
  let shaftMs = 0;
  let proxiesWritten = 0;
  let proxyFailures = 0;
  let proxyMs = 0;
  let clubFailures = 0;
  let decoded = 0;
  const pending = new Set();
  const rgbScratch = makeCanvas(ClubDecode.SIZE, ClubDecode.SIZE);
  const [pw, ph] = Proxies.size(frameW, frameH);

  async function queue(job) {
    const p = job().finally(() => pending.delete(p));
    pending.add(p);
    while (pending.size >= IN_FLIGHT) {
      await Promise.race(pending);
    }
  }

  function clubInput(f, wf) {
    try {
      clubInputs.set(f, wf.rgb(ClubDecode.SIZE, ClubDecode.SIZE, rgbScratch));
    } catch {
      clubFailures += 1;
    }
  }

  async function handle(f, wf, which) {
    if (which.addrStrip) strips.set(f, wf.graySampled(strip[0], strip[1]));
    if (which.addrGray) addrGrays.set(f, wf.grayStrip(addrRoi, step));
    if (which.impact) {
      const t = performance.now();
      impactShaft = seeded(wf.grayStrip(impRoi, step), impOk.hands);
      shaftMs += performance.now() - t;
    }
    if (which.proxy && !cancelled()) {
      const t = performance.now();
      try {
        const c = wf.drawTo(makeCanvas(pw, ph), pw, ph, false);
        proxyMs += performance.now() - t;
        await queue(async () => {
          try {
            if (cancelled()) return;
            await write(proxyDir, `${f}.jpg`, await canvasJpeg(c, Proxies.JPEG_QUALITY / 100));
            proxiesWritten += 1;
          } catch {
            proxyFailures += 1;
          }
        });
      } catch {
        proxyFailures += 1;
      }
    }
    if (which.club) clubInput(f, wf);
    if (which.still) {
      const c = wf.full();
      await queue(async () => {
        written.set(f, await write(req.outDir, `${f}.jpg`, await canvasJpeg(c, STILL_QUALITY)));
      });
    }
  }

  async function decodeSpan(frames, pick) {
    if (!frames.size) return;
    const lo = Math.min(...frames);
    const hi = Math.max(...frames);
    for await (const d of clip.frames(lo, hi, { cancelled, want: (f) => frames.has(f) })) {
      if (cancelled()) throw new CancelledError();
      decoded += 1;
      if (frames.has(d.frame)) await handle(d.frame, new WebFrame(d, track), pick(d.frame));
    }
  }

  let mainMs = 0;
  let addrMs = 0;
  let onsetMs = 0;
  let waitMs = 0;
  let onset = null;
  let addressShaft = null;
  let clubMs = 0;
  let clubDets = null;
  let clubScenery = [];
  let clubDelegate = 'cpu';
  let detector = null;
  const dets = new Map();

  try {
    const wanted = new Set([...stills, ...proxyFrames, ...clubFrames]);
    if (addrRange) for (let f = addrRange[0]; f <= addrRange[1]; f += 1) wanted.add(f);
    if (addrOk) wanted.add(addrOk.frame);
    if (impOk) wanted.add(impOk.frame);
    let t = performance.now();
    await decodeSpan(wanted, (f) => ({
      addrStrip: inAddr(f),
      addrGray: addrOk && f === addrOk.frame,
      impact: impOk && f === impOk.frame,
      proxy: proxyFrames.has(f),
      club: clubFrames.has(f),
      still: stills.has(f),
    }));
    mainMs = performance.now() - t;

    const infer = async (frames) => {
      if (!detector) return;
      const t1 = performance.now();
      const sx = track.dispW / ClubDecode.SIZE;
      const sy = track.dispH / ClubDecode.SIZE;
      for (const f of [...frames].sort((a, b) => a - b)) {
        if (cancelled()) throw new CancelledError();
        const px = clubInputs.get(f);
        if (!px) continue;
        clubInputs.delete(f);
        try {
          dets.set(f, (await detector.detect(px)).map((b) => b.scaled(sx, sy)));
        } catch (e) {
          clubFailures += 1;
          console.warn(`[swing] club detector failed at frame ${f}`, e);
        }
      }
      clubMs += performance.now() - t1;
    };
    if (req.clubModel) {
      t = performance.now();
      try {
        detector = await openDetector();
        clubDelegate = detector.delegate;
      } catch (e) {
        clubFailures += 1;
        console.warn('[swing] club detector unavailable, keeping the edge proposals', e);
      }
      clubMs += performance.now() - t;
      await infer([...cps.filter((c) => c.key !== 'address').map((c) => c.frame), ...samples]);
    }

    t = performance.now();
    if (addrRange) {
      const places = new Map();
      cps.filter((c) => c.key !== 'address' && dets.has(c.frame)).forEach((c) => places.set(c.frame, ClubRules.place(c.key)));
      const voting = new Map([...dets].filter(([f]) => places.has(f)));
      const scenery = ClubRules.scenery([...ClubRules.splitStatic(voting, places)[1].values()].flat());
      const heads = new Map();
      samples.forEach((f) => {
        const boxes = dets.get(f);
        let best = null;
        if (boxes) {
          ClubRules.dropScenery(boxes, scenery).filter((b) => b.cls === ClubDecode.HEAD).forEach((b) => {
            if (!best || b.score > best.score) best = b;
          });
        }
        heads.set(f, best ? [best.cx / decim, best.cy / decim, best.score] : null);
      });
      const rest = ClubheadTrack.restingHead(heads, ballF.x, ballF.y, pxCmF);
      let ref;
      let hx;
      let hy;
      if (rest) [ref, hx, hy] = rest;
      else {
        [hx, hy] = ClubheadTrack.fallbackHead(ballF.x, ballF.y, addrOk.hands.x / decim, pxCmF);
        ref = addrRange[0];
      }
      const [rect, stepS] = strip;
      const headTrack = ClubheadTrack.track(strips, [rect.x0, rect.y0], stepS, ref, hx, hy, ballF.x, ballF.y, pxCmF);
      const at = ClubheadTrack.address(headTrack, ref, addrRange[1], fps, addrRange[0] === 0);
      onset = at != null && at >= 0 && at < n ? at : null;
      strips.clear();
    }
    onsetMs = performance.now() - t;

    if (addrOk) {
      const at = onset ?? addrOk.frame;
      if (at !== addrOk.frame) {
        const missing = new Set(span({ frame: at, neighbours: addrOk.neighbours }).filter((f) => !stills.has(f)));
        t = performance.now();
        await decodeSpan(new Set([...missing, at]), (f) => ({
          addrGray: f === at,
          club: f === at && req.clubModel && !clubInputs.has(f) && !dets.has(f),
          still: missing.has(f),
        }));
        addrMs = performance.now() - t;
      }
      const g = addrGrays.get(at);
      if (g) {
        const t2 = performance.now();
        addressShaft = seeded(g, addrOk.hands);
        shaftMs += performance.now() - t2;
      }
    }

    if (detector) {
      const address = cps.find((c) => c.key === 'address');
      const finalAddress = address ? (onset ?? address.frame) : null;
      if (finalAddress != null) await infer([finalAddress]);
      const places = new Map();
      cps.forEach((c) => {
        const f = c.key === 'address' && onset != null ? onset : c.frame;
        if (!places.has(f)) places.set(f, ClubRules.place(c.key));
      });
      const [kept, dropped] = ClubRules.splitStatic(new Map([...dets].filter(([f]) => places.has(f))), places);
      clubDets = kept;
      clubScenery = ClubRules.scenery([...dropped.values()].flat());
    }
    clubInputs.clear();
    t = performance.now();
    await Promise.all([...pending]);
    waitMs = performance.now() - t;
  } finally {
    try { detector?.close(); } catch { /* ignore */ }
  }

  const finalFrames = Object.fromEntries(cps.map((c) => [c.key, c.key === 'address' && onset != null ? onset : c.frame]));
  const stillsOut = {};
  cps.forEach((c) => {
    const at = finalFrames[c.key];
    const m = {};
    for (let f = at - c.neighbours; f <= at + c.neighbours; f += 1) if (written.has(f)) m[String(f)] = written.get(f);
    stillsOut[c.key] = m;
  });
  const prior = () => ({
    head: null, hidden: false, conf: PRIOR_CONF, source: 'prior',
  });
  const entry = (sf) => ({
    head: sf.hidden ? null : [sf.headX / ws, sf.headY / ws],
    hidden: sf.hidden,
    conf: Math.round(sf.conf * 1000) / 1000,
    source: 'edge',
    angleDeg: sf.angleDeg,
    lengthPx: sf.lengthPx / ws,
  });
  const base = {};
  cps.forEach((c) => { base[String(finalFrames[c.key])] = prior(); });
  if (addrOk) base[String(finalFrames.address)] = addressShaft ? entry(addressShaft) : prior();
  if (impOk) base[String(impOk.frame)] = impactShaft ? entry(impactShaft) : prior();
  const grips = new Map();
  cps.forEach((c) => { const f = finalFrames[c.key]; if (!grips.has(f)) grips.set(f, c.hands); });
  const shaft = ClubRules.merge(base, clubDets, grips, pxPerCm);

  const timings = {
    totalMs: Math.round(performance.now() - t0),
    decodeMs: Math.round(mainMs),
    addressDecodeMs: Math.round(addrMs),
    jpegWaitMs: Math.round(waitMs),
    onsetMs: Math.round(onsetMs),
    shaftMs: Math.round(shaftMs),
    decoded,
    stills: written.size,
    proxies: proxiesWritten,
    proxyMs: Math.round(proxyMs),
    proxyFailures,
    backend: clip.backend,
  };
  if (req.clubModel) {
    Object.assign(timings, {
      clubMs: Math.round(clubMs), clubFrames: clubDets?.size ?? 0, clubFailures, clubDelegate,
    });
  }
  const pf = [...proxyFrames];
  const out = {
    stills: stillsOut,
    shaft,
    addressFrame: onset,
    proxies: proxyDir ? {
      every: req.proxyEvery, from: pf.length ? Math.min(...pf) : 0, to: pf.length ? Math.max(...pf) : -1, count: proxiesWritten, failed: proxyFailures,
    } : null,
    timings,
  };
  if (req.clubModel) {
    out.club = clubDets ? {
      model: MODEL, input: ClubDecode.SIZE, conf: ClubDecode.CONF, nms: ClubDecode.NMS_IOU, scenery: ClubRules.boxJson(clubScenery),
    } : null;
  }
  return out;
}
