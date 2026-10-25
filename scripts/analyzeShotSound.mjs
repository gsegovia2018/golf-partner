// EXPERIMENTAL, READ-ONLY — tune the shot listener on exported rounds.
//
// Usage:
//   node scripts/analyzeShotSound.mjs <shot-sound-*.zip | round.json> [...more]
//
// Reads the "Export shot sound data" zip (Settings; store/shotSoundExport) or
// round.json files out of it. My answer to each detected stop (Add → status
// 'added', Not a shot → 'dismissed') is the label. Prints, over all rounds:
//   - level × answer: how many stops of each sound level I added or dismissed;
//   - the strikes near added vs dismissed stops (peak, rise, centroid, motion);
//   - a sweep of the "own swing" gyroscope threshold: precision / recall of
//     'shot' against my answers.
// Clips stay in the zip; listen to them with any audio player.
import { readFileSync } from 'node:fs';
import {
  soundIndex, soundLevel, STRIKE_BEFORE_MS, STRIKE_AFTER_MS, OWN_GYRO_MIN, OWN_ACC_MIN,
} from '../src/store/shotSound.js';

const paths = process.argv.slice(2);
if (!paths.length) {
  console.error('Usage: node scripts/analyzeShotSound.mjs <shot-sound-*.zip | round.json> [...]');
  process.exit(1);
}

// round.json bodies from a stored (uncompressed) zip, as store/shotSoundExport writes.
function roundsFromZip(buf) {
  const out = [];
  let at = 0;
  while (at + 30 <= buf.length && buf.readUInt32LE(at) === 0x04034b50) {
    const method = buf.readUInt16LE(at + 8);
    const size = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const extraLen = buf.readUInt16LE(at + 28);
    const name = buf.toString('utf8', at + 30, at + 30 + nameLen);
    const start = at + 30 + nameLen + extraLen;
    if (method !== 0) throw new Error(`${name}: compressed entries are not supported`);
    if (name.endsWith('/round.json')) out.push(JSON.parse(buf.toString('utf8', start, start + size)));
    at = start + size;
  }
  return out;
}

const rounds = paths.flatMap((p) => {
  const buf = readFileSync(p);
  return p.endsWith('.zip') ? roundsFromZip(buf) : [JSON.parse(buf.toString('utf8'))];
});
console.log(`${rounds.length} round(s): ${rounds.map((r) => r.session).join(', ')}\n`);

const LEVELS = ['shot', 'heard', 'quiet', null];
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');
const median = (xs) => {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};
const fmt = (x, d = 1) => (x == null ? '—' : x.toFixed(d));

// Every answered stop with its strikes, per round.
const answered = [];
for (const r of rounds) {
  const idx = soundIndex(r.events);
  for (const s of r.stops ?? []) {
    if (s.status !== 'added' && s.status !== 'dismissed') continue;
    const near = idx.strikes.filter((e) => e.t >= s.start - STRIKE_BEFORE_MS && e.t <= s.end + STRIKE_AFTER_MS);
    answered.push({ ...s, level: soundLevel(s, idx), near, idx });
  }
}
const added = answered.filter((s) => s.status === 'added');
const dismissed = answered.filter((s) => s.status === 'dismissed');

console.log('Level × answer');
console.log('level   added  dismissed  share added');
for (const lv of LEVELS) {
  const a = added.filter((s) => s.level === lv).length;
  const d = dismissed.filter((s) => s.level === lv).length;
  console.log(`${String(lv).padEnd(7)} ${String(a).padStart(5)}  ${String(d).padStart(9)}  ${pct(a, a + d).padStart(11)}`);
}

console.log('\nStrikes near added vs dismissed stops (medians)');
console.log('                 n   peakDb  riseMs  decayMs  centroidHz  gyroPeak  accPeak');
for (const [label, list] of [['added', added], ['dismissed', dismissed]]) {
  const st = list.flatMap((s) => s.near);
  const m = (k) => median(st.map((e) => e[k]));
  console.log(`${label.padEnd(10)} ${String(st.length).padStart(7)}  ${fmt(m('peakDb')).padStart(6)}  ${fmt(m('riseMs')).padStart(6)}  ${fmt(m('decayMs')).padStart(7)}  ${fmt(m('centroidHz'), 0).padStart(10)}  ${fmt(m('gyroPeak')).padStart(8)}  ${fmt(m('accPeak')).padStart(7)}`);
}

console.log(`\nOwn-swing threshold sweep (now: gyro ≥ ${OWN_GYRO_MIN} rad/s or acc ≥ ${OWN_ACC_MIN} m/s²)`);
console.log('gyro ≥   shot&added  shot&dismissed  precision  recall');
for (const g of [1, 2, 3, 4, 5, 6, 8]) {
  const isShot = (s) => s.near.some((e) => (e.gyroPeak ?? 0) >= g || (e.accPeak ?? 0) >= OWN_ACC_MIN);
  const tp = added.filter(isShot).length;
  const fp = dismissed.filter(isShot).length;
  console.log(`${String(g).padStart(6)}   ${String(tp).padStart(10)}  ${String(fp).padStart(14)}  ${pct(tp, tp + fp).padStart(9)}  ${pct(tp, added.length).padStart(6)}`);
}

const swings = rounds.flatMap((r) => (r.events ?? []).filter((e) => e.type === 'swing'));
const strikes = rounds.flatMap((r) => (r.events ?? []).filter((e) => e.type === 'strike'));
console.log(`\n${strikes.length} strikes, ${swings.length} swings logged; ${answered.length} stops answered (${added.length} added, ${dismissed.length} dismissed).`);
