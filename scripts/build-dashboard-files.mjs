#!/usr/bin/env node
// Builds copy-paste files for setup WITHOUT the Supabase CLI (browser only):
//   supabase/setup.sql                       — all migrations in order, for Dashboard → SQL Editor
//   supabase/dashboard-functions/<name>.ts   — each Edge Function as ONE self-contained file
//                                              for Dashboard → Edge Functions → Via Editor
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../supabase/', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

// 1) setup.sql
const migrations = readdirSync(new URL('migrations/', root)).filter((f) => f.endsWith('.sql')).sort();
const sql = [
  '-- TAPTIM — полная установка базы одним файлом.',
  '-- Supabase Dashboard → SQL Editor → New query → вставить ВЕСЬ файл → Run.',
  '-- Запускать ОДИН раз на пустом проекте. Сгенерировано из supabase/migrations.',
  '',
  ...migrations.map((f) => `-- ════════ ${f} ════════\n${read(`migrations/${f}`)}`),
].join('\n');
writeFileSync(new URL('setup.sql', root), sql);

// 2) single-file Edge Functions
const strip = (src) =>
  src
    .split('\n')
    .filter((l) => !/^import .* from '\.\.\/_shared\/.*';$/.test(l) && !/^import \{[^}]*\} from '\.\.\/_shared/.test(l))
    .join('\n');
const shared = (name) =>
  read(`functions/_shared/${name}`)
    .replace(/^import .*npm:@supabase\/supabase-js@2.*$/m, '')
    .replace(/^export /gm, '');

mkdirSync(new URL('dashboard-functions/', root), { recursive: true });
const header =
  "// AUTO-GENERATED single-file version for the Supabase Dashboard editor (scripts/build-dashboard-files.mjs).\n" +
  "import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';\n";
for (const fn of ['photos', 'delete-account', 'cleanup-photos']) {
  const main = strip(read(`functions/${fn}/index.ts`));
  const parts = [header, shared('http.ts')];
  if (fn === 'photos') parts.push(shared('image.ts'));
  parts.push(main);
  writeFileSync(new URL(`dashboard-functions/${fn}.ts`, root), parts.join('\n'));
}
console.log(`setup.sql: ${migrations.length} migrations; dashboard-functions: 3 files`);
