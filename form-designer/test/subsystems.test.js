// The three subsystems: the designer (admin + per-customer designers), the
// template repository, and runtime servers that sync from it.
// The central server runs as a child process; this process is the runtime.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const central = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-central-'));
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-runtime-'));
fs.mkdirSync(path.join(runtime, 'templates'), { recursive: true });
process.env.FD_STORAGE = runtime;
process.env.FD_MODE = 'render';
delete process.env.FD_API_KEY;

const ADMIN = 'admin-key-0123456789abcdef';
const A_API = 'fdk_customer_a_render_key_0001';
const A_DESIGN = 'fdd_customer_a_design_key_0001';
const B_DESIGN = 'fdd_customer_b_design_key_0001';
const tpl = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples/template-1001.json'), 'utf8'));
const xml = fs.readFileSync(path.join(ROOT, 'examples/invoice.xml'), 'utf8');

const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

let child;
let C; // central base URL
let R; // runtime base URL
let server;
let repo;
let closeBrowser;
let A;
let B;

before(async () => {
  const port = await freePort();
  child = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env: { ...process.env, FD_MODE: 'full', FD_STORAGE: central, FD_API_KEY: ADMIN, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((res, rej) => {
    child.stdout.on('data', (d) => { if (String(d).includes('Form Designer')) res(); });
    child.once('exit', (c) => rej(new Error('central server exited ' + c)));
  });
  C = `http://127.0.0.1:${port}`;
  const { app } = await import('../server/index.js');
  repo = await import('../server/repo.js');
  ({ closeBrowser } = await import('../server/render/pdf.js'));
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  R = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server?.close();
  child?.kill();
  await closeBrowser?.();
  fs.rmSync(central, { recursive: true, force: true });
  fs.rmSync(runtime, { recursive: true, force: true });
});

const call = (base, method, url, key, body, headers = {}) => fetch(base + url, {
  method,
  headers: { ...(key ? { 'x-api-key': key } : {}), ...(body !== undefined && typeof body !== 'string' ? { 'Content-Type': 'application/json' } : {}), ...headers },
  body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
});
const ok = async (p, status = 200) => { const r = await p; const b = await r.json().catch(() => null); assert.equal(r.status, status, JSON.stringify(b)); return b; };

test('admin sets up customers with render and design keys', async () => {
  A = await ok(call(C, 'POST', '/api/customers', ADMIN, { name: 'לקוח א', apiKey: A_API, designKey: A_DESIGN }), 201);
  B = await ok(call(C, 'POST', '/api/customers', ADMIN, { name: 'לקוח ב', designKey: B_DESIGN }), 201);
  assert.equal(A.hasApiKey, true);
  assert.equal(A.hasDesignKey, true);
  assert.equal(A.designKeyHash, undefined);
  // the same key cannot serve as render and design key
  await ok(call(C, 'PUT', `/api/customers/${B.id}`, ADMIN, { name: 'לקוח ב', apiKey: B_DESIGN }), 400);
  await ok(call(C, 'POST', '/api/templates', ADMIN, { ...tpl, id: '1001', customers: undefined }), 201);
  await ok(call(C, 'POST', '/api/templates', ADMIN, { ...tpl, id: '2001', name: 'משותפת' }), 201);
  await ok(call(C, 'POST', '/api/templates', ADMIN, { ...tpl, id: '5001', name: 'של ב' }), 201);
  await ok(call(C, 'PUT', `/api/customers/${A.id}/templates`, ADMIN, { templates: ['1001', '2001'] }));
  await ok(call(C, 'PUT', `/api/customers/${B.id}/templates`, ADMIN, { templates: ['2001', '5001'] }));
});

test("a customer's designer works only on its own templates", async () => {
  const me = await ok(call(C, 'GET', '/api/me', A_DESIGN));
  assert.equal(me.role, 'designer');
  assert.equal(me.customer.id, A.id);
  const list = await ok(call(C, 'GET', '/api/templates', A_DESIGN));
  assert.deepEqual(list.map((t) => t.id), ['1001', '2001']);
  // new template: linked to the customer automatically, whatever the body says
  const created = await ok(call(C, 'POST', '/api/templates', A_DESIGN, { ...tpl, id: '3001', name: 'חדשה של א', customers: [B.id] }), 201);
  assert.deepEqual(created.customers, [A.id]);
  // the designer gets the sample data of its template
  assert.ok((await ok(call(C, 'GET', '/api/templates/3001', A_DESIGN))).schema?.sample);
  await ok(call(C, 'PUT', '/api/templates/1001', A_DESIGN, { ...tpl, name: 'עודכן על ידי א' }));
  // shared with another customer: read-only for it, duplicating is fine
  const shared = await call(C, 'PUT', '/api/templates/2001', A_DESIGN, { ...tpl, name: 'x' });
  assert.equal(shared.status, 403);
  assert.match((await shared.json()).error, /משותפת/);
  const dup = await ok(call(C, 'POST', '/api/templates/2001/duplicate', A_DESIGN, { id: '3002' }), 201);
  assert.deepEqual(dup.customers, [A.id]);
  // other customers' templates and admin screens are closed
  await ok(call(C, 'GET', '/api/templates/5001', A_DESIGN), 403);
  await ok(call(C, 'PUT', '/api/templates/5001', A_DESIGN, { ...tpl }), 403);
  await ok(call(C, 'POST', '/api/templates?overwrite=1', A_DESIGN, { ...tpl, id: '5001' }), 403);
  await ok(call(C, 'DELETE', '/api/templates/5001', A_DESIGN), 403);
  await ok(call(C, 'GET', '/api/customers', A_DESIGN), 403);
  await ok(call(C, 'PUT', '/api/templates/1001/customers', A_DESIGN, { customers: [B.id] }), 403);
  await ok(call(C, 'POST', '/api/fonts', A_DESIGN, { family: 'X', dataBase64: 'AA==' }), 403);
  // the render key cannot design
  await ok(call(C, 'PUT', '/api/templates/1001', A_API, { ...tpl }), 403);
  // B's designer does not see A's templates
  assert.deepEqual((await ok(call(C, 'GET', '/api/templates', B_DESIGN))).map((t) => t.id), ['2001', '5001']);
  await ok(call(C, 'GET', '/api/templates/1001', B_DESIGN), 403);
});

test('the repository lists and hands out only the customer templates', async () => {
  const list = await ok(call(C, 'GET', '/api/repo/templates', A_API));
  assert.deepEqual(list.map((t) => t.id), ['1001', '2001', '3001', '3002']);
  assert.ok(list.every((t) => t.version > 0 && t.updatedAt));
  const one = await ok(call(C, 'GET', '/api/repo/templates/2001', A_API));
  assert.deepEqual(one.customers, [A.id]); // B is not revealed
  const withFonts = await ok(call(C, 'GET', '/api/repo/templates/1001?fonts=1', A_API));
  assert.equal(withFonts.template.id, '1001');
  assert.ok(Array.isArray(withFonts.fonts));
  await ok(call(C, 'GET', '/api/repo/templates/5001', A_API), 403);
  await ok(call(C, 'GET', '/api/repo/templates', null), 401);
  // admin: per customer
  await ok(call(C, 'GET', '/api/repo/templates', ADMIN), 400);
  assert.equal((await ok(call(C, 'GET', `/api/repo/templates?customer=${B.id}`, ADMIN))).length, 2);
  const bundle = await ok(call(C, 'GET', '/api/repo/bundle', A_API));
  assert.equal(bundle.kind, 'form-designer-bundle');
  assert.equal(bundle.templates.length, 4);
  assert.ok(bundle.customer.apiKeyHash);
});

test('a runtime server syncs from the repository: only changes are downloaded', async () => {
  let r = await repo.syncFromRepo({ url: C, keys: [A_API] });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.customers[0].installed.sort(), ['1001', '2001', '3001', '3002']);
  r = await repo.syncFromRepo({ url: C, keys: [A_API] });
  assert.equal(r.customers[0].installed.length, 0);
  assert.equal(r.customers[0].unchanged.length, 4);
  // a template changed in the designer, another one unlinked from the customer
  await ok(call(C, 'PUT', '/api/templates/1001', A_DESIGN, { ...tpl, name: 'גרסה 2' }));
  await ok(call(C, 'PUT', `/api/customers/${A.id}/templates`, ADMIN, { templates: ['1001', '2001', '3002'] }));
  r = await repo.syncFromRepo({ url: C, keys: [A_API] });
  assert.deepEqual(r.customers[0].installed, ['1001']);
  assert.deepEqual(r.customers[0].removed, ['3001']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(runtime, 'templates', '1001.json'), 'utf8')).name, 'גרסה 2');
  // a wrong key fails without touching the installed templates
  r = await repo.syncFromRepo({ url: C, keys: ['fdk_wrong_key_000000000000'] });
  assert.equal(r.ok, false);
  assert.ok(fs.existsSync(path.join(runtime, 'templates', '1001.json')));
});

test('the runtime renders synced templates with the customer key only', async () => {
  const r = await call(R, 'POST', '/api/render/1001?output=json', A_API, xml, { 'Content-Type': 'application/xml' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.pdfBase64.length > 1000);
  assert.ok(Array.isArray(j.placeholders));
  assert.equal((await call(R, 'POST', '/api/render/1001', null, xml, { 'Content-Type': 'application/xml' })).status, 401);
  // no designer on a runtime server
  assert.equal((await call(R, 'GET', '/designer.html', A_API)).status, 404);
});

test('a template can also be sent inline with the data', async () => {
  const body = { template: { ...tpl, id: 'from-file' }, data: xml, output: 'base64' };
  const j = await ok(call(R, 'POST', '/api/render', A_API, body));
  assert.equal(j.templateId, 'from-file');
  assert.ok(j.pdfBase64.length > 1000);
  // on the central server: admin only
  await ok(call(C, 'POST', '/api/render', A_API, body), 403);
  assert.equal((await call(C, 'POST', '/api/render', ADMIN, body)).status, 200);
});

test('a bundle file installs the same way (with --prune semantics)', async () => {
  const bundle = await ok(call(C, 'GET', '/api/repo/bundle', A_API));
  bundle.templates = bundle.templates.filter((t) => t.id !== '3002');
  const res = repo.installBundle(bundle, { prune: true });
  assert.deepEqual(res.removed, ['3002']);
  assert.ok(res.unchanged.includes('1001'));
});
