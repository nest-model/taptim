#!/usr/bin/env node
// Fails the build if anything secret-looking ended up in the browser bundle (dist/).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../dist/', import.meta.url).pathname;
const patterns = [
  [/sb_secret_[A-Za-z0-9_-]+/, 'Supabase secret key'],
  [/SERVICE_ROLE_KEY/, 'service role env name'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
];
const jwtRe = /eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]+/g;

let bad = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|html|css|json|map|txt)$/.test(name)) {
      const text = readFileSync(p, 'utf8');
      for (const [re, label] of patterns) if (re.test(text)) (bad++, console.error(`✗ ${label} in ${p}`));
      for (const m of text.matchAll(jwtRe)) {
        try {
          const payload = JSON.parse(Buffer.from(m[1], 'base64url').toString());
          if (payload.role === 'service_role') (bad++, console.error(`✗ service_role JWT in ${p}`));
        } catch {
          /* not a JWT */
        }
      }
    }
  }
}
walk(root);
if (bad) process.exit(1);
console.log('✓ no secrets found in dist/');
