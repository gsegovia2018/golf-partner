// Query the live DB via the Supabase Management API (no service key in repo,
// no writes — SELECT / information_schema only).
//
// `dotenv` is present in node_modules only as a transitive dependency (it is
// not listed in package.json), so we don't lean on `import 'dotenv/config'`.
// Instead, load `.env` at the repo root with a tiny inline parser.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../../.env');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip matching surrounding quotes, if any.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(envPath);

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
if (!url) {
  throw new Error('EXPO_PUBLIC_SUPABASE_URL is not set (checked .env and process.env)');
}
const ref = new URL(url).hostname.split('.')[0];

// The brief's naming assumed SUPABASE_MANAGEMENT_API_TOKEN, but the actual
// .env in this worktree stores the Management API PAT as
// SUPABASE_ACCESS_TOKEN (it's what the Supabase CLI reads too). Support both
// so this script works regardless of which name is present.
const token = process.env.SUPABASE_ACCESS_TOKEN ?? process.env.SUPABASE_MANAGEMENT_API_TOKEN;
if (!token) {
  throw new Error(
    'No Management API token found in .env (expected SUPABASE_ACCESS_TOKEN or SUPABASE_MANAGEMENT_API_TOKEN)'
  );
}

export async function dbQuery(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}
