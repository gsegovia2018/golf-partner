// Extract GPS course geometry from OpenStreetMap (Overpass) into a nested
// course object that scripts/seedCourseGeometry.mjs can seed.
//
// Usage:
//   node scripts/extractCourseGeometry.mjs \
//     --id centro-nacional --name "Centro Nacional de Golf" \
//     --tokens "centro nacional|rfeg" --bbox 40.475,-3.749,40.499,-3.726
//
// --tokens: '|'-separated match groups; each group ' '-separated tokens
//   ("club de campo negro" => ["club de campo","negro"]).
// Emits holes-mode when OSM has ref'd golf=hole ways, else greens-mode.
// Writes scripts/data/geometry-<id>.json. Pin data is never in OSM — the app
// falls back to the green centroid.
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OVERPASS = 'https://maps.mail.ru/osm/tools/overpass/api/interpreter';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const id = arg('id');
const name = arg('name');
const tokensRaw = arg('tokens', '');
const bbox = arg('bbox'); // s,w,n,e
if (!id || !name || !bbox) {
  console.error('Required: --id --name --bbox s,w,n,e');
  process.exit(1);
}
const matchTokens = tokensRaw.split('|').filter(Boolean).map((g) => g.trim().split(/\s+/));
if (!matchTokens.length) matchTokens.push(name.toLowerCase().split(/\s+/));

const RAD = Math.PI / 180;
const centroid = (pts) => {
  let a = 0, b = 0;
  for (const p of pts) { a += p[0]; b += p[1]; }
  return [a / pts.length, b / pts.length];
};
// Meters between two [lat,lng] via equirectangular approx (fine at course scale).
function metersBetween(p, q) {
  const x = (q[1] - p[1]) * RAD * Math.cos(((p[0] + q[0]) / 2) * RAD);
  const y = (q[0] - p[0]) * RAD;
  return Math.hypot(x, y) * 6371000;
}
// Min distance (m) from point to a polyline.
function pointToLine(pt, line) {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, segDist(pt, line[i - 1], line[i]));
  return best;
}
function segDist(p, a, b) {
  const ax = 0, ay = 0;
  const bx = (b[1] - a[1]) * Math.cos(a[0] * RAD), by = b[0] - a[0];
  const px = (p[1] - a[1]) * Math.cos(a[0] * RAD), py = p[0] - a[0];
  const len2 = bx * bx + by * by;
  let t = len2 ? ((px - ax) * bx + (py - ay) * by) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * bx, cy = ay + t * by;
  return metersBetween([0, 0], [(py - cy), (px - cx) / Math.max(Math.cos(a[0] * RAD), 1e-9)]);
}

async function overpass(query) {
  const r = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(query) });
  if (!r.ok) throw new Error(`Overpass HTTP ${r.status}`);
  return r.json();
}

const q = `[out:json][timeout:90];
( way["golf"~"^(green|hole|tee|bunker|water_hazard|lateral_water_hazard)$"](${bbox});
  way["natural"="water"](${bbox}); );
out geom;`;
const j = await overpass(q);

const geom = (el) => (el.geometry || []).map((p) => [p.lat, p.lon]);
const greens = [], holes = [], tees = [], hazards = [];
for (const el of j.elements) {
  const g = el.tags?.golf;
  const pts = geom(el);
  if (pts.length < 2) continue;
  if (g === 'green') greens.push({ poly: pts, center: centroid(pts) });
  else if (g === 'hole') holes.push({ ref: parseInt(el.tags.ref, 10), par: el.tags.par ? +el.tags.par : null, line: pts });
  else if (g === 'tee') tees.push({ poly: pts, center: centroid(pts) });
  else if (g === 'bunker') hazards.push({ kind: 'bunker', poly: pts, center: centroid(pts) });
  else if (g === 'water_hazard' || g === 'lateral_water_hazard' || el.tags?.natural === 'water')
    hazards.push({ kind: 'water', poly: pts, center: centroid(pts) });
}

const refHoles = holes.filter((h) => Number.isFinite(h.ref));
let course;
if (refHoles.length >= 9) {
  // holes-mode: pair each hole line with its nearest green, assign hazards to
  // the nearest hole line within 70m (drops noise / adjacent-course hazards).
  refHoles.sort((a, b) => a.ref - b.ref);
  const assignHaz = (hz) => {
    let best = null, bd = Infinity;
    for (const h of refHoles) { const d = pointToLine(hz.center, h.line); if (d < bd) { bd = d; best = h.ref; } }
    return bd <= 70 ? best : null;
  };
  const hazByHole = new Map();
  for (const hz of hazards) { const r = assignHaz(hz); if (r != null) { if (!hazByHole.has(r)) hazByHole.set(r, []); hazByHole.get(r).push({ kind: hz.kind, poly: hz.poly }); } }
  const nearest = (pt, arr) => arr.reduce((best, c) => (metersBetween(pt, c.center) < metersBetween(pt, best.center) ? c : best), arr[0]);
  const holeObjs = refHoles.map((h) => {
    const end = h.line[h.line.length - 1];
    const green = greens.length ? nearest(end, greens) : null;
    const tee = tees.length ? nearest(h.line[0], tees) : null;
    return {
      number: h.ref,
      par: h.par,
      green: green?.poly ?? null,
      greenCenter: green?.center ?? null,
      pin: null,
      tees: tee?.poly ?? null,
      start: h.line[0],
      hazards: hazByHole.get(h.ref) ?? [],
    };
  });
  course = { key: id, name, matchTokens, mode: 'holes', source: 'OpenStreetMap (ODbL)', holes: holeObjs };
} else {
  // greens-mode: no reliable per-hole numbering, target the nearest green.
  course = { key: id, name, matchTokens, mode: 'greens', source: 'OpenStreetMap (ODbL)', greens: greens.map((g) => g.poly) };
}

mkdirSync(resolve(__dirname, 'data'), { recursive: true });
const out = resolve(__dirname, 'data', `geometry-${id}.json`);
writeFileSync(out, JSON.stringify(course, null, 2));
const summary = course.mode === 'holes'
  ? `${course.holes.length} holes, ${course.holes.reduce((n, h) => n + h.hazards.length, 0)} hazards, ${greens.length} greens`
  : `${course.greens.length} greens (nearest-green mode)`;
console.log(`${id}: ${course.mode} — ${summary}\nwrote ${out}`);
console.log('seed with: node scripts/seedCourseGeometry.mjs ' + out);
