// Stop detection over a GPS trail: offline in scripts/analyzeGpsTrail.mjs,
// live in store/shotDetection (automatic shot proposals).
// A "stop" is where the golfer stood still long enough to be playing a shot,
// so it approximates a ball position.
// Pure JS, no I/O. Points are { t (ms), lat, lng, acc?, spd? }.

export const STOP_RADIUS_M = 6;
export const STOP_MIN_MS = 15000;
export const MERGE_DIST_M = 10;
export const MERGE_GAP_MS = 30000;
export const MAX_ACCURACY_M = 25;

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
export function haversine(a, b) {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function centroid(pts) {
  if (!pts?.length) return null;
  let lat = 0;
  let lng = 0;
  for (const p of pts) { lat += p[0]; lng += p[1]; }
  return [lat / pts.length, lng / pts.length];
}

export function pointInPolygon([y, x], poly) {
  if (!poly || poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// Sorted by time, one point per timestamp, poor fixes dropped.
export function cleanTrail(points, maxAcc = MAX_ACCURACY_M) {
  const seen = new Set();
  return (points ?? [])
    .filter((p) => Number.isFinite(p?.t) && Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .filter((p) => p.acc == null || p.acc <= maxAcc)
    .sort((a, b) => a.t - b.t)
    .filter((p) => (seen.has(p.t) ? false : (seen.add(p.t), true)));
}

// Windows of consecutive points that stay within `radius` of their running
// centroid for at least `minMs`. The tracker only reports after moving ~2 m
// (distanceInterval), so standing still shows up as a GAP, not as many
// points: a window's dwell therefore runs until the first point that leaves
// it (or its own last point at the end of the trail).
export function detectStops(points, { radius = STOP_RADIUS_M, minMs = STOP_MIN_MS } = {}) {
  const stops = [];
  let i = 0;
  while (i < points.length) {
    const win = [[points[i].lat, points[i].lng]];
    let j = i;
    while (j + 1 < points.length) {
      const next = [points[j + 1].lat, points[j + 1].lng];
      const c = centroid([...win, next]);
      if (win.concat([next]).some((p) => haversine(p, c) > radius)) break;
      win.push(next);
      j += 1;
    }
    const start = points[i].t;
    const end = j + 1 < points.length ? points[j + 1].t : points[j].t;
    if (end - start >= minMs) {
      // Each fix weighted by how long it was held (until the next fix), so
      // the stop sits where the golfer stood, not on the walk-in points.
      let w = 0;
      let lat = 0;
      let lng = 0;
      for (let k = i; k <= j; k += 1) {
        const held = Math.max(1, (k + 1 < points.length ? points[k + 1].t : points[k].t) - points[k].t);
        w += held;
        lat += points[k].lat * held;
        lng += points[k].lng * held;
      }
      stops.push({ start, end, lat: lat / w, lng: lng / w, n: win.length });
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return stops;
}

// Stops closer than `dist` metres and `gapMs` apart in time are one stop
// (a practice swing, a step to the side).
export function mergeStops(stops, { dist = MERGE_DIST_M, gapMs = MERGE_GAP_MS } = {}) {
  const out = [];
  for (const s of stops) {
    const prev = out[out.length - 1];
    if (prev && s.start - prev.end < gapMs && haversine([prev.lat, prev.lng], [s.lat, s.lng]) < dist) {
      const n = prev.n + s.n;
      prev.lat = (prev.lat * prev.n + s.lat * s.n) / n;
      prev.lng = (prev.lng * prev.n + s.lng * s.n) / n;
      prev.n = n;
      prev.end = Math.max(prev.end, s.end);
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

// Distance from p to the segment a→b, metres (flat-earth, fine at hole scale).
function segmentDistance(p, a, b) {
  const k = Math.cos(rad(a[0]));
  const toXY = (q) => [(q[1] - a[1]) * k * rad(1) * R, (q[0] - a[0]) * rad(1) * R];
  const [px, py] = toXY(p);
  const [bx, by] = toXY(b);
  const len2 = bx * bx + by * by;
  const u = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
  return Math.hypot(px - u * bx, py - u * by);
}

// Distance from `pos` to a hole's tee→green line (holeRefs), metres.
export const distanceToHoleLine = (pos, refs) => segmentDistance(pos, refs.tee, refs.green);

// The tee and green reference points of a geometry hole (assembleCourses shape).
export function holeRefs(hole) {
  const tee = hole.start ?? centroid(hole.tees);
  const green = hole.pin ?? hole.greenCenter ?? centroid(hole.green);
  return tee && green ? { tee, green, poly: hole.green ?? null } : null;
}

// Each stop goes to the hole whose tee→green line is nearest, within
// `maxM`; anything further (car park, between holes) stays unassigned. Before
// lines: a stop on a green is that hole's, and one within TEE_STOP_M of a tee
// (and nearer it than to any flag) is that hole's tee shot, even when another
// hole's line passes closer (a tee beside the previous green).
export const TEE_STOP_M = 15;
export function assignStopsToHoles(stops, holes, { maxM = 60 } = {}) {
  const refs = (holes ?? []).map((h) => ({ number: h.number, refs: holeRefs(h) })).filter((h) => h.refs);
  const byHole = new Map();
  const unassigned = [];
  const nearest = (dist, within) => refs.reduce((best, h) => {
    const d = dist(h.refs);
    return d <= within && (!best || d < best.d) ? { number: h.number, d } : best;
  }, null);
  for (const s of stops) {
    const pos = [s.lat, s.lng];
    const flag = Math.min(...refs.map((h) => haversine(pos, h.refs.green)));
    const best = refs.find((h) => onGreen(pos, h.refs))
      ?? nearest((r) => haversine(pos, r.tee), Math.min(TEE_STOP_M, flag))
      ?? nearest((r) => segmentDistance(pos, r.tee, r.green), maxM);
    if (!best) { unassigned.push(s); continue; }
    if (!byHole.has(best.number)) byHole.set(best.number, []);
    byHole.get(best.number).push(s);
  }
  return { byHole, unassigned };
}

// assignStopsToHoles with time: holes are played one after another, so a stop
// on a hole's line hours apart from the rest of that hole's stops was made
// while playing another hole (a drive into the next fairway). A hole's stops
// fall into runs with no gap over `gapMs`; its play is the largest run that
// did not happen while another hole was being played (inside the time span of
// that hole's largest run) — crossing a hole on the way to another tee can
// leave more stops than its real play, which may still be under way. A stop
// outside its hole's play (or near no hole line) goes to the hole being played
// at that moment — the latest play started before it — when that hole's line
// is within `strayM`, else it is dropped.
export const PLAY_GAP_MS = 10 * 60000;
const longest = (runs) => runs.reduce((a, b) => (b.length > a.length ? b : a));
export function assignStopsByPlay(stops, holes, { maxM = 60, strayM = 150, gapMs = PLAY_GAP_MS } = {}) {
  const { byHole: geo, unassigned } = assignStopsToHoles(stops, holes, { maxM });
  const refs = new Map((holes ?? []).map((h) => [h.number, holeRefs(h)]).filter(([, r]) => r));
  const byHole = new Map();
  const add = (n, s) => { if (!byHole.has(n)) byHole.set(n, []); byHole.get(n).push(s); };
  const runsOf = new Map();
  for (const [n, list] of geo) {
    const runs = [];
    for (const s of [...list].sort((a, b) => a.start - b.start)) {
      const run = runs[runs.length - 1];
      if (run && s.start - run[run.length - 1].end <= gapMs) run.push(s);
      else runs.push([s]);
    }
    runsOf.set(n, runs);
  }
  const spans = [...runsOf].map(([n, runs]) => {
    const run = longest(runs);
    return { n, start: run[0].start, end: run[run.length - 1].end };
  });
  const during = (n, run) => spans.some((sp) => sp.n !== n
    && sp.start < run[0].start && run[run.length - 1].end < sp.end);
  const plays = [];
  const strays = [...unassigned];
  for (const [n, runs] of runsOf) {
    const own = runs.filter((run) => !during(n, run));
    const main = longest(own.length ? own : runs);
    main.forEach((s) => add(n, s));
    plays.push({ number: n, start: main[0].start });
    runs.filter((run) => run !== main).forEach((run) => strays.push(...run.map((s) => ({ s, own: n }))));
  }
  plays.sort((a, b) => a.start - b.start);
  for (const item of strays) {
    const s = item.s ?? item;
    const playing = plays.filter((p) => p.start <= s.start).pop();
    if (!playing) continue;
    if (playing.number === item.own) { add(playing.number, s); continue; } // no other hole since
    const r = refs.get(playing.number);
    if (r && segmentDistance([s.lat, s.lng], r.tee, r.green) <= strayM) add(playing.number, s);
  }
  return byHole;
}

// The walk drawn on the hole map: `walk` ([[lat,lng],...], in time order) with
// `points` (trail points) appended, keeping one point every `stepM` metres so
// a round stays a few thousand points. Poor fixes are dropped (cleanTrail).
export const WALK_STEP_M = 5;
export function extendWalk(walk, points, stepM = WALK_STEP_M) {
  const out = walk ? walk.slice() : [];
  for (const p of cleanTrail(points)) {
    const last = out[out.length - 1];
    if (!last || haversine(last, [p.lat, p.lng]) >= stepM) out.push([p.lat, p.lng]);
  }
  return out;
}

// The parts of a round's walk that belong to one hole: each point goes to the
// hole whose tee→green line is nearest (within `maxM`, as assignStopsToHoles),
// and a run of this hole's points is one polyline. Returns [[[lat,lng],...]],
// runs of a single point dropped.
export function walkForHole(walk, holes, holeNumber, { maxM = 60 } = {}) {
  const refs = (holes ?? []).map((h) => ({ number: h.number, refs: holeRefs(h) })).filter((h) => h.refs);
  const runs = [];
  let run = [];
  for (const pt of walk ?? []) {
    let best = null;
    for (const h of refs) {
      const d = segmentDistance(pt, h.refs.tee, h.refs.green);
      if (d <= maxM && (!best || d < best.d)) best = { number: h.number, d };
    }
    if (best?.number === holeNumber) run.push(pt);
    else { if (run.length > 1) runs.push(run); run = []; }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

export const onGreen = (pos, refs) => (refs.poly ? pointInPolygon(pos, refs.poly) : haversine(pos, refs.green) <= 15);

// Drive and approach distances from an ordered list of ball spots on one
// hole (stops or GPS-marked shots: { lat, lng }). Drive: first spot → next
// spot (par 4/5 only). Approach: the last spot off the green before the first
// spot on it → the pin (or green centre).
export function inferHoleDistances(spots, hole, par) {
  const refs = holeRefs(hole);
  if (!refs || !spots?.length) return { drive: null, approach: null };
  const pos = spots.map((s) => [s.lat, s.lng]);
  const drive = par >= 4 && pos.length >= 2 ? haversine(pos[0], pos[1]) : null;
  const firstOn = pos.findIndex((p) => onGreen(p, refs));
  const fromIdx = firstOn > 0 ? firstOn - 1 : (firstOn === -1 ? pos.length - 1 : -1);
  const approach = fromIdx >= 0 && !onGreen(pos[fromIdx], refs) ? haversine(pos[fromIdx], refs.green) : null;
  return { drive, approach };
}
