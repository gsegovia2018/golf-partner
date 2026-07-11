// Read-only recon + fixture export: pull the 12 most recent non-empty
// tournament blobs from the live DB (SELECT only, no writes) and write out
// four real fixtures for the sync-v2 rewrite to round-trip/test against:
//   1. a finished multi-round tournament
//   2. one whose rounds include shotDetails/notes
//   3. the live weekend tournament (most recent non-official, 3 rounds — this
//      weekend's trip)
//   4. a single-round game
//
// Each fixture file is the raw `data` jsonb blob of one tournament, written
// to src/store/__tests__/fixtures/syncV2/fixture-<id>.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbQuery } from './db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../../src/store/__tests__/fixtures/syncV2');

function hasShotDetailsOrNotes(blob) {
  const rounds = Array.isArray(blob?.rounds) ? blob.rounds : [];
  return rounds.some((r) => {
    if (r?.notes) return true;
    const scores = r?.scores && typeof r.scores === 'object' ? Object.values(r.scores) : [];
    return scores.some((perPlayer) => {
      if (!perPlayer || typeof perPlayer !== 'object') return false;
      return Object.values(perPlayer).some(
        (cell) => cell && typeof cell === 'object' && cell.shotDetails
      );
    });
  });
}

// Mirrors isTournamentFinished() in src/store/tournamentStore.js: a
// tournament is finished when explicitly archived (finishedAt set) or every
// round has every player scored on every hole.
function isFinished(blob) {
  if (blob?.finishedAt) return true;
  const rounds = Array.isArray(blob?.rounds) ? blob.rounds : [];
  const players = Array.isArray(blob?.players) ? blob.players : [];
  if (rounds.length === 0 || players.length === 0) return false;
  return rounds.every((r) => {
    const holes = Array.isArray(r?.holes) ? r.holes : [];
    if (holes.length === 0 || !r?.scores) return false;
    return players.every((p) => {
      const perPlayer = r.scores[p.id];
      if (!perPlayer) return false;
      return holes.every((h) => perPlayer[h.number] != null);
    });
  });
}

function roundCount(blob) {
  return Array.isArray(blob?.rounds) ? blob.rounds.length : 0;
}

async function main() {
  // Brief's base query uses LIMIT 12, but the 12 most recent rows contain no
  // finished multi-round tournament (the current weekend trip and its QA
  // clone are both still in progress). Widened to 60 so all four selection
  // criteria have a real candidate; see sync-v2-schema-facts.md for detail.
  const rows = await dbQuery(`
    SELECT id, name, kind, data
    FROM tournaments
    WHERE data IS NOT NULL AND data != '{}'::jsonb
    ORDER BY created_at DESC
    LIMIT 60;
  `);

  console.log(`Fetched ${rows.length} candidate tournament rows.\n`);
  for (const r of rows) {
    const blob = r.data;
    console.log(
      `- id=${r.id} kind=${r.kind} name="${r.name}" rounds=${roundCount(blob)} ` +
        `finished=${isFinished(blob)} shotDetails/notes=${hasShotDetailsOrNotes(blob)}`
    );
  }
  console.log('');

  // Selection criteria, applied over the fetched candidates:
  const nonOfficial = rows.filter((r) => r.kind !== 'official');

  // Dev/QA seed data pollutes this table (names like "QA Duel Rand", player
  // names prefixed "qa-"). Exclude it so "the live weekend tournament" picks
  // the real friend group's trip, not a test fixture that happens to also
  // have 3 rounds.
  const looksLikeQaSeed = (r) => {
    if (/\bqa\b/i.test(r.name)) return true;
    const players = Array.isArray(r.data?.players) ? r.data.players : [];
    return players.some((p) => /^qa-|^verify-/i.test(p?.name ?? ''));
  };

  // 1. The live weekend tournament: most recently created non-official,
  //    non-QA tournament whose blob has exactly 3 rounds (this weekend's
  //    trip). `rows` is already ordered by created_at DESC, so the first
  //    match wins.
  const liveWeekend = nonOfficial.find(
    (r) => roundCount(r.data) === 3 && !looksLikeQaSeed(r)
  );

  // 2. A finished multi-round tournament (not the live weekend one).
  const finishedMultiRound = rows.find(
    (r) => r !== liveWeekend && isFinished(r.data) && roundCount(r.data) > 1
  );

  // 3. One with shotDetails/notes on a round (not already picked).
  const withShotDetailsOrNotes = rows.find(
    (r) => r !== liveWeekend && r !== finishedMultiRound && hasShotDetailsOrNotes(r.data)
  );

  // 4. A single-round game (not already picked).
  const singleRound = rows.find(
    (r) =>
      r !== liveWeekend &&
      r !== finishedMultiRound &&
      r !== withShotDetailsOrNotes &&
      roundCount(r.data) === 1
  );

  const picks = [
    ['finished multi-round', finishedMultiRound],
    ['shotDetails/notes', withShotDetailsOrNotes],
    ['live weekend (3 rounds, most recent non-official)', liveWeekend],
    ['single-round game', singleRound],
  ];

  const missing = picks.filter(([, r]) => !r);
  if (missing.length > 0) {
    console.error(
      `Could not find candidates for: ${missing.map(([label]) => label).join(', ')}. ` +
        `Inspect the candidate list above and adjust selection.`
    );
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const [label, row] of picks) {
    const outPath = path.join(OUT_DIR, `fixture-${row.id}.json`);
    const json = JSON.stringify(row.data, null, 2);

    // Step 4 sanity check: parses, has rounds[]/players[].
    const parsed = JSON.parse(json);
    console.assert(Array.isArray(parsed.rounds), `fixture-${row.id}: expected rounds[] array`);
    console.assert(Array.isArray(parsed.players), `fixture-${row.id}: expected players[] array`);
    if (!Array.isArray(parsed.rounds) || !Array.isArray(parsed.players)) {
      throw new Error(`fixture-${row.id}.json failed sanity check (rounds[]/players[])`);
    }

    fs.writeFileSync(outPath, json + '\n');
    console.log(`Wrote ${outPath}  <-  ${label} (id=${row.id}, name="${row.name}")`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
