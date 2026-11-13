#!/usr/bin/env node
// Pull this runtime's templates from the central repository once:
//   node cli/sync.js --repo https://forms.example.com --key <customer API key> [--storage <dir>]
// (or FD_REPO_URL / FD_REPO_KEY). A render server with these settings also syncs by itself.
import path from 'node:path';

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
if (arg('--storage')) process.env.FD_STORAGE = path.resolve(arg('--storage'));
if (arg('--repo')) process.env.FD_REPO_URL = arg('--repo');
if (arg('--key')) process.env.FD_REPO_KEY = arg('--key');
const { syncFromRepo } = await import('../server/repo.js');
const r = await syncFromRepo();
if (!r.ok) {
  console.error('sync failed: ' + r.error);
  process.exit(1);
}
for (const c of r.customers) {
  console.log(`${c.name} (${c.id}): ${c.templates} template(s) - ${c.installed.length} installed, ${c.unchanged.length} unchanged, ${c.removed.length} removed, ${c.fonts} font(s)`);
}
console.log(`done in ${r.ms} ms`);
