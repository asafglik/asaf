// Template repository: customers download the templates built for them, and
// runtime (render) servers keep themselves in sync with it.
//
// Central server  : bundleFor(customer), repoTemplate(template)
// Runtime server  : installBundle(bundle), syncFromRepo({ url, keys })
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import * as store from './storage.js';
import { sanitizeTemplate } from './sanitize.js';
import { uploadedFontsFor, installFont } from './fonts.js';

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

/** A template as the repository hands it out: linked to that customer only. */
export function repoTemplate(t, customerId) {
  return { ...t, customers: customerId ? [String(customerId)] : [] };
}

export function repoTemplatesOf(customerId) {
  return store.listTemplates().filter((t) => t.customers.includes(String(customerId)));
}

/** The repository listing: one row per template, with its version (updatedAt). */
export function repoListing(customerId) {
  return repoTemplatesOf(customerId).map((t) => ({
    id: t.id, name: t.name, description: t.description, pages: t.pages, languages: t.languages,
    placeholders: t.placeholders, format: t.format, updatedAt: t.updatedAt, version: t.updatedAt ? Date.parse(t.updatedAt) : 0,
  }));
}

/** Everything a runtime server needs for one customer, in one file. */
export function bundleFor(c) {
  const templates = repoTemplatesOf(c.id).map((t) => repoTemplate(store.getTemplate(t.id), c.id));
  return {
    kind: 'form-designer-bundle',
    version: 2,
    createdAt: new Date().toISOString(),
    // the key hash lets the runtime accept that customer's key (the key itself is never stored)
    customer: { id: c.id, name: c.name, code: c.code, apiKeyHash: c.apiKeyHash, apiKeyHint: c.apiKeyHint },
    templates,
    fonts: uploadedFontsFor(templates),
  };
}

// ---------------------------------------------------------------- runtime side
function stateFile() {
  return path.join(config.storageDir, 'repo-state.json');
}
export function readRepoState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return { customers: {} };
  }
}
function writeRepoState(st) {
  fs.mkdirSync(config.storageDir, { recursive: true });
  fs.writeFileSync(stateFile() + '.tmp', JSON.stringify(st, null, 2));
  fs.renameSync(stateFile() + '.tmp', stateFile());
}

/**
 * Install templates of one customer. Unchanged templates (same updatedAt) are
 * skipped; with prune, templates installed earlier for that customer and no
 * longer in the repository are removed.
 */
function installTemplates(customerId, templates, { prune = false } = {}) {
  const st = readRepoState();
  const prev = new Set(st.customers[customerId]?.templates || []);
  const now = [];
  const result = { installed: [], unchanged: [], removed: [], skipped: [] };
  for (const t of templates) {
    if (!store.validId(t.id)) { result.skipped.push(String(t.id)); continue; }
    const id = String(t.id);
    now.push(id);
    if (store.templateExists(id)) {
      const cur = store.getTemplate(id);
      // never overwrite a template that belongs to another customer on this server
      if ((cur.customers || []).length && !(cur.customers || []).includes(String(customerId))) { result.skipped.push(id); continue; }
      if (cur.updatedAt && cur.updatedAt === t.updatedAt) { result.unchanged.push(id); continue; }
    }
    store.saveTemplate(id, { ...sanitizeTemplate(t), customers: [String(customerId)], updatedAt: t.updatedAt }, { keepDates: true });
    result.installed.push(id);
  }
  if (prune) {
    for (const id of prev) {
      if (now.includes(id) || !store.templateExists(id)) continue;
      const cur = store.getTemplate(id);
      if ((cur.customers || []).length <= 1) { store.deleteTemplate(id); result.removed.push(id); }
    }
  }
  st.customers[customerId] = { ...(st.customers[customerId] || {}), templates: now, installedAt: new Date().toISOString() };
  writeRepoState(st);
  return result;
}

/** Install a bundle file (from the repository page or GET /api/repo/bundle). */
export function installBundle(bundle, { prune = false } = {}) {
  if (bundle?.kind !== 'form-designer-bundle') throw Object.assign(new Error('הקובץ אינו חבילת תבניות'), { status: 400 });
  let fonts = 0;
  for (const f of bundle.fonts || []) if (installFont(f)) fonts++;
  if (bundle.customer?.id) store.importCustomer(bundle.customer);
  const customerId = String(bundle.customer?.id || '');
  const result = customerId
    ? installTemplates(customerId, bundle.templates || [], { prune })
    : { installed: (bundle.templates || []).filter((t) => store.validId(t.id)).map((t) => { store.saveTemplate(String(t.id), sanitizeTemplate(t)); return String(t.id); }), unchanged: [], removed: [], skipped: [] };
  return { customer: bundle.customer ? { id: bundle.customer.id, name: bundle.customer.name } : null, fonts, ...result };
}

async function getJson(url, key) {
  const res = await fetch(url, { headers: { 'x-api-key': key, accept: 'application/json' }, signal: AbortSignal.timeout(120000) });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* not json */ }
    throw Object.assign(new Error(`${url}: ${msg}`), { status: res.status === 401 || res.status === 403 ? 502 : 502 });
  }
  return res.json();
}

let lastSync = null;
export function lastSyncStatus() {
  return lastSync;
}

/**
 * Pull the templates of each customer key from the central repository.
 * Only templates whose version changed are downloaded.
 */
export async function syncFromRepo({ url = config.repoUrl, keys = config.repoKeys } = {}) {
  const base = String(url || '').replace(/\/+$/, '');
  if (!base || !keys.length) throw Object.assign(new Error('לא הוגדר מאגר תבניות (FD_REPO_URL, FD_REPO_KEY)'), { status: 400 });
  const started = Date.now();
  const out = { ok: true, at: new Date().toISOString(), url: base, customers: [] };
  try {
    for (const key of keys) {
      const me = await getJson(`${base}/api/me`, key);
      if (!me.customer) throw new Error('המפתח אינו מפתח של לקוח');
      const c = me.customer;
      // the runtime accepts the same key it syncs with
      store.importCustomer({ id: c.id, name: c.name, code: c.code, apiKeyHash: sha256(key), apiKeyHint: key.slice(-4) });
      const list = await getJson(`${base}/api/repo/templates`, key);
      const templates = [];
      let fonts = 0;
      for (const row of list) {
        const id = String(row.id);
        if (store.validId(id) && store.templateExists(id) && store.getTemplate(id).updatedAt === row.updatedAt) {
          templates.push({ id, updatedAt: row.updatedAt }); // unchanged: installTemplates skips it
          continue;
        }
        const r = await getJson(`${base}/api/repo/templates/${encodeURIComponent(id)}?fonts=1`, key);
        for (const f of r.fonts || []) if (installFont(f)) fonts++;
        templates.push(r.template);
      }
      const res = installTemplates(String(c.id), templates, { prune: true });
      out.customers.push({ id: c.id, name: c.name, templates: list.length, fonts, ...res });
    }
  } catch (e) {
    out.ok = false;
    out.error = e.message;
  }
  out.ms = Date.now() - started;
  lastSync = out;
  return out;
}

/** Runtime servers: sync on start and every FD_REPO_SYNC_MINUTES. */
export function startRepoSync(log = console) {
  if (!config.repoUrl || !config.repoKeys.length) return null;
  const run = async () => {
    const r = await syncFromRepo();
    if (!r.ok) log.warn(`  repository sync failed: ${r.error}`);
    else {
      const changed = r.customers.reduce((n, c) => n + c.installed.length + c.removed.length, 0);
      if (changed) log.log(`  repository sync: ${r.customers.map((c) => `${c.name}: +${c.installed.length} -${c.removed.length}`).join(', ')}`);
    }
  };
  run();
  const t = setInterval(run, Math.max(1, config.repoSyncMinutes) * 60000);
  t.unref();
  return t;
}
