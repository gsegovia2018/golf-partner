// The video track of an MP4 / QuickTime file, read without decoding (the web's MediaExtractor):
// the sample table, the decoder config WebCodecs needs, the display rotation and the slow-motion
// capture rate. Only the `moov` box is read; `mdat` is skipped by its size, so a clip of any length
// costs a few small reads. Pure: it takes a byte reader, so Jest feeds it buffers.
//
// reader: { size: number, read(offset, length) -> Promise<Uint8Array> }
//
// Frame numbers are the ranks of the presentation times (what Android's sorted sample times and
// the lab's OpenCV read give): edit lists are not applied.

const ascii = (b) => String.fromCharCode(...b);
const fourcc = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const u32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const i32 = (b, o) => (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
const u64 = (b, o) => u32(b, o) * 2 ** 32 + u32(b, o + 4);

/** Top-level boxes, headers only: [{ type, start, size, header }]. */
async function topBoxes(reader) {
  const out = [];
  let pos = 0;
  while (pos + 8 <= reader.size) {
    const h = await reader.read(pos, 16);
    let size = u32(h, 0);
    const type = fourcc(h, 4);
    let header = 8;
    if (size === 1) { size = u64(h, 8); header = 16; } else if (size === 0) size = reader.size - pos;
    if (size < header) break;
    out.push({
      type, start: pos, size, header,
    });
    pos += size;
  }
  return out;
}

/** Child boxes of the payload b[from, to): [{ type, start (payload offset), end }]. */
function children(b, from, to) {
  const out = [];
  let pos = from;
  while (pos + 8 <= to) {
    let size = u32(b, pos);
    const type = fourcc(b, pos + 4);
    let header = 8;
    if (size === 1) { size = u64(b, pos + 8); header = 16; } else if (size === 0) size = to - pos;
    if (size < header || pos + size > to) break;
    out.push({ type, start: pos + header, end: pos + size });
    pos += size;
  }
  return out;
}

const child = (b, box, type) => children(b, box.start, box.end).find((c) => c.type === type) ?? null;

function path(b, box, ...types) {
  let cur = box;
  for (const t of types) {
    cur = cur && child(b, cur, t);
    if (!cur) return null;
  }
  return cur;
}

/** Display rotation (0/90/180/270) from the tkhd matrix (a, b, c, d in 16.16). */
export function rotationOf(b, tkhd) {
  const v = b[tkhd.start];
  const m = tkhd.start + (v === 1 ? 4 + 8 + 8 + 4 + 4 + 8 : 4 + 4 + 4 + 4 + 4 + 4) + 8 + 2 + 2 + 2 + 2;
  const a = i32(b, m) / 65536;
  const bb = i32(b, m + 4) / 65536;
  const deg = Math.round((Math.atan2(bb, a) * 180) / Math.PI);
  return ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
}

const hex2 = (n) => n.toString(16).padStart(2, '0');

/** RFC 6381 codec string from an avcC payload. */
function avcCodec(type, c) {
  return `${type}.${hex2(c[1])}${hex2(c[2])}${hex2(c[3])}`;
}

/** ISO/IEC 14496-15 Annex E codec string from an hvcC payload. */
function hevcCodec(type, c) {
  const space = c[1] >> 6;
  const tier = (c[1] >> 5) & 1;
  const profile = c[1] & 0x1f;
  let compat = u32(c, 2);
  let rev = 0;
  for (let i = 0; i < 32; i += 1) { rev = (rev << 1) | (compat & 1); compat >>>= 1; }
  rev >>>= 0;
  const cons = [c[6], c[7], c[8], c[9], c[10], c[11]];
  while (cons.length && cons[cons.length - 1] === 0) cons.pop();
  const level = c[12];
  const parts = [type, `${['', 'A', 'B', 'C'][space]}${profile}`, rev.toString(16), `${tier ? 'H' : 'L'}${level}`];
  if (cons.length) parts.push(...cons.map((x) => x.toString(16)));
  return parts.join('.');
}

function vp9Codec(c) {
  // vpcC is a FullBox: version/flags, then profile, level, bitDepth(4) chroma(3) range(1)
  const p = c[4];
  const l = c[5];
  const depth = c[6] >> 4;
  return `vp09.${String(p).padStart(2, '0')}.${String(l).padStart(2, '0')}.${String(depth).padStart(2, '0')}`;
}

function av1Codec(c) {
  const profile = c[1] >> 5;
  const level = c[1] & 0x1f;
  const tier = c[2] >> 7;
  const high = (c[2] >> 6) & 1;
  const twelve = (c[2] >> 5) & 1;
  const depth = high ? (twelve ? 12 : 10) : 8;
  return `av01.${profile}.${String(level).padStart(2, '0')}${tier ? 'H' : 'M'}.${String(depth).padStart(2, '0')}`;
}

/** The first visual sample entry: codec string, coded size, decoder description, HDR. */
function sampleEntry(b, stsd) {
  const entry = children(b, stsd.start + 8, stsd.end)[0];
  if (!entry) throw new Error('no sample description');
  const type = entry.type;
  const width = u16(b, entry.start + 24);
  const height = u16(b, entry.start + 26);
  const boxes = children(b, entry.start + 78, entry.end);
  const get = (t) => boxes.find((x) => x.type === t);
  let codec = type;
  let description = null;
  let hdr = false;
  const cfg = get('avcC') ?? get('hvcC') ?? get('vpcC') ?? get('av1C');
  if (cfg) {
    const c = b.subarray(cfg.start, cfg.end);
    description = c.slice();
    if (cfg.type === 'avcC') {
      codec = avcCodec(type, c);
      hdr = c[1] === 110; // High 10
    } else if (cfg.type === 'hvcC') {
      codec = hevcCodec(type, c);
      const profile = c[1] & 0x1f;
      const depth = (c[19] & 0x7) + 8;
      hdr = profile === 2 || depth > 8;
    } else if (cfg.type === 'vpcC') {
      codec = vp9Codec(c);
      hdr = c[4] >= 2;
      description = null;
    } else {
      codec = av1Codec(c);
      hdr = ((c[2] >> 6) & 1) === 1;
      description = null;
    }
  }
  const colr = get('colr');
  if (colr && fourcc(b, colr.start) === 'nclx') {
    const transfer = u16(b, colr.start + 6);
    if (transfer === 16 || transfer === 18) hdr = true;
  }
  return {
    type, codec, width, height, description, hdr,
  };
}

/** Samples in decode order: [{ offset, size, dts, cts, sync }], times in track timescale units. */
function sampleTable(b, stbl) {
  const box = (t) => child(b, stbl, t);
  const stsz = box('stsz');
  const stco = box('stco');
  const co64 = box('co64');
  const stsc = box('stsc');
  const stts = box('stts');
  if (!stsz || !(stco || co64) || !stsc || !stts) throw new Error('incomplete sample table');
  const fixed = u32(b, stsz.start + 4);
  const count = u32(b, stsz.start + 8);
  const sizes = new Array(count);
  for (let i = 0; i < count; i += 1) sizes[i] = fixed || u32(b, stsz.start + 12 + 4 * i);

  const offsets = [];
  if (stco) {
    const n = u32(b, stco.start + 4);
    for (let i = 0; i < n; i += 1) offsets.push(u32(b, stco.start + 8 + 4 * i));
  } else {
    const n = u32(b, co64.start + 4);
    for (let i = 0; i < n; i += 1) offsets.push(u64(b, co64.start + 8 + 8 * i));
  }
  const runs = [];
  const nsc = u32(b, stsc.start + 4);
  for (let i = 0; i < nsc; i += 1) {
    const o = stsc.start + 8 + 12 * i;
    runs.push({ first: u32(b, o) - 1, per: u32(b, o + 4) });
  }

  const samples = new Array(count);
  let s = 0;
  for (let r = 0; r < runs.length && s < count; r += 1) {
    const lastChunk = r + 1 < runs.length ? runs[r + 1].first : offsets.length;
    for (let ch = runs[r].first; ch < lastChunk && s < count; ch += 1) {
      let off = offsets[ch];
      for (let k = 0; k < runs[r].per && s < count; k += 1) {
        samples[s] = {
          offset: off, size: sizes[s], dts: 0, cts: 0, sync: true,
        };
        off += sizes[s];
        s += 1;
      }
    }
  }
  if (s < count) samples.length = s;

  let t = 0;
  let i = 0;
  const nts = u32(b, stts.start + 4);
  for (let e = 0; e < nts; e += 1) {
    const n = u32(b, stts.start + 8 + 8 * e);
    const d = u32(b, stts.start + 12 + 8 * e);
    for (let k = 0; k < n && i < samples.length; k += 1) {
      samples[i].dts = t;
      samples[i].cts = t;
      t += d;
      i += 1;
    }
  }
  const ctts = box('ctts');
  if (ctts) {
    const signed = b[ctts.start] === 1;
    const n = u32(b, ctts.start + 4);
    i = 0;
    for (let e = 0; e < n; e += 1) {
      const c = u32(b, ctts.start + 8 + 8 * e);
      const off = signed ? i32(b, ctts.start + 12 + 8 * e) : u32(b, ctts.start + 12 + 8 * e);
      for (let k = 0; k < c && i < samples.length; k += 1) {
        samples[i].cts = samples[i].dts + off;
        i += 1;
      }
    }
  }
  const stss = box('stss');
  if (stss) {
    samples.forEach((x) => { x.sync = false; });
    const n = u32(b, stss.start + 4);
    for (let e = 0; e < n; e += 1) {
      const k = u32(b, stss.start + 8 + 4 * e) - 1;
      if (samples[k]) samples[k].sync = true;
    }
  }
  return samples;
}

/**
 * Samples of a fragmented MP4 (moov holds no samples; every `moof` describes the next run): the
 * video track's `traf`s, with the `trex` / `tfhd` defaults. Same shape as sampleTable.
 */
async function fragmentSamples(reader, top, mb, moov, tkhd) {
  const v1 = mb[tkhd.start] === 1;
  const trackId = u32(mb, tkhd.start + (v1 ? 20 : 12));
  const defaults = { duration: 0, size: 0, flags: 0 };
  const mvex = child(mb, moov, 'mvex');
  if (mvex) {
    const trex = children(mb, mvex.start, mvex.end).find((t) => t.type === 'trex' && u32(mb, t.start + 4) === trackId);
    if (trex) {
      defaults.duration = u32(mb, trex.start + 12);
      defaults.size = u32(mb, trex.start + 16);
      defaults.flags = u32(mb, trex.start + 20);
    }
  }
  const out = [];
  let t = 0;
  for (const box of top.filter((x) => x.type === 'moof')) {
    const b = await reader.read(box.start, box.size);
    for (const traf of children(b, box.header, box.size).filter((x) => x.type === 'traf')) {
      const tfhd = child(b, traf, 'tfhd');
      if (!tfhd || u32(b, tfhd.start + 4) !== trackId) continue;
      const tf = u32(b, tfhd.start) & 0xffffff;
      let p = tfhd.start + 8;
      let base = box.start;
      if (tf & 0x1) { base = u64(b, p); p += 8; }
      if (tf & 0x2) p += 4;
      const dur0 = tf & 0x8 ? u32(b, (p += 4) - 4) : defaults.duration;
      const size0 = tf & 0x10 ? u32(b, (p += 4) - 4) : defaults.size;
      const flags0 = tf & 0x20 ? u32(b, (p += 4) - 4) : defaults.flags;
      const tfdt = child(b, traf, 'tfdt');
      if (tfdt) t = b[tfdt.start] === 1 ? u64(b, tfdt.start + 4) : u32(b, tfdt.start + 4);
      let next = base;
      for (const trun of children(b, traf.start, traf.end).filter((x) => x.type === 'trun')) {
        const version = b[trun.start];
        const rf = u32(b, trun.start) & 0xffffff;
        const count = u32(b, trun.start + 4);
        let q = trun.start + 8;
        let off = next;
        if (rf & 0x1) { off = base + i32(b, q); q += 4; }
        let firstFlags = null;
        if (rf & 0x4) { firstFlags = u32(b, q); q += 4; }
        for (let k = 0; k < count; k += 1) {
          const d = rf & 0x100 ? u32(b, (q += 4) - 4) : dur0;
          const size = rf & 0x200 ? u32(b, (q += 4) - 4) : size0;
          let flags = rf & 0x400 ? u32(b, (q += 4) - 4) : flags0;
          if (k === 0 && firstFlags != null) flags = firstFlags;
          let cto = 0;
          if (rf & 0x800) { cto = version === 1 ? i32(b, q) : u32(b, q); q += 4; }
          out.push({
            offset: off, size, dts: t, cts: t + cto, sync: (flags & 0x10000) === 0,
          });
          off += size;
          t += d;
        }
        next = off;
      }
    }
  }
  return out;
}

/** QuickTime `mdta` metadata (moov/meta or moov/udta/meta): { key: value } for numbers and text. */
export function quickTimeMeta(b, moov) {
  const metas = [];
  const direct = child(b, moov, 'meta');
  if (direct) metas.push(direct);
  const udta = child(b, moov, 'udta');
  const um = udta && child(b, udta, 'meta');
  if (um) metas.push(um);
  const out = {};
  for (const meta of metas) {
    // ISO meta is a FullBox (4 bytes of version/flags before the children), QuickTime's is not
    const iso = fourcc(b, meta.start + 4) !== 'hdlr' && fourcc(b, meta.start + 8) === 'hdlr';
    const kids = children(b, meta.start + (iso ? 4 : 0), meta.end);
    const keysBox = kids.find((k) => k.type === 'keys');
    const ilst = kids.find((k) => k.type === 'ilst');
    if (!keysBox || !ilst) continue;
    const keys = [];
    const n = u32(b, keysBox.start + 4);
    let p = keysBox.start + 8;
    for (let k = 0; k < n && p + 8 <= keysBox.end; k += 1) {
      const size = u32(b, p);
      keys.push(ascii(b.subarray(p + 8, p + size)));
      p += size;
    }
    let q = ilst.start;
    while (q + 8 <= ilst.end) {
      const size = u32(b, q);
      if (size < 8) break;
      const index = u32(b, q + 4);
      const data = children(b, q + 8, q + size).find((d) => d.type === 'data');
      const key = keys[index - 1];
      if (data && key) {
        const kind = u32(b, data.start) & 0xffffff;
        const v = data.start + 8;
        const len = data.end - v;
        const view = new DataView(b.buffer, b.byteOffset + v, len);
        let value = null;
        if (kind === 23 && len >= 4) value = view.getFloat32(0);
        else if (kind === 24 && len >= 8) value = view.getFloat64(0);
        else if ((kind === 21 || kind === 22) && len >= 1 && len <= 4) {
          value = 0;
          for (let k = 0; k < len; k += 1) value = value * 256 + b[v + k];
          if (kind === 21 && b[v] & 0x80) value -= 2 ** (8 * len);
        } else if (kind === 1) value = ascii(b.subarray(v, data.end));
        if (value != null) out[key] = value;
      }
      q += size;
    }
  }
  return out;
}

/**
 * Reads the video track. Resolves to
 *   { codec, description, codedWidth, codedHeight, rotation, dispW, dispH, timescale, durationUs,
 *     samples (decode order, + ptsUs, frame), frames (presentation order: sample index per frame),
 *     ptsUs (presentation order), syncFrames (frame numbers of sync samples, ascending),
 *     containerFps, captureFps | null, hdr }
 */
export async function readVideoTrack(reader) {
  const top = await topBoxes(reader);
  const mv = top.find((x) => x.type === 'moov');
  if (!mv) throw new Error('no moov box');
  const b = await reader.read(mv.start, mv.size);
  const moov = { start: mv.header, end: mv.size };
  const traks = children(b, moov.start, moov.end).filter((c) => c.type === 'trak');
  let trak = null;
  for (const t of traks) {
    const hdlr = path(b, t, 'mdia', 'hdlr');
    if (hdlr && fourcc(b, hdlr.start + 8) === 'vide') { trak = t; break; }
  }
  if (!trak) throw new Error('no video track');
  const mdhd = path(b, trak, 'mdia', 'mdhd');
  const v1 = b[mdhd.start] === 1;
  const timescale = v1 ? u32(b, mdhd.start + 20) : u32(b, mdhd.start + 12);
  const duration = v1 ? u64(b, mdhd.start + 24) : u32(b, mdhd.start + 16);
  const stbl = path(b, trak, 'mdia', 'minf', 'stbl');
  const entry = sampleEntry(b, child(b, stbl, 'stsd'));
  const tkhd = child(b, trak, 'tkhd');
  let samples = sampleTable(b, stbl);
  if (!samples.length && top.some((x) => x.type === 'moof')) {
    samples = await fragmentSamples(reader, top, b, moov, tkhd);
  }
  const rotation = tkhd ? rotationOf(b, tkhd) : 0;

  const toUs = (t) => Math.round((t * 1e6) / timescale);
  samples.forEach((s, i) => { s.ptsUs = toUs(s.cts); s.index = i; });
  const order = samples.map((_, i) => i).sort((x, y) => samples[x].cts - samples[y].cts || x - y);
  order.forEach((si, f) => { samples[si].frame = f; });
  const ptsUs = order.map((si) => samples[si].ptsUs);
  const syncFrames = samples.filter((s) => s.sync).map((s) => s.frame).sort((x, y) => x - y);
  const n = samples.length;
  const lo = n ? ptsUs[0] : 0;
  const hi = n ? ptsUs[n - 1] : 0;
  const containerFps = n > 1 && hi > lo ? ((n - 1) * 1e6) / (hi - lo) : 30;
  const meta = quickTimeMeta(b, moov);
  const cap = Number(meta['com.android.capture.fps']);
  const swap = rotation === 90 || rotation === 270;
  return {
    codec: entry.codec,
    sampleType: entry.type,
    description: entry.description,
    codedWidth: entry.width,
    codedHeight: entry.height,
    rotation,
    dispW: swap ? entry.height : entry.width,
    dispH: swap ? entry.width : entry.height,
    timescale,
    durationUs: duration ? toUs(duration) : Math.max(0, hi - lo),
    samples,
    frames: order,
    ptsUs,
    syncFrames,
    containerFps,
    captureFps: Number.isFinite(cap) && cap > 0 ? cap : null,
    hdr: entry.hdr,
  };
}

/** A byte reader over a Blob / File (browser). */
export function blobReader(blob) {
  return {
    size: blob.size,
    async read(offset, length) {
      const end = Math.min(blob.size, offset + length);
      return new Uint8Array(await blob.slice(offset, end).arrayBuffer());
    },
  };
}

/** A byte reader over an in-memory buffer (tests, Node). */
export function bufferReader(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return {
    size: u8.length,
    async read(offset, length) { return u8.subarray(offset, Math.min(u8.length, offset + length)); },
  };
}
