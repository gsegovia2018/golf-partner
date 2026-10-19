import { takeClosedStops, proposalsForHole, seqForProposal } from '../shotDetection';

// ~1 m of latitude.
const M = 1 / 111195;
const at = (t, north) => ({ t: t * 1000, lat: 40 + north * M, lng: -3.7, acc: 4 });
const spot = (north) => [40 + north * M, -3.7];

// Stand at 0 m for 20 s, walk 2 m every 2 s to `to`.
function walk(to, { stand = 20, from = 0, t0 = 0 } = {}) {
  const pts = [at(t0, from)];
  let t = t0 + stand;
  for (let d = from + 2; d <= to; d += 2) { pts.push(at(t, d)); t += 2; }
  return pts;
}

test('a stop is reported once the golfer has walked more than 20 m away', () => {
  expect(takeClosedStops(walk(14)).stops).toEqual([]); // only 14 m away so far
  const { stops, rest } = takeClosedStops(walk(40));
  expect(stops).toHaveLength(1);
  expect(stops[0].lat).toBeCloseTo(40, 4);
  // The buffer keeps only what follows the stop, so it is never reported twice.
  expect(takeClosedStops(rest).stops).toEqual([]);
});

test('a golfer still standing at the end of the buffer is not a proposal yet', () => {
  const pts = [...walk(60), at(200, 60)]; // second stand at 60 m, still there
  const { stops, rest } = takeClosedStops(pts);
  expect(stops).toHaveLength(1);
  expect(rest[rest.length - 1].t).toBe(200000);
});

const hole = {
  number: 1, par: 4, start: spot(0), pin: spot(360),
  green: [[40 + 345 * M, -3.7001], [40 + 345 * M, -3.6999], [40 + 375 * M, -3.6999], [40 + 375 * M, -3.7001]],
};
const course = { holes: [hole, { number: 2, par: 3, start: [41, -3.7], pin: [41.001, -3.7] }] };
const stop = (id, north, extra = {}) => ({
  id, start: Number(id), end: Number(id) + 20, lat: spot(north)[0], lng: spot(north)[1], hole: 9, status: 'open', ...extra,
});

test('proposals on a hole: green, dismissed and already-marked spots are left out', () => {
  const stops = [
    stop('3', 355), // on the green: a putt
    stop('2', 200),
    stop('1', 0),
    stop('4', 120, { status: 'dismissed' }),
    stop('5', 300), // next to a shot marked by hand
  ];
  const got = proposalsForHole(stops, { holeNumber: 1, course, shots: [{ lat: spot(303)[0], lng: spot(303)[1] }] });
  expect(got.map((p) => p.id)).toEqual(['1', '2']);
  expect(got[0].fromTee).toBe(true);
  expect(got[1].fromTee).toBe(false);
  expect(Math.round(got[1].toGreen)).toBe(160);
});

test('without geometry a stop belongs to the hole the scorecard showed', () => {
  const got = proposalsForHole([stop('1', 0, { hole: 3 }), stop('2', 50, { hole: 4 })], { holeNumber: 3 });
  expect(got.map((p) => p.id)).toEqual(['1']);
  expect(got[0].toGreen).toBeNull();
});

test('a confirmed proposal goes before the first marked shot closer to the green', () => {
  const green = spot(360);
  const shots = [{ seq: 1, lat: spot(0)[0], lng: spot(0)[1] }, { seq: 2, lat: spot(330)[0], lng: spot(330)[1] }];
  expect(seqForProposal({ lat: spot(200)[0], lng: spot(200)[1] }, shots, green)).toBe(2);
  expect(seqForProposal({ lat: spot(340)[0], lng: spot(340)[1] }, shots, green)).toBe(3);
  expect(seqForProposal({ lat: spot(200)[0], lng: spot(200)[1] }, shots, null)).toBe(3);
  expect(seqForProposal({ lat: 0, lng: 0 }, [], green)).toBe(1);
});

