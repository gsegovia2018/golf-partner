import { crc32, makeZip, utf8 } from '../zip';

const dv = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);

describe('zip (stored)', () => {
  test('crc32 matches the standard check value', () => {
    expect(crc32(utf8('123456789'))).toBe(0xcbf43926);
  });

  test('utf8 encodes multi-byte characters', () => {
    expect(Array.from(utf8('é'))).toEqual([0xc3, 0xa9]);
  });

  test('writes local headers, a central directory and an end record that point at each other', () => {
    const a = utf8('{"a":1}');
    const b = new Uint8Array([1, 2, 3, 4, 5]);
    const z = makeZip([{ name: 'a.json', data: a }, { name: 'video.mp4', data: b }]);
    const d = dv(z);
    const end = z.length - 22;
    expect(d.getUint32(end, true)).toBe(0x06054b50);
    expect(d.getUint16(end + 10, true)).toBe(2);
    const centralStart = d.getUint32(end + 16, true);
    expect(d.getUint32(end + 12, true)).toBe(end - centralStart);
    expect(d.getUint32(centralStart, true)).toBe(0x02014b50);
    expect(d.getUint32(centralStart + 42, true)).toBe(0); // first entry: local header at 0
    expect(d.getUint32(0, true)).toBe(0x04034b50);
    expect(d.getUint32(14, true)).toBe(crc32(a));
    expect(d.getUint32(18, true)).toBe(a.length);
    const second = centralStart + 46 + 'a.json'.length;
    const off = d.getUint32(second + 42, true);
    const dataAt = off + 30 + 'video.mp4'.length;
    expect(Array.from(z.slice(dataAt, dataAt + 5))).toEqual([1, 2, 3, 4, 5]);
  });
});
