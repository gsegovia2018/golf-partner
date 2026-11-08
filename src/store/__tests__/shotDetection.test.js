import {
  takeClosedStops, proposalsForHole, seqForProposal, greenLandingStop, holeStops, walkMissingHere,
} from '../shotDetection';

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
  id, start: Number(id), end: Number(id) + 60000, lat: spot(north)[0], lng: spot(north)[1], hole: 9, status: 'open', ...extra,
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


test('stops under 30 s are kept but not proposed (waiting on the tee, round the green)', () => {
  const stops = [stop('1', 0), { ...stop('2', 200), end: 2 + 20000 }];
  expect(proposalsForHole(stops, { holeNumber: 1, course }).map((p) => p.id)).toEqual(['1']);
  expect(holeStops(stops, { holeNumber: 1, course }).map((p) => p.id)).toEqual(['1', '2']);
});

describe('stops go to the hole being played when they were made', () => {
  const MIN = 60000;
  // Hole 2 runs back alongside hole 1, 40 m east of it.
  const east = 40 / (111195 * Math.cos((40 * Math.PI) / 180));
  const side = {
    holes: [hole, { number: 2, par: 4, start: [spot(360)[0], -3.7 + east], pin: [spot(0)[0], -3.7 + east] }],
  };
  const at = (id, min, north, lng = -3.7) => ({
    id, start: min * MIN, end: min * MIN + MIN, lat: spot(north)[0], lng, status: 'open',
  });
  const holeOne = [at('a', 0, 0), at('b', 4, 200), at('c', 8, 330)];

  test('a second shot from the neighbouring fairway belongs to the hole being played', () => {
    const stops = [
      ...holeOne,
      at('d', 15, 360, -3.7 + east), at('e', 20, 250, -3.7 + east), // hole 2's tee, then its fairway
      at('f', 24, 150, -3.70005), // hole 2's third shot, from hole 1's fairway
    ];
    expect(holeStops(stops, { holeNumber: 1, course: side }).map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(holeStops(stops, { holeNumber: 2, course: side }).map((s) => s.id).sort()).toEqual(['d', 'e', 'f']);
  });

  test('the hole played last keeps its stops when its line was crossed earlier', () => {
    // 7 Nov 2026: while playing hole 1 the golfer crossed hole 2's fairway
    // (three stops, more than hole 2's real play), and hole 2 came last — its
    // tee stop plus one fairway stop closed before the trail ended.
    const crossing = [at('x1', 5, 150, -3.7 + east), at('x2', 6, 170, -3.7 + east), at('x3', 7, 190, -3.7 + east)];
    const play = [at('t', 40, 360, -3.7 + east), at('u', 45, 250, -3.7 + east)];
    const stops = [...holeOne, ...crossing, ...play];
    expect(holeStops(stops, { holeNumber: 2, course: side }).map((s) => s.id)).toEqual(['t', 'u']);
    expect(holeStops(stops, { holeNumber: 1, course: side }).map((s) => s.id).sort())
      .toEqual(['a', 'b', 'c', 'x1', 'x2', 'x3']);
    // From the tee shot on, not only once the hole is over.
    expect(holeStops([...holeOne, ...crossing, play[0]], { holeNumber: 2, course: side }).map((s) => s.id)).toEqual(['t']);
  });

  test('a stop by a tee belongs to that hole even when another line passes closer', () => {
    // Hole 3's tee is 20 m east of hole 1's line and the hole runs east; the
    // golfer waits 12 m behind the tee, 8 m from hole 1's line.
    const m = 1 / (111195 * Math.cos((40 * Math.PI) / 180));
    const three = { number: 3, par: 3, start: [spot(200)[0], -3.7 + 20 * m], pin: [spot(200)[0], -3.7 + 170 * m] };
    const course3 = { holes: [hole, three] };
    expect(holeStops([at('w', 0, 200, -3.7 + 8 * m)], { holeNumber: 3, course: course3 }).map((s) => s.id)).toEqual(['w']);
    // A stop on a green stays with that green, whatever tee is near.
    const four = { number: 4, par: 4, start: [spot(360)[0], -3.7 + 20 * m], pin: [spot(360)[0], -3.69] };
    expect(holeStops([at('g', 0, 360, -3.7)], { holeNumber: 1, course: { holes: [hole, four] } }).map((s) => s.id)).toEqual(['g']);
  });

  test('a stray far from the hole being played is dropped', () => {
    const far = { holes: [hole, { number: 2, par: 3, start: [41, -3.7], pin: [41.001, -3.7] }] };
    const stray = at('x', 60, 100); // an hour later on hole 1's line
    // With no other hole started since, it stays on hole 1 …
    expect(holeStops([...holeOne, stray], { holeNumber: 1, course: far }).map((s) => s.id))
      .toEqual(['a', 'b', 'c', 'x']);
    // … but once hole 2 (far away) is being played, it is nobody's.
    const teeTwo = { ...at('t2', 50, 0), lat: 41 };
    const got = holeStops([...holeOne, teeTwo, stray], { holeNumber: 1, course: far });
    expect(got.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('greenLandingStop', () => {
  const shot = (north, club) => ({ lat: spot(north)[0], lng: spot(north)[1], club });
  const open = [shot(0, 'driver'), shot(230, '8i')];

  test('the first stop on the green ends an open hole', () => {
    const stops = [stop('9', 358), stop('8', 352), stop('7', 230)];
    expect(greenLandingStop(stops, { holeNumber: 1, course, shots: open })?.id).toBe('8');
  });

  test('nothing when the hole is closed, untagged, without geometry or the stop was used', () => {
    const stops = [stop('8', 352)];
    expect(greenLandingStop(stops, { holeNumber: 1, course, shots: [...open, shot(355, null)] })).toBeNull();
    expect(greenLandingStop(stops, { holeNumber: 1, course, shots: [shot(0, null)] })).toBeNull();
    expect(greenLandingStop(stops, { holeNumber: 1, shots: open })).toBeNull();
    expect(greenLandingStop([stop('8', 352, { status: 'added' })], { holeNumber: 1, course, shots: open })).toBeNull();
    expect(greenLandingStop([stop('8', 352, { status: 'dismissed' })], { holeNumber: 1, course, shots: open })).toBeNull();
  });
});

test('walkMissingHere: on the hole well past its tee with nothing to draw', () => {
  const refs = { tee: spot(0), green: spot(360), poly: null };
  expect(walkMissingHere(spot(200), refs, [])).toBe(true);
  expect(walkMissingHere(spot(200), refs, [[spot(0), spot(10)]])).toBe(false); // there is a walk
  expect(walkMissingHere(spot(20), refs, [])).toBe(false); // still by the tee
  expect(walkMissingHere([spot(200)[0], -3.699], refs, [])).toBe(false); // ~85 m off the line
  expect(walkMissingHere(null, refs, [])).toBe(false);
  expect(walkMissingHere(spot(200), null, [])).toBe(false);
});
