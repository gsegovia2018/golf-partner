// Pure helpers for scripts/importOsmGeometry.mjs: parsing OSM golf features
// into per-hole geometry, and linking an OSM course to exactly one library
// course with match tokens that mirror src/lib/geo.js findCourseGeometry.
// CommonJS so the script and Jest can both load it. No I/O here.

// Words that say "golf course" but not which one. Never match on these alone.
const GENERIC = new Set([
  'golf', 'club', 'clube', 'de', 'del', 'la', 'las', 'los', 'el', 'real', 'campo', 'course',
  'resort', 'country', 'cc', 'rcg', 'gc', 'y', 'and', 'the', 'of', 'hotel', 'spa', 'sports',
  'leisure', 'municipal', 'rc', 'sa',
]);
// Toponyms shared by many clubs: sharing only these is not evidence of the same club.
const PLACES = new Set(['marbella', 'madrid', 'malaga', 'mallorca', 'barcelona', 'valencia', 'alicante',
  'sevilla', 'benidorm', 'ibiza', 'tenerife', 'costa', 'sol', 'mar', 'playa', 'sotogrande']);
// Dropped even from the fallback token group (articles/prepositions).
const ARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'and', 'the', 'of']);

// Same normalization as src/lib/courseLibrary.js normalizeText.
const normalize = (s) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const words = (s) => normalize(s).split(/[^a-z0-9]+/).filter(Boolean);
const distinctiveWords = (s) => [...new Set(words(s).filter((w) => !GENERIC.has(w)))];
const clubPart = (libName) => String(libName).split(' — ')[0];

// Does an OSM course name point at this library course? `ok` = the OSM name's
// distinctive words are all in the library name, or the library club name's
// are all in the OSM name. `strong` = both club names have identical words.
function nameMatch(osmName, libName) {
  const o = new Set(distinctiveWords(osmName));
  const l = new Set(distinctiveWords(libName));
  const c = new Set(distinctiveWords(clubPart(libName)));
  if (!o.size || !c.size) return { ok: false, strong: false };
  const oInL = [...o].every((w) => l.has(w));
  const cInO = [...c].every((w) => o.has(w));
  const strong = oInL && cInO;
  const shared = [...o].filter((w) => l.has(w));
  const placeOnly = shared.every((w) => PLACES.has(w));
  return { ok: (oInL || cInO) && (strong || !placeOnly), strong };
}

// OSM par tags (array of 18, null when untagged) vs library pars. `checked`
// counts tagged holes; `ok` = no tagged hole disagrees.
function compareParsOsm(osmPars, libPars) {
  let checked = 0;
  for (let i = 0; i < 18; i++) {
    if (osmPars[i] == null) continue;
    checked++;
    if (osmPars[i] !== libPars[i]) return { checked, ok: false };
  }
  return { checked, ok: true };
}

// Exact findCourseGeometry rule: a group matches when every token is a
// substring of the normalized name; most tokens wins, ties keep the first.
function resolveGeometry(courseName, geoms) {
  const n = normalize(courseName);
  let best = null;
  let score = 0;
  for (const g of geoms) {
    for (const group of g.matchTokens) {
      if (group.every((t) => n.includes(t)) && group.length > score) { best = g; score = group.length; }
    }
  }
  return best;
}

// One token group for `target`, unique among `library` names and harmless to
// existing geometry. Tries the distinctive words first, then every
// non-article word. Returns { tokens } or { reason }.
function buildTokens(target, library, existing, key) {
  const baseline = new Map(library.map((c) => [c.id, resolveGeometry(c.name, existing)?.id ?? null]));
  const tiers = [distinctiveWords(target.name), [...new Set(words(target.name).filter((w) => !ARTICLES.has(w)))]];
  let why = 'no distinctive words in library name';
  let code = 'sibling-clash';
  for (const tokens of tiers) {
    if (!tokens.length) continue;
    const cand = { id: key, matchTokens: [tokens] };
    const all = [...existing, cand];
    const bad = library.filter((c) => {
      const got = resolveGeometry(c.name, all)?.id ?? null;
      return c.id === target.id ? got !== key : got !== baseline.get(c.id);
    });
    if (!bad.length) return { tokens };
    why = `tokens [${tokens.join(' ')}] clash with ${bad.slice(0, 3).map((c) => c.name).join('; ')}`;
    // sibling = another library course would also match; hijack = only courses that already have geometry
    code = bad.some((c) => !baseline.get(c.id)) ? 'sibling-clash' : 'hijack-existing';
  }
  return { reason: why, code };
}

function slugify(s) {
  return normalize(s).replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const RAD = Math.PI / 180;
const centroid = (pts) => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
function metersBetween(p, q) {
  const x = (q[1] - p[1]) * RAD * Math.cos(((p[0] + q[0]) / 2) * RAD);
  return Math.hypot(x, (q[0] - p[0]) * RAD) * 6371000;
}
// Min distance (m) from a point to a polyline, in a local flat projection.
function pointToLine(pt, line) {
  const k = Math.cos(pt[0] * RAD);
  const xy = (p) => [(p[1] - pt[1]) * RAD * k * 6371000, (p[0] - pt[0]) * RAD * 6371000];
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = xy(line[i - 1]);
    const [bx, by] = xy(line[i]);
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * (bx - ax) + ay * (by - ay)) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * (bx - ax), ay + t * (by - ay)));
  }
  return best;
}
// Even-odd point-in-polygon over several rings ([lat,lng] points).
function inRings(pt, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [yi, xi] = ring[i];
      const [yj, xj] = ring[j];
      if ((yi > pt[0]) !== (yj > pt[0]) && pt[1] < ((xj - xi) * (pt[0] - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

const round6 = (p) => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6];
const geomOf = (el) => (el.geometry || []).map((p) => round6([p.lat, p.lon]));

// Overpass elements -> per-hole geometry for refs 1..18, or { reason }.
// `rings` (optional): outline rings; hole ways whose middle vertex lies
// outside are dropped (bbox fallback). Hazards belong to the nearest hole
// line within 70 m; green = nearest to the line end, tee = nearest to the
// start within 60 m. `flags` lists things worth a human look.
function buildHoles(elements, rings) {
  const greens = [], tees = [], hazards = [], rawHoles = [];
  for (const el of elements) {
    const g = el.tags?.golf;
    const pts = geomOf(el);
    if (pts.length < 2) continue;
    if (g === 'green') greens.push({ poly: pts, center: round6(centroid(pts)) });
    else if (g === 'tee') tees.push({ poly: pts, center: round6(centroid(pts)) });
    else if (g === 'hole') {
      const ref = /^\s*\d+\s*$/.test(el.tags.ref ?? '') ? parseInt(el.tags.ref, 10) : null;
      const par = /^\d+$/.test(el.tags.par ?? '') ? +el.tags.par : null;
      if (ref != null) rawHoles.push({ ref, par, line: pts });
    } else if (g === 'bunker') hazards.push({ kind: 'bunker', poly: pts, center: centroid(pts) });
    else if (g === 'water_hazard' || g === 'lateral_water_hazard' || el.tags?.natural === 'water') {
      hazards.push({ kind: 'water', poly: pts, center: centroid(pts) });
    }
  }
  const holes = rings ? rawHoles.filter((h) => inRings(h.line[Math.floor(h.line.length / 2)], rings)) : rawHoles;
  const byRef = new Map();
  for (const h of holes) byRef.set(h.ref, [...(byRef.get(h.ref) ?? []), h]);
  const dup = [...byRef].filter(([, v]) => v.length > 1).map(([r]) => r);
  if (dup.length) return { reason: `duplicate hole refs (${dup.sort((a, b) => a - b).join(',')})` };
  const extra = [...byRef.keys()].filter((r) => r < 1 || r > 18);
  if (extra.length) return { reason: `refs outside 1-18 (${extra.length} extra): multi-course` };
  const missing = [...Array(18)].map((_, i) => i + 1).filter((r) => !byRef.has(r));
  if (missing.length) return { reason: `missing hole refs (${missing.join(',')})` };

  const lines = [...byRef.values()].map((v) => v[0]);
  const hazByHole = new Map();
  for (const hz of hazards) {
    let best = null, bd = Infinity;
    for (const h of lines) { const d = pointToLine(hz.center, h.line); if (d < bd) { bd = d; best = h.ref; } }
    if (bd <= 70) hazByHole.set(best, [...(hazByHole.get(best) ?? []), { kind: hz.kind, poly: hz.poly }]);
  }
  const nearest = (pt, arr) => arr.reduce((b, c) => (!b || metersBetween(pt, c.center) < metersBetween(pt, b.center) ? c : b), null);
  const flags = [];
  const used = new Map();
  const out = lines.sort((a, b) => a.ref - b.ref).map((h) => {
    const end = h.line[h.line.length - 1];
    const start = h.line[0];
    let green = nearest(end, greens);
    let tee = nearest(start, tees);
    if (!green) flags.push(`hole ${h.ref}: no green`);
    else {
      const d = metersBetween(end, green.center);
      // OSM hole lines end on the green: a nearest green this far off is
      // another hole's (an unmapped green), so aim at the line end instead.
      if (d > 60) { flags.push(`hole ${h.ref}: green ${Math.round(d)}m from line end, aiming at the line end`); green = null; }
      else {
        if (metersBetween(start, green.center) < d) flags.push(`hole ${h.ref}: line may run green to tee`);
        used.set(green, [...(used.get(green) ?? []), h.ref]);
      }
    }
    if (tee && metersBetween(start, tee.center) > 60) { flags.push(`hole ${h.ref}: nearest tee >60m, dropped`); tee = null; }
    return {
      number: h.ref,
      par: h.par,
      green: green?.poly ?? null,
      greenCenter: green?.center ?? end,
      pin: null,
      tees: tee?.poly ?? null,
      start,
      hazards: hazByHole.get(h.ref) ?? [],
    };
  });
  for (const refs of used.values()) if (refs.length > 1) flags.push(`holes ${refs.join('+')} share one green`);
  return { holes: out, flags, greensMatched: out.filter((h) => h.green).length };
}

module.exports = {
  GENERIC, normalize, distinctiveWords, nameMatch, compareParsOsm, resolveGeometry,
  buildTokens, slugify, buildHoles, inRings, pointToLine, metersBetween,
};
