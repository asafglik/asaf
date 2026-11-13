import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-test-'));
fs.mkdirSync(path.join(tmp, 'templates'), { recursive: true });
fs.copyFileSync(new URL('../examples/template-1001.json', import.meta.url), path.join(tmp, 'templates', '1001.json'));
process.env.FD_STORAGE = tmp;

const { app } = await import('../server/index.js');
const { findChrome, closeBrowser } = await import('../server/render/pdf.js');
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

const json = (method, url, body) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });

test('template CRUD', async () => {
  let r = await json('POST', '/api/templates', { name: 'בדיקה', pages: [{ elements: [] }] });
  assert.equal(r.status, 201);
  const t = await r.json();
  assert.equal(t.id, '1002');
  r = await json('PUT', `/api/templates/${t.id}`, { ...t, name: 'שונה' });
  assert.equal((await r.json()).name, 'שונה');
  assert.equal((await (await fetch(`${base}/api/templates/${t.id}/history`)).json()).length, 1);
  r = await json('POST', '/api/templates', { id: t.id });
  assert.equal(r.status, 409);
  r = await json('DELETE', `/api/templates/${t.id}`);
  assert.equal(r.status, 200);
  r = await fetch(`${base}/api/templates/${t.id}`);
  assert.equal(r.status, 404);
  r = await fetch(`${base}/api/templates/..%2Fx`);
  assert.equal(r.status, 400);
});

test('data parse', async () => {
  const r = await json('POST', '/api/data/parse', { content: '<a><b>1</b><b>2</b></a>' });
  const d = await r.json();
  assert.deepEqual(d.arrays, ['b']);
});

test('render XML body', { skip: !findChrome() && 'no browser' }, async () => {
  const xml = fs.readFileSync(new URL('../examples/invoice.xml', import.meta.url));
  const r = await fetch(`${base}/api/render/1001`, { method: 'POST', headers: { 'Content-Type': 'application/xml' }, body: xml });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
});

test('render JSON with base64 output', { skip: !findChrome() && 'no browser' }, async () => {
  const r = await json('POST', '/api/render', { templateId: '1001', data: { '@number': '5', items: { item: [] } }, output: 'base64' });
  const j = await r.json();
  assert.equal(j.pages, 1);
  assert.ok(Buffer.from(j.pdfBase64, 'base64').subarray(0, 5).toString() === '%PDF-');
});

test('unknown template and bad data', async () => {
  let r = await json('POST', '/api/render', { templateId: '999', data: {} });
  assert.equal(r.status, 404);
  r = await fetch(`${base}/api/render/1001`, { method: 'POST', headers: { 'Content-Type': 'application/xml' }, body: '<a><b></a>' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /XML/);
});

test('barcode endpoint', async () => {
  const r = await fetch(`${base}/api/barcode?type=qrcode&text=hello`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /^<svg/);
  assert.equal((await fetch(`${base}/api/barcode?type=nope&text=1`)).status, 400);
});
