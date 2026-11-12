// Templates are stored as one JSON file per template number:
//   storage/templates/<id>.json
// A template file is self-contained (images and the source PDF are embedded),
// so deploying a template to a client server is copying that one file.
import fs from 'node:fs';
import path from 'node:path';
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
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
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
    fs.copyFileSync(f, path.join(hdir, `${Date.now()}.json`));
    const old = fs.readdirSync(hdir).sort();
    for (const o of old.slice(0, Math.max(0, old.length - config.historyLimit))) fs.rmSync(path.join(hdir, o));
  }
  const t = { ...template, id: String(id), updatedAt: new Date().toISOString() };
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
