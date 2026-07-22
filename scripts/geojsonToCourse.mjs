// Convert a geojson.io export of hand-traced greens into a seedable course.
// Usage:
//   node scripts/geojsonToCourse.mjs <in.geojson> --id lomas-bosque \
//     --name "Golf Lomas-Bosque" --tokens "lomas bosque|lomas|el bosque"
//
// Each green is a Point (green center) or Polygon (green outline) feature.
// LineString/MultiLineString features (e.g. the course boundary) are ignored.
// geojson coordinates are [lng,lat]; we emit [lat,lng] to match geo.js.
//
// If every green feature carries a numeric `hole` property, this emits
// PER-HOLE mode (distance to that hole's green). Otherwise greens-mode
// (nearest-green). Add `hole` in geojson.io's properties table, or edit the
// raw JSON: "properties": { "type": "green", "hole": 1 }.
// Seed with scripts/seedCourseGeometry.mjs.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const inFile = process.argv[2];
const id = arg('id');
const name = arg('name');
const tokensRaw = arg('tokens', '');
const filter = arg('filter'); // keep only features whose properties.course === this
if (!inFile || !id || !name) { console.error('Required: <in.geojson> --id --name [--tokens "a b|c"] [--filter amarillo]'); process.exit(1); }
const matchTokens = tokensRaw.split('|').filter(Boolean).map((g) => g.trim().split(/\s+/));
if (!matchTokens.length) matchTokens.push(name.toLowerCase().split(/\s+/));

const gj = JSON.parse(readFileSync(resolve(process.cwd(), inFile), 'utf8'));
const feats = gj.type === 'FeatureCollection' ? gj.features : [gj];

// Parse each feature to { center|poly, hole, kind } — a Point gives a center,
// a Polygon gives an outline (with its own centroid). `kind` comes from
// properties.type ('green' | 'tee'); untyped Point/Polygon default to 'green'
// (backward compat with earlier greens-only exports). Tees feed hole.start.
const parsed = [];
const tees = []; // { pt: [lat,lng], hole }
// When ANY feature carries a `type`, treat this as a typed export: untyped
// features (stray markers, boundary lines) are ignored rather than counted as
// greens. Legacy greens-only exports (no types anywhere) keep the old default.
const typedExport = feats.some((f) => f.properties?.type);
for (const f of feats) {
  const g = f.geometry;
  if (!g) continue;
  if (filter && String(f.properties?.course ?? '').trim().toLowerCase() !== filter.toLowerCase()) continue;
  if (typedExport && !f.properties?.type) continue;
  const hole = Number.isFinite(+f.properties?.hole) ? +f.properties.hole : null;
  const kind = String(f.properties?.type ?? 'green').trim().toLowerCase();
  let center = null, poly = null;
  if (g.type === 'Point') {
    const [lng, lat] = g.coordinates;
    center = [lat, lng];
  } else if (g.type === 'Polygon') {
    const ring = g.coordinates[0].map(([lng, lat]) => [lat, lng]);
    if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
    center = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
    poly = ring;
  } else {
    continue; // LineString / MultiLineString (boundary, fairways) skipped.
  }
  if (kind === 'tee') {
    // First tee per hole wins (dedupe point+polygon for the same hole).
    if (hole != null && !tees.some((t) => t.hole === hole)) tees.push({ pt: center, hole });
  } else {
    parsed.push({ center, poly, hole });
  }
}
if (!parsed.length) { console.error('No green features found in', inFile); process.exit(1); }
const teeByHole = new Map(tees.map((t) => [t.hole, t.pt]));

mkdirSync(resolve(__dirname, 'data'), { recursive: true });
const out = resolve(__dirname, 'data', `geometry-${id}.json`);
let course;
const numbered = parsed.filter((p) => p.hole != null);

if (numbered.length === parsed.length) {
  // Per-hole mode: every green is numbered.
  const nums = numbered.map((p) => p.hole);
  const dupes = nums.filter((n, i) => nums.indexOf(n) !== i);
  if (dupes.length) { console.error('Duplicate hole numbers:', [...new Set(dupes)].join(',')); process.exit(1); }
  const holes = numbered
    .sort((a, b) => a.hole - b.hole)
    .map((p) => ({ number: p.hole, par: null, green: p.poly, greenCenter: p.center, pin: null, tees: null, start: teeByHole.get(p.hole) ?? null, hazards: [] }));
  course = { key: id, name, matchTokens, mode: 'holes', source: 'Hand-traced (satellite imagery)', holes };
  writeFileSync(out, JSON.stringify(course, null, 2));
  const teedHoles = holes.filter((h) => h.start).length;
  const greenSet = new Set(nums);
  const teeOnly = [...teeByHole.keys()].filter((h) => !greenSet.has(h)).sort((a, b) => a - b);
  console.log(`${id}: PER-HOLE — ${holes.length} greens numbered ${Math.min(...nums)}–${Math.max(...nums)}, ${teedHoles} with tee\nwrote ${out}`);
  if (teeOnly.length) console.warn(`WARN: tee but NO green (no distances) for hole(s): ${teeOnly.join(',')}`);
} else {
  // Nearest-green mode: some/all greens unnumbered.
  if (numbered.length) console.warn(`WARN: ${numbered.length}/${parsed.length} numbered — falling back to nearest-green (number ALL to get per-hole).`);
  const greens = parsed.map((p) => p.poly ?? p.center);
  course = { key: id, name, matchTokens, mode: 'greens', source: 'Hand-traced (satellite imagery)', greens };
  writeFileSync(out, JSON.stringify(course, null, 2));
  const pts = greens.filter((x) => typeof x[0] === 'number').length;
  console.log(`${id}: NEAREST-GREEN — ${greens.length} greens (${pts} center-points, ${greens.length - pts} outlines)\nwrote ${out}`);
}
console.log('seed with: node scripts/seedCourseGeometry.mjs ' + out);
