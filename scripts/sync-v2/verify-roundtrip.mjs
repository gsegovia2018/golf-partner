// Round-trip check against the LIVE database: for every non-official
// tournament with a non-empty blob, compare the legacy `data` column against
// get_game_tournament(id)'s reassembled output (normalized per
// normalize.mjs — spec Amendment 6). Read-only: two SELECTs, no writes.
//
// Usage: node scripts/sync-v2/verify-roundtrip.mjs
// Exit code: 0 if every tournament round-trips, 1 if any FAIL.
import { dbQuery } from './db.mjs';
import { normalize } from './normalize.mjs';

function asObj(v) {
  if (v == null) return v;
  return typeof v === 'string' ? JSON.parse(v) : v;
}

// Minimal recursive diff — good enough to point at the first mismatching
// path without pulling in a dependency; deep-equal itself is done key by key
// so an object-shape difference (extra/missing key) is reported precisely.
function diff(a, b, path = '$') {
  if (a === b) return null;
  if (typeof a !== typeof b) {
    return `${path}: type mismatch (${JSON.stringify(a)} vs ${JSON.stringify(b)})`;
  }
  if (a === null || b === null) {
    return a === b ? null : `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${path}: array/non-array mismatch`;
    if (a.length !== b.length) return `${path}: length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = diff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (typeof a === 'object') {
    const ak = Object.keys(a).sort();
    const bk = Object.keys(b).sort();
    if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) {
      return `${path}: key sets differ [${ak.join(', ')}] vs [${bk.join(', ')}]`;
    }
    for (const k of ak) {
      const d = diff(a[k], b[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
}

async function main() {
  const rows = await dbQuery(`
    SELECT id, data, public.get_game_tournament(id) AS assembled
    FROM public.tournaments
    WHERE (kind IS DISTINCT FROM 'official')
      AND data IS NOT NULL
      AND data <> '{}'::jsonb
    ORDER BY id;
  `);

  let failCount = 0;
  for (const row of rows) {
    const legacy = normalize(asObj(row.data));
    const assembled = normalize(asObj(row.assembled));
    const d = diff(legacy, assembled);
    if (d) {
      failCount++;
      console.log(`FAIL ${row.id}: ${d}`);
    } else {
      console.log(`PASS ${row.id}`);
    }
  }

  console.log(`\n${rows.length - failCount}/${rows.length} tournaments round-trip cleanly.`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
