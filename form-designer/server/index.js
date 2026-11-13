// Form Designer server.
//   mode "full"   : designer UI + template management + render API
//   mode "render" : render API only (install on client servers)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { config, ROOT } from './config.js';
import * as store from './storage.js';
import { describeData, detectFormat } from './data.js';
import { renderPdf, findChrome, closeBrowser, renderPageImage } from './render/pdf.js';
import { barcodeSvg, SYMBOLOGIES } from './barcode.js';
import { listFonts, fontsCssForWeb, resolveFontFile, saveUploadedFont, deleteUploadedFont } from './fonts.js';
import { docxToHtml, officeToPdf, findSoffice } from './import.js';
import { templatePlaceholders } from '../shared/elements.js';
import { pageSize } from './render/html.js';
import { autoDesign, designRequest, aiAvailable, translateTexts, aiReview } from './ai.js';
import { reviewPdf } from './review.js';
import { renderBatch, mergePdfs, manifestOf, ZipWriter } from './batch.js';
import { parseData } from './data.js';
import { sanitizeTemplate } from './sanitize.js';
import { bundleFor, repoListing, repoTemplate, installBundle, syncFromRepo, startRepoSync, lastSyncStatus, readRepoState } from './repo.js';
import { uploadedFontsFor } from './fonts.js';
import { decodeBytes, charsetOf } from '../shared/encoding.js';

const app = express();
app.disable('x-powered-by');
const full = config.mode !== 'render';

// ------------------------------------------------------------- auth
// FD_API_KEY = admin key (designer + everything). A customer's own API key
// (set in the management screen) can only render / read that customer's templates.
function requestKey(req) {
  return req.get('x-api-key') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
}

const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();
function isAdminKey(k) {
  return !!(config.apiKey && k && crypto.timingSafeEqual(sha(k), sha(config.apiKey)));
}

// roles: admin (FD_API_KEY, or an open server without keys), designer (a
// customer's design key: designer limited to that customer's templates),
// render (a customer's API key: render / download that customer's templates)
function apiKey(req, res, next) {
  const k = requestKey(req);
  if (isAdminKey(k)) { req.role = 'admin'; return next(); }
  const found = k ? store.customerByKey(k) : null;
  if (found) {
    req.customer = found.customer;
    req.role = found.role;
    return next();
  }
  // no admin key configured: open access, except on a render server that has
  // customer keys installed - there a customer key is always required
  if (!config.apiKey && !(config.mode === 'render' && store.hasCustomerKeys())) { req.role = 'admin'; return next(); }
  res.status(401).json({ error: 'נדרש מפתח API תקין (כותרת x-api-key)' });
}

function adminOnly(req, res, next) {
  if (req.role !== 'admin') return res.status(403).json({ error: req.role === 'designer' ? 'הפעולה זמינה למנהל המערכת בלבד' : 'מפתח לקוח מאפשר הפקה בלבד' });
  next();
}

// designer API: the admin, or a customer's designer (limited to its own templates)
function designerAccess(req, res, next) {
  if (req.role === 'admin' || req.role === 'designer') return next();
  res.status(403).json({ error: 'מפתח לקוח מאפשר הפקה בלבד' });
}

function checkCustomerAccess(req, template) {
  if (req.customer && !(template.customers || []).includes(req.customer.id)) {
    throw Object.assign(new Error(`תבנית ${template.id} אינה משויכת ללקוח`), { status: 403 });
  }
}

// a customer's designer edits only templates that belong to that customer alone;
// a template shared with other customers is read-only for it (it can duplicate it)
function checkCanEdit(req, template) {
  if (req.role !== 'designer') return;
  checkCustomerAccess(req, template);
  if ((template.customers || []).length > 1) {
    throw Object.assign(new Error(`תבנית ${template.id} משותפת לכמה לקוחות ואפשר לערוך אותה רק דרך מנהל המערכת. שכפלו אותה כדי ליצור גרסה משלכם`), { status: 403 });
  }
}

function withPlaceholders(t) {
  const { width, height } = pageSize(t);
  return { ...t, sourcePdf: undefined, placeholders: templatePlaceholders(t, width, height) };
}

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ------------------------------------------------------------- render API
// raw bytes: legacy systems send windows-1255 XML, decoded by charset / XML declaration
const rawBody = express.raw({ type: () => true, limit: config.bodyLimit });
const jsonBody = express.json({ limit: config.bodyLimit });

// admission by size: request bodies being processed together stay under
// FD_MAX_INFLIGHT_MB, so a burst of large XML files cannot exhaust memory.
// The rest get 503 + Retry-After before their body is read.
let inflight = 0;
function admit(req, res, next) {
  const len = Number(req.get('content-length')) || 1e6;
  const max = config.maxInflightMb * 1e6;
  if (inflight > 0 && inflight + len > max) {
    res.set('Retry-After', '5');
    return res.status(503).json({ error: 'השרת עמוס, נסו שוב בעוד רגע' });
  }
  inflight += len;
  let done = false;
  const free = () => { if (!done) { done = true; inflight -= len; } };
  res.once('finish', free);
  res.once('close', free);
  next();
}

function pdfFileName(req, template) {
  const n = String(req.query.fileName || req.body?.fileName || `${template.id}.pdf`).replace(/[^\p{L}\p{N}._ -]+/gu, '_');
  return n.toLowerCase().endsWith('.pdf') ? n : n + '.pdf';
}

async function sendRender(req, res, templateId, data, format, charset, inlineTemplate) {
  const template = inlineTemplate || store.getTemplate(String(templateId));
  if (!inlineTemplate) checkCustomerAccess(req, template);
  const started = Date.now();
  const lang = req.query.lang || req.body?.lang || undefined;
  const { pdf, errors, pages, placeholders } = await renderPdf(template, data, { format, lang, charset });
  const name = pdfFileName(req, template);
  res.set('X-Render-Pages', String(pages));
  res.set('X-Render-Ms', String(Date.now() - started));
  res.set('X-Render-Warnings', String(errors.length));
  res.set('X-Render-Placeholders', String(placeholders.length));
  const output = req.query.output || req.body?.output;
  if (output === 'base64' || output === 'json') {
    return res.json({ templateId: template.id, pages, warnings: errors, fileName: name, placeholders, pdfBase64: pdf.toString('base64') });
  }
  res.type('application/pdf');
  const disp = req.query.download === '1' || req.query.download === 'true' ? 'attachment' : 'inline';
  res.set('Content-Disposition', `${disp}; filename="${encodeURIComponent(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send(pdf);
}

// POST /api/render/1001   body = XML or JSON data as-is
app.post('/api/render/:templateId', apiKey, admit, rawBody, asyncH(async (req, res) => {
  // the bytes go to a worker thread as they are; decoding and parsing happen there
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const head = body.subarray(body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf ? 3 : 0, 4096);
  const ct = req.get('content-type') || '';
  const format = req.query.format || (/xml/i.test(ct) ? 'xml' : /json/i.test(ct) ? 'json' : detectFormat(head.toString('latin1')));
  req.body = {};
  await sendRender(req, res, req.params.templateId, body, format, charsetOf(ct));
}));

// POST /api/render   { templateId | template: {...}, data | xml | json, format?, output?: "base64" }
// "template" can be the template itself (JSON from the repository): on a runtime
// server with any valid key, on the central server with the admin key only.
app.post('/api/render', apiKey, admit, jsonBody, asyncH(async (req, res) => {
  const b = req.body || {};
  let inline = null;
  if (b.template && typeof b.template === 'object') {
    if (!(req.role === 'admin' || (config.mode === 'render' && req.customer))) return res.status(403).json({ error: 'הפקה עם תבנית בגוף הבקשה זמינה בשרת הפקה, או למנהל המערכת' });
    if (!Array.isArray(b.template.pages)) return res.status(400).json({ error: 'template אינה תבנית תקינה' });
    inline = { ...sanitizeTemplate(b.template), id: String(b.template.id || 'inline') };
  }
  const templateId = inline ? inline.id : b.templateId ?? b.template ?? req.query.templateId;
  if (templateId === undefined) return res.status(400).json({ error: 'חסר templateId' });
  let data = b.data ?? b.xml ?? b.json ?? {};
  let format = b.format;
  if (b.dataBase64) data = Buffer.from(b.dataBase64, 'base64').toString('utf8');
  if (typeof data === 'string' && !format) format = detectFormat(data);
  await sendRender(req, res, templateId, data, format, undefined, inline);
}));

// POST /api/render-batch/:templateId   bulk rendering (thousands of records)
// { records: [ <object | XML/JSON string>, ... ] }  or  { data: <one XML/JSON with a list>, split: "invoice" (path after the XML root), wrap?: "name" }
// output: zip (default, PDFs + manifest.json, streamed) | merged (one PDF) | json (base64 per record)
// fileName: name pattern per record, e.g. "invoice-{{invoice.number}}.pdf"
const batchBody = express.json({ limit: config.batchBodyLimit });
app.post('/api/render-batch/:templateId', apiKey, admit, batchBody, asyncH(async (req, res) => {
  const template = store.getTemplate(String(req.params.templateId));
  checkCustomerAccess(req, template);
  const b = req.body || {};
  const q = (k) => b[k] ?? req.query[k];
  let records = b.records;
  if (!Array.isArray(records) && b.data !== undefined && q('split')) {
    const root = typeof b.data === 'string' ? parseData(b.data, { format: q('format'), arrays: [...(template.schema?.arrays || []), String(q('split'))] }) : b.data;
    let list = String(q('split')).split('.').filter(Boolean).reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), root);
    if (list && !Array.isArray(list)) list = [list];
    const wrap = q('wrap');
    records = (list || []).map((item) => (wrap ? { [wrap]: item } : item));
  }
  if (!Array.isArray(records) || !records.length) return res.status(400).json({ error: 'חסרות רשומות: records (מערך) או data + split' });
  if (records.length > config.maxBatch) return res.status(413).json({ error: `עד ${config.maxBatch} רשומות בקריאה אחת` });
  const output = String(q('output') || 'zip');
  const opts = { format: q('format'), lang: q('lang'), fileName: q('fileName'), concurrency: q('concurrency') };
  const started = Date.now();
  const base = String(q('archiveName') || `batch-${template.id}`).replace(/[^\p{L}\p{N}._ -]+/gu, '_');

  if (output === 'zip') {
    // streamed: the first PDFs are on the wire while the rest are still rendering
    res.status(200);
    res.type('application/zip');
    res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(base)}.zip"; filename*=UTF-8''${encodeURIComponent(base)}.zip`);
    res.set('X-Batch-Count', String(records.length));
    let aborted = false;
    res.on('close', () => { if (!res.writableFinished) aborted = true; });
    const write = (buf) => new Promise((resolve) => { if (aborted || res.write(buf)) resolve(); else res.once('drain', resolve); });
    const zip = new ZipWriter(write);
    let chain = Promise.resolve();
    const results = await renderBatch(template, records, {
      ...opts,
      onResult: (r) => {
        const { pdf, fileName } = r;
        if (r.ok && !aborted) chain = chain.then(() => zip.add(fileName, pdf));
        delete r.pdf; // keep memory flat: each PDF is released once it is written
        return chain;
      },
    });
    await chain;
    if (!aborted) {
      await zip.add('manifest.json', Buffer.from(JSON.stringify(manifestOf(template, results, Date.now() - started), null, 2), 'utf8'));
      await zip.finish();
    }
    return res.end();
  }
  const results = await renderBatch(template, records, opts);
  const manifest = manifestOf(template, results, Date.now() - started);
  res.set('X-Batch-Count', String(manifest.count));
  res.set('X-Batch-Failed', String(manifest.failed));
  if (output === 'merged') {
    const pdf = await mergePdfs(results);
    res.type('application/pdf');
    res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(base)}.pdf"; filename*=UTF-8''${encodeURIComponent(base)}.pdf`);
    res.set('X-Batch-Manifest', encodeURIComponent(JSON.stringify({ count: manifest.count, ok: manifest.ok, failed: manifest.failed, ms: manifest.ms })));
    return res.send(pdf);
  }
  if (output === 'json') {
    manifest.items.forEach((it, i) => { if (results[i].ok) it.pdfBase64 = results[i].pdf.toString('base64'); });
    return res.json(manifest);
  }
  res.status(400).json({ error: 'output: zip | merged | json' });
}));

app.get('/api/health', (req, res) => {
  const chrome = !!findChrome();
  // details only for the admin (or an open server without keys)
  if (!isAdminKey(requestKey(req)) && config.apiKey) return res.json({ ok: chrome, mode: config.mode });
  res.json({ ok: chrome, mode: config.mode, repo: config.repoUrl ? { url: config.repoUrl, lastSync: lastSyncStatus() } : undefined, chrome: findChrome() || null, libreoffice: full ? findSoffice() : undefined, templates: store.listTemplates().length, ai: aiAvailable() });
});

app.get('/api/me', apiKey, (req, res) => {
  res.json({ role: req.role, mode: config.mode, customer: req.customer ? { id: req.customer.id, name: req.customer.name, code: req.customer.code || '' } : null });
});

app.get('/api/templates', apiKey, (req, res) => {
  let list = store.listTemplates();
  if (req.customer) list = list.filter((t) => t.customers.includes(req.customer.id));
  else if (req.query.customer) list = list.filter((t) => t.customers.includes(String(req.query.customer)));
  res.json(list);
});
app.get('/api/templates/:id/placeholders', apiKey, (req, res) => {
  const t = store.getTemplate(req.params.id);
  checkCustomerAccess(req, t);
  const { width, height } = pageSize(t);
  res.json({ templateId: t.id, page: { width, height, unit: 'mm' }, placeholders: templatePlaceholders(t, width, height) });
});
app.get('/api/templates/:id', apiKey, (req, res) => {
  let t = store.getTemplate(req.params.id);
  checkCustomerAccess(req, t);
  if (req.role === 'render') t = { ...t, customers: undefined, schema: t.schema ? { ...t.schema, sample: undefined } : null };
  if (req.query.download) res.set('Content-Disposition', `attachment; filename="template-${t.id}.json"`);
  res.json(t);
});

// ------------------------------------------------------------- template repository
// Central server: each customer lists and downloads the templates built for it
// (with its API key or design key; the admin passes ?customer=<id>).
function repoCustomer(req) {
  if (req.customer) return req.customer;
  if (!req.query.customer) throw Object.assign(new Error('חסר ?customer=<מספר לקוח>'), { status: 400 });
  return store.getCustomer(String(req.query.customer));
}
if (full) {
  app.get('/api/repo/templates', apiKey, (req, res) => res.json(repoListing(repoCustomer(req).id)));
  app.get('/api/repo/templates/:id', apiKey, (req, res) => {
    const c = repoCustomer(req);
    const t = store.getTemplate(req.params.id);
    if (!(t.customers || []).includes(c.id)) throw Object.assign(new Error(`תבנית ${t.id} אינה משויכת ללקוח`), { status: 403 });
    const out = repoTemplate(t, c.id);
    // runtime sync: the template together with the uploaded fonts it uses
    if (req.query.fonts === '1') return res.json({ template: out, fonts: uploadedFontsFor([out]) });
    if (req.query.download) res.set('Content-Disposition', `attachment; filename="template-${t.id}.json"`);
    res.json(out);
  });
  app.get('/api/repo/bundle', apiKey, (req, res) => {
    const c = repoCustomer(req);
    res.set('Content-Disposition', `attachment; filename="bundle-customer-${c.id}.json"`);
    res.json(bundleFor(c));
  });
}

// Runtime servers: pull now from the repository, or install an uploaded bundle (admin key)
app.post('/api/repo/sync', apiKey, adminOnly, asyncH(async (req, res) => {
  const r = await syncFromRepo();
  res.status(r.ok ? 200 : 502).json(r);
}));
app.post('/api/repo/install', apiKey, adminOnly, express.json({ limit: config.batchBodyLimit }), (req, res) => {
  res.json(installBundle(req.body, { prune: req.query.prune === '1' }));
});
app.get('/api/repo/status', apiKey, adminOnly, (req, res) => {
  res.json({ repoUrl: config.repoUrl || null, syncMinutes: config.repoUrl ? config.repoSyncMinutes : null, lastSync: lastSyncStatus(), installed: readRepoState().customers });
});

// ------------------------------------------------------------- designer API
if (full) {
  // designer helpers (no secrets): barcode preview images and fonts
  app.get('/api/fonts', (req, res) => res.json(listFonts()));
  app.get('/api/symbologies', (req, res) => res.json(SYMBOLOGIES));
  app.get('/fonts.css', (req, res) => {
    res.type('text/css').set('Cache-Control', 'no-cache').send(fontsCssForWeb());
  });
  app.get('/fonts/:kind/:file', (req, res) => {
    const f = resolveFontFile(req.params.kind, req.params.file);
    if (!f) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=86400').sendFile(f);
  });
  
  app.get('/api/barcode', (req, res) => {
    try {
      if (String(req.query.text || '').length > 1000) return res.status(400).type('text/plain').send('text too long');
      const svg = barcodeSvg({
        symbology: String(req.query.type || 'code128'),
        text: String(req.query.text || ''),
        showText: req.query.showText !== '0',
        color: String(req.query.color || '#000000'),
        rotate: String(req.query.rotate || 'N'),
      });
      res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
    } catch (e) {
      res.status(400).type('text/plain').send(e.message);
    }
  });

  app.use('/api', apiKey, designerAccess, jsonBody);

  app.post('/api/templates', (req, res) => {
    const t = req.body || {};
    let id = t.id !== undefined && t.id !== '' ? String(t.id) : store.nextId();
    if (!store.validId(id)) return res.status(400).json({ error: 'מספר תבנית יכול להכיל ספרות, אותיות לועזיות, - ו-_' });
    const exists = store.templateExists(id);
    if (exists && req.query.overwrite !== '1') return res.status(409).json({ error: `תבנית ${id} כבר קיימת` });
    if (exists) checkCanEdit(req, store.getTemplate(id));
    const clean = sanitizeTemplate(t);
    // a customer's designer creates templates for that customer only
    if (req.role === 'designer') clean.customers = exists ? store.getTemplate(id).customers : [req.customer.id];
    res.status(201).json(withPlaceholders(store.saveTemplate(id, clean)));
  });

  app.put('/api/templates/:id', (req, res) => {
    const body = { ...(req.body || {}) };
    // customer links are managed by their own endpoints: a design save keeps the stored ones
    const exists = store.templateExists(req.params.id);
    if (exists) checkCanEdit(req, store.getTemplate(req.params.id));
    body.customers = exists ? store.getTemplate(req.params.id).customers || [] : req.role === 'designer' ? [req.customer.id] : [];
    res.json(withPlaceholders(store.saveTemplate(req.params.id, sanitizeTemplate(body))));
  });

  app.post('/api/templates/:id/duplicate', (req, res) => {
    const { id, name } = req.body || {};
    checkCustomerAccess(req, store.getTemplate(req.params.id));
    let copy = store.duplicateTemplate(req.params.id, id, name);
    if (req.role === 'designer') copy = store.saveTemplate(copy.id, { ...copy, customers: [req.customer.id] });
    res.status(201).json(withPlaceholders(copy));
  });

  // only the customer links of a template (from the management screen)
  app.put('/api/templates/:id/customers', adminOnly, (req, res) => {
    const t = store.getTemplate(req.params.id);
    if (!Array.isArray(req.body?.customers)) return res.status(400).json({ error: 'customers חייב להיות רשימה' });
    const ids = req.body.customers.map(String);
    res.json(withPlaceholders(store.saveTemplate(t.id, { ...t, customers: ids })));
  });

  // ---- customers
  app.use('/api/customers', adminOnly);
  app.get('/api/customers', (req, res) => {
    const templates = store.listTemplates();
    res.json(store.listCustomers().map((c) => ({ ...store.publicCustomer(c), templates: templates.filter((t) => t.customers.includes(c.id)).map((t) => t.id) })));
  });
  app.post('/api/customers', (req, res) => res.status(201).json(store.publicCustomer(store.saveCustomer({ ...(req.body || {}), id: undefined }))));
  app.put('/api/customers/:id', (req, res) => res.json(store.publicCustomer(store.saveCustomer({ ...(req.body || {}), id: req.params.id }))));
  app.delete('/api/customers/:id', (req, res) => { store.deleteCustomer(req.params.id); res.json({ ok: true }); });
  app.put('/api/customers/:id/templates', (req, res) => {
    if (!Array.isArray(req.body?.templates)) return res.status(400).json({ error: 'templates חייב להיות רשימה' });
    store.setCustomerTemplates(req.params.id, req.body.templates);
    res.json({ ok: true });
  });
  // installation bundle for a client server: all the customer's templates in one file
  app.get('/api/customers/:id/bundle', (req, res) => {
    const c = store.getCustomer(req.params.id);
    res.set('Content-Disposition', `attachment; filename="bundle-customer-${c.id}.json"`);
    res.json(bundleFor(c));
  });

  // ---- smart design agent
  app.get('/api/ai/status', (req, res) => res.json({ available: aiAvailable(), model: aiAvailable() ? config.aiModel : null }));
  // design review of a sample PDF + mapping of its values to the data world
  app.post('/api/ai/review', asyncH(async (req, res) => {
    const { pages = [], data, template, tree, useAi = true } = req.body || {};
    if (!Array.isArray(pages) || !pages.length) return res.status(400).json({ error: 'חסר ניתוח של קובץ ה-PDF' });
    const obj = data && typeof data === 'object' ? data
      : template?.schema?.sample ? parseData(template.schema.sample, { arrays: template.schema.arrays || [] }) : {};
    const report = reviewPdf({ pages, data: obj });
    report.ai = null;
    if (useAi && aiAvailable()) {
      try {
        report.ai = await aiReview({ pages, tree, report });
      } catch (e) {
        report.aiError = e.message;
      }
      // the agent's corrections of field mappings
      for (const fx of report.ai?.mapping_fixes || []) {
        const m = report.mappings.find((x) => x.page === fx.page && x.value === fx.value);
        if (m && fx.path && fx.path !== m.path) {
          m.alternatives = [m.path, ...m.alternatives.filter((a) => a !== fx.path)];
          m.path = fx.path;
          m.fixedByAgent = true;
          for (const op of report.operations) if (op.element?.type === 'field' && op.element.binding === m.alternatives[0] && op.page === m.page && Math.abs(op.element.y - (m.y - 0.3)) < 0.6) op.element.binding = fx.path;
        }
      }
    }
    res.json(report);
  }));
  app.post('/api/ai/translate', asyncH(async (req, res) => {
    res.json(await translateTexts(req.body || {}));
  }));
  app.post('/api/ai/auto-design', asyncH(async (req, res) => {
    res.json(await autoDesign(req.body || {}));
  }));
  app.post('/api/ai/request', asyncH(async (req, res) => {
    const body = req.body || {};
    if (aiAvailable() && body.template && !body.designImage) {
      body.designImage = await renderPageImage(body.template, body.template.schema?.sample || {}, body.pageIndex || 0).catch(() => null);
    }
    res.json(await designRequest(body));
  }));

  app.delete('/api/templates/:id', (req, res) => {
    checkCanEdit(req, store.getTemplate(req.params.id));
    store.deleteTemplate(req.params.id);
    res.json({ ok: true });
  });

  app.get('/api/templates/:id/history', (req, res) => { checkCustomerAccess(req, store.getTemplate(req.params.id)); res.json(store.listHistory(req.params.id)); });
  app.get('/api/templates/:id/history/:version', (req, res) => { checkCustomerAccess(req, store.getTemplate(req.params.id)); res.json(store.getHistoryVersion(req.params.id, req.params.version)); });
  app.get('/api/next-id', (req, res) => res.json({ id: store.nextId() }));

  // parse a data sample (XML/JSON) -> data + tree + array paths
  app.post('/api/data/parse', (req, res) => {
    const { content, format, arrays, detectLists } = req.body || {};
    try {
      res.json(describeData(content ?? '', { format, arrays, detectLists: !!detectLists }));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // render an unsaved template from the designer
  app.post('/api/preview', asyncH(async (req, res) => {
    const { template, data, format, lang } = req.body || {};
    if (!template) return res.status(400).json({ error: 'חסרה תבנית' });
    const { pdf, errors, pages } = await renderPdf(template, data ?? {}, { format, lang });
    res.set('X-Render-Pages', String(pages));
    res.set('X-Render-Warnings', encodeURIComponent(JSON.stringify(errors.slice(0, 20))));
    res.type('application/pdf').send(pdf);
  }));

  app.post('/api/import/docx', asyncH(async (req, res) => {
    const { dataBase64, mode, fileName } = req.body || {};
    if (!dataBase64) return res.status(400).json({ error: 'חסר קובץ' });
    const buf = Buffer.from(String(dataBase64), 'base64');
    if (buf.length > config.maxImportBytes) return res.status(413).json({ error: 'הקובץ גדול מדי' });
    const ext = path.extname(fileName || '').slice(1).toLowerCase() || 'docx';
    if (mode === 'pdf') {
      const pdf = await officeToPdf(buf, ext);
      return res.json({ pdfBase64: pdf.toString('base64') });
    }
    // a Word file as a sample for the design agent: an exact PDF with LibreOffice,
    // otherwise (docx) the document's content rendered as rich text
    if (mode === 'sample') {
      if (findSoffice()) {
        try {
          return res.json({ pdfBase64: (await officeToPdf(buf, ext)).toString('base64'), via: 'libreoffice' });
        } catch (e) {
          if (ext !== 'docx') throw e;
        }
      }
      if (ext !== 'docx') return res.status(400).json({ error: 'המרת קובץ זה לדוגמה דורשת LibreOffice בשרת. שמרו אותו כ-docx או כ-PDF' });
      const { html } = await docxToHtml(buf);
      const sample = { page: { size: 'A4' }, pages: [{ id: 'p1', elements: [{ id: 'doc', type: 'richtext', x: 15, y: 15, w: 180, h: 267, html, overflow: 'paginate' }] }] };
      const { pdf } = await renderPdf(sanitizeTemplate(sample), {});
      return res.json({ pdfBase64: pdf.toString('base64'), via: 'html' });
    }
    if (ext !== 'docx') return res.status(400).json({ error: 'ייבוא כטקסט עשיר נתמך לקבצי docx בלבד' });
    res.json(await docxToHtml(buf));
  }));

  app.post('/api/fonts', adminOnly, (req, res) => res.json(saveUploadedFont(req.body || {})));
  app.delete('/api/fonts/:family', adminOnly, (req, res) => res.json(deleteUploadedFont(req.params.family)));
}

// ------------------------------------------------------------- static designer
if (full) {
  app.use('/shared', express.static(path.join(ROOT, 'shared')));
  app.use('/vendor/pdfjs', express.static(path.join(ROOT, 'node_modules', 'pdfjs-dist', 'build')));
  app.use(express.static(path.join(ROOT, 'public')));
} else {
  app.get('/', (req, res) => res.type('text/plain; charset=utf-8').send('Form Designer render server - POST /api/render/<templateId>'));
}

// ------------------------------------------------------------- errors
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || (err.type === 'entity.too.large' ? 413 : err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  // messages of errors we raise ourselves (with a status) are meant for the user; others may leak internals
  const msg = err.status || status < 500 ? err.message || 'שגיאה' : 'שגיאה פנימית בשרת';
  if (status === 503) res.set('Retry-After', '2');
  res.status(status).json({ error: msg });
});

export function start(port = config.port) {
  fs.mkdirSync(path.join(config.storageDir, 'templates'), { recursive: true });
  const server = app.listen(port, config.host, () => {
    const chrome = findChrome();
    console.log(`Form Designer (${config.mode}) http://localhost:${server.address().port}`);
    console.log(`  storage: ${config.storageDir}`);
    console.log(`  browser: ${chrome || 'NOT FOUND - set CHROME_PATH'}`);
    if (config.apiKey) console.log('  API key: required');
    else console.warn('  WARNING: FD_API_KEY is not set - the API is open to anyone who can reach this port' + (config.mode === 'render' && store.hasCustomerKeys() ? ' (customer keys are still required for rendering)' : ''));
  });
  // runtime servers keep their templates in sync with the central repository
  if (config.mode === 'render') startRepoSync();
  // a request may wait in the render queue: allow long requests
  server.requestTimeout = config.requestTimeoutMs;
  server.headersTimeout = 60000;
  server.keepAliveTimeout = 65000;
  const stop = async () => {
    server.close();
    await closeBrowser();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return server;
}

export { app };

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(ROOT, 'server', 'index.js')) start();
