// Placeholders, header/footer bands, conditions, customers and the rule-based designer.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-feat-'));
fs.mkdirSync(path.join(tmp, 'templates'), { recursive: true });
fs.copyFileSync(new URL('../examples/template-1001.json', import.meta.url), path.join(tmp, 'templates', '1001.json'));
process.env.FD_STORAGE = tmp;
delete process.env.ANTHROPIC_API_KEY;

const { app } = await import('../server/index.js');
const { renderPdf, findChrome, closeBrowser } = await import('../server/render/pdf.js');
const { templatePlaceholders } = await import('../shared/elements.js');
const { heuristicDesign } = await import('../server/ai.js');
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

const sigTemplate = {
  name: 'חוזה',
  page: { size: 'A4' },
  header: { enabled: true, height: 20, showOn: 'all', elements: [{ id: 'h1', type: 'text', x: 10, y: 5, w: 100, h: 8, text: 'כותרת' }] },
  footer: { enabled: true, height: 15, showOn: 'all', elements: [{ id: 'f1', type: 'text', x: 10, y: 5, w: 100, h: 6, text: 'עמוד {{page}} מתוך {{pages}}' }, { id: 'f2', type: 'upload', placeholder: 'stamp', label: 'חותמת', x: 150, y: 1, w: 30, h: 12 }] },
  pages: [{ id: 'p1', elements: [
    { id: 't', type: 'table', x: 10, y: 25, w: 190, h: 200, binding: 'rows', overflow: 'paginate', columns: [{ id: 'c', header: 'א', binding: 'a', width: 1 }] },
    { id: 's1', type: 'signature', placeholder: 'customer_sign', label: 'חתימת הלקוח', required: true, x: 20, y: 240, w: 60, h: 18, showOn: 'last' },
    { id: 's2', type: 'signature', placeholder: 'guarantor_sign', label: 'ערב', x: 120, y: 240, w: 60, h: 18, visibleIf: 'hasGuarantor == true' },
  ] }],
};

test('static placeholders: positions in mm and PDF points, bands included', () => {
  const ph = templatePlaceholders(sigTemplate, 210, 297);
  const s = ph.find((p) => p.name === 'customer_sign');
  assert.deepEqual(s.mm, { x: 20, y: 240, width: 60, height: 18 });
  assert.equal(s.page, 1);
  assert.ok(Math.abs(s.pdf.y - (297 - 258) * 72 / 25.4) < 0.01);
  const stamp = ph.find((p) => p.name === 'stamp');
  assert.equal(stamp.band, 'footer');
  assert.equal(stamp.mm.y, 297 - 15 + 1);
});

test('saving a template returns its placeholders', async () => {
  const r = await json('POST', '/api/templates', { ...sigTemplate, id: '2001' });
  const t = await r.json();
  assert.equal(r.status, 201);
  assert.deepEqual(t.placeholders.map((p) => p.name).sort(), ['customer_sign', 'guarantor_sign', 'stamp']);
  assert.equal(t.sourcePdf, undefined);
  const r2 = await (await fetch(`${base}/api/templates/2001/placeholders`)).json();
  assert.equal(r2.placeholders.length, 3);
});

test('rendered placeholders follow pagination and conditions', { skip: !findChrome() && 'no browser' }, async () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({ a: `שורה ${i}` }));
  const { pages, placeholders } = await renderPdf(sigTemplate, { rows, hasGuarantor: false });
  assert.ok(pages >= 2);
  const sign = placeholders.filter((p) => p.name === 'customer_sign');
  assert.equal(sign.length, 1, 'showOn last: only once');
  assert.equal(sign[0].page, pages);
  assert.equal(placeholders.filter((p) => p.name === 'guarantor_sign').length, 0, 'hidden by condition');
  assert.equal(placeholders.filter((p) => p.baseName === 'stamp').length, pages, 'footer upload area on every page');
  const withG = await renderPdf(sigTemplate, { rows: [], hasGuarantor: 'true' });
  assert.equal(withG.placeholders.filter((p) => p.name === 'guarantor_sign').length, 1);
});

test('header/footer showOn notFirst is applied to the whole document', { skip: !findChrome() && 'no browser' }, async () => {
  const t = JSON.parse(JSON.stringify(sigTemplate));
  t.footer.showOn = 'notFirst';
  const { pages, placeholders } = await renderPdf(t, { rows: Array.from({ length: 120 }, () => ({ a: 'x' })) });
  assert.equal(placeholders.filter((p) => p.baseName === 'stamp').length, pages - 1);
  assert.ok(!placeholders.some((p) => p.baseName === 'stamp' && p.page === 1));
});

test('duplicate a template', async () => {
  const r = await json('POST', '/api/templates/2001/duplicate', { id: '2002', name: 'עותק' });
  assert.equal(r.status, 201);
  const t = await r.json();
  assert.equal(t.id, '2002');
  assert.equal(t.duplicatedFrom, '2001');
  assert.equal((await json('POST', '/api/templates/2001/duplicate', { id: '2002' })).status, 409);
});

test('customers: link templates, customer API key is limited to its templates', async () => {
  let r = await json('POST', '/api/customers', { name: 'לקוח א', apiKey: 'key-a-0123456789abcdef' });
  const c = await r.json();
  assert.equal(r.status, 201);
  r = await json('PUT', `/api/customers/${c.id}/templates`, { templates: ['2001'] });
  assert.equal(r.status, 200);
  const list = await (await fetch(`${base}/api/customers`)).json();
  assert.deepEqual(list[0].templates, ['2001']);
  // customer key: sees and renders only its own templates, no designer API
  const mine = await (await fetch(`${base}/api/templates`, { headers: { 'x-api-key': 'key-a-0123456789abcdef' } })).json();
  assert.deepEqual(mine.map((t) => t.id), ['2001']);
  assert.equal((await json('POST', '/api/render', { templateId: '1001', data: {} }, { 'x-api-key': 'key-a-0123456789abcdef' })).status, 403);
  assert.equal((await json('PUT', '/api/templates/2001', {}, { 'x-api-key': 'key-a-0123456789abcdef' })).status, 403);
  const bundle = await (await fetch(`${base}/api/customers/${c.id}/bundle`)).json();
  assert.equal(bundle.kind, 'form-designer-bundle');
  assert.deepEqual(bundle.templates.map((t) => t.id), ['2001']);
  // delete unlinks
  await json('DELETE', `/api/customers/${c.id}`);
  const t = await (await fetch(`${base}/api/templates/2001`)).json();
  assert.deepEqual(t.customers, []);
});

test('ai status and rule-based auto design without an API key', async () => {
  const st = await (await fetch(`${base}/api/ai/status`)).json();
  assert.equal(st.available, false);
  const tree = { children: [{ kind: 'object', name: 'customer', path: 'customer', children: [{ kind: 'value', name: 'name', path: 'customer.name' }, { kind: 'value', name: 'email', path: 'customer.email' }] }] };
  const pages = [{
    width: 210, height: 297,
    texts: [{ str: 'Name:', x: 180, y: 40, w: 12, h: 4 }, { str: 'Email:', x: 180, y: 50, w: 13, h: 4 }, { str: 'Signature:', x: 175, y: 100, w: 20, h: 4 }],
    fields: [{ name: 'agree', type: 'checkbox', x: 20, y: 200, w: 4, h: 4 }],
  }];
  const r = heuristicDesign({ tree, pages });
  const types = r.operations.map((o) => o.element.type);
  assert.deepEqual(types.filter((t) => t === 'field').length, 2);
  assert.ok(types.includes('signature'));
  assert.ok(types.includes('checkbox'));
  assert.equal(r.operations.find((o) => o.element.name === 'Name').element.binding, 'customer.name');
  const field = r.operations.find((o) => o.element.name === 'Name').element;
  assert.ok(field.x + field.w <= 180, 'field is left of its label (RTL)');
  const api = await (await json('POST', '/api/ai/auto-design', { tree, pages })).json();
  assert.equal(api.operations.length, r.operations.length);
  assert.equal((await json('POST', '/api/ai/request', { request: 'x' })).status, 501);
});

test('designer save keeps customer links', async () => {
  const c = await (await json('POST', '/api/customers', { name: 'שומר קישור' })).json();
  const t = await (await fetch(`${base}/api/templates/2002`)).json();
  await json('PUT', `/api/customers/${c.id}/templates`, { templates: ['2002'] });
  await json('PUT', '/api/templates/2002', { ...t, customers: [] }); // stale copy from an open designer tab
  const again = await (await fetch(`${base}/api/templates/2002`)).json();
  assert.deepEqual(again.customers, [c.id]);
});
