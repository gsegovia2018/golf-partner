// One-shot: import scripts/data/madrid-courses.json into Supabase.
// Usage:  node scripts/importMadridCourses.js [--dry-run]
// Reads EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY from .env.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const {
  deriveCourseName, deriveLayoutName, validateStrokeIndex, buildTeeRows,
} = require('./lib/madridCourses');

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}
const supabase = createClient(url, key);
const DRY_RUN = process.argv.includes('--dry-run');
const IN = path.join(__dirname, 'data', 'madrid-courses.json');

async function main() {
  const records = JSON.parse(fs.readFileSync(IN, 'utf8'));
  console.log(`Importing ${records.length} courses${DRY_RUN ? ' (dry run)' : ''}\n`);

  // How many trazados each club has — drives single-vs-multi course naming.
  const trazadoCount = {};
  for (const r of records) {
    trazadoCount[r.clubCode] = (trazadoCount[r.clubCode] || 0) + 1;
  }

  const courseByName = new Map();
  const clubByName = new Map();
  if (!DRY_RUN) {
    const { data: courses, error: cErr } = await supabase.from('courses').select('id, name');
    if (cErr) throw cErr;
    for (const c of courses) courseByName.set(c.name, c.id);
    const { data: clubs, error: clErr } = await supabase.from('clubs').select('id, name');
    if (clErr) throw clErr;
    for (const c of clubs) clubByName.set(c.name, c.id);
  }

  // Resolve a club row by name, creating it on first sight.
  async function ensureClub(clubName) {
    if (clubByName.has(clubName)) return clubByName.get(clubName);
    const { data, error } = await supabase
      .from('clubs').insert({ name: clubName, province: 'Madrid' }).select().single();
    if (error) throw error;
    clubByName.set(clubName, data.id);
    return data.id;
  }

  const flagged = [];
  let inserted = 0;
  let enriched = 0;
  let teesWritten = 0;
  let clubsCreated = 0;

  for (const r of records) {
    const name = deriveCourseName(r.clubName, r.trazadoName, trazadoCount[r.clubCode]);
    const layoutName = deriveLayoutName(r.trazadoName);

    const check = validateStrokeIndex(r.holes);
    if (!check.valid) flagged.push(`${name}: ${check.reason}`);

    // Flatten tees → course_tees rows. JSON tees are already longest-first,
    // so the running index is a meaningful sort_order.
    const teeRows = [];
    for (const t of r.tees) {
      for (const row of buildTeeRows(
        { id: t.barra, nombre: t.name }, t.distances, t.men, t.women)) {
        teeRows.push(row);
      }
    }

    const totalPar = r.holes.reduce((a, h) => a + h.par, 0);
    const mark = courseByName.has(name) ? '↻' : '+';
    console.log(
      `${mark} ${name.padEnd(46)} layout="${layoutName}" holes=${r.holeCount} ` +
      `par=${totalPar} tees=${teeRows.length}${check.valid ? '' : '  ⚠ SI INVALID'}`);

    if (DRY_RUN) continue;

    const hadClub = clubByName.has(r.clubName);
    const clubId = await ensureClub(r.clubName);
    if (!hadClub) clubsCreated++;

    const courseRow = { name, province: 'Madrid', club_id: clubId, layout_name: layoutName };
    let id = courseByName.get(name);
    if (id) {
      const { error } = await supabase.from('courses').update(courseRow).eq('id', id);
      if (error) throw error;
      enriched++;
    } else {
      const { data, error } = await supabase
        .from('courses').insert(courseRow).select().single();
      if (error) throw error;
      id = data.id;
      courseByName.set(name, id);
      inserted++;
    }

    await supabase.from('course_holes').delete().eq('course_id', id);
    const { error: hErr } = await supabase.from('course_holes').insert(
      r.holes.map((h) => ({
        course_id: id, number: h.number, par: h.par, stroke_index: h.strokeIndex,
      })));
    if (hErr) throw hErr;

    await supabase.from('course_tees').delete().eq('course_id', id);
    if (teeRows.length) {
      const { error: tErr } = await supabase.from('course_tees').insert(
        teeRows.map((row, i) => ({
          course_id: id, label: row.label, rating: row.rating, slope: row.slope,
          sort_order: i, yardages: row.yardages,
        })));
      if (tErr) throw tErr;
      teesWritten += teeRows.length;
    }
  }

  console.log(
    `\n${DRY_RUN
      ? 'Dry run — no writes performed.'
      : `Done. ${clubsCreated} clubs created, ${inserted} courses inserted, ` +
        `${enriched} enriched, ${teesWritten} tee rows.`}`);
  if (flagged.length) {
    console.log(`\n⚠ ${flagged.length} course(s) need manual stroke-index fixing:`);
    for (const f of flagged) console.log(`  - ${f}`);
  }
}

main().catch((e) => { console.error('\nFailed:', e.message ?? e); process.exit(1); });
