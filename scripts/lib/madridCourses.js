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

module.exports = { CLUBS, decodeEntities, parseTrazadoOptions };
