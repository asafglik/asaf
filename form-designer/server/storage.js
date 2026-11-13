// Templates are stored as one JSON file per template number:
//   storage/templates/<id>.json
// A template file is self-contained (images and the source PDF are embedded),
// so deploying a template to a client server is copying that one file.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function dir() {
  const d = path.join(config.storageDir, 'templates');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function validId(id) {
  return ID_RE.test(String(id));
}

function fileOf(id) {
  if (!validId(id)) throw Object.assign(new Error('מספר תבנית לא תקין'), { status: 400 });
  return path.join(dir(), `${id}.json`);
}

export function listTemplates() {
  return fs
    .readdirSync(dir())
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const t = JSON.parse(fs.readFileSync(path.join(dir(), f), 'utf8'));
        return {
          id: String(t.id ?? f.replace(/\.json$/, '')),
          name: t.name || '',
          description: t.description || '',
          pages: (t.pages || []).length,
          updatedAt: t.updatedAt || null,
          createdAt: t.createdAt || null,
          customers: t.customers || [],
          format: t.schema?.format || null,
          placeholders: countPlaceholders(t),
          hasSource: !!t.sourcePdf,
          languages: [t.defaultLanguage || 'he', ...(t.languages || []).filter((l) => l !== (t.defaultLanguage || 'he'))],
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}

function countPlaceholders(t) {
  let c = 0;
  const scan = (els) => (els || []).forEach((e) => { if (e.type === 'signature' || e.type === 'upload') c++; });
  (t.pages || []).forEach((p) => scan(p.elements));
  scan(t.header?.elements);
  scan(t.footer?.elements);
  return c;
}

const memCache = new Map(); // id -> { mtimeMs, template }

export function getTemplate(id) {
  const f = fileOf(id);
  let st;
  try {
    st = fs.statSync(f);
  } catch {
    throw Object.assign(new Error(`תבנית ${id} לא נמצאה`), { status: 404 });
  }
  const c = memCache.get(id);
  if (c && c.mtimeMs === st.mtimeMs) return c.template;
  const template = JSON.parse(fs.readFileSync(f, 'utf8'));
  memCache.set(id, { mtimeMs: st.mtimeMs, template });
  return template;
}

export function templateExists(id) {
  return validId(id) && fs.existsSync(fileOf(id));
}

export function saveTemplate(id, template) {
  const f = fileOf(id);
  if (fs.existsSync(f) && config.historyLimit > 0) {
    const hdir = path.join(dir(), '.history', String(id));
    fs.mkdirSync(hdir, { recursive: true });
    let stamp = Date.now();
    while (fs.existsSync(path.join(hdir, `${stamp}.json`))) stamp++;
    fs.copyFileSync(f, path.join(hdir, `${stamp}.json`));
    const old = fs.readdirSync(hdir).sort();
    for (const o of old.slice(0, Math.max(0, old.length - config.historyLimit))) fs.rmSync(path.join(hdir, o));
  }
  const t = { ...template, id: String(id), updatedAt: new Date().toISOString() };
  if (!t.createdAt) t.createdAt = t.updatedAt;
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(t));
  fs.renameSync(tmp, f);
  memCache.delete(id);
  return t;
}

export function deleteTemplate(id) {
  const f = fileOf(id);
  if (!fs.existsSync(f)) throw Object.assign(new Error(`תבנית ${id} לא נמצאה`), { status: 404 });
  fs.rmSync(f);
  memCache.delete(id);
}

export function nextId() {
  const nums = listTemplates().map((t) => parseInt(t.id, 10)).filter(Number.isFinite);
  return String(nums.length ? Math.max(...nums) + 1 : 1001);
}

export function listHistory(id) {
  fileOf(id);
  const hdir = path.join(dir(), '.history', String(id));
  if (!fs.existsSync(hdir)) return [];
  return fs.readdirSync(hdir).sort().reverse().map((f) => ({ version: f.replace('.json', ''), savedAt: new Date(+f.replace('.json', '')).toISOString() }));
}

export function getHistoryVersion(id, version) {
  fileOf(id);
  if (!/^\d+$/.test(version)) throw Object.assign(new Error('גרסה לא תקינה'), { status: 400 });
  const f = path.join(dir(), '.history', String(id), `${version}.json`);
  if (!fs.existsSync(f)) throw Object.assign(new Error('גרסה לא נמצאה'), { status: 404 });
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

// ---------------------------------------------------------------- duplicate
export function duplicateTemplate(id, newId, name) {
  const src = getTemplate(id);
  const target = newId ? String(newId) : nextId();
  if (!validId(target)) throw Object.assign(new Error('מספר תבנית לא תקין'), { status: 400 });
  if (templateExists(target)) throw Object.assign(new Error(`תבנית ${target} כבר קיימת`), { status: 409 });
  const copy = JSON.parse(JSON.stringify(src));
  copy.name = name || `${src.name || ''} (עותק)`;
  copy.createdAt = new Date().toISOString();
  copy.duplicatedFrom = String(id);
  return saveTemplate(target, copy);
}

// ---------------------------------------------------------------- customers
// storage/customers.json : [{ id, name, code, contact, email, phone, notes, apiKey, createdAt }]
// A template is linked to customers through template.customers = [customerId, ...]
function customersFile() {
  fs.mkdirSync(config.storageDir, { recursive: true });
  return path.join(config.storageDir, 'customers.json');
}

const hashKey = (k) => crypto.createHash('sha256').update(String(k)).digest('hex');

export function listCustomers() {
  let list;
  try {
    list = JSON.parse(fs.readFileSync(customersFile(), 'utf8'));
  } catch {
    return [];
  }
  // migrate keys saved in plain text by older versions
  if (list.some((c) => c.apiKey)) {
    for (const c of list) {
      if (c.apiKey) { c.apiKeyHash = hashKey(c.apiKey); c.apiKeyHint = String(c.apiKey).slice(-4); delete c.apiKey; }
    }
    writeCustomers(list);
  }
  return list;
}

/** Customer as shown by the API: never the key hash. */
export function publicCustomer(c) {
  const { apiKeyHash, ...rest } = c;
  return { ...rest, hasApiKey: !!apiKeyHash };
}

export function hasCustomerKeys() {
  return listCustomers().some((c) => c.apiKeyHash);
}

function writeCustomers(list) {
  const f = customersFile();
  fs.writeFileSync(f + '.tmp', JSON.stringify(list, null, 2));
  fs.renameSync(f + '.tmp', f);
}

export function getCustomer(id) {
  const c = listCustomers().find((x) => x.id === String(id));
  if (!c) throw Object.assign(new Error('לקוח לא נמצא'), { status: 404 });
  return c;
}

export function saveCustomer(data) {
  const list = listCustomers();
  const name = String(data.name || '').trim();
  if (!name) throw Object.assign(new Error('חסר שם לקוח'), { status: 400 });
  let c = data.id ? list.find((x) => x.id === String(data.id)) : null;
  const fields = ['name', 'code', 'contact', 'email', 'phone', 'notes'];
  if (c) {
    for (const k of fields) if (k in data) c[k] = data[k] == null ? '' : String(data[k]).slice(0, 500);
    c.name = name;
    c.updatedAt = new Date().toISOString();
  } else {
    const nums = list.map((x) => parseInt(x.id, 10)).filter(Number.isFinite);
    c = { id: String(nums.length ? Math.max(...nums) + 1 : 1), createdAt: new Date().toISOString() };
    for (const k of fields) c[k] = data[k] == null ? '' : String(data[k]).slice(0, 500);
    c.name = name;
    list.push(c);
  }
  // the key itself is never stored: only its hash and last 4 characters
  if (data.removeApiKey) { delete c.apiKeyHash; delete c.apiKeyHint; }
  if (data.apiKey) {
    const key = String(data.apiKey).trim();
    if (key.length < 16) throw Object.assign(new Error('מפתח API חייב להכיל לפחות 16 תווים'), { status: 400 });
    if (config.apiKey && key === config.apiKey) throw Object.assign(new Error('אי אפשר להשתמש במפתח המנהל כמפתח לקוח'), { status: 400 });
    const h = hashKey(key);
    if (list.some((x) => x !== c && x.apiKeyHash === h)) throw Object.assign(new Error('מפתח ה-API כבר בשימוש אצל לקוח אחר'), { status: 409 });
    c.apiKeyHash = h;
    c.apiKeyHint = key.slice(-4);
  }
  writeCustomers(list);
  return c;
}

export function deleteCustomer(id) {
  const list = listCustomers();
  if (!list.some((x) => x.id === String(id))) throw Object.assign(new Error('לקוח לא נמצא'), { status: 404 });
  writeCustomers(list.filter((x) => x.id !== String(id)));
  // unlink from templates
  for (const t of listTemplates()) {
    const full = getTemplate(t.id);
    if ((full.customers || []).includes(String(id))) {
      saveTemplate(t.id, { ...full, customers: full.customers.filter((c) => c !== String(id)) });
    }
  }
}

export function customerByApiKey(key) {
  if (!key) return null;
  const h = Buffer.from(hashKey(key), 'hex');
  return listCustomers().find((c) => c.apiKeyHash && crypto.timingSafeEqual(Buffer.from(c.apiKeyHash, 'hex'), h)) || null;
}

/** Install a customer (with its key hash) from a bundle on a render server. */
export function importCustomer(c) {
  const list = listCustomers();
  const existing = list.find((x) => x.id === String(c.id));
  const rec = { id: String(c.id), name: String(c.name || ''), code: String(c.code || ''), apiKeyHash: c.apiKeyHash || undefined, apiKeyHint: c.apiKeyHint || undefined };
  if (existing) Object.assign(existing, rec);
  else list.push(rec);
  writeCustomers(list);
}

/** Set which templates belong to a customer. */
export function setCustomerTemplates(customerId, templateIds) {
  getCustomer(customerId);
  const want = new Set(templateIds.map(String));
  for (const t of listTemplates()) {
    const full = getTemplate(t.id);
    const cur = new Set(full.customers || []);
    const has = cur.has(String(customerId));
    if (want.has(t.id) && !has) cur.add(String(customerId));
    else if (!want.has(t.id) && has) cur.delete(String(customerId));
    else continue;
    const tmp = { ...full, customers: [...cur] };
    // keep updatedAt meaningful: linking is not a design change, but it is saved
    saveTemplate(t.id, tmp);
  }
}
