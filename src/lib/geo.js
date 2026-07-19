// Pure geo helpers for GPS distances to course features. No I/O, no React.
// Coordinates are [lat, lng] pairs (matches src/data/courseGeometry.json).

import seedGeometry from '../data/courseGeometry.json';
import { normalizeText } from './courseLibrary';

// Active geometry set. Seeded from the bundled JSON so GPS works offline and
// before the first Supabase fetch; courseGeometryStore.hydrate() swaps in the
// live table data via setCourseGeometry(). Same nested shape either way:
// { key, name, matchTokens, mode, holes[] | greens[] }.
let COURSES = seedGeometry.courses;

// Subscription so React re-renders when hydration swaps the geometry in — the
// bundled seed renders first, then Supabase data replaces it. Without this,
// screens keep the seed (e.g. the old greens-mode CCVM) and never show the
// live per-hole courses. Shaped for useSyncExternalStore.
let version = 0;
const listeners = new Set();

// Replace the active geometry (called by courseGeometryStore after a fetch).
// Falls back to the bundled seed when handed an empty/invalid set.
export function setCourseGeometry(courses) {
  COURSES = Array.isArray(courses) && courses.length ? courses : seedGeometry.courses;
  version += 1;
  listeners.forEach((l) => l());
}

export function getCourseGeometry() {
  return COURSES;
}

export function subscribeCourseGeometry(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getCourseGeometryVersion() {
  return version;
}

const EARTH_RADIUS_M = 6371000;
const RAD = Math.PI / 180;

// Great-circle distance in meters between two [lat, lng] points.
export function haversineMeters(a, b) {
  const dLat = (b[0] - a[0]) * RAD;
  const dLng = (b[1] - a[1]) * RAD;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s));
}

function polygonCentroid(pts) {
  let lat = 0, lng = 0;
  for (const p of pts) { lat += p[0]; lng += p[1]; }
  return [lat / pts.length, lng / pts.length];
}

// Initial bearing in degrees (0–360) from a to b.
function bearingDeg(a, b) {
  const dLng = (b[1] - a[1]) * RAD;
  const y = Math.sin(dLng) * Math.cos(b[0] * RAD);
  const x = Math.cos(a[0] * RAD) * Math.sin(b[0] * RAD)
    - Math.sin(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.cos(dLng);
  return ((Math.atan2(y, x) / RAD) + 360) % 360;
}

// Front/center/back of a green polygon as seen from `pos`: front is the
// nearest polygon vertex, back the farthest, center the centroid. OSM green
// outlines are dense enough (~20 vertices) that vertex distance ≈ edge
// distance within GPS accuracy.
export function greenDistances(pos, greenPolygon, greenCenter) {
  const center = greenCenter ?? (greenPolygon ? polygonCentroid(greenPolygon) : null);
  if (!center) return null;
  if (!greenPolygon) {
    const c = haversineMeters(pos, center);
    return { front: null, center: c, back: null };
  }
  let front = Infinity, back = 0;
  for (const v of greenPolygon) {
    const d = haversineMeters(pos, v);
    if (d < front) front = d;
    if (d > back) back = d;
  }
  return { front, center: haversineMeters(pos, center), back };
}

// Resolve a round's course name to a geometry entry, or null. A course
// matches when every token of any of its matchTokens groups appears in the
// accent/case-normalized name — so "Villaitana Golf — Levante" or
// "Club de Campo (Negro)" both resolve.
export function findCourseGeometry(courseName) {
  const n = normalizeText(courseName);
  if (!n) return null;
  // Most-specific match wins: the matching token group with the most tokens
  // beats a looser one. Otherwise CCVM's single-token color groups (["amarillo"],
  // ["negro"]) would steal a "Lomas Bosque Amarillo" round from Lomas-Bosque's
  // two-token ["lomas","bosque"] group. First course wins ties (array order).
  let best = null, bestScore = 0;
  for (const course of COURSES) {
    for (const tokens of course.matchTokens) {
      if (tokens.every((t) => n.includes(t)) && tokens.length > bestScore) {
        best = course;
        bestScore = tokens.length;
      }
    }
  }
  return best;
}

// Distances for a specific hole of a 'holes'-mode course. Returns
// { front, center, back, pin, kind: 'hole' } or null.
export function holeTargetDistances(pos, geometryCourse, holeNumber) {
  const hole = geometryCourse.holes?.find((h) => h.number === holeNumber);
  if (!hole) return null;
  // Admin-set front/center/back points win over the traced polygon: they're
  // intentional edges along the line of play, not just nearest/farthest vertex.
  let d;
  if (hole.greenFront || hole.greenBack || (hole.greenCenter && !hole.green)) {
    d = {
      front: hole.greenFront ? haversineMeters(pos, hole.greenFront) : null,
      center: hole.greenCenter ? haversineMeters(pos, hole.greenCenter) : null,
      back: hole.greenBack ? haversineMeters(pos, hole.greenBack) : null,
    };
  } else {
    d = greenDistances(pos, hole.green, hole.greenCenter);
  }
  if (!d) return null;
  return {
    ...d,
    pin: hole.pin ? haversineMeters(pos, hole.pin) : null,
    kind: 'hole',
  };
}

// Hazards (bunkers/water) ahead of `pos` on the given hole: kept when the
// hazard's centroid sits within ±40° of the bearing to the green and its
// near edge is short of the green center — behind-you and sideways hazards
// are noise. `reach` is the nearest polygon vertex, `carry` the farthest
// (same vertex≈edge approximation as greenDistances). Sorted nearest-first.
export function holeHazardDistances(pos, geometryCourse, holeNumber) {
  const hole = geometryCourse.holes?.find((h) => h.number === holeNumber);
  if (!hole?.hazards?.length || !hole.greenCenter) return [];
  const dGreen = haversineMeters(pos, hole.greenCenter);
  const bGreen = bearingDeg(pos, hole.greenCenter);
  const out = [];
  for (const hz of hole.hazards) {
    const b = bearingDeg(pos, polygonCentroid(hz.poly));
    let diff = Math.abs(b - bGreen);
    if (diff > 180) diff = 360 - diff;
    if (diff > 40) continue;
    let reach = Infinity, carry = 0;
    for (const v of hz.poly) {
      const d = haversineMeters(pos, v);
      if (d < reach) reach = d;
      if (d > carry) carry = d;
    }
    if (reach > dGreen) continue;
    out.push({ kind: hz.kind, reach, carry });
  }
  out.sort((a, b2) => a.reach - b2.reach);
  return out;
}

// Distances to the nearest green of a 'greens'-mode course (courses whose
// per-hole numbering is not mapped). Returns { front, center, back, pin: null,
// kind: 'nearest' } or null.
export function nearestGreenDistances(pos, geometryCourse) {
  let best = null;
  for (const green of geometryCourse.greens ?? []) {
    // A green is either an outline polygon ([[lat,lng],...]) or just a hand-
    // traced center point ([lat,lng]); the latter yields center distance only.
    const isCenterPoint = typeof green[0] === 'number';
    const d = isCenterPoint
      ? greenDistances(pos, null, green)
      : greenDistances(pos, green, null);
    if (d && (!best || d.center < best.center)) best = d;
  }
  return best ? { ...best, pin: null, kind: 'nearest' } : null;
}

// Raw polygons/points for one hole, for drawing the hole map. Returns
// { green, greenCenter, pin, tees, start, hazards } or null. Only 'holes'-mode
// courses carry per-hole geometry; 'greens'-mode returns null (no layout).
export function holeFeatures(courseName, holeNumber) {
  const course = findCourseGeometry(courseName);
  if (!course || course.mode !== 'holes') return null;
  const hole = course.holes?.find((h) => h.number === holeNumber);
  if (!hole?.green && !hole?.greenCenter) return null;
  const green = hole.green ?? null;
  return {
    green,
    greenCenter: hole.greenCenter ?? (green ? polygonCentroid(green) : null),
    greenFront: hole.greenFront ?? null,
    greenBack: hole.greenBack ?? null,
    pin: hole.pin ?? null,
    tees: hole.tees ?? null,
    start: hole.start ?? null,
    hazards: hole.hazards ?? [],
  };
}

// One entry point for the UI: distances from `pos` for `holeNumber` on the
// course named `courseName`, or null when the course has no geometry.
// 'holes'-mode results also carry `hazards` (see holeHazardDistances);
// 'greens'-mode courses have no hazard data, so theirs is always [].
export function courseTargetDistances(pos, courseName, holeNumber) {
  const course = findCourseGeometry(courseName);
  if (!course) return null;
  if (course.mode !== 'holes') {
    const d = nearestGreenDistances(pos, course);
    return d ? { ...d, hazards: [] } : null;
  }
  const d = holeTargetDistances(pos, course, holeNumber);
  return d ? { ...d, hazards: holeHazardDistances(pos, course, holeNumber) } : null;
}
