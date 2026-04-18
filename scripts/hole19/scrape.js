// Scraper: populate Supabase `courses` + `course_holes` from Hole19.
//
// Usage:
//   node scripts/hole19/scrape.js                 # Spain, full run
//   node scripts/hole19/scrape.js --dry-run       # preview only, no writes
//   node scripts/hole19/scrape.js --limit 20      # scrape first 20 courses
//   node scripts/hole19/scrape.js --country spain # override country slug
//   node scripts/hole19/scrape.js --update        # also overwrite existing courses
//                                                  (default: skip names that exist)
//
// Uses EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY from .env.
// Respects a 600ms delay between requests and retries transient failures once.
// Stores a resume checkpoint at scripts/hole19/.state.json.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const ARG = (flag) => process.argv.includes(flag);
const ARGV = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const DRY_RUN = ARG('--dry-run');
const UPDATE_EXISTING = ARG('--update');
const LIMIT = parseInt(ARGV('--limit', '0'), 10) || Infinity;
const COUNTRY = ARGV('--country', 'spain');
const DELAY_MS = parseInt(ARGV('--delay', '600'), 10);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const STATE_FILE = path.join(__dirname, '.state.json');

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}
const supabase = createClient(url, key);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpGet(url, attempt = 1) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    if (attempt < 3) {
      await sleep(DELAY_MS * attempt * 2);
      return httpGet(url, attempt + 1);
    }
    throw e;
  }
}

// Brace-balanced JSON extraction starting at the first '{' after anchor.
function extractJsonAfterAnchor(html, anchor) {
  const a = html.indexOf(anchor);
  if (a < 0) return null;
  let i = html.indexOf('{', a);
  if (i < 0) return null;
  const start = i;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === '\\') {
        esc = true;
        continue;
      }
      if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return html.slice(start, i + 1);
    }
  }
  return null;
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { processed: [] };
  }
}
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// Country index pages on Hole19 are infinite-scroll (rex API). Server-rendered HTML
// only shows ~10 courses per location page. Workaround: use the sitemap to enumerate
// every region/city page for the target country, then scrape each for slugs. Cities
// usually have ≤10 courses so inline listings cover them fully.
async function listLocationPagesFromSitemap() {
  const sitemapRoots = [1, 2, 3, 4].map(
    (n) => `https://www.hole19golf.com/sitemap-${n}.xml`,
  );
  const urls = [];
  for (const root of sitemapRoots) {
    try {
      const xml = await httpGet(root);
      const found = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
      urls.push(...found);
    } catch (e) {
      console.log(`  sitemap ${root} failed: ${e.message}`);
    }
    await sleep(DELAY_MS);
  }
  const prefix = `https://www.hole19golf.com/courses/countries/${COUNTRY}`;
  return urls.filter((u) => u.startsWith(prefix));
}

async function collectSlugs() {
  const slugs = new Set();
  const locationPages = await listLocationPagesFromSitemap();
  console.log(`  Found ${locationPages.length} location pages for country=${COUNTRY}`);

  for (let i = 0; i < locationPages.length; i++) {
    const u = locationPages[i];
    try {
      const html = await httpGet(u);
      const found = [...html.matchAll(/href="\/courses\/([a-z0-9-]+)"/g)].map((m) => m[1]);
      // Skip anchor/breadcrumb paths; keep leaf slugs only
      const uniq = [...new Set(found)];
      const fresh = uniq.filter((s) => !slugs.has(s));
      fresh.forEach((s) => slugs.add(s));
      const tag = u.replace('https://www.hole19golf.com/courses/countries/', '');
      process.stdout.write(`  [${i + 1}/${locationPages.length}] ${tag.padEnd(60).slice(0, 60)} +${fresh.length} (Σ${slugs.size})\n`);
    } catch (e) {
      console.log(`  ${u} failed: ${e.message}`);
    }
    if (slugs.size >= LIMIT) break;
    await sleep(DELAY_MS);
  }
  return [...slugs].slice(0, LIMIT);
}

function pickPrimaryTee(tees) {
  if (!tees?.length) return null;
  const males = tees.filter((t) => t.gender === 'male');
  const pool = males.length ? males : tees;
  // Longest distance = typically the championship/white tee
  return [...pool].sort((a, b) => (b.distance ?? 0) - (a.distance ?? 0))[0];
}

function parseCoursePayload(html) {
  const json = extractJsonAfterAnchor(html, 'data-component-name="CourseProfile"');
  if (!json) return null;
  let obj;
  try {
    obj = JSON.parse(json);
  } catch {
    return null;
  }
  const ci = obj.course_identity;
  if (!ci) return null;

  const primary = ci.courses?.[0];
  const tee = pickPrimaryTee(primary?.active_version?.tees);
  const sc = ci.default_course_scorecard?.scorecard ?? [];

  const holes = sc
    .map((h) => ({
      number: h.hole_index,
      par: h.par,
      strokeIndex: h.stroke_index,
    }))
    .filter((h) => h.number && h.par && h.strokeIndex)
    .sort((a, b) => a.number - b.number);

  // Hole19 sometimes reports 0 for missing slope/rating; treat as null.
  const nonZero = (v) => (typeof v === 'number' && v > 0 ? v : null);
  return {
    name: ci.name,
    city: ci.places_city?.name ?? null,
    province: ci.places_region?.name ?? null,
    slope: nonZero(tee?.slope_rating),
    rating: nonZero(tee?.course_rating),
    holes_count: ci.holes_count ?? null,
    par_total: tee?.par ?? null,
    hole_count_scorecard: holes.length,
    holes,
  };
}

function validate(course) {
  const problems = [];
  if (!course.name) problems.push('no name');
  if (course.hole_count_scorecard !== 18) problems.push(`scorecard has ${course.hole_count_scorecard} holes, not 18`);
  else {
    const sis = course.holes.map((h) => h.strokeIndex).sort((a, b) => a - b).join(',');
    const expected = Array.from({ length: 18 }, (_, i) => i + 1).join(',');
    if (sis !== expected) problems.push(`stroke indices not 1-18: [${sis}]`);
    const totalPar = course.holes.reduce((a, h) => a + h.par, 0);
    if (totalPar < 60 || totalPar > 80) problems.push(`unusual total par: ${totalPar}`);
  }
  return problems;
}

async function loadExistingCourseNames() {
  const { data, error } = await supabase.from('courses').select('id, name');
  if (error) throw error;
  return new Map(data.map((r) => [r.name, r.id]));
}

async function upsertCourse(course, existingByName) {
  const existingId = existingByName.get(course.name);
  if (existingId && !UPDATE_EXISTING) {
    return { action: 'skip-exists', id: existingId };
  }
  if (DRY_RUN) return { action: existingId ? 'would-update' : 'would-insert', id: existingId };

  let id = existingId;
  const payload = {
    name: course.name,
    slope: course.slope,
    rating: course.rating,
    city: course.city,
    province: course.province,
  };

  if (id) {
    const { error } = await supabase.from('courses').update(payload).eq('id', id);
    if (error) throw error;
  } else {
    const { data, error } = await supabase.from('courses').insert(payload).select().single();
    if (error) throw error;
    id = data.id;
    existingByName.set(course.name, id);
  }

  await supabase.from('course_holes').delete().eq('course_id', id);
  const rows = course.holes.map((h) => ({
    course_id: id,
    number: h.number,
    par: h.par,
    stroke_index: h.strokeIndex,
  }));
  const { error: hErr } = await supabase.from('course_holes').insert(rows);
  if (hErr) throw hErr;

  return { action: existingId ? 'updated' : 'inserted', id };
}

async function main() {
  console.log(
    `Hole19 scraper  country=${COUNTRY}  limit=${LIMIT === Infinity ? 'all' : LIMIT}  delay=${DELAY_MS}ms  ` +
      `dryRun=${DRY_RUN}  updateExisting=${UPDATE_EXISTING}`,
  );

  const state = loadState();
  const existingByName = await loadExistingCourseNames();
  console.log(`\nExisting courses in DB: ${existingByName.size}`);

  console.log('\n=== PHASE 1: collecting slugs from country index ===');
  const slugs = await collectSlugs();
  console.log(`\nCollected ${slugs.length} unique course slugs.`);

  console.log('\n=== PHASE 2: fetching detail pages ===');
  const summary = {
    inserted: 0,
    updated: 0,
    skippedExists: 0,
    wouldInsert: 0,
    wouldUpdate: 0,
    failedFetch: 0,
    failedParse: 0,
    failedValidation: 0,
    failedDb: 0,
  };
  const failures = [];

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    const prefix = `[${i + 1}/${slugs.length}] ${slug}`;
    if (state.processed.includes(slug) && !UPDATE_EXISTING) {
      console.log(`${prefix}  (checkpointed, skipping)`);
      continue;
    }
    let html;
    try {
      html = await httpGet(`https://www.hole19golf.com/courses/${slug}`);
    } catch (e) {
      console.log(`${prefix}  FETCH FAIL: ${e.message}`);
      summary.failedFetch++;
      failures.push({ slug, phase: 'fetch', error: e.message });
      await sleep(DELAY_MS);
      continue;
    }

    const course = parseCoursePayload(html);
    if (!course) {
      console.log(`${prefix}  PARSE FAIL`);
      summary.failedParse++;
      failures.push({ slug, phase: 'parse' });
      await sleep(DELAY_MS);
      continue;
    }
    const problems = validate(course);
    if (problems.length) {
      console.log(`${prefix}  ${course.name}  SKIP: ${problems.join('; ')}`);
      summary.failedValidation++;
      failures.push({ slug, phase: 'validate', name: course.name, problems });
      state.processed.push(slug);
      saveState(state);
      await sleep(DELAY_MS);
      continue;
    }

    try {
      const { action } = await upsertCourse(course, existingByName);
      const tag = {
        inserted: 'INSERT',
        updated: 'UPDATE',
        'skip-exists': 'SKIP (already exists — use --update to overwrite)',
        'would-insert': 'DRY INSERT',
        'would-update': 'DRY UPDATE',
      }[action];
      console.log(
        `${prefix}  ${course.name}  ${tag}  slope=${course.slope} rating=${course.rating} ` +
          `city=${course.city ?? '-'} prov=${course.province ?? '-'}`,
      );
      if (action === 'inserted') summary.inserted++;
      if (action === 'updated') summary.updated++;
      if (action === 'skip-exists') summary.skippedExists++;
      if (action === 'would-insert') summary.wouldInsert++;
      if (action === 'would-update') summary.wouldUpdate++;
    } catch (e) {
      console.log(`${prefix}  ${course.name}  DB FAIL: ${e.message}`);
      summary.failedDb++;
      failures.push({ slug, phase: 'db', name: course.name, error: e.message });
    }

    state.processed.push(slug);
    saveState(state);
    await sleep(DELAY_MS);
  }

  console.log('\n=== SUMMARY ===');
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(18)} ${v}`);
  if (failures.length) {
    console.log(`\n${failures.length} failures — first 10:`);
    failures.slice(0, 10).forEach((f) => console.log('  ', f));
    fs.writeFileSync(
      path.join(__dirname, '.failures.json'),
      JSON.stringify(failures, null, 2),
    );
    console.log(`Full failure list written to scripts/hole19/.failures.json`);
  }
}

main().catch((e) => {
  console.error('\nFatal:', e);
  process.exit(1);
});
