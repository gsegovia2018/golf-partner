#!/usr/bin/env node
// Prints the per-handicap strokes-gained baseline tables as the JS literal
// pasted into src/store/strokesGainedBaseline.js (BASELINES). Re-run after
// changing scripts/lib/sgBaselineModel.js; scripts/__tests__/sgBaselineModel.test.js
// fails if the committed literal drifts from the model.
//
//   node scripts/sgBaselineTables.mjs            # the BASELINES literal
//   node scripts/sgBaselineTables.mjs --report   # calibration report per anchor
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  HANDICAP_ANCHORS, buildTables, lookup, DRIVE_DISTANCE_ANCHORS, DRIVE_MIX_ANCHORS,
  PENALTIES_ANCHORS, SCORE_VS_PAR_ANCHORS,
} = require('./lib/sgBaselineModel.js');

const tables = buildTables();

if (process.argv.includes('--report')) {
  const Ex = (lie, h, d) => lookup(tables[lie].distances, tables[lie].byHandicap[h], d);
  const rows = HANDICAP_ANCHORS.map((h, i) => {
    const w = { fairway: DRIVE_MIX_ANCHORS.fairway[i], sand: DRIVE_MIX_ANCHORS.sand[i], recovery: DRIVE_MIX_ANCHORS.recovery[i] };
    w.rough = 1 - w.fairway - w.sand - w.recovery;
    const mix = (d) => Object.entries(w).reduce((s, [lie, p]) => s + p * Ex(lie, h, d), 0);
    const par3 = Ex('tee', h, 160);
    const par4 = 1 + mix(340 - DRIVE_DISTANCE_ANCHORS[i]);
    const par5 = 1 + mix(470 - DRIVE_DISTANCE_ANCHORS[i]);
    const visible = 4 * par3 + 10 * par4 + 4 * par5 - 72 + PENALTIES_ANCHORS[i];
    return {
      hcp: h,
      par3: +par3.toFixed(2), par4: +par4.toFixed(2), par5: +par5.toFixed(2),
      visibleVsPar: +visible.toFixed(1), typicalVsPar: SCORE_VS_PAR_ANCHORS[i],
      invisible: +(SCORE_VS_PAR_ANCHORS[i] - visible).toFixed(1),
      'fw 100 m': Ex('fairway', h, 100), 'fw 137 m': +Ex('fairway', h, 137.2).toFixed(2),
      'rough 91 m': +Ex('rough', h, 91.4).toFixed(2), 'greenside 20': Ex('greenside', h, 20),
      'sand 20': Ex('sand', h, 20), 'green 1.5': +Ex('green', h, 1.5).toFixed(2), 'green 4.5': +Ex('green', h, 4.5).toFixed(2),
    };
  });
  console.table(rows);
  process.exit(0);
}

const lines = ['export const BASELINES = {'];
Object.entries(tables).forEach(([lie, { distances, byHandicap }]) => {
  lines.push(`  ${lie}: {`);
  lines.push(`    distances: [${distances.join(', ')}],`);
  lines.push('    byHandicap: {');
  HANDICAP_ANCHORS.forEach((h) => {
    lines.push(`      ${h}: [${byHandicap[h].map((v) => v.toFixed(2)).join(', ')}],`);
  });
  lines.push('    },');
  lines.push('  },');
});
lines.push('};');
console.log(lines.join('\n'));
