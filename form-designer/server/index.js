// Form Designer server.
//   mode "full"   : designer UI + template management + render API
//   mode "render" : render API only (install on client servers)
import fs from 'node:fs';
import path from 'node:path';
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
import { autoDesign, designRequest, aiAvailable } from './ai.js';

const app = express();
app.disable('x-powered-by');
const full = config.mode !== 'render';

// ------------------------------------------------------------- auth
// FD_API_KEY = admin key (designer + everything). A customer's own API key
// (set in the management screen) can only render / read that customer's templates.
function requestKey(req) {
  return req.get('x-api-key') || req.query.apiKey || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
}

function apiKey(req, res, next) {
  const k = requestKey(req);
  if (config.apiKey && k === config.apiKey) return next();
  const customer = k ? store.customerByApiKey(k) : null;
  if (customer) {
    req.customer = customer;
    return next();
  }
  if (!config.apiKey) return next();
  res.status(401).json({ error: 'נדרש מפתח API תקין (כותרת x-api-key)' });
}

function adminOnly(req, res, next) {
  if (req.customer) return res.status(403).json({ error: 'מפתח לקוח מאפשר הפקה בלבד' });
  next();
}

function checkCustomerAccess(req, template) {
  if (req.customer && !(template.customers || []).includes(req.customer.id)) {
    throw Object.assign(new Error(`תבנית ${template.id} אינה משויכת ללקוח`), { status: 403 });
  }
}

function withPlaceholders(t) {
  const { width, height } = pageSize(t);
  return { ...t, sourcePdf: undefined, placeholders: templatePlaceholders(t, width, height) };
}

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ------------------------------------------------------------- render API
const rawBody = express.text({ type: () => true, limit: config.bodyLimit });
const jsonBody = express.json({ limit: config.bodyLimit });

function pdfFileName(req, template) {
  const n = String(req.query.fileName || req.body?.fileName || `${template.id}.pdf`).replace(/[^\p{L}\p{N}._ -]+/gu, '_');
  return n.toLowerCase().endsWith('.pdf') ? n : n + '.pdf';
}

async function sendRender(req, res, templateId, data, format) {
  const template = store.getTemplate(String(templateId));
  checkCustomerAccess(req, template);
  const started = Date.now();
  const { pdf, errors, pages, placeholders } = await renderPdf(template, data, { format });
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
app.post('/api/render/:templateId', apiKey, rawBody, asyncH(async (req, res) => {
  const body = typeof req.body === 'string' ? req.body : '';
  const format = req.query.format || (/(xml)/i.test(req.get('content-type') || '') ? 'xml' : /json/i.test(req.get('content-type') || '') ? 'json' : detectFormat(body));
  req.body = {};
  await sendRender(req, res, req.params.templateId, body, format);
}));

// POST /api/render   { templateId, data | xml | json, format?, output?: "base64" }
app.post('/api/render', apiKey, jsonBody, asyncH(async (req, res) => {
  const b = req.body || {};
  const templateId = b.templateId ?? b.template ?? req.query.templateId;
  if (templateId === undefined) return res.status(400).json({ error: 'חסר templateId' });
  let data = b.data ?? b.xml ?? b.json ?? {};
  let format = b.format;
  if (b.dataBase64) data = Buffer.from(b.dataBase64, 'base64').toString('utf8');
  if (typeof data === 'string' && !format) format = detectFormat(data);
  await sendRender(req, res, templateId, data, format);
}));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, mode: config.mode, chrome: findChrome() || null, libreoffice: full ? findSoffice() : undefined, templates: store.listTemplates().length });
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
  const t = store.getTemplate(req.params.id);
  checkCustomerAccess(req, t);
  if (req.query.download) res.set('Content-Disposition', `attachment; filename="template-${t.id}.json"`);
  res.json(t);
});

// ------------------------------------------------------------- designer API
if (full) {
  app.use('/api', apiKey, adminOnly, jsonBody);

  app.post('/api/templates', (req, res) => {
    const t = req.body || {};
    let id = t.id !== undefined && t.id !== '' ? String(t.id) : store.nextId();
    if (!store.validId(id)) return res.status(400).json({ error: 'מספר תבנית יכול להכיל ספרות, אותיות לועזיות, - ו-_' });
    if (store.templateExists(id) && req.query.overwrite !== '1') return res.status(409).json({ error: `תבנית ${id} כבר קיימת` });
    res.status(201).json(withPlaceholders(store.saveTemplate(id, t)));
  });

  app.put('/api/templates/:id', (req, res) => {
    res.json(withPlaceholders(store.saveTemplate(req.params.id, req.body || {})));
  });

  app.post('/api/templates/:id/duplicate', (req, res) => {
    const { id, name } = req.body || {};
    res.status(201).json(withPlaceholders(store.duplicateTemplate(req.params.id, id, name)));
  });

  // only the customer links of a template (from the management screen)
  app.put('/api/templates/:id/customers', (req, res) => {
    const t = store.getTemplate(req.params.id);
    const ids = (req.body?.customers || []).map(String);
    res.json(withPlaceholders(store.saveTemplate(t.id, { ...t, customers: ids })));
  });

  // ---- customers
  app.get('/api/customers', (req, res) => {
    const templates = store.listTemplates();
    res.json(store.listCustomers().map((c) => ({ ...c, templates: templates.filter((t) => t.customers.includes(c.id)).map((t) => t.id) })));
  });
  app.post('/api/customers', (req, res) => res.status(201).json(store.saveCustomer({ ...(req.body || {}), id: undefined })));
  app.put('/api/customers/:id', (req, res) => res.json(store.saveCustomer({ ...(req.body || {}), id: req.params.id })));
  app.delete('/api/customers/:id', (req, res) => { store.deleteCustomer(req.params.id); res.json({ ok: true }); });
  app.put('/api/customers/:id/templates', (req, res) => {
    store.setCustomerTemplates(req.params.id, req.body?.templates || []);
    res.json({ ok: true });
  });
  // installation bundle for a client server: all the customer's templates in one file
  app.get('/api/customers/:id/bundle', (req, res) => {
    const c = store.getCustomer(req.params.id);
    const templates = store.listTemplates().filter((t) => t.customers.includes(c.id)).map((t) => store.getTemplate(t.id));
    res.set('Content-Disposition', `attachment; filename="bundle-customer-${c.id}.json"`);
    res.json({ kind: 'form-designer-bundle', version: 1, createdAt: new Date().toISOString(), customer: { id: c.id, name: c.name, code: c.code }, templates });
  });

  // ---- smart design agent
  app.get('/api/ai/status', (req, res) => res.json({ available: aiAvailable(), model: aiAvailable() ? config.aiModel : null }));
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
    store.deleteTemplate(req.params.id);
    res.json({ ok: true });
  });

  app.get('/api/templates/:id/history', (req, res) => res.json(store.listHistory(req.params.id)));
  app.get('/api/templates/:id/history/:version', (req, res) => res.json(store.getHistoryVersion(req.params.id, req.params.version)));
  app.get('/api/next-id', (req, res) => res.json({ id: store.nextId() }));

  // parse a data sample (XML/JSON) -> data + tree + array paths
  app.post('/api/data/parse', (req, res) => {
    const { content, format, arrays } = req.body || {};
    try {
      res.json(describeData(content ?? '', { format, arrays }));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // render an unsaved template from the designer
  app.post('/api/preview', asyncH(async (req, res) => {
    const { template, data, format } = req.body || {};
    if (!template) return res.status(400).json({ error: 'חסרה תבנית' });
    const { pdf, errors, pages } = await renderPdf(template, data ?? {}, { format });
    res.set('X-Render-Pages', String(pages));
    res.set('X-Render-Warnings', encodeURIComponent(JSON.stringify(errors.slice(0, 20))));
    res.type('application/pdf').send(pdf);
  }));

  app.post('/api/import/docx', asyncH(async (req, res) => {
    const { dataBase64, mode, fileName } = req.body || {};
    if (!dataBase64) return res.status(400).json({ error: 'חסר קובץ' });
    const buf = Buffer.from(dataBase64, 'base64');
    const ext = path.extname(fileName || '').slice(1).toLowerCase() || 'docx';
    if (mode === 'pdf') {
      const pdf = await officeToPdf(buf, ext);
      return res.json({ pdfBase64: pdf.toString('base64') });
    }
    if (ext !== 'docx') return res.status(400).json({ error: 'ייבוא כטקסט עשיר נתמך לקבצי docx בלבד' });
    res.json(await docxToHtml(buf));
  }));

  app.post('/api/fonts', (req, res) => res.json(saveUploadedFont(req.body || {})));
  app.delete('/api/fonts/:family', (req, res) => res.json(deleteUploadedFont(req.params.family)));
}

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
  res.status(status).json({ error: err.message || 'שגיאה' });
});

export function start(port = config.port) {
  fs.mkdirSync(path.join(config.storageDir, 'templates'), { recursive: true });
  const server = app.listen(port, config.host, () => {
    const chrome = findChrome();
    console.log(`Form Designer (${config.mode}) http://localhost:${server.address().port}`);
    console.log(`  storage: ${config.storageDir}`);
    console.log(`  browser: ${chrome || 'NOT FOUND - set CHROME_PATH'}`);
    if (config.apiKey) console.log('  API key: required');
  });
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
