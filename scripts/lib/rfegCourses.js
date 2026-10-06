// Pure helpers for the Spain course import (scripts/fetchSpainCourses.js and
// scripts/buildSpainCoursesMigration.js). Source: the Real Federación
// Española de Golf club pages, rfegolf.es/club/<slug>, which carry every
// recorrido with par, stroke index, metres and the official WHS rating and
// slope per tee and sex. CommonJS so the scripts and Jest can require it.
// No I/O lives here — only deterministic, unit-tested transforms.

const crypto = require('crypto');
const { decodeEntities, validateStrokeIndex } = require('./madridCourses');

// Spanish postal codes start with the INE province code; the library stores
// the autonomous community in English (see the existing course rows).
const REGION_BY_PROVINCE_CODE = {
  '01': 'Basque Country', '02': 'Castile-La Mancha', '03': 'Valencian Community',
  '04': 'Andalusia', '05': 'Castile and León', '06': 'Extremadura',
  '07': 'Balearic Islands', '08': 'Catalonia', '09': 'Castile and León',
  '10': 'Extremadura', '11': 'Andalusia', '12': 'Valencian Community',
  '13': 'Castile-La Mancha', '14': 'Andalusia', '15': 'Galicia',
  '16': 'Castile-La Mancha', '17': 'Catalonia', '18': 'Andalusia',
  '19': 'Castile-La Mancha', '20': 'Basque Country', '21': 'Andalusia',
  '22': 'Aragon', '23': 'Andalusia', '24': 'Castile and León', '25': 'Catalonia',
  '26': 'La Rioja', '27': 'Galicia', '28': 'Madrid', '29': 'Andalusia',
  '30': 'Region of Murcia', '31': 'Navarre', '32': 'Galicia', '33': 'Asturias',
  '34': 'Castile and León', '35': 'Canary Islands', '36': 'Galicia',
  '37': 'Castile and León', '38': 'Canary Islands', '39': 'Cantabria',
  '40': 'Castile and León', '41': 'Andalusia', '42': 'Castile and León',
  '43': 'Catalonia', '44': 'Aragon', '45': 'Castile-La Mancha',
  '46': 'Valencian Community', '47': 'Castile and León', '48': 'Basque Country',
  '49': 'Castile and León', '50': 'Aragon', '51': 'Ceuta', '52': 'Melilla',
};

function regionForPostalCode(cp) {
  const m = /^(\d{2})\d{3}$/.exec(String(cp ?? '').trim());
  return m ? REGION_BY_PROVINCE_CODE[m[1]] ?? null : null;
}

const stripTags = (s) => decodeEntities(String(s).replace(/<[^>]*>/g, '')).trim();

// "AMARILLAS" → "Amarillas", the label style of the existing Spanish tees.
function teeLabel(raw) {
  const s = String(raw).trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Vc/Vs arrive as "72.4" / "131", or "-" / "0" / "" when the tee is unrated.
function rated(v) {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Option text is "<RECORRIDO> - <TEE> (M|F) <emoji>".
function parseOptionText(text) {
  const m = /^(.*) - (.+?) \((M|F)\)/.exec(text);
  return m ? { recorrido: m[1].trim(), tee: m[2].trim(), sex: m[3] } : null;
}

// The 18 hole cells of a Par/Hdcp/Metros row, dropping the IDA/VUELTA/TOTAL
// sums. A nine-hole recorrido leaves cells 10-18 empty.
function holeCells(rowHtml) {
  const cells = [...rowHtml.matchAll(/<td(?![^>]*holes-table-col-(?:suma|label))[^>]*>([\s\S]*?)<\/td>/g)]
    .map((m) => stripTags(m[1]));
  return cells.slice(0, 18);
}

function parsePanel(html) {
  const row = (label) => {
    const m = new RegExp(`holes-table-col-label">${label}</td>([\\s\\S]*?)</tr>`).exec(html);
    return m ? holeCells(m[1]) : [];
  };
  const par = row('Par');
  const hcp = row('Hdcp');
  const metros = row('Metros');
  const n = par.slice(9).every((c) => c === '') ? 9 : 18;
  const holes = [];
  const yardages = {};
  for (let i = 0; i < n; i++) {
    const p = Number(par[i]);
    const si = Number(hcp[i]);
    holes.push({ number: i + 1, par: p, strokeIndex: si });
    const d = Number(metros[i]);
    if (Number.isFinite(d) && d > 0) yardages[i + 1] = d;
  }
  const vc = /Vc:\s*([^<]*)</.exec(html);
  const vs = /Vs:\s*([^<]*)</.exec(html);
  return { holes, yardages, rating: rated(vc && vc[1]), slope: rated(vs && vs[1]) };
}

// Split a club page into { name, postalCode, city, region, recorridos[] }. Each
// recorrido holds its holes (men's stroke index — women's tees carry their
// own, but the app keeps one per hole) and one tee per colour with the
// men's and women's rating pairs, longest tee first.
function parseClubPage(html) {
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  // Drop company suffixes: "Islantilla Golf Resort, S.l" → "Islantilla Golf Resort".
  const name = h1 ? stripTags(h1[1]).replace(/,?\s+S\.\s?[al]\.?$/i, '').trim() : null;
  // The contact block lists the postal code as a field of its own
  // ("… | 29660 | Malaga | …"). The map embed's title, when it reads
  // "…, 29660 Marbella, Málaga, España", also names the town.
  const loc = html.indexOf('Ubicación y Contacto');
  const fields = loc >= 0
    ? decodeEntities(html.slice(loc, loc + 20000).replace(/<[^>]*>/g, '|')).split('|').map((s) => s.trim())
    : [];
  const addr = /title="([^"]*\b\d{5} [^"]*)"/.exec(html);
  const cpCity = addr ? /\b(\d{5}) ([^,\d]+)/.exec(decodeEntities(addr[1])) : null;
  const postalCode = fields.find((f) => /^\d{5}$/.test(f)) ?? (cpCity ? cpCity[1] : null);
  const city = cpCity && cpCity[1] === postalCode ? cpCity[2].trim() : null;

  const panels = new Map();
  const panelRe = /id="(rcpanel_[\w]+)"([\s\S]*?)holes-table-footer">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = panelRe.exec(html)) !== null) panels.set(m[1], parsePanel(m[2] + m[3]));

  const byRecorrido = new Map();
  const optRe = /<option value="(rcpanel_[\w]+)">([\s\S]*?)<\/option>/g;
  while ((m = optRe.exec(html)) !== null) {
    const opt = parseOptionText(decodeEntities(m[2]));
    const panel = panels.get(m[1]);
    if (!opt || !panel) continue;
    if (!byRecorrido.has(opt.recorrido)) byRecorrido.set(opt.recorrido, { men: [], women: [] });
    byRecorrido.get(opt.recorrido)[opt.sex === 'M' ? 'men' : 'women'].push({ tee: opt.tee, ...panel });
  }

  const recorridos = [];
  for (const [recorrido, { men, women }] of byRecorrido) {
    const base = men[0] ?? women[0];
    const tees = new Map();
    for (const t of [...men, ...women]) {
      const key = teeLabel(t.tee);
      if (!tees.has(key)) {
        tees.set(key, { label: key, rating: null, slope: null, ratingWomen: null, slopeWomen: null, yardages: t.yardages });
      }
      const row = tees.get(key);
      if (men.includes(t)) Object.assign(row, { rating: t.rating, slope: t.slope, yardages: t.yardages });
      else Object.assign(row, { ratingWomen: t.rating, slopeWomen: t.slope });
    }
    const length = (t) => Object.values(t.yardages).reduce((a, b) => a + b, 0);
    recorridos.push({
      recorrido,
      holes: base.holes,
      tees: [...tees.values()].sort((a, b) => length(b) - length(a)),
    });
  }
  return { name, postalCode, city, region: regionForPostalCode(postalCode), recorridos };
}

// Temporary set-ups the federation rates alongside the real layouts:
// provisional routings while holes are closed ("PROV. H 12", "obras"),
// championship and competition set-ups, seasonal and alternative routings.
const TEMPORARY = /provisional|\bprov\b|\bH ?\d{1,2}\b|\bcto\b|campeonato|\bcopa\b|torneo|tour series|young masters|golf cup|\bebtc\b|puntuable|senior|verano|invierno|obras|alternativo|\b20\d\d\b/i;

// Why a recorrido should not become a library course, or null to keep it.
function skipReason(r) {
  if (TEMPORARY.test(r.recorrido)) return 'temporary or competition set-up';
  if (!r.holes.every((h) => Number.isInteger(h.par) && h.par >= 3 && h.par <= 6)) return 'incomplete par';
  const si = validateStrokeIndex(r.holes);
  if (!si.valid) return si.reason;
  if (!r.tees.some((t) => (t.rating && t.slope) || (t.ratingWomen && t.slopeWomen))) return 'no rated tee';
  return null;
}

// "HACIENDA ALAMO B + B" → "Hacienda Alamo B + B": capitalise all-caps
// words, leaving roman numerals and tokens like "A+A" or "P&P" alone.
function tidyCaps(s) {
  return s.replace(/\s+/g, ' ').split(' ').map((w) => (
    /^\p{Lu}{2,}$/u.test(w) && !/^[IVX]+$/.test(w) ? w.charAt(0) + w.slice(1).toLowerCase() : w
  )).join(' ');
}

// "ALOHA - P&P" → "P&P"; a recorrido without " - " keeps its full text.
function layoutShortName(recorrido) {
  const i = recorrido.lastIndexOf(' - ');
  return tidyCaps((i >= 0 ? recorrido.slice(i + 3) : recorrido).trim());
}

// Library course name — the club name alone for a one-layout club, else
// "Club — Layout", as the Madrid import names them.
function courseName(clubName, recorrido, layoutCount) {
  return layoutCount <= 1 ? clubName : `${clubName} — ${layoutShortName(recorrido)}`;
}

const STOP = new Set(['club', 'de', 'del', 'golf', 'real', 'the', 'resort', 'y', 'and', 'la', 'el',
  'los', 'las', 'campo', 'country', 'course', 'hotel', 'spa', 'sl', 'sa', 'cd', 'rcg', 'cg']);

// Distinctive words of a name, accent- and case-folded.
function nameTokens(s) {
  return new Set(String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));
}

// Equal, or one letter apart for longer words ("Perelada" / "Peralada").
function sameWord(a, b) {
  if (a === b) return true;
  if (a.length < 6 || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++d > 1) return false;
  return true;
}

const holesKey = (holes) => holes.map((h) => h.par).join('');
const siKey = (holes) => holes.map((h) => h.strokeIndex).join(',');

// Holes whose par differs, or Infinity when the hole counts differ.
function parDistance(a, b) {
  if (a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}
const swapNines = (pars) => (pars.length === 18 ? pars.slice(9) + pars.slice(0, 9) : pars);

// Find the library course a federation layout already is: identical par
// and stroke index on every hole, whatever the name; otherwise a course
// sharing a distinctive word with the federation club's name whose pars are
// the same, off by at most two holes, or the same nines swapped (older
// library rows carry stale scorecards). Ties go to the closest pars. Errs
// towards "already have it" — a missed layout is cheaper than a duplicate.
function findExisting(layout, clubName, existing) {
  const pars = holesKey(layout.holes);
  const si = siKey(layout.holes);
  const exact = existing.find((c) => c.pars === pars && c.si === si);
  if (exact) return exact;
  const words = [...nameTokens(clubName)];
  let best = null;
  let bestD = Infinity;
  for (const c of existing) {
    if (![...nameTokens(c.name)].some((w) => words.some((x) => sameWord(w, x)))) continue;
    const d = Math.min(parDistance(pars, c.pars), parDistance(swapNines(pars), c.pars));
    if (d <= 2 && d < bestD) { best = c; bestD = d; }
  }
  return best;
}

// Stable uuid from a string, so re-running the generator yields the same ids.
function stableUuid(key) {
  const h = crypto.createHash('sha1').update(`rfeg:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

module.exports = {
  regionForPostalCode, teeLabel, parseOptionText, parsePanel, parseClubPage,
  skipReason, layoutShortName, courseName, nameTokens, holesKey, siKey,
  findExisting, stableUuid,
};
