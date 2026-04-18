// One-shot script to seed 10 Marbella courses into Supabase.
// Usage:  node scripts/seedMarbellaCourses.js [--dry-run]
// Reads EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY from .env

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}
const supabase = createClient(url, key);
const DRY_RUN = process.argv.includes('--dry-run');

const h = (pars, sis) =>
  pars.map((par, i) => ({ number: i + 1, par, strokeIndex: sis[i] }));

const COURSES = [
  {
    name: 'Finca Cortesín',
    slope: 137,
    holes: h(
      [4, 3, 5, 4, 5, 3, 4, 5, 4, 3, 5, 3, 4, 4, 4, 4, 3, 5],
      [9, 7, 3, 15, 11, 13, 1, 5, 17, 10, 2, 6, 16, 14, 4, 12, 18, 8],
    ),
  },
  {
    name: 'Real Club de Golf Las Brisas',
    slope: 149,
    holes: h(
      [4, 4, 4, 3, 5, 4, 3, 5, 4, 4, 3, 5, 4, 4, 5, 3, 4, 4],
      [11, 1, 7, 13, 9, 3, 17, 5, 15, 6, 14, 12, 8, 2, 16, 18, 4, 10],
    ),
  },
  {
    name: 'La Quinta Golf (A+B)',
    slope: null,
    holes: h(
      [5, 4, 4, 3, 4, 3, 4, 3, 5, 4, 3, 4, 4, 4, 5, 3, 4, 4],
      [5, 3, 9, 17, 1, 13, 15, 11, 7, 12, 18, 2, 10, 6, 8, 16, 4, 14],
    ),
  },
  {
    name: 'Los Naranjos Golf Club',
    slope: 139,
    holes: h(
      [4, 5, 4, 3, 5, 4, 4, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5],
      [14, 4, 12, 10, 6, 2, 18, 16, 8, 3, 11, 15, 13, 1, 9, 7, 17, 5],
    ),
  },
  {
    name: 'Santa Clara Golf Marbella',
    slope: 129,
    holes: h(
      [4, 3, 4, 4, 4, 3, 4, 5, 4, 5, 4, 4, 3, 5, 3, 4, 4, 4],
      [14, 12, 18, 8, 10, 6, 4, 2, 16, 3, 11, 5, 9, 1, 15, 17, 7, 13],
    ),
  },
  {
    name: 'Cabopino Golf Marbella',
    slope: 130,
    holes: h(
      [4, 4, 4, 4, 4, 4, 3, 4, 4, 4, 4, 5, 3, 5, 3, 4, 4, 4],
      [11, 12, 13, 9, 1, 10, 15, 6, 3, 7, 2, 5, 18, 4, 17, 14, 16, 8],
    ),
  },
  {
    name: 'Marbella Club Golf Resort',
    slope: 123,
    holes: h(
      [4, 3, 4, 3, 4, 5, 5, 5, 3, 4, 4, 3, 5, 4, 3, 4, 4, 5],
      [10, 17, 1, 14, 8, 3, 15, 11, 6, 7, 2, 18, 9, 13, 16, 4, 5, 12],
    ),
  },
  {
    name: 'Río Real Golf',
    slope: 139,
    holes: h(
      [4, 4, 3, 4, 4, 3, 5, 4, 5, 4, 4, 3, 5, 3, 4, 5, 4, 4],
      [15, 11, 18, 4, 6, 13, 2, 7, 9, 8, 12, 14, 3, 16, 5, 1, 17, 10],
    ),
  },
  {
    name: 'Aloha Golf Club',
    slope: 132,
    holes: h(
      [5, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 4, 4, 5, 3, 4],
      [4, 14, 18, 6, 10, 2, 12, 16, 8, 1, 9, 5, 13, 7, 15, 11, 17, 3],
    ),
  },
  {
    name: 'Guadalmina Sur',
    slope: 136,
    holes: h(
      [4, 3, 4, 4, 4, 5, 5, 4, 3, 4, 3, 4, 4, 3, 4, 5, 5, 4],
      [13, 7, 15, 1, 11, 5, 17, 3, 9, 2, 10, 12, 4, 16, 14, 6, 18, 8],
    ),
  },
];

function validate(course) {
  const pars = course.holes.map((x) => x.par);
  const sis = course.holes.map((x) => x.strokeIndex);
  const totalPar = pars.reduce((a, b) => a + b, 0);
  const sisSorted = [...sis].sort((a, b) => a - b).join(',');
  const expected = Array.from({ length: 18 }, (_, i) => i + 1).join(',');
  if (sisSorted !== expected) {
    throw new Error(`${course.name}: stroke indices must be 1-18 exactly, got [${sisSorted}]`);
  }
  return totalPar;
}

async function main() {
  console.log(`Seeding ${COURSES.length} Marbella courses${DRY_RUN ? ' (dry run)' : ''}\n`);

  for (const c of COURSES) {
    const totalPar = validate(c);
    console.log(`• ${c.name.padEnd(36)} par=${totalPar} slope=${c.slope ?? 'null'}`);
  }

  if (DRY_RUN) {
    console.log('\nDry run — no writes performed.');
    return;
  }

  const { data: existing, error: listErr } = await supabase
    .from('courses')
    .select('id, name');
  if (listErr) throw listErr;
  const byName = new Map(existing.map((r) => [r.name, r.id]));

  for (const c of COURSES) {
    let id = byName.get(c.name);
    if (id) {
      console.log(`\n↻ ${c.name} already exists (${id}) — updating slope + holes`);
      const { error } = await supabase
        .from('courses')
        .update({ slope: c.slope })
        .eq('id', id);
      if (error) throw error;
    } else {
      const { data, error } = await supabase
        .from('courses')
        .insert({ name: c.name, slope: c.slope })
        .select()
        .single();
      if (error) throw error;
      id = data.id;
      console.log(`\n+ ${c.name} inserted (${id})`);
    }

    await supabase.from('course_holes').delete().eq('course_id', id);
    const rows = c.holes.map((h) => ({
      course_id: id,
      number: h.number,
      par: h.par,
      stroke_index: h.strokeIndex,
    }));
    const { error: insErr } = await supabase.from('course_holes').insert(rows);
    if (insErr) throw insErr;
    console.log(`  ↳ ${rows.length} holes saved`);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('\nFailed:', err.message ?? err);
  process.exit(1);
});
