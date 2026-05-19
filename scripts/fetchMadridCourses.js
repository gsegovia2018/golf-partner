// One-shot: fetch every Madrid club/trazado from fedgolfmadrid.com into
// scripts/data/madrid-courses.json.  Usage:  node scripts/fetchMadridCourses.js
// Re-runnable — overwrites the JSON file. Node 26 provides global fetch.
const fs = require('fs');
const path = require('path');
const { CLUBS, parseTrazadoOptions, buildHoles } = require('./lib/madridCourses');

const BASE = 'https://fedgolfmadrid.com';
const OUT = path.join(__dirname, 'data', 'madrid-courses.json');
const HEADERS = { 'X-Requested-With': 'XMLHttpRequest' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getText(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}
async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// Fetch one trazado: its tees, per-hole par/hcp, per-tee distances + ratings.
async function fetchTrazado(trazadoId) {
  const barras = await getJson(`${BASE}/ajax/barras-trazado?trazado=${trazadoId}`);
  await sleep(250);
  if (!Array.isArray(barras) || barras.length === 0) return null;

  let parArr = null;
  let hcpArr = null;
  const tees = [];
  for (const barra of barras) {
    const datos = await getJson(
      `${BASE}/ajax/datos-trazado?barra=${barra.id}&trazado=${trazadoId}`);
    await sleep(250);
    const valores = await getJson(
      `${BASE}/ajax/trazadobarra-valores?barra=${barra.id}&trazado=${trazadoId}&hoyos=3`);
    await sleep(250);

    const data = datos.m || datos.f || {};
    if (!parArr) { parArr = data.par || []; hcpArr = data.hcp || []; }
    const metros = data.metros || [];
    const distances = {};
    metros.forEach((dist, i) => {
      if (typeof parArr[i] === 'number') distances[i + 1] = dist;
    });
    tees.push({
      barra: barra.id,
      name: barra.nombre,
      color: barra.color,
      distances,
      men: { rating: valores?.m?.campo ?? null, slope: valores?.m?.slope ?? null },
      women: { rating: valores?.f?.campo ?? null, slope: valores?.f?.slope ?? null },
    });
  }
  if (!parArr || parArr.length === 0) return null;

  const holes = buildHoles(parArr, hcpArr);
  // Longest tee first, so course_tees sort_order is meaningful after import.
  const total = (t) => Object.values(t.distances).reduce((a, b) => a + (Number(b) || 0), 0);
  tees.sort((a, b) => total(b) - total(a));
  return { holeCount: holes.length, holes, tees };
}

async function main() {
  const records = [];
  for (const club of CLUBS) {
    try {
      const html = await getText(`${BASE}${club.path}`);
      await sleep(250);
      const options = parseTrazadoOptions(html);
      console.log(`${club.code} ${club.name} — ${options.length} trazado(s)`);
      for (const opt of options) {
        try {
          const data = await fetchTrazado(opt.id);
          if (!data) { console.warn(`  ! ${opt.text} — no data, skipped`); continue; }
          records.push({
            clubCode: club.code,
            clubName: club.name,
            trazadoId: opt.id,
            trazadoName: opt.text,
            ...data,
          });
          console.log(`  ✓ ${opt.text} — ${data.holeCount} holes, ${data.tees.length} tees`);
        } catch (e) {
          console.warn(`  ! ${opt.text} — ${e.message}`);
        }
      }
    } catch (e) {
      console.warn(`! ${club.code} ${club.name} — ${e.message}`);
    }
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(records, null, 2));
  console.log(`\nWrote ${records.length} courses → ${OUT}`);
}

main().catch((e) => { console.error('\nFailed:', e.message ?? e); process.exit(1); });
