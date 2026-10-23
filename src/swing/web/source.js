// Decoded frames of a clip, in presentation order with their frame numbers (the web's
// Media.decode). Two backends behind one interface:
//
//   WebCodecs  VideoDecoder fed straight from the file's samples: fast, every frame. Chrome
//              (desktop, Android) and Safari 16.4+ for H.264; HEVC where the platform decoder
//              takes it.
//   element    a <video> seeked to each wanted frame and drawn: slow (one seek per frame), but
//              every codec the browser plays (HEVC on iOS when WebCodecs refuses it, MPEG-4 Part 2).
//
// openClip(blob) reads the sample table once; clip.frames(from, to, opts) yields
// { frame, ptsUs, image, width, height } where `image` is a CanvasImageSource in CODED orientation
// (draw it with webFrame.js, which rotates). Every yielded image is only valid until the next one:
// the generator closes it when the consumer asks for the next frame (the decoder's frame pool is
// small on phones, so a frame is never held).

import { readVideoTrack, blobReader } from './mp4';
import { CancelledError, UnsupportedVideoError } from './core/geom';

const hasWebCodecs = () => typeof VideoDecoder !== 'undefined' && typeof EncodedVideoChunk !== 'undefined';

// Bytes read from the file per slice: samples of a GOP sit next to each other, so one read covers many.
const READ_BLOCK = 4 << 20;
// Decoder input kept queued ahead of the consumer (frames, not bytes).
const AHEAD = 6;
// No output for this long while input is queued = a stuck decoder.
const STALL_MS = 10000;

/** Byte cache over the clip: one READ_BLOCK slice at a time. */
function sampleBytes(reader) {
  let base = -1;
  let block = null;
  return async (s) => {
    if (block && s.offset >= base && s.offset + s.size <= base + block.length) {
      return block.subarray(s.offset - base, s.offset - base + s.size);
    }
    const len = Math.max(READ_BLOCK, s.size);
    block = await reader.read(s.offset, len);
    base = s.offset;
    return block.subarray(0, s.size);
  };
}

function decoderConfig(track) {
  const cfg = {
    codec: track.codec,
    codedWidth: track.codedWidth,
    codedHeight: track.codedHeight,
    optimizeForLatency: true,
  };
  if (track.description) cfg.description = track.description;
  return cfg;
}

/** True when this browser's VideoDecoder takes the clip's codec. */
export async function webCodecsSupports(track) {
  if (!hasWebCodecs() || !/^(avc[13]|hvc1|hev1|vp09|av01)\./.test(track.codec)) return false;
  try {
    const r = await VideoDecoder.isConfigSupported(decoderConfig(track));
    return !!r?.supported;
  } catch {
    return false;
  }
}

/**
 * A WebCodecs decoder that can be resumed: frames(from, to) goes on forward from the last output
 * when no sync sample lies between (the warm scrubber), else it resets and starts at the sync
 * sample at or before `from`.
 */
class CodecDecoder {
  constructor(track, read) {
    this.track = track;
    this.read = read;
    this.decoder = null;
    this.fed = -1; // decode index of the last sample fed
    this.lastOut = -1; // frame number of the last output handed over
    this.queue = [];
    this.error = null;
    this.wake = null;
    this.flushed = false;
  }

  open() {
    this.close();
    this.queue = [];
    this.error = null;
    this.flushed = false;
    // a closed decoder still calls back (an AbortError, late outputs): only the current one counts
    const dec = new VideoDecoder({
      output: (f) => {
        if (dec !== this.decoder) { f.close(); return; }
        this.queue.push(f);
        this.notify();
      },
      error: (e) => {
        if (dec !== this.decoder) return;
        this.error = e;
        this.notify();
      },
    });
    this.decoder = dec;
    dec.configure(decoderConfig(this.track));
  }

  notify() {
    const w = this.wake;
    this.wake = null;
    if (w) w();
  }

  close() {
    this.queue.forEach((f) => f.close());
    this.queue = [];
    if (this.decoder && this.decoder.state !== 'closed') {
      try { this.decoder.close(); } catch { /* already closed */ }
    }
    this.decoder = null;
    this.fed = -1;
    this.lastOut = -1;
  }

  /** The decode index to start feeding from for presentation frame `from`. */
  startFor(from) {
    const t = this.track;
    let sync = t.syncFrames[0] ?? 0;
    for (const f of t.syncFrames) { if (f <= from) sync = f; else break; }
    return t.samples[t.frames[sync]].index;
  }

  needsSeek(from) {
    if (!this.decoder || this.decoder.state === 'closed' || this.flushed || this.lastOut < 0) return true;
    if (from <= this.lastOut) return true;
    // a sync sample after the last output and at or before `from`: seeking there skips the frames between
    return this.track.syncFrames.some((f) => f > this.lastOut && f <= from);
  }

  async* frames(from, to, { cancelled = () => false, want = null } = {}) {
    const t = this.track;
    const last = Math.min(to, t.frames.length - 1);
    if (from > last) return;
    if (this.needsSeek(from)) {
      this.open();
      this.fed = this.startFor(from) - 1;
    }
    let lastInput = Date.now();
    while (true) {
      if (cancelled()) throw new CancelledError();
      if (this.error) {
        const e = this.error;
        this.close();
        throw new UnsupportedVideoError(`the browser could not decode this video (${e?.message ?? e})`);
      }
      // keep the decoder fed a few frames ahead of the consumer
      while (!this.flushed && this.fed + 1 < t.samples.length && this.decoder.decodeQueueSize < AHEAD && this.queue.length < AHEAD) {
        const s = t.samples[this.fed + 1];
        const data = await this.read(s);
        if (!this.decoder || this.decoder.state === 'closed') return;
        this.decoder.decode(new EncodedVideoChunk({
          type: s.sync ? 'key' : 'delta', timestamp: s.ptsUs, data,
        }));
        this.fed += 1;
        lastInput = Date.now();
      }
      if (!this.flushed && this.fed + 1 >= t.samples.length && this.decoder.decodeQueueSize === 0) {
        // end of the stream: what is held for reordering comes out with a flush
        this.flushed = true;
        const dec = this.decoder;
        dec.flush().then(() => this.notify(), (e) => {
          // a flush cut short by close() (a seek, a release) is not a decode error
          if (dec === this.decoder && !this.error) this.error = e;
          this.notify();
        });
      }
      if (this.queue.length) {
        const vf = this.queue.shift();
        const frame = this.frameOf(vf.timestamp);
        if (frame == null || frame < from || (want && !want(frame))) {
          vf.close();
          if (frame != null && frame >= last) { this.lastOut = frame; return; }
          continue;
        }
        this.lastOut = frame;
        try {
          yield {
            frame, ptsUs: t.ptsUs[frame], image: vf, width: vf.displayWidth, height: vf.displayHeight,
          };
        } finally {
          vf.close();
        }
        if (frame >= last) return;
        continue;
      }
      if (this.flushed && this.decoder.decodeQueueSize === 0 && !this.queue.length) {
        // the flush resolved (or is about to): wait one turn for its outputs, then stop
        await new Promise((r) => { this.wake = r; setTimeout(r, 50); });
        if (!this.queue.length) return;
        continue;
      }
      if (Date.now() - lastInput > STALL_MS) throw new UnsupportedVideoError('the video decoder stalled');
      await new Promise((r) => { this.wake = r; setTimeout(r, 250); });
    }
  }

  frameOf(ts) {
    if (!this.index) {
      this.index = new Map();
      this.track.ptsUs.forEach((p, f) => this.index.set(p, f));
    }
    return this.index.get(ts) ?? null;
  }
}

/**
 * The <video> fallback: one seek per frame. `want` (frame → bool) keeps the seeks to the frames the
 * caller needs; without it every frame in range is visited.
 */
class ElementDecoder {
  constructor(track, url) {
    this.track = track;
    this.url = url;
    this.video = null;
  }

  async load() {
    if (this.video) return this.video;
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    v.src = this.url;
    await new Promise((resolve, reject) => {
      const ok = () => { cleanup(); resolve(); };
      const bad = () => { cleanup(); reject(new UnsupportedVideoError('this browser cannot play this video')); };
      const cleanup = () => { v.removeEventListener('loadeddata', ok); v.removeEventListener('error', bad); };
      v.addEventListener('loadeddata', ok);
      v.addEventListener('error', bad);
      v.load();
    });
    this.video = v;
    return v;
  }

  async seek(sec) {
    const v = this.video;
    if (Math.abs(v.currentTime - sec) < 1e-4 && v.readyState >= 2) return;
    await new Promise((resolve) => {
      const done = () => { v.removeEventListener('seeked', done); resolve(); };
      v.addEventListener('seeked', done);
      v.currentTime = sec;
    });
    // a frame callback (where supported) makes sure the seeked frame is the one painted
    if (typeof v.requestVideoFrameCallback === 'function') {
      await new Promise((r) => { v.requestVideoFrameCallback(() => r()); setTimeout(r, 120); });
    }
  }

  async* frames(from, to, { cancelled = () => false, want = null } = {}) {
    const t = this.track;
    const v = await this.load();
    const last = Math.min(to, t.ptsUs.length - 1);
    const t0 = t.ptsUs[0];
    const half = 0.5 / Math.max(1, t.containerFps);
    for (let f = from; f <= last; f += 1) {
      if (cancelled()) throw new CancelledError();
      if (want && !want(f)) continue;
      // the middle of the frame's display interval, so rounding never lands on its neighbour
      await this.seek((t.ptsUs[f] - t0) / 1e6 + half);
      yield {
        frame: f, ptsUs: t.ptsUs[f], image: v, width: v.videoWidth, height: v.videoHeight, element: true,
      };
    }
  }

  close() {
    if (this.video) {
      this.video.removeAttribute('src');
      this.video.load();
    }
    this.video = null;
  }
}

/**
 * Opens a clip (a Blob / File). Resolves to
 *   { track, backend: 'webcodecs' | 'element', frames(from, to, opts), close() }
 * Rejects with ERR_UNSUPPORTED_VIDEO when the file has no readable video track. `url` is an object
 * URL of the blob (the element backend plays it); the caller revokes it.
 */
export async function openClip(blob, { url = null, preferElement = false } = {}) {
  let track;
  try {
    track = await readVideoTrack(blobReader(blob));
  } catch (e) {
    throw new UnsupportedVideoError(`not a readable video (${e?.message ?? e})`);
  }
  if (!track.samples.length) throw new UnsupportedVideoError('the video has no frames');
  const codecs = !preferElement && (await webCodecsSupports(track));
  if (!codecs && !url) throw new UnsupportedVideoError(`this browser cannot decode ${track.codec}`);
  const dec = codecs ? new CodecDecoder(track, sampleBytes(blobReader(blob))) : new ElementDecoder(track, url);
  return {
    track,
    backend: codecs ? 'webcodecs' : 'element',
    frames: (from, to, opts) => dec.frames(from, to, opts),
    close: () => dec.close(),
  };
}
