// Pure geo helpers for GPS distances to course features. No I/O, no React.
// Coordinates are [lat, lng] pairs (matches src/data/courseGeometry.json).

import courseGeometry from '../data/courseGeometry.json';
import { normalizeText } from './courseLibrary';

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
  for (const course of courseGeometry.courses) {
    for (const tokens of course.matchTokens) {
      if (tokens.every((t) => n.includes(t))) return course;
    }
  }
  return null;
}

// Distances for a specific hole of a 'holes'-mode course. Returns
// { front, center, back, pin, kind: 'hole' } or null.
export function holeTargetDistances(pos, geometryCourse, holeNumber) {
  const hole = geometryCourse.holes?.find((h) => h.number === holeNumber);
  if (!hole) return null;
  const d = greenDistances(pos, hole.green, hole.greenCenter);
  if (!d) return null;
  return {
    ...d,
    pin: hole.pin ? haversineMeters(pos, hole.pin) : null,
    kind: 'hole',
  };
}

// Distances to the nearest green of a 'greens'-mode course (courses whose
// per-hole numbering is not mapped). Returns { front, center, back, pin: null,
// kind: 'nearest' } or null.
export function nearestGreenDistances(pos, geometryCourse) {
  let best = null;
  for (const green of geometryCourse.greens ?? []) {
    const d = greenDistances(pos, green, null);
    if (d && (!best || d.center < best.center)) best = d;
  }
  return best ? { ...best, pin: null, kind: 'nearest' } : null;
}

// One entry point for the UI: distances from `pos` for `holeNumber` on the
// course named `courseName`, or null when the course has no geometry.
export function courseTargetDistances(pos, courseName, holeNumber) {
  const course = findCourseGeometry(courseName);
  if (!course) return null;
  return course.mode === 'holes'
    ? holeTargetDistances(pos, course, holeNumber)
    : nearestGreenDistances(pos, course);
}
