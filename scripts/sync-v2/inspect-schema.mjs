// Read-only recon: dump the live `tournaments` + `tournament_*` table
// columns (information_schema) and the RLS policies on `tournaments`
// (pg_policies), formatted as markdown. No DDL/writes — SELECT only.
import { dbQuery } from './db.mjs';

function mdTable(rows, columns) {
  if (rows.length === 0) return '_(no rows)_\n';
  const header = `| ${columns.join(' | ')} |`;
  const sep = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows
    .map((r) => `| ${columns.map((c) => String(r[c] ?? '').replace(/\|/g, '\\|')).join(' | ')} |`)
    .join('\n');
  return `${header}\n${sep}\n${body}\n`;
}

async function main() {
  const columnsSql = `
    select table_name, ordinal_position, column_name, data_type, udt_name,
           is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public'
      and (table_name = 'tournaments' or table_name like 'tournament\\_%')
    order by table_name, ordinal_position;
  `;
  const columns = await dbQuery(columnsSql);

  const policiesSql = `
    select policyname, permissive, roles, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public' and tablename = 'tournaments'
    order by policyname;
  `;
  const policies = await dbQuery(policiesSql);

  const tableNames = [...new Set(columns.map((r) => r.table_name))].sort();

  let out = '# Live schema: tournaments + tournament_* tables\n\n';
  out += `Queried ${new Date().toISOString()} via Supabase Management API (read-only).\n\n`;

  for (const t of tableNames) {
    const rows = columns.filter((r) => r.table_name === t);
    out += `## \`${t}\`\n\n`;
    out += mdTable(rows, [
      'ordinal_position',
      'column_name',
      'data_type',
      'udt_name',
      'is_nullable',
      'column_default',
    ]);
    out += '\n';
  }

  out += `## RLS policies on \`tournaments\`\n\n`;
  out += mdTable(policies, ['policyname', 'permissive', 'roles', 'cmd', 'qual', 'with_check']);
  out += '\n';

  console.log(out);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
