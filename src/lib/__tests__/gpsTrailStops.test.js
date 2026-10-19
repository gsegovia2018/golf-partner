import {
  cleanTrail, detectStops, mergeStops, assignStopsToHoles, inferHoleDistances, haversine,
} from '../gpsTrailStops';

// ~1 m of latitude.
const M = 1 / 111195;
const at = (t, north, east = 0, acc = 4) => ({ t: t * 1000, lat: 40 + north * M, lng: -3.7 + (east * M) / Math.cos((40 * Math.PI) / 180), acc });

// Walk north in 2 m steps every 2 s, standing still at 0 m (20 s), 200 m (30 s)
// and 330 m (18 s); the tracker reports nothing while standing still.
function round() {
  const pts = [at(0, 0)];
  let t = 20;
  for (let d = 2; d <= 200; d += 2) { pts.push(at(t, d)); t += 2; }
  t += 30;
  for (let d = 202; d <= 330; d += 2) { pts.push(at(t, d)); t += 2; }
  t += 18;
  pts.push(at(t, 332));
  return pts;
}

test('cleanTrail sorts, de-dupes timestamps and drops poor fixes', () => {
  const pts = cleanTrail([at(2, 1), at(1, 0), at(1, 0), at(3, 2, 0, 80)]);
  expect(pts.map((p) => p.t)).toEqual([1000, 2000]);
});

test('detects the three stops, each where the golfer stood', () => {
  const stops = mergeStops(detectStops(cleanTrail(round())));
  expect(stops).toHaveLength(3);
  const north = (s) => haversine([40, -3.7], [s.lat, -3.7]);
  expect(north(stops[0])).toBeLessThan(3);
  expect(Math.abs(north(stops[1]) - 200)).toBeLessThan(3);
  expect(Math.abs(north(stops[2]) - 330)).toBeLessThan(3);
  expect(stops[1].end - stops[1].start).toBeGreaterThanOrEqual(15000);
});

test('a short pause is not a stop; nearby stops close in time merge', () => {
  expect(detectStops([at(0, 0), at(5, 1), at(7, 10)])).toEqual([]);
  const merged = mergeStops([
    { start: 0, end: 20000, lat: 40, lng: -3.7, n: 2 },
    { start: 30000, end: 50000, lat: 40 + 4 * M, lng: -3.7, n: 2 },
  ]);
  expect(merged).toHaveLength(1);
  expect(merged[0].end).toBe(50000);
});

test('maps stops to the nearest hole and infers drive and approach', () => {
  const hole = {
    number: 1,
    par: 4,
    start: [40, -3.7],
    pin: [40 + 360 * M, -3.7],
    green: [[40 + 345 * M, -3.7001], [40 + 345 * M, -3.6999], [40 + 375 * M, -3.6999], [40 + 375 * M, -3.7001]],
  };
  const far = { number: 2, par: 3, start: [41, -3.7], pin: [41.001, -3.7] };
  const stops = [
    { start: 0, end: 1, lat: 40, lng: -3.7, n: 1 },
    { start: 2, end: 3, lat: 40 + 200 * M, lng: -3.7, n: 1 },
    { start: 4, end: 5, lat: 40 + 355 * M, lng: -3.7, n: 1 },
    { start: 6, end: 7, lat: 40.5, lng: -3.7, n: 1 },
  ];
  const { byHole, unassigned } = assignStopsToHoles(stops, [hole, far]);
  expect(byHole.get(1)).toHaveLength(3);
  expect(unassigned).toHaveLength(1);
  const { drive, approach } = inferHoleDistances(byHole.get(1), hole, 4);
  expect(Math.round(drive)).toBe(200);
  expect(Math.round(approach)).toBe(160);
});
