// One-shot: fetch every club page on rfegolf.es into
// scripts/data/spain-courses.json (parsed — club, address, recorridos with
// holes and rated tees). Usage:
//   node scripts/fetchSpainCourses.js [--cache <dir>]
// --cache reads <dir>/<slug>.html when present and saves fetched pages there.
// Re-runnable — overwrites the JSON file. Clubs with no recorrido (schools,
// associations, indoor clubs) are left out.
const fs = require('fs');
const path = require('path');
const { parseClubPage } = require('./lib/rfegCourses');

const SITEMAP = 'https://rfegolf.es/club-sitemap.xml';
const OUT = path.join(__dirname, 'data', 'spain-courses.json');
const cacheArg = process.argv.indexOf('--cache');
const CACHE = cacheArg > 0 ? process.argv[cacheArg + 1] : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function clubPage(url) {
  const slug = url.split('/').pop();
  const file = CACHE && path.join(CACHE, `${slug}.html`);
  if (file && fs.existsSync(file) && fs.statSync(file).size > 20000) return fs.readFileSync(file, 'utf8');
  const html = await getText(url);
  if (file) fs.writeFileSync(file, html);
  await sleep(700);
  return html;
}

async function main() {
  const urls = [...(await getText(SITEMAP)).matchAll(/<loc>(https:\/\/rfegolf\.es\/club\/[^<]+)<\/loc>/g)]
    .map((m) => m[1]);
  console.log(`${urls.length} club pages`);
  const clubs = [];
  for (const url of urls) {
    const slug = url.split('/').pop();
    try {
      const club = parseClubPage(await clubPage(url));
      if (club.recorridos.length) clubs.push({ slug, ...club });
    } catch (e) {
      console.warn(`! ${slug}: ${e.message}`);
    }
  }
  clubs.sort((a, b) => a.slug.localeCompare(b.slug));
  // One club per line: compact, and a re-fetch diffs club by club.
  fs.writeFileSync(OUT, `[\n${clubs.map((c) => JSON.stringify(c)).join(',\n')}\n]\n`);
  const layouts = clubs.reduce((n, c) => n + c.recorridos.length, 0);
  console.log(`Wrote ${clubs.length} clubs, ${layouts} recorridos → ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => { console.error('\nFailed:', e.message ?? e); process.exit(1); });
