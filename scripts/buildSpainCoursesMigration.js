// One-shot: turn scripts/data/spain-courses.json into a SQL migration that
// adds the federation courses the library does not have yet.
// Usage:
//   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/buildSpainCoursesMigration.js <out.sql>
// Reads the live library (via the Management API, like applyMigration.mjs)
// to skip every layout that is already a course — see findExisting — and
// prints what it matched, skipped and added, for review before applying.
// Ids are derived from the federation slug + recorrido, so the output is
// stable across runs and the SQL is safe to apply twice.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  regionForPostalCode, skipReason, courseName, layoutShortName, findExisting, holesKey, siKey,
  nameTokens, sameWord, stableUuid, SAME_AS,
} = require('./lib/rfegCourses');

const OUT = process.argv[2];
if (!OUT) { console.error('Usage: node scripts/buildSpainCoursesMigration.js <out.sql>'); process.exit(1); }
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.EXPO_PUBLIC_SUPABASE_URL && new URL(process.env.EXPO_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
if (!token || !ref) { console.error('Need SUPABASE_ACCESS_TOKEN and EXPO_PUBLIC_SUPABASE_URL.'); process.exit(1); }

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`query failed ${res.status}: ${await res.text()}`);
  return res.json();
}

const REGIONS = new Set(Array.from({ length: 52 }, (_, i) => regionForPostalCode(`${String(i + 1).padStart(2, '0')}000`)));

const q = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (v == null ? 'NULL' : String(v));

async function main() {
  const clubs = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'spain-courses.json'), 'utf8'));
  const existing = await query(`
    SELECT c.id, c.name, c.club_id, c.province,
      string_agg(h.par::text, '' ORDER BY h.number) AS pars,
      string_agg(h.stroke_index::text, ',' ORDER BY h.number) AS si
    FROM public.courses c JOIN public.course_holes h ON h.course_id = c.id
    GROUP BY c.id, c.name, c.club_id, c.province`);
  const existingNames = new Set(existing.map((c) => c.name.toLowerCase()));
  const libraryClubs = await query('SELECT id, name FROM public.clubs');
  const clubIdByName = new Map(libraryClubs.map((c) => [c.name.toLowerCase(), c.id]));
  const clubNameById = new Map(libraryClubs.map((c) => [c.id, c.name]));

  const report = { matched: [], skipped: [], duplicate: [], nameClash: [], added: [] };
  const seen = new Map(); // pars|si → course name, across federation clubs
  const clubRows = [];
  const courseRows = [];
  const holeRows = [];
  const teeRows = [];

  for (const club of clubs) {
    if (!club.region) { report.skipped.push(`${club.name}: postal code ${club.postalCode ?? '—'} is not in Spain`); continue; }
    const keep = [];
    for (const r of club.recorridos) {
      const why = skipReason(r);
      if (why) report.skipped.push(`${club.name} / ${r.recorrido}: ${why}`);
      else keep.push(r);
    }
    const fresh = [];
    let siblingClubId = null;
    for (const r of keep) {
      const manual = SAME_AS[`${club.slug}:${r.recorrido}`];
      const hit = manual ? existing.find((c) => c.name === manual) : findExisting(r, club.name, existing);
      if (manual && !hit) throw new Error(`SAME_AS target not in the library: ${manual}`);
      if (hit) {
        report.matched.push(`${club.name} / ${r.recorrido} = ${hit.name}`);
        // Join a sibling's club only when it is in this club's region and is
        // named like this club — a stale match can have filed it elsewhere.
        const words = [...nameTokens(club.name)];
        const sameClub = hit.club_id
          && [...nameTokens(clubNameById.get(hit.club_id))].some((w) => words.some((x) => sameWord(w, x)));
        if (sameClub && (!REGIONS.has(hit.province) || hit.province === club.region)) {
          siblingClubId = siblingClubId ?? hit.club_id;
        }
        continue;
      }
      const key = `${holesKey(r.holes)}|${siKey(r.holes)}`;
      if (seen.has(key)) { report.duplicate.push(`${club.name} / ${r.recorrido} = ${seen.get(key)}`); continue; }
      seen.set(key, `${club.name} / ${r.recorrido}`);
      fresh.push(r);
    }
    if (!fresh.length) continue;

    // A multi-layout club groups its layouts: join the club a matched sibling
    // already belongs to, or a club of the same name, before creating one.
    let clubId = null;
    if (keep.length > 1) {
      clubId = siblingClubId ?? clubIdByName.get(club.name.toLowerCase()) ?? null;
      if (!clubId) {
        clubId = stableUuid(`club:${club.slug}`);
        clubIdByName.set(club.name.toLowerCase(), clubId);
        clubRows.push(`(${q(clubId)}, ${q(club.name)}, ${q(club.city)}, ${q(club.region)})`);
      }
    }
    for (const r of fresh) {
      const name = courseName(club.name, r.recorrido, keep.length);
      if (existingNames.has(name.toLowerCase())) { report.nameClash.push(`${name} (${club.slug})`); continue; }
      existingNames.add(name.toLowerCase());
      const id = stableUuid(`course:${club.slug}:${r.recorrido}`);
      courseRows.push(`(${q(id)}, ${q(name)}, ${q(club.city)}, ${q(club.region)}, ${q(clubId)}, ${q(keep.length > 1 ? layoutShortName(r.recorrido) : null)})`);
      for (const h of r.holes) holeRows.push(`(${q(id)}, ${h.number}, ${h.par}, ${h.strokeIndex})`);
      r.tees.forEach((t, i) => teeRows.push(
        `(${q(id)}, ${q(t.label)}, ${n(t.rating)}, ${n(t.slope)}, ${n(t.ratingWomen)}, ${n(t.slopeWomen)}, ${i}, ${q(JSON.stringify(t.yardages))})`));
      report.added.push(`${name} [${club.region}] ${r.holes.length} holes, ${r.tees.length} tees`);
    }
  }

  const sql = `-- Spanish courses from the Real Federación Española de Golf.
--
-- Generated by scripts/buildSpainCoursesMigration.js from
-- scripts/data/spain-courses.json (fetched with scripts/fetchSpainCourses.js
-- from rfegolf.es/club/<club>). Do not edit by hand — regenerate.
--
-- Adds every federation recorrido the library did not already have: holes
-- with the men's stroke index, and one tee per colour carrying the official
-- WHS rating/slope for men and women, longest tee first, metres per hole in
-- yardages. A layout already in the library (same par on every hole, and the
-- same stroke index or a shared name word) is left untouched.
--
-- Ids are stable, and every insert is guarded, so applying twice is a no-op.

INSERT INTO public.clubs (id, name, city, province) VALUES
  ${clubRows.join(',\n  ')}
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.courses (id, name, city, province, club_id, layout_name)
SELECT v.id::uuid, v.name, v.city, v.province, v.club_id::uuid, v.layout_name FROM (VALUES
  ${courseRows.join(',\n  ')}
) AS v(id, name, city, province, club_id, layout_name)
WHERE NOT EXISTS (SELECT 1 FROM public.courses c WHERE c.id = v.id::uuid OR lower(c.name) = lower(v.name));

INSERT INTO public.course_holes (course_id, number, par, stroke_index)
SELECT v.course_id::uuid, v.number, v.par, v.si FROM (VALUES
  ${holeRows.join(',\n  ')}
) AS v(course_id, number, par, si)
WHERE EXISTS (SELECT 1 FROM public.courses c WHERE c.id = v.course_id::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.course_holes h WHERE h.course_id = v.course_id::uuid AND h.number = v.number);

INSERT INTO public.course_tees (course_id, label, rating, slope, rating_women, slope_women, sort_order, yardages)
SELECT v.course_id::uuid, v.label, v.rating, v.slope, v.rating_women, v.slope_women, v.sort_order, v.yardages::jsonb FROM (VALUES
  ${teeRows.join(',\n  ')}
) AS v(course_id, label, rating, slope, rating_women, slope_women, sort_order, yardages)
WHERE EXISTS (SELECT 1 FROM public.courses c WHERE c.id = v.course_id::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.course_tees t WHERE t.course_id = v.course_id::uuid AND t.label = v.label);
`;
  fs.writeFileSync(OUT, sql);

  for (const [k, rows] of Object.entries(report)) {
    console.log(`\n## ${k} (${rows.length})`);
    for (const r of rows) console.log(`- ${r}`);
  }
  console.log(`\nWrote ${OUT}: ${clubRows.length} clubs, ${courseRows.length} courses, ${holeRows.length} holes, ${teeRows.length} tees.`);
}

main().catch((e) => { console.error('\nFailed:', e.message ?? e); process.exit(1); });
