// Apply the sync-v2 normalized-schema migration to the LIVE database, then
// backfill every existing tournament into the new game_* tables.
//
// This WRITES to the live DB (DDL + backfill_game_tournament for every
// tournament row), so it refuses to run unless invoked with --yes. Task 14
// is the one that runs this deliberately, once, as part of the sync-v2
// rollout.
//
// Usage: node scripts/sync-v2/apply-migration.mjs --yes
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbQuery } from './db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.resolve(
  __dirname,
  '../../supabase/migrations/20260712000000_sync_v2_normalized.sql'
);

const ROW_COUNT_TABLES = [
  'tournaments',
  'game_players',
  'game_rounds',
  'game_scores',
  'game_shot_details',
  'game_round_notes',
];

async function main() {
  if (!process.argv.includes('--yes')) {
    console.error(
      'Refusing to run: this applies DDL and backfills every tournament on the ' +
        'LIVE database. Re-run with --yes to confirm.\n' +
        '  node scripts/sync-v2/apply-migration.mjs --yes'
    );
    process.exit(1);
  }

  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  console.log(`Applying ${path.basename(MIGRATION_PATH)} (${sql.length} bytes)...`);
  await dbQuery(sql);
  console.log('Migration applied.');

  // Backfill each tournament in its OWN statement so a single malformed
  // historical blob can't abort the whole batch. `SELECT backfill(id) FROM
  // tournaments` runs as one statement — one bad row (a blob shape the
  // function chokes on) rolls the entire SELECT back with no indication of
  // which id failed. Iterating per id isolates failures, reports each one,
  // and lets the rest complete. backfill_game_tournament is idempotent, so
  // re-running this script after fixing a bad blob only re-touches what
  // changed.
  const idRows = await dbQuery('SELECT id FROM public.tournaments ORDER BY created_at;');
  console.log(`Backfilling ${idRows.length} tournaments (one statement each)...`);

  const failures = [];
  let ok = 0;
  for (const { id } of idRows) {
    try {
      // Parameterless quoting: ids are client timestamp strings, but escape
      // defensively anyway (single-quote doubling) — dbQuery has no bind API.
      await dbQuery(`SELECT public.backfill_game_tournament('${String(id).replace(/'/g, "''")}');`);
      ok++;
    } catch (err) {
      failures.push({ id, error: err?.message ?? String(err) });
    }
  }
  console.log(`Backfilled ${ok}/${idRows.length} tournaments.`);

  if (failures.length > 0) {
    console.error(`\n${failures.length} tournament(s) FAILED to backfill:`);
    for (const f of failures) {
      console.error(`  ${f.id}: ${f.error}`);
    }
  }

  console.log('\nRow counts after backfill:');
  for (const table of ROW_COUNT_TABLES) {
    const rows = await dbQuery(`SELECT count(*) AS n FROM public.${table};`);
    console.log(`  ${table}: ${rows[0].n}`);
  }

  if (failures.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
