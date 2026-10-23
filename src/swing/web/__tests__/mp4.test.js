import { readVideoTrack, bufferReader } from '../mp4';

// A minimal MP4 / QuickTime file assembled box by box: what the reader needs from a phone clip
// (rotation matrix, avcC / hvcC, sample table with B-frame reordering, sync samples, the Android
// capture-rate tag) without shipping a video in the repo.

const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n) => [(n >>> 8) & 255, n & 255];
const str = (s) => [...s].map((c) => c.charCodeAt(0));
const box = (type, ...parts) => {
  const body = parts.flat();
  return [...u32(8 + body.length), ...str(type), ...body];
};
const full = (type, version, ...parts) => box(type, [version, 0, 0, 0], ...parts);
const fixed = (v) => u32(Math.round(v * 65536) >>> 0);

function matrix(deg) {
  const r = (deg * Math.PI) / 180;
  const a = Math.round(Math.cos(r));
  const b = Math.round(Math.sin(r));
  return [...fixed(a), ...fixed(b), ...u32(0), ...fixed(-b), ...fixed(a), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)];
}

function tkhd(deg, w, h) {
  return full('tkhd', 0, u32(0), u32(0), u32(1), u32(0), u32(0), Array(8).fill(0), u16(0), u16(0), u16(0), u16(0), matrix(deg), fixed(w), fixed(h));
}

function visualEntry(type, w, h, config) {
  return box(type, Array(6).fill(0), u16(1), Array(16).fill(0), u16(w), u16(h), fixed(72), fixed(72), u32(0), u16(1), Array(32).fill(0), u16(24), u16(0xffff), config);
}

const avcC = box('avcC', [1, 0x64, 0x00, 0x28, 0xff, 0xe1, ...u16(4), 0x67, 0x64, 0x00, 0x28, 1, ...u16(2), 0x68, 0xee]);

function hvcC() {
  // configurationVersion, profile_space 0 / tier 0 / profile_idc 1, compat flags 0x60000000,
  // constraint 0x90 then zeros, level 120, …, chroma, bitDepthLuma (8 → 0), bitDepthChroma
  const b = [1, 0x01, ...u32(0x60000000), 0x90, 0, 0, 0, 0, 0, 120, 0xf0, 0x00, 0xfc, 0xfd, 0xf8, 0xf8, 0, 0, 0x0f, 0];
  return box('hvcC', b);
}

function sampleTable(n, delta, ctsOffsets, syncs, sizes) {
  return box('stbl',
    full('stsd', 0, u32(1), visualEntry('avc1', 1920, 1080, avcC)),
    full('stts', 0, u32(1), u32(n), u32(delta)),
    full('ctts', 0, u32(n), ...ctsOffsets.map((o) => [...u32(1), ...u32(o)])),
    full('stss', 0, u32(syncs.length), ...syncs.map((s) => u32(s + 1))),
    full('stsz', 0, u32(0), u32(n), ...sizes.map(u32)),
    full('stsc', 0, u32(1), u32(1), u32(n), u32(1)),
    full('stco', 0, u32(1), u32(4096)));
}

function captureFpsMeta(fps) {
  const key = 'com.android.capture.fps';
  const keys = full('keys', 0, u32(1), box('mdta', str(key)));
  const f = new DataView(new ArrayBuffer(4));
  f.setFloat32(0, fps);
  const value = [...new Uint8Array(f.buffer)];
  const ilst = box('ilst', box('\u0000\u0000\u0000\u0001', box('data', u32(23), u32(0), value)));
  return box('meta', full('hdlr', 0, u32(0), str('mdta'), Array(12).fill(0), [0]), keys, ilst);
}

function clip({
  rotation = 90, n = 6, timescale = 600, delta = 20, meta = null,
} = {}) {
  // decode order I P B B P B: presentation order 0 3 1 2 5 4 (ctts offsets in deltas)
  const cts = [1, 3, 0, 0, 2, 0].slice(0, n).map((k) => k * delta);
  const stbl = sampleTable(n, delta, cts, [0, 4], Array(n).fill(100));
  const mdia = box('mdia',
    full('mdhd', 0, u32(0), u32(0), u32(timescale), u32(n * delta), u16(0), u16(0)),
    full('hdlr', 0, u32(0), str('vide'), Array(12).fill(0), [0]),
    box('minf', stbl));
  const trak = box('trak', tkhd(rotation, 1920, 1080), mdia);
  const moov = box('moov', full('mvhd', 0, Array(96).fill(0)), trak, meta ? box('udta', meta) : []);
  const ftyp = box('ftyp', str('isom'), u32(0), str('isom'));
  const mdat = box('mdat', Array(1000).fill(0));
  return new Uint8Array([...ftyp, ...mdat, ...moov]);
}

describe('readVideoTrack', () => {
  test('rotation, display size, codec string and description from an avc1 track', async () => {
    const t = await readVideoTrack(bufferReader(clip({ rotation: 90 })));
    expect(t.codec).toBe('avc1.640028');
    expect(t.codedWidth).toBe(1920);
    expect(t.codedHeight).toBe(1080);
    expect(t.rotation).toBe(90);
    expect([t.dispW, t.dispH]).toEqual([1080, 1920]);
    expect(t.description[0]).toBe(1);
    expect(t.hdr).toBe(false);
  });

  test('frames are numbered in presentation order, sync samples by frame', async () => {
    const t = await readVideoTrack(bufferReader(clip()));
    // decode order cts (in deltas) 1 3 0 0 2 0 + dts 0..5 → pts 1 4 2 3 6 5
    expect(t.ptsUs).toEqual([1, 2, 3, 4, 5, 6].map((k) => Math.round((k * 20 * 1e6) / 600)));
    expect(t.frames).toEqual([0, 2, 3, 1, 5, 4]);
    expect(t.samples.map((s) => s.frame)).toEqual([0, 3, 1, 2, 5, 4]);
    expect(t.syncFrames).toEqual([0, 5]);
    expect(t.samples.map((s) => s.offset)).toEqual([4096, 4196, 4296, 4396, 4496, 4596]);
    expect(t.containerFps).toBeCloseTo(30, 3); // from µs times, like MediaExtractor's
  });

  test("Android's capture-rate tag (QuickTime mdta metadata) is the capture fps", async () => {
    const t = await readVideoTrack(bufferReader(clip({ meta: captureFpsMeta(240) })));
    expect(t.captureFps).toBe(240);
    expect((await readVideoTrack(bufferReader(clip()))).captureFps).toBeNull();
  });

  test('180 and 0 degree matrices', async () => {
    expect((await readVideoTrack(bufferReader(clip({ rotation: 180 })))).rotation).toBe(180);
    const t = await readVideoTrack(bufferReader(clip({ rotation: 0 })));
    expect(t.rotation).toBe(0);
    expect([t.dispW, t.dispH]).toEqual([1920, 1080]);
  });

  test('an hvc1 entry gets its ISO 14496-15 codec string', async () => {
    const bytes = clip();
    // swap the sample entry for an hvc1 one by rebuilding the clip with it
    const entry = visualEntry('hvc1', 1920, 1080, hvcC());
    const avc = visualEntry('avc1', 1920, 1080, avcC);
    const at = bytes.findIndex((_, i) => avc.every((b, k) => bytes[i + k] === b));
    expect(at).toBeGreaterThan(0);
    const swapped = [...bytes.slice(0, at), ...entry, ...bytes.slice(at + avc.length)];
    // every enclosing box grows by the size difference
    const grow = entry.length - avc.length;
    const out = new Uint8Array(swapped);
    const dv = new DataView(out.buffer);
    const bump = (type) => {
      for (let i = 0; i + 8 <= out.length; i += 1) {
        if (String.fromCharCode(out[i + 4], out[i + 5], out[i + 6], out[i + 7]) === type && i < at) {
          dv.setUint32(i, dv.getUint32(i) + grow);
          return;
        }
      }
    };
    ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd'].forEach(bump);
    // the chunk offset sits after the entry: unchanged, the sample bytes don't move
    const t = await readVideoTrack(bufferReader(out));
    expect(t.codec).toBe('hvc1.1.6.L120.90');
  });

  test('a file without a moov box is rejected', async () => {
    await expect(readVideoTrack(bufferReader(new Uint8Array(box('ftyp', str('isom')))))).rejects.toThrow('no moov box');
  });
});
