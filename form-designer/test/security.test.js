// Regression tests for the security review findings.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-sec-'));
fs.mkdirSync(path.join(tmp, 'templates'), { recursive: true });
process.env.FD_STORAGE = tmp;

const { app } = await import('../server/index.js');
const { renderPdf, findChrome, closeBrowser } = await import('../server/render/pdf.js');
const { buildDocumentHtml } = await import('../server/render/html.js');
const { sanitizeTemplate } = await import('../server/sanitize.js');
const { evalExpr, scopeFor } = await import('../shared/expr.js');
let server;
let base;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await closeBrowser();
  fs.rmSync(tmp, { recursive: true, force: true });
});
const json = (method, url, body, headers = {}) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) });

const page = (elements) => ({ page: { size: 'A4' }, pages: [{ id: 'p', elements }] });

test('rich text scripts and event handlers are removed', () => {
  const t = sanitizeTemplate(page([{ id: 'r', type: 'richtext', x: 0, y: 0, w: 50, h: 20, html: '<p onclick="x()">hi {{a}}<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">l</a></p>' }]));
  const h = t.pages[0].elements[0].html;
  assert.ok(!/script|onerror|onclick|javascript:/i.test(h), h);
  assert.ok(h.includes('{{a}}'));
});

test('style values cannot break out of CSS or attributes', () => {
  const evil = 'red;}</style><script>alert(1)</script>';
  const { html } = buildDocumentHtml(page([
    { id: 'a', type: 'text', x: 0, y: 0, w: 10, h: 10, text: 'x', style: { color: evil, fontFamily: "X';}</style><script>" } },
    { id: 't', type: 'table', x: 0, y: 20, w: 100, h: 50, binding: 'rows', columns: [{ id: 'c', header: 'h', binding: 'a', color: '"><script>alert(1)</script>' }] },
    { id: 'c', type: 'signature', x: 0, y: 80, w: 10, h: 10, style: { color: '"><img src=x onerror=1>' } },
  ]), { rows: [{ a: 1 }] }, { fontsCss: '' });
  assert.ok(!/<script|<img/i.test(html));
  assert.ok(!/="[^"]*"[^ >]*onerror/i.test(html));
});

test('render page has no scripts and no network (WebSocket)', { skip: !findChrome() && 'no browser' }, async () => {
  let hits = 0;
  const listener = http.createServer((req, res) => { hits++; res.end(); });
  await new Promise((r) => listener.listen(0, r));
  const port = listener.address().port;
  // bypass the save-time sanitizer on purpose: rendering must be safe on its own
  const t = page([{ id: 'r', type: 'image', x: 0, y: 0, w: 10, h: 10, source: 'static', src: `http://127.0.0.1:${port}/img` }]);
  t.pages[0].elements.push({ id: 'x', type: 'text', x: 0, y: 20, w: 10, h: 10, text: 'ok' });
  const { pdf } = await renderPdf(t, {});
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal(hits, 0);
  listener.close();
});

test('font upload cannot write outside the fonts folder', async () => {
  const r = await json('POST', '/api/fonts', { family: 'Evil', style: 'x/../../../pwned', weight: '400/../../x', fileName: 'a.ttf', dataBase64: 'SGVsbG8=' });
  assert.equal(r.status, 400);
  const r2 = await json('POST', '/api/fonts', { family: "X';}</style>", fileName: 'a.ttf', dataBase64: 'SGVsbG8=' });
  assert.equal(r2.status, 400);
  assert.ok(!fs.existsSync(path.join(tmp, '..', 'pwned.ttf')));
});

test('customer keys are stored hashed and never returned', async () => {
  const key = 'fdk_secret_0123456789abcdef';
  const c = await (await json('POST', '/api/customers', { name: 'C', apiKey: key })).json();
  assert.equal(c.apiKey, undefined);
  assert.equal(c.apiKeyHash, undefined);
  assert.equal(c.hasApiKey, true);
  const raw = fs.readFileSync(path.join(tmp, 'customers.json'), 'utf8');
  assert.ok(!raw.includes(key));
  const list = await (await fetch(`${base}/api/customers`)).json();
  assert.ok(!JSON.stringify(list).includes(key));
  // query-string keys are not accepted any more
  const r = await fetch(`${base}/api/templates?apiKey=${key}`);
  assert.equal(r.status, 200); // open server (no admin key): works, but as anonymous, not as the customer
});

test('health hides details and expression functions do not reach the prototype', async () => {
  const h = await (await fetch(`${base}/api/health`)).json();
  assert.equal(typeof h.ok, 'boolean');
  assert.throws(() => evalExpr('constructor(1)', scopeFor({})), /לא מוכרת/);
  assert.throws(() => evalExpr('toString()', scopeFor({})), /לא מוכרת/);
});

test('unexpected errors do not leak internals', async () => {
  const r = await json('POST', '/api/preview', { template: { pages: 'x' }, data: {} });
  const body = await r.json();
  assert.ok(!/\/home\/|node_modules|at /.test(body.error), body.error);
});
