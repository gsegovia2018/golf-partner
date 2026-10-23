import {
  cleanTrail, detectStops, mergeStops, assignStopsByPlay, holeRefs, onGreen, haversine,
  MERGE_DIST_M,
} from '../lib/gpsTrailStops';

// Automatic shot detection, pure half: turns this phone's GPS fixes into
// proposed shots ("you stood here, then walked on") and places them on a hole.
// store/shotProposalStore feeds it and keeps the answers; the scorecard asks
// the golfer to confirm each proposal before it becomes a shot.
//
// A proposal is a stop (gpsTrailStops: within STOP_RADIUS_M, for PROPOSE_MIN_MS)
// that the golfer has since walked more than MOVE_AWAY_M away from. Stops on
// the green (putts), next to a shot already marked, or away from every hole
// are not proposed.
//
// Only stops of PROPOSE_MIN_MS or more are proposed: on the first two recorded
// rounds (Oct 2026) the stops the golfer added lasted a median ~80 s and only
// 3 of 40 were under 30 s, while 61 of the 94 never added were under 30 s
// (waiting on the tee, walking round the green). Shorter stops are still kept:
// they are where a missed shot is placed (store/shotGap).
//
// shortcut: STOP_RADIUS_M 6 m and MOVE_AWAY_M 20 m are still uncalibrated.
export const MOVE_AWAY_M = 20;
export const PROPOSE_MIN_MS = 30000;
// How far from the tee a first proposal still counts as the tee shot.
export const TEE_RADIUS_M = 25;

// Stops in a live fix buffer that are over: the golfer has since been more
// than MOVE_AWAY_M from them. Returns `{ stops, rest }`: the closed stops in
// time order and the buffer to keep (fixes from the end of the last closed
// stop on), so a stop is reported once and the buffer stays short.
export function takeClosedStops(buffer) {
  const pts = cleanTrail(buffer);
  const closed = [];
  for (const s of mergeStops(detectStops(pts))) {
    const left = pts.some((p) => p.t >= s.end && haversine([p.lat, p.lng], [s.lat, s.lng]) > MOVE_AWAY_M);
    if (!left) break; // still there (or not far yet): this and every later stop stay open
    closed.push(s);
  }
  if (!closed.length) return { stops: [], rest: pts };
  const cut = closed[closed.length - 1].end;
  return { stops: closed, rest: pts.filter((p) => p.t >= cut) };
}

// One hole's stops, every status. `stops`: the round's stored stops
// `{ id, start, end, lat, lng, hole, status, shotId? }` (`hole` = the
// scorecard's hole when the stop ended). `course`: the course's geometry entry
// (assembleCourses shape) or null; with holes, stops go to the hole being
// played there and then (assignStopsByPlay), else to `hole`.
export function holeStops(stops, { holeNumber, course = null }) {
  const geoHoles = course?.holes?.length ? course.holes : null;
  return geoHoles
    ? (assignStopsByPlay(stops ?? [], geoHoles).get(holeNumber) ?? [])
    : (stops ?? []).filter((s) => s.hole === holeNumber);
}

// The proposals to show on one hole, in the order they were played. `stops`
// and `course` as in holeStops; `shots`: the hole's marked shots. Each result
// adds `toGreen` (m, or null without geometry) and `fromTee`.
export function proposalsForHole(stops, { holeNumber, course = null, shots = [] }) {
  const geo = course?.holes?.find((h) => h.number === holeNumber);
  const refs = geo ? holeRefs(geo) : null;
  return holeStops(stops, { holeNumber, course })
    .filter((s) => s.status !== 'dismissed')
    .filter((s) => {
      if (s.status === 'added') return true;
      if (s.end - s.start < PROPOSE_MIN_MS) return false;
      const pos = [s.lat, s.lng];
      if (refs && onGreen(pos, refs)) return false;
      return !shots.some((sh) => haversine(pos, [sh.lat, sh.lng]) < MERGE_DIST_M);
    })
    .sort((a, b) => a.start - b.start)
    .map((s, i) => {
      const pos = [s.lat, s.lng];
      return {
        ...s,
        toGreen: refs ? haversine(pos, refs.green) : null,
        fromTee: refs ? haversine(pos, refs.tee) <= TEE_RADIUS_M : i === 0,
      };
    });
}

// The stop that ends an open hole on its green: your first stop on the green
// is where you putted from, right by the ball, so it is the approach's
// landing. Null unless the hole has geometry with a green, the chain is open
// (its last shot carries a club and is off the green) and such a stop exists
// that hasn't been dismissed or used. `stops`, `course`, `shots` as in
// proposalsForHole.
export function greenLandingStop(stops, { holeNumber, course = null, shots = [] }) {
  const geoHoles = course?.holes?.length ? course.holes : null;
  const geo = geoHoles?.find((h) => h.number === holeNumber);
  const refs = geo ? holeRefs(geo) : null;
  const last = shots[shots.length - 1];
  if (!refs || !last?.club || onGreen([last.lat, last.lng], refs)) return null;
  return holeStops(stops, { holeNumber, course })
    .filter((s) => s.status === 'open' && onGreen([s.lat, s.lng], refs))
    .sort((a, b) => a.start - b.start)[0] ?? null;
}

// Where a confirmed proposal goes in the hole's shot chain: before the first
// marked shot that is closer to the green, else at the end. Without a green
// (no geometry) it is appended. `shots` are the hole's shots ordered by seq.
export function seqForProposal(proposal, shots, green) {
  if (green) {
    const d = haversine([proposal.lat, proposal.lng], green);
    const next = shots.find((sh) => haversine([sh.lat, sh.lng], green) < d);
    if (next) return next.seq;
  }
  return shots.length ? shots[shots.length - 1].seq + 1 : 1;
}

