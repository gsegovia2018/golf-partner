// One-shot: import scripts/data/waldkirch-courses.json into Supabase.
// Usage:  node scripts/importWaldkirchCourses.js [--dry-run]
// Reads EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (preferred —
// bypasses RLS to write the clubs/course_tees tables) from .env, falling back
// to EXPO_PUBLIC_SUPABASE_ANON_KEY. Mirrors importMadridCourses.js.
//
// Source data: Golfpark Waldkirch (Migros Golfparks, Waldkirch SG).
//   - per-hole par / stroke index / distances: the club's own layout pages
//     under migrosgolf.ch/de/golfparks/waldkirch/golfanlage
//   - per-tee course rating + slope (men and women): the club's official
//     "Rating März 2026" sheets, one PDF per layout
// Cross-checked against the printed 2026 scorecards (26_SK_Waldkirch_*.pdf).
//
// Waldkirch is four 9-hole loops (Blau, Gelb, Grün, Rot) that combine into
// eight separately rated 18-hole layouts. The club publishes each loop's own
// 1-9 stroke index; the 18-hole card numbers the front nine 2*si-1 (odd) and
// the back nine 2*si (even). That transform is already baked into the JSON —
// it reproduces the printed Schwarz card exactly.
// dotenv is not a declared dependency — load .env when it happens to be
// installed, otherwise fall back to whatever the shell exports.
try { require('dotenv').config(); } catch (_) { /* env comes from the shell */ }
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or a Supabase key in .env');
  process.exit(1);
}
const supabase = createClient(url, key);
const DRY_RUN = process.argv.includes('--dry-run');
const IN = path.join(__dirname, 'data', 'waldkirch-courses.json');

// Every hole must carry a unique SI from 1..N, or handicap/Stableford maths
// silently break on every round played on the course (see
// src/lib/courseLibrary.js#computeSiIssues).
function validate(course) {
  const n = course.holes.length;
  if (n !== course.holeCount) return `holeCount ${course.holeCount} but ${n} holes`;
  const sis = course.holes.map((h) => h.strokeIndex).sort((a, b) => a - b);
  if (!sis.every((si, i) => si === i + 1)) return `stroke indices must be 1..${n}`;
  const labels = course.tees.map((t) => t.label);
  if (new Set(labels).size !== labels.length) return 'duplicate tee labels';
  return null;
}

async function main() {
  const { club, courses } = JSON.parse(fs.readFileSync(IN, 'utf8'));
  console.log(`Importing ${courses.length} ${club.name} layouts${DRY_RUN ? ' (dry run)' : ''}\n`);

  const problems = courses
    .map((c) => [c.name, validate(c)])
    .filter(([, err]) => err);
  if (problems.length) {
    for (const [name, err] of problems) console.error(`  ✖ ${name}: ${err}`);
    throw new Error(`${problems.length} course(s) failed validation — nothing written`);
  }

  for (const c of courses) {
    const par = c.holes.reduce((sum, h) => sum + h.par, 0);
    console.log(`  ${c.layoutName.padEnd(11)} holes=${String(c.holeCount).padStart(2)} `
      + `par=${par} tees=${c.tees.map((t) => t.label).join(', ')}`);
  }
  if (DRY_RUN) {
    console.log('\nDry run — no writes performed.');
    return;
  }

  // Resolve the club by name (clubs.name is UNIQUE), creating it on first run.
  let clubId;
  const { data: existingClub, error: clubReadErr } = await supabase
    .from('clubs').select('id').eq('name', club.name).maybeSingle();
  if (clubReadErr) throw clubReadErr;
  if (existingClub) {
    clubId = existingClub.id;
  } else {
    const { data, error } = await supabase.from('clubs').insert(club).select().single();
    if (error) throw error;
    clubId = data.id;
    console.log(`\nCreated club "${club.name}"`);
  }

  const { data: known, error: courseReadErr } = await supabase
    .from('courses').select('id, name').eq('club_id', clubId);
  if (courseReadErr) throw courseReadErr;
  const idByName = new Map(known.map((c) => [c.name, c.id]));

  let inserted = 0;
  let updated = 0;
  for (const c of courses) {
    const row = {
      name: c.name, city: club.city, province: club.province,
      club_id: clubId, layout_name: c.layoutName,
    };
    let id = idByName.get(c.name);
    if (id) {
      const { error } = await supabase.from('courses').update(row).eq('id', id);
      if (error) throw error;
      updated++;
    } else {
      const { data, error } = await supabase.from('courses').insert(row).select().single();
      if (error) throw error;
      id = data.id;
      inserted++;
    }

    // Holes and tees are replaced wholesale so a re-run converges on the
    // JSON rather than accumulating stale rows.
    await supabase.from('course_holes').delete().eq('course_id', id);
    const { error: hErr } = await supabase.from('course_holes').insert(
      c.holes.map((h) => ({
        course_id: id, number: h.number, par: h.par, stroke_index: h.strokeIndex,
      })));
    if (hErr) throw hErr;

    await supabase.from('course_tees').delete().eq('course_id', id);
    const { error: tErr } = await supabase.from('course_tees').insert(
      c.tees.map((t, i) => ({
        course_id: id, label: t.label, rating: t.rating, slope: t.slope,
        rating_women: t.ratingWomen, slope_women: t.slopeWomen,
        sort_order: i, yardages: t.yardages,
      })));
    if (tErr) throw tErr;
  }

  console.log(`\nDone. ${inserted} courses inserted, ${updated} updated.`);
}

main().catch((e) => { console.error('\nFailed:', e.message ?? e); process.exit(1); });
