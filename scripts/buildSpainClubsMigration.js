// One-shot: group every Spanish club's layouts under one club row, so the
// course picker shows "Club · N layouts" instead of loose sibling courses.
// Usage:
//   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/buildSpainClubsMigration.js <out.sql>
// Reads scripts/data/spain-courses.json and the live library. For each
// federation club it finds the library course of every recorrido — the row
// the import created (stable id), a reviewed SAME_AS match, or a findExisting
// match that also shares a word with the club's name — and when a club has
// two or more, puts them all in one club with a layout name. Prints what it
// grouped and what it skipped, for review before applying.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  regionForPostalCode, skipReason, layoutShortName, findExisting, nameTokens, sameWord, stableUuid, SAME_AS,
} = require('./lib/rfegCourses');

const OUT = process.argv[2];
if (!OUT) { console.error('Usage: node scripts/buildSpainClubsMigration.js <out.sql>'); process.exit(1); }
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

async function main() {
  const clubs = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'spain-courses.json'), 'utf8'));
  const library = await query(`
    SELECT c.id, c.name, c.club_id, c.layout_name, c.province,
      string_agg(h.par::text, '' ORDER BY h.number) AS pars,
      string_agg(h.stroke_index::text, ',' ORDER BY h.number) AS si
    FROM public.courses c JOIN public.course_holes h ON h.course_id = c.id
    GROUP BY c.id, c.name, c.club_id, c.layout_name, c.province`);
  const byId = new Map(library.map((c) => [c.id, c]));
  const clubIdByName = new Map((await query('SELECT id, name FROM public.clubs'))
    .map((c) => [c.name.toLowerCase(), c.id]));

  const claimed = new Map(); // course id → federation club that grouped it
  const report = { grouped: [], conflict: [] };
  const clubRows = [];
  const updates = [];

  for (const club of clubs) {
    if (!club.region) continue;
    const words = [...nameTokens(club.name)];
    const members = new Map(); // course id → layout name
    for (const r of club.recorridos) {
      if (skipReason(r)) continue;
      const manual = SAME_AS[`${club.slug}:${r.recorrido}`];
      let hit = byId.get(stableUuid(`course:${club.slug}:${r.recorrido}`))
        ?? (manual ? library.find((c) => c.name === manual) : null);
      if (!hit) {
        const found = findExisting(r, club.name, library);
        const named = found && [...nameTokens(found.name)].some((w) => words.some((x) => sameWord(w, x)));
        hit = named ? found : null;
      }
      // Never pull a course from another region into this club (a few old
      // rows store a province such as "Málaga" rather than the region).
      if (hit && REGIONS.has(hit.province) && hit.province !== club.region) hit = null;
      if (hit && !members.has(hit.id)) members.set(hit.id, layoutShortName(r.recorrido));
    }
    if (members.size < 2) continue;

    const taken = [...members.keys()].filter((id) => claimed.has(id) && claimed.get(id) !== club.slug);
    if (taken.length) {
      report.conflict.push(`${club.name}: ${taken.map((id) => byId.get(id).name).join(', ')} already grouped under ${claimed.get(taken[0])}`);
      continue;
    }
    const existingClubs = [...new Set([...members.keys()].map((id) => byId.get(id).club_id).filter(Boolean))];
    if (existingClubs.length > 1) {
      report.conflict.push(`${club.name}: layouts already split across ${existingClubs.length} clubs`);
      continue;
    }
    let clubId = existingClubs[0] ?? clubIdByName.get(club.name.toLowerCase());
    if (!clubId) {
      clubId = stableUuid(`club:${club.slug}`);
      clubIdByName.set(club.name.toLowerCase(), clubId);
      clubRows.push(`(${q(clubId)}, ${q(club.name)}, ${q(club.city)}, ${q(club.region)})`);
    }
    const changed = [];
    for (const [id, layout] of members) {
      claimed.set(id, club.slug);
      const c = byId.get(id);
      if (c.club_id === clubId && c.layout_name) continue;
      updates.push(`(${q(id)}, ${q(clubId)}, ${q(layout)})`);
      changed.push(`${c.name} → ${c.layout_name || layout}`);
    }
    if (changed.length) report.grouped.push(`${club.name} (${members.size} layouts): ${changed.join('; ')}`);
  }

  const sql = `-- Group each Spanish club's layouts under one club.
--
-- Generated by scripts/buildSpainClubsMigration.js from
-- scripts/data/spain-courses.json and the library. Do not edit by hand.
--
-- The course picker shows a club with two or more layouts as one row and
-- lets the round pick the layout (layout_name). Courses seeded before the
-- federation import carried no club, so a club's layouts sat side by side.
-- Each federation club's courses now share a club; a course keeps any
-- layout_name it already had. Course names and ids do not change.

${clubRows.length ? `INSERT INTO public.clubs (id, name, city, province) VALUES
  ${clubRows.join(',\n  ')}
ON CONFLICT (id) DO NOTHING;
` : ''}
UPDATE public.courses c
   SET club_id = v.club_id::uuid,
       layout_name = COALESCE(c.layout_name, v.layout_name)
  FROM (VALUES
  ${updates.join(',\n  ')}
) AS v(id, club_id, layout_name)
 WHERE c.id = v.id::uuid
   AND EXISTS (SELECT 1 FROM public.clubs k WHERE k.id = v.club_id::uuid);
`;
  fs.writeFileSync(OUT, sql);
  for (const [k, rows] of Object.entries(report)) {
    console.log(`\n## ${k} (${rows.length})`);
    for (const r of rows) console.log(`- ${r}`);
  }
  console.log(`\nWrote ${OUT}: ${clubRows.length} new clubs, ${updates.length} courses grouped.`);
}

main().catch((e) => { console.error('\nFailed:', e.message ?? e); process.exit(1); });
