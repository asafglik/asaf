#!/usr/bin/env node
// Install a customer's template bundle on a (render) server:
//   node cli/import-bundle.js bundle-customer-3.json [--storage <dir>] [--prune]
// --prune removes templates installed earlier for that customer that are no longer in the bundle.
import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
const si = process.argv.indexOf('--storage');
if (si > 0) process.env.FD_STORAGE = path.resolve(process.argv[si + 1]);
if (!file) {
  console.log('Usage: import-bundle <bundle.json> [--storage <dir>] [--prune]');
  process.exit(1);
}
const { installBundle } = await import('../server/repo.js');
try {
  const r = installBundle(JSON.parse(fs.readFileSync(file, 'utf8')), { prune: process.argv.includes('--prune') });
  for (const id of r.installed) console.log(`installed template ${id}`);
  for (const id of r.removed) console.log(`removed template ${id}`);
  for (const id of r.skipped) console.warn(`skipped template ${id}`);
  if (r.customer) console.log(`customer ${r.customer.name} (${r.customer.id})`);
  console.log(`done: ${r.installed.length} installed, ${r.unchanged.length} unchanged, ${r.removed.length} removed, ${r.fonts} font(s)`);
} catch (e) {
  console.error('error: ' + e.message);
  process.exit(1);
}
