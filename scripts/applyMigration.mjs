// Apply a SQL migration to the linked Supabase project via the Management API
// (POST /v1/projects/{ref}/database/query — runs arbitrary SQL, DDL included).
// Needs ONLY a personal access token; no DB password. The token is read from
// the SUPABASE_ACCESS_TOKEN env var and never printed.
//
// Usage:
//   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/applyMigration.mjs supabase/migrations/20260722000000_golf_shot.sql
//
// The project ref is derived from EXPO_PUBLIC_SUPABASE_URL in .env, so this
// always targets the same project the app talks to.
import 'dotenv/config';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/applyMigration.mjs <migration.sql>'); process.exit(1); }

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error('Set SUPABASE_ACCESS_TOKEN (a sbp_… personal access token).'); process.exit(1); }

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ref = url && new URL(url).hostname.split('.')[0];
if (!ref) { console.error('Could not derive project ref from EXPO_PUBLIC_SUPABASE_URL.'); process.exit(1); }

const query = readFileSync(resolve(process.cwd(), file), 'utf8');

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
});

const text = await res.text();
if (!res.ok) { console.error(`FAILED ${res.status}: ${text}`); process.exit(1); }
console.log(`Applied ${file} to project ${ref}.`);
console.log(text || '(no rows returned — expected for DDL)');
