// Seed GPS course geometry into the golf_* Supabase tables.
// Usage:
//   node scripts/seedCourseGeometry.mjs [--dry-run] [extra1.json extra2.json ...]
// Always seeds the bundled src/data/courseGeometry.json courses; any extra
// files are single nested course objects (e.g. extractor / geojson output).
// Idempotent: upserts the course row, replaces its child rows.
import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { flattenCourse } from '../src/lib/courseGeometryShape.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const DRY = process.argv.includes('--dry-run');
const extraFiles = process.argv.slice(2).filter((a) => a !== '--dry-run');

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!DRY && (!url || !key)) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}
const supabase = DRY ? null : createClient(url, key);

const bundled = JSON.parse(readFileSync(resolve(root, 'src/data/courseGeometry.json'), 'utf8')).courses;
const extras = extraFiles.map((f) => JSON.parse(readFileSync(resolve(process.cwd(), f), 'utf8')));
const courses = [...bundled, ...extras];

async function seedOne(course) {
  const { course: row, holes, hazards, greens } = flattenCourse(course);
  const label = `${row.id} (${row.mode}) — holes:${holes.length} hazards:${hazards.length} greens:${greens.length}`;
  if (DRY) { console.log('DRY', label); return; }

  const up = await supabase.from('golf_course').upsert(row);
  if (up.error) throw new Error(`golf_course ${row.id}: ${up.error.message}`);
  // Replace children (FK cascade only fires on course delete, which we avoid).
  for (const t of ['golf_hole', 'golf_hazard', 'golf_green']) {
    const del = await supabase.from(t).delete().eq('course_id', row.id);
    if (del.error) throw new Error(`${t} delete ${row.id}: ${del.error.message}`);
  }
  const ins = async (t, rows) => {
    if (!rows.length) return;
    const r = await supabase.from(t).insert(rows);
    if (r.error) throw new Error(`${t} insert ${row.id}: ${r.error.message}`);
  };
  await ins('golf_hole', holes);
  await ins('golf_hazard', hazards);
  await ins('golf_green', greens);
  console.log('OK  ', label);
}

for (const c of courses) await seedOne(c);
console.log(`\nDone: ${courses.length} course(s)${DRY ? ' (dry run)' : ''}.`);
