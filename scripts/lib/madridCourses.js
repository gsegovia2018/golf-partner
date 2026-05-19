// Pure helpers for the Madrid course populate scripts (fetch + import).
// CommonJS so both the one-shot scripts and the Jest tests can require it.
// No I/O lives here — only deterministic, unit-tested transforms.

// The 29 golf courses listed at https://fedgolfmadrid.com/club/lista
// (practice-only facilities are excluded). `path` is the detail-page route;
// Mistral Samaranch uses /cmd/ instead of /club/.
const CLUBS = [
  { code: 'CM01', name: 'Real Club Puerta de Hierro',                   path: '/club/CM01' },
  { code: 'CM02', name: 'Real Club de Campo Villa de Madrid',           path: '/club/CM02' },
  { code: 'CM03', name: 'C.D.S.C.E.A. Barberán y Collar',               path: '/club/CM03' },
  { code: 'CM04', name: 'Real Automóvil Club de España (RACE)',         path: '/club/CM04' },
  { code: 'CM05', name: 'Real Club de Golf La Herrería',                path: '/club/CM05' },
  { code: 'CM06', name: 'Real Club de Golf Las Rozas de Madrid',        path: '/club/CM06' },
  { code: 'CM07', name: 'Real Club de Golf Lomas-Bosque',               path: '/club/CM07' },
  { code: 'CM08', name: 'El Robledal Golf',                             path: '/club/CM08' },
  { code: 'CM09', name: 'Club de Golf Encinas de Boadilla',             path: '/club/CM09' },
  { code: 'CM11', name: 'Real Sociedad Hípica Española Club de Campo',  path: '/club/CM11' },
  { code: 'CM12', name: 'Campo de Golf B.A. de Torrejón',               path: '/club/CM12' },
  { code: 'CM14', name: 'Green Paddock S.A.',                           path: '/club/CM14' },
  { code: 'CM18', name: 'Golf Park Entertainment',                      path: '/club/CM18' },
  { code: 'CM22', name: 'Forus Golf Las Rejas',                         path: '/club/CM22' },
  { code: 'CM33', name: 'Golf Negralejo',                               path: '/club/CM33' },
  { code: 'CM41', name: 'Escuela de la Real Federación de Golf Madrid', path: '/club/CM41' },
  { code: 'CM52', name: 'Real Club La Moraleja',                        path: '/club/CM52' },
  { code: 'CM60', name: 'Golf Los Retamares',                           path: '/club/CM60' },
  { code: 'CM61', name: 'Club de Golf La Dehesa',                       path: '/club/CM61' },
  { code: 'CM66', name: 'Club de Golf Aranjuez',                        path: '/club/CM66' },
  { code: 'CM74', name: 'Club de Golf de Pozuelo',                      path: '/club/CM74' },
  { code: 'CM77', name: 'Asociación de Golf Villa El Escorial',         path: '/club/CM77' },
  { code: 'CM81', name: 'Club de Golf Olivar de La Hinojosa',           path: '/club/CM81' },
  { code: 'CM87', name: 'Centro Deportivo Militar La Dehesa',           path: '/club/CM87' },
  { code: 'CMA5', name: 'Golf Santander S.A.',                          path: '/club/CMA5' },
  { code: 'CMA8', name: 'Centro Nacional de Golf',                      path: '/club/CMA8' },
  { code: 'CMC8', name: 'El Encín Golf',                                path: '/club/CMC8' },
  { code: 'CMD9', name: 'Club de Golf Mistral Samaranch',               path: '/cmd/CMD9'  },
  { code: 'CME9', name: 'LaFinca Golf',                                 path: '/club/CME9' },
];

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü',
};

// Decode the HTML entities that appear in federation page text. Numeric
// (&#241; / &#xF1;) and the named set above; unknown names are left intact.
function decodeEntities(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) =>
      Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : m);
}

// Extract the <option> id + decoded text from a club page's #trazados <select>.
function parseTrazadoOptions(html) {
  const select = /<select[^>]*id="trazados"[\s\S]*?<\/select>/i.exec(html || '');
  if (!select) return [];
  const out = [];
  const re = /<option[^>]*value="(\d+)"[^>]*>([\s\S]*?)<\/option>/gi;
  let m;
  while ((m = re.exec(select[0])) !== null) {
    out.push({ id: m[1], text: decodeEntities(m[2]).trim() });
  }
  return out;
}

// Build the app course name. The trazado option text is "CLUB - Trazado";
// a club with one trazado keeps just the club name, otherwise the trazado
// short name (text after the last " - ") is appended with an em dash.
function deriveCourseName(clubName, trazadoText, trazadoCount) {
  const club = decodeEntities(clubName).trim();
  if (trazadoCount <= 1) return club;
  const decoded = decodeEntities(trazadoText).trim();
  const idx = decoded.lastIndexOf(' - ');
  const short = idx >= 0 ? decoded.slice(idx + 3).trim() : decoded;
  return `${club} — ${short}`;
}

// Build the hole list from the federation's parallel par/hcp arrays.
// Holes whose par is "A" (void — used to pad 9-hole courses to 18 slots)
// are dropped; surviving holes are renumbered 1..N.
function buildHoles(parArr, hcpArr) {
  const holes = [];
  for (let i = 0; i < parArr.length; i++) {
    const par = parArr[i];
    if (typeof par !== 'number' || !Number.isFinite(par)) continue;
    holes.push({ number: holes.length + 1, par, strokeIndex: Number(hcpArr[i]) });
  }
  return holes;
}

// Stroke indices for an N-hole course must be exactly the set 1..N.
function validateStrokeIndex(holes) {
  const n = holes.length;
  const sis = holes.map((h) => h.strokeIndex).sort((a, b) => a - b);
  const ok = n > 0 && sis.every((v, i) => v === i + 1);
  return ok
    ? { valid: true }
    : { valid: false, reason: `stroke indices must be 1..${n}, got [${sis.join(',')}]` };
}

// Federation ratings arrive as strings ("71.2") or 0/"" when absent.
// Normalise to a finite number, or null when missing/zero.
function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

// Build the course_tees rows for one tee colour (barra). Rating/slope are
// rated separately per sex, so up to two rows are produced — men's keeps the
// plain colour label, women's gets a " (Damas)" suffix. A sex with no rating
// AND no slope is skipped. If neither sex is rated, a single fallback row is
// kept so the distances are not lost. Both rows share the same yardages map.
function buildTeeRows(barra, distances, men, women) {
  const name = decodeEntities(barra.nombre).trim();
  const mRating = numOrNull(men && men.rating);
  const mSlope = numOrNull(men && men.slope);
  const wRating = numOrNull(women && women.rating);
  const wSlope = numOrNull(women && women.slope);
  const rows = [];
  if (mRating != null || mSlope != null) {
    rows.push({ label: name, rating: mRating, slope: mSlope, yardages: distances });
  }
  if (wRating != null || wSlope != null) {
    rows.push({ label: `${name} (Damas)`, rating: wRating, slope: wSlope, yardages: distances });
  }
  if (rows.length === 0) {
    rows.push({ label: name, rating: null, slope: null, yardages: distances });
  }
  return rows;
}

module.exports = {
  CLUBS, decodeEntities, parseTrazadoOptions, deriveCourseName,
  buildHoles, validateStrokeIndex, numOrNull, buildTeeRows,
};
