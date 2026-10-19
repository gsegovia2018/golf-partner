// EXPERIMENTAL, READ-ONLY — evaluate stop detection on a recorded GPS trail.
//
// Usage:
//   node scripts/analyzeGpsTrail.mjs <round_id> [--tournament <id>] [--user <uuid>]
//
// Round ids are only unique per tournament ("r0", "r1", ...), so pass
// --tournament when the round id matches more than one recorded trail.
//
// Loads the trail (golf_gps_trail, recorded with the "Record GPS trail (test)"
// setting), detects stops — stationary ≥ 15 s within 6 m, stops < 10 m and
// < 30 s apart merged — maps them to holes via the course geometry when there
// is one, and prints per hole: the stops, the inferred drive and approach
// distances, and what was logged (strokes, shot-detail buckets, GPS-marked
// shots). Service-role key from .env; never writes.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { assembleCourses } from '../src/lib/courseGeometryShape.js';
import {
  cleanTrail, detectStops, mergeStops, assignStopsToHoles, inferHoleDistances, holeRefs, haversine,
} from '../src/lib/gpsTrailStops.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const roundId = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!roundId) {
  console.error('Usage: node scripts/analyzeGpsTrail.mjs <round_id> [--tournament <id>] [--user <uuid>]');
  process.exit(1);
}
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data ?? [];
};
const m = (v) => (v == null ? '—' : `${Math.round(v)} m`);
const time = (ms) => new Date(ms).toISOString().slice(11, 19);

// ---- Trail ------------------------------------------------------------------
let q = db.from('golf_gps_trail').select('user_id,tournament_id,round_id,round_index,seq,points').eq('round_id', roundId);
if (flag('--tournament')) q = q.eq('tournament_id', flag('--tournament'));
if (flag('--user')) q = q.eq('user_id', flag('--user'));
const rows = must(await q.order('seq'), 'golf_gps_trail');
const groups = new Map();
for (const r of rows) {
  const g = `${r.user_id}|${r.tournament_id}|${r.round_index}`;
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push(r);
}
if (groups.size === 0) {
  console.error(`No trail recorded for round ${roundId}.`);
  process.exit(1);
}
if (groups.size > 1) {
  console.error(`Round id ${roundId} matches ${groups.size} trails — pass --tournament (and --user):`);
  for (const g of groups.keys()) {
    const [u, t, ri] = g.split('|');
    console.error(`  --tournament ${t} --user ${u}   (round_index ${ri})`);
  }
  process.exit(1);
}
const trailRows = [...groups.values()][0];
const { user_id: userId, tournament_id: tournamentId, round_index: roundIndex } = trailRows[0];
const raw = trailRows.flatMap((r) => r.points ?? []);
const points = cleanTrail(raw);
const stops = mergeStops(detectStops(points));

console.log('EXPERIMENTAL — GPS trail stop detection (read-only)');
console.log(`tournament ${tournamentId} · round ${roundId} (index ${roundIndex}) · user ${userId}`);
if (!points.length) {
  console.log(`${raw.length} points, none usable.`);
  process.exit(0);
}
const spanMin = (points[points.length - 1].t - points[0].t) / 60000;
console.log(`${raw.length} points (${points.length} usable, acc ≤ 25 m) over ${spanMin.toFixed(0)} min, ${time(points[0].t)}–${time(points[points.length - 1].t)} UTC`);
console.log(`${stops.length} stops\n`);

// ---- Round, player, logged data --------------------------------------------
const [round] = must(await db.from('game_rounds').select('body').eq('tournament_id', tournamentId).eq('id', roundId), 'game_rounds');
const body = round?.body ?? {};
const parOf = new Map((body.holes ?? []).map((h) => [h.number, h.par]));
const [player] = must(await db.from('game_players').select('player_id').eq('tournament_id', tournamentId).eq('user_id', userId), 'game_players');
const playerId = player?.player_id ?? null;
const strokes = new Map();
const details = new Map();
if (playerId) {
  must(await db.from('game_scores').select('hole,strokes').eq('tournament_id', tournamentId).eq('round_id', roundId).eq('player_id', playerId), 'game_scores')
    .forEach((r) => strokes.set(r.hole, r.strokes));
  must(await db.from('game_shot_details').select('hole,detail').eq('tournament_id', tournamentId).eq('round_id', roundId).eq('player_id', playerId), 'game_shot_details')
    .forEach((r) => details.set(r.hole, r.detail ?? {}));
}
// golf_shot has no tournament_id, so keep only shots marked while the trail ran.
const from = new Date(points[0].t - 3600000).toISOString();
const to = new Date(points[points.length - 1].t + 3600000).toISOString();
const marked = new Map();
must(await db.from('golf_shot').select('hole_number,seq,lat,lng,club,created_at')
  .eq('user_id', userId).eq('round_id', roundId).eq('round_index', roundIndex)
  .gte('created_at', from).lte('created_at', to).order('seq'), 'golf_shot')
  .forEach((s) => {
    if (!marked.has(s.hole_number)) marked.set(s.hole_number, []);
    marked.get(s.hole_number).push(s);
  });
console.log(`course: ${body.courseName ?? '?'} · player ${playerId ?? '(not found)'}`);

// ---- Course geometry ---------------------------------------------------------
// Same matching as src/lib/geo.js findCourseGeometry (most specific token group).
const normalizeText = (v) => (v ?? '').toString().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
async function loadGeometry(courseName) {
  const n = normalizeText(courseName);
  if (!n) return null;
  const courses = must(await db.from('golf_course').select('id,name,mode,match_tokens,source'), 'golf_course');
  let best = null;
  let score = 0;
  for (const c of courses) {
    for (const tokens of c.match_tokens ?? []) {
      if (tokens.every((t) => n.includes(t)) && tokens.length > score) { best = c; score = tokens.length; }
    }
  }
  if (!best || best.mode !== 'holes') return null;
  const holes = must(await db.from('golf_hole').select('*').eq('course_id', best.id), 'golf_hole');
  return assembleCourses({ courses: [best], holes })[0];
}
const geometry = await loadGeometry(body.courseName);

if (!geometry) {
  console.log('no hole geometry for this course — stops in time order:\n');
  stops.forEach((s, i) => {
    const prev = stops[i - 1];
    const leg = prev ? haversine([prev.lat, prev.lng], [s.lat, s.lng]) : null;
    console.log(`  ${time(s.start)}  ${Math.round((s.end - s.start) / 1000)} s  [${s.lat.toFixed(6)}, ${s.lng.toFixed(6)}]  from previous ${m(leg)}`);
  });
  process.exit(0);
}
console.log(`geometry: ${geometry.key}\n`);

const { byHole, unassigned } = assignStopsToHoles(stops, geometry.holes);
for (const hole of geometry.holes) {
  const par = parOf.get(hole.number) ?? hole.par;
  const holeStops = byHole.get(hole.number) ?? [];
  const shots = marked.get(hole.number) ?? [];
  const d = details.get(hole.number) ?? {};
  if (!holeStops.length && !shots.length && strokes.get(hole.number) == null) continue;
  const refs = holeRefs(hole);
  const inferred = inferHoleDistances(holeStops, hole, par);
  const logged = inferHoleDistances(shots, hole, par);
  console.log(`Hole ${hole.number} (par ${par ?? '?'}) — strokes ${strokes.get(hole.number) ?? '—'}, ${holeStops.length} stops, ${shots.length} GPS-marked shots`);
  holeStops.forEach((s) => {
    const p = [s.lat, s.lng];
    console.log(`    ${time(s.start)}  ${String(Math.round((s.end - s.start) / 1000)).padStart(4)} s  tee ${m(haversine(p, refs.tee)).padStart(6)}  green ${m(haversine(p, refs.green)).padStart(6)}`);
  });
  console.log(`  drive:    inferred ${m(inferred.drive)} · marked ${m(logged.drive)} · logged bucket ${d.driveDistBucket ?? '—'}${d.teeClub ? ` (${d.teeClub})` : ''}`);
  console.log(`  approach: inferred ${m(inferred.approach)} · marked ${m(logged.approach)} · logged bucket ${d.approachBucket ?? '—'}\n`);
}
if (unassigned.length) console.log(`${unassigned.length} stops away from every hole (clubhouse, paths, between holes).`);
