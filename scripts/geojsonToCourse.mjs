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

// Parse each green feature to { center|poly, hole } — a Point gives a center,
// a Polygon gives an outline (with its own centroid for per-hole mode).
const parsed = [];
for (const f of feats) {
  const g = f.geometry;
  if (!g) continue;
  if (filter && String(f.properties?.course ?? '').trim().toLowerCase() !== filter.toLowerCase()) continue;
  const hole = Number.isFinite(+f.properties?.hole) ? +f.properties.hole : null;
  if (g.type === 'Point') {
    const [lng, lat] = g.coordinates;
    parsed.push({ center: [lat, lng], poly: null, hole });
  } else if (g.type === 'Polygon') {
    const ring = g.coordinates[0].map(([lng, lat]) => [lat, lng]);
    if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
    const c = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
    parsed.push({ center: c, poly: ring, hole });
  }
  // LineString / MultiLineString (boundary, fairways) intentionally skipped.
}
if (!parsed.length) { console.error('No Point/Polygon green features found in', inFile); process.exit(1); }

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
    .map((p) => ({ number: p.hole, par: null, green: p.poly, greenCenter: p.center, pin: null, tees: null, start: null, hazards: [] }));
  course = { key: id, name, matchTokens, mode: 'holes', source: 'Hand-traced (satellite imagery)', holes };
  writeFileSync(out, JSON.stringify(course, null, 2));
  console.log(`${id}: PER-HOLE — ${holes.length} greens numbered ${Math.min(...nums)}–${Math.max(...nums)}\nwrote ${out}`);
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
