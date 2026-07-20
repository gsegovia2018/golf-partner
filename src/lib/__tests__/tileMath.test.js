import { lonToTileX, latToTileY, tilesForBbox, holeBbox } from '../tileMath';

describe('tile coordinates', () => {
  it('is consistent with the slippy-map formulas for a known point', () => {
    // lat 38.56 lng -0.139 @ z15 (computed from the OSM wiki formulas)
    expect(lonToTileX(-0.139, 15)).toBe(Math.floor(((-0.139 + 180) / 360) * 2 ** 15));
    const r = (38.56 * Math.PI) / 180;
    expect(latToTileY(38.56, 15)).toBe(Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** 15));
  });
});

describe('tilesForBbox', () => {
  const bbox = { minLat: 38.5595, maxLat: 38.5605, minLng: -0.1440, maxLng: -0.1390 };
  it('enumerates tiles covering the bbox at the requested zoom', () => {
    const tiles = tilesForBbox(bbox, [15]);
    expect(tiles.length).toBeGreaterThanOrEqual(1);
    tiles.forEach((t) => expect(t.z).toBe(15));
    tiles.forEach((t) => {
      expect(t.x).toBeGreaterThanOrEqual(lonToTileX(bbox.minLng, 15));
      expect(t.x).toBeLessThanOrEqual(lonToTileX(bbox.maxLng, 15));
    });
  });
  it('higher zooms produce more tiles', () => {
    expect(tilesForBbox(bbox, [19]).length).toBeGreaterThan(tilesForBbox(bbox, [16]).length);
  });
  it('dedupes repeated zooms', () => {
    expect(tilesForBbox(bbox, [15, 15]).length).toBe(tilesForBbox(bbox, [15]).length);
  });
});

describe('holeBbox', () => {
  it('covers tee, green and hazards with padding', () => {
    const b = holeBbox({ tee: [38.5634, -0.1439], greenCenter: [38.56, -0.139], green: null, hazards: [{ kind: 'bunker', poly: [[38.5606, -0.1414]] }] });
    expect(b.minLat).toBeLessThan(38.56);
    expect(b.maxLat).toBeGreaterThan(38.5634);
    expect(b.minLng).toBeLessThan(-0.1439);
    expect(b.maxLng).toBeGreaterThan(-0.139);
  });
  it('returns null with no usable points', () => {
    expect(holeBbox({ tee: null, greenCenter: null, green: null, hazards: [] })).toBeNull();
  });
});
