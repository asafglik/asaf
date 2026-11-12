#!/usr/bin/env node
// Install a customer's template bundle on a (render) server:
//   node cli/import-bundle.js bundle-customer-3.json [--storage <dir>]
import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
const si = process.argv.indexOf('--storage');
if (si > 0) process.env.FD_STORAGE = path.resolve(process.argv[si + 1]);
if (!file) {
  console.log('Usage: import-bundle <bundle.json> [--storage <dir>]');
  process.exit(1);
}
const { saveTemplate, validId, importCustomer } = await import('../server/storage.js');
const { sanitizeTemplate } = await import('../server/sanitize.js');
const bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
if (bundle.kind !== 'form-designer-bundle') {
  console.error('error: not a form designer bundle');
  process.exit(1);
}
for (const t of bundle.templates || []) {
  if (!validId(t.id)) { console.warn(`skipped template with invalid id "${t.id}"`); continue; }
  saveTemplate(t.id, sanitizeTemplate(t));
  console.log(`installed template ${t.id} - ${t.name || ''}`);
}
if (bundle.customer?.id) {
  importCustomer(bundle.customer);
  console.log(`customer ${bundle.customer.name}${bundle.customer.apiKeyHash ? ' (API key installed)' : ''}`);
}
console.log(`done: ${bundle.templates?.length || 0} template(s) for customer ${bundle.customer?.name || ''}`);
