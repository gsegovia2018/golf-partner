// Bulk-import GPS course geometry from OpenStreetMap for Spanish courses that
// have all 18 holes numbered, linked to the right course in the app library.
//
// Usage (needs SUPABASE_ACCESS_TOKEN + EXPO_PUBLIC_SUPABASE_URL in .env; the
// library is read with SELECTs only, nothing is written to the database):
//   node scripts/importOsmGeometry.mjs [--force] [--only <osm id>]
//     [--candidates scripts/data/osm-candidates.json]
//
// Per candidate: fetch the golf features INSIDE the course's own OSM outline
// (Overpass map_to_area). If that yields fewer than 18 numbered holes, fall
// back to the candidate's bbox and keep only hole ways whose middle vertex is
// inside the outline. Accept only one hole way per ref 1..18, then link to
// exactly one library course (name words + par tags) and build a unique
// matchTokens group. Writes:
//   scripts/data/osm-geometry/<key>.json   (gitignored; seed with seedCourseGeometry.mjs)
//   scripts/data/osm-geometry-manifest.json, osm-geometry-report.md (committed)
// Resumable: Overpass answers are cached in osm-geometry/_raw; --force refetches.
import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import osm from './lib/osmGeometry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// overpass-api.de rejects requests without a descriptive User-Agent (406); the
// mail.ru mirror is the fallback.
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const UA = 'golf-partner-geometry-import/1.0';
const OUT = resolve(__dirname, 'data/osm-geometry');
const RAW = resolve(OUT, '_raw');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const force = process.argv.includes('--force');
const only = arg('only')?.replace(/^(way|relation)\//, '');
const candidates = JSON.parse(readFileSync(resolve(arg('candidates', resolve(__dirname, 'data/osm-candidates.json'))), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(query) {
  let last;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = ENDPOINTS[attempt % 2];
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: 'data=' + encodeURIComponent(query),
      });
      if (r.ok) return await r.json();
      last = new Error(`Overpass HTTP ${r.status}`);
      if (![429, 502, 503, 504].includes(r.status)) last.fatal = true;
    } catch (e) { last = e; }
    if (last.fatal && attempt >= 1) throw last;
    await sleep(3000 * 2 ** Math.floor(attempt / 2));
  }
  throw last;
}

async function sql(query) {
  const ref = new URL(process.env.EXPO_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`SQL HTTP ${res.status}`);
  return res.json();
}

const FEATURES = 'way["golf"~"^(green|hole|tee|bunker|water_hazard|lateral_water_hazard)$"]';
const kindOf = (osmId) => osmId.split('/')[0] === 'relation' ? 'rel' : 'way';
const idOf = (osmId) => osmId.split('/')[1];

// Overpass answer for one candidate: area query, bbox fallback when <18 refs.
async function fetchRaw(c) {
  const file = resolve(RAW, `${c.osm.replace('/', '-')}.json`);
  if (!force && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const sel = `${kindOf(c.osm)}(${idOf(c.osm)})`;
  let raw = { mode: 'area', elements: [] };
  try {
    const j = await overpass(`[out:json][timeout:120];${sel};map_to_area->.a;(${FEATURES}(area.a);way["natural"="water"](area.a););out geom;`);
    raw.elements = j.elements;
  } catch (e) { raw.error = e.message; }
  await sleep(2000);
  const refs = new Set(raw.elements.filter((e) => e.tags?.golf === 'hole').map((e) => +e.tags.ref));
  if ([...Array(18)].some((_, i) => !refs.has(i + 1))) {
    const bb = c.bbox.join(',');
    const [h, o] = [
      await overpass(`[out:json][timeout:120];(${FEATURES}(${bb});way["natural"="water"](${bb}););out geom;`),
      (await sleep(2000), await overpass(`[out:json][timeout:120];${sel};out geom;`)),
    ];
    // Outline rings: the way itself, or the outer member ways of a relation.
    const ring = (g) => (g || []).map((p) => [p.lat, p.lon]);
    const rings = o.elements.flatMap((e) => e.type === 'way' ? [ring(e.geometry)]
      : (e.members || []).filter((m) => m.role === 'outer' && m.geometry).map((m) => ring(m.geometry)));
    raw = { mode: 'bbox', elements: h.elements, rings, areaError: raw.error };
    await sleep(2000);
  }
  mkdirSync(RAW, { recursive: true });
  writeFileSync(file, JSON.stringify(raw));
  return raw;
}

// Library + existing geometry (read-only).
const library = (await sql(`select c.id, c.name, (select string_agg(h.par::text, ',' order by h.number) from course_holes h where h.course_id=c.id) pars, (select count(*) from course_holes h where h.course_id=c.id) n from courses c`))
  .filter((c) => +c.n === 18)
  .map((c) => ({ id: c.id, name: c.name, pars: c.pars.split(',').map(Number) }));
const dbGeoms = await sql('select id, name, match_tokens from golf_course');
const existing = dbGeoms.map((g) => ({ id: g.id, matchTokens: g.match_tokens }));
const base = [...existing]; // DB geometry only, before this run adds its own
const usedKeys = new Set(dbGeoms.map((g) => g.id));

mkdirSync(OUT, { recursive: true });
const accepted = [], rejected = [], review = new Map();
const flag = (key, msg) => review.set(key, [...(review.get(key) ?? []), msg]);
const list = candidates.filter((c) => !only || idOf(c.osm) === only);

for (const c of list) {
  const reject = (code, detail) => { rejected.push({ osm: c.osm, name: c.name, code, detail }); console.log(`REJECT ${c.osm} ${c.name}: [${code}] ${detail}`); };
  let raw;
  try { raw = await fetchRaw(c); } catch (e) { reject('overpass-failed', e.message); continue; }
  const built = osm.buildHoles(raw.elements, raw.rings);
  if (built.reason) { reject('hole-refs', `${raw.mode === 'bbox' ? '[bbox fallback] ' : ''}${built.reason}`); continue; }

  const osmPars = built.holes.map((h) => h.par);
  const named = library.filter((l) => osm.nameMatch(c.name, l.name).ok);
  if (!named.length) { reject('no-name-match', 'no library course shares distinctive name words'); continue; }
  const fits = named.map((l) => ({ l, p: osm.compareParsOsm(osmPars, l.pars), strong: osm.nameMatch(c.name, l.name).strong }))
    .filter((x) => x.p.ok);
  if (!fits.length) { reject('par-mismatch', `name matches [${named.map((l) => l.name).join('; ')}] but pars differ`); continue; }
  if (fits.length > 1) { reject('ambiguous', fits.map((x) => x.l.name).join('; ')); continue; }
  const { l: lib, p, strong } = fits[0];
  // Fewer tagged pars than this can't confirm the hole numbering matches the card.
  if (p.checked < 12) { reject('weak-evidence', `only ${p.checked} par tags for "${lib.name}"`); continue; }

  // An existing entry that resolves for this library course is the same course
  // when its name matches the OSM name; otherwise (e.g. a lone ["negro"] group
  // matching an unrelated name) the new, longer group wins in the app: flag only.
  const hit = osm.resolveGeometry(lib.name, base);
  const hitDesc = hit && `${hit.id} ${JSON.stringify(hit.matchTokens)}`;
  if (hit && osm.nameMatch(c.name, dbGeoms.find((g) => g.id === hit.id).name).ok) { reject('already-geometry', `${lib.name} -> existing ${hitDesc}`); continue; }

  const farGreens = built.flags.filter((f) => /from line end|no green/.test(f)).length;
  if (built.greensMatched < 16 || farGreens >= 3) { reject('bad-geometry', `${built.greensMatched}/18 greens, ${farGreens} holes with missing or far (>60m) greens`); continue; }

  const key0 = osm.slugify(lib.name);
  let key = key0;
  for (let i = 2; usedKeys.has(key); i++) key = `${key0}-${i}`;
  const tok = osm.buildTokens(lib, library, existing, key);
  if (tok.reason) { reject(tok.code, tok.reason); continue; }
  usedKeys.add(key);
  existing.push({ id: key, matchTokens: [tok.tokens] });

  const holes = built.holes.map((h, i) => ({ ...h, par: h.par ?? lib.pars[i] }));
  const course = { key, name: lib.name, matchTokens: [tok.tokens], mode: 'holes', source: 'OpenStreetMap (ODbL)', holes };
  writeFileSync(resolve(OUT, `${key}.json`), JSON.stringify(course));
  const hazards = holes.reduce((n, h) => n + h.hazards.length, 0);
  accepted.push({ key, osm: c.osm, osmName: c.name, libraryCourseId: lib.id, libraryName: lib.name, matchTokens: tok.tokens, holes: 18, parsChecked: p.checked, hazards, greensMatched: built.greensMatched });
  for (const f of built.flags) flag(key, f);
  if (hit) flag(key, `an existing group also matches this name (${hitDesc}); the new longer group wins in the app`);
  if (p.checked < 18) flag(key, `par evidence: ${p.checked}/18 holes tagged`);
  if (!strong) flag(key, `name is not an exact club-name match: OSM "${c.name}" vs "${lib.name}"`);
  if (raw.mode === 'bbox') flag(key, 'bbox fallback (holes filtered to the outline)');
  console.log(`ACCEPT ${c.osm} ${c.name} -> ${lib.name} [${tok.tokens.join(' ')}]`);
}

if (only) process.exit(0); // partial run: leave manifest/report alone

// Re-runs replay from the raw cache, so a full run always rebuilds these.
const manifest = accepted.sort((a, b) => a.key.localeCompare(b.key));
writeFileSync(resolve(__dirname, 'data/osm-geometry-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const byReason = {};
for (const r of rejected) byReason[r.code] = (byReason[r.code] ?? 0) + 1;
const md = [
  '# OSM course geometry import report', '',
  `${manifest.length} accepted, ${rejected.length} rejected of ${list.length} candidates.`, '',
  '## Rejected', '', ...Object.entries(byReason).map(([k, n]) => `- ${n} x ${k}`), '',
  ...rejected.map((r) => `- ${r.name} (${r.osm}): [${r.code}] ${r.detail}`), '',
  '## Accepted', '', ...manifest.map((m) => `- ${m.osmName} (${m.osm}) -> ${m.libraryName} [${m.matchTokens.join(' ')}], pars ${m.parsChecked}/18, greens ${m.greensMatched}/18, hazards ${m.hazards}`), '',
  '## Accepted, flagged for review', '', ...[...review].map(([k, f]) => `- ${k}: ${f.join('; ')}`), '',
];
writeFileSync(resolve(__dirname, 'data/osm-geometry-report.md'), md.join('\n'));
console.log(`\n${manifest.length} accepted, ${rejected.length} rejected; outputs in ${OUT}`);
console.log(`files on disk: ${readdirSync(OUT).filter((f) => f.endsWith('.json')).length}`);
