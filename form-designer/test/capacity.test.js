// Capacity: large XML goes through the worker threads, and when too many large
// bodies arrive at once the extra ones get 503 + Retry-After instead of
// exhausting memory.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-cap-'));
fs.mkdirSync(path.join(tmp, 'templates'), { recursive: true });
fs.copyFileSync(new URL('../examples/template-1001.json', import.meta.url), path.join(tmp, 'templates', '1001.json'));
process.env.FD_STORAGE = tmp;
process.env.FD_MAX_INFLIGHT_MB = '15';

const { app } = await import('../server/index.js');
const { closeBrowser } = await import('../server/render/pdf.js');
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

const xml = fs.readFileSync(new URL('../examples/invoice.xml', import.meta.url), 'utf8');
// ~10MB of data the template does not print
const filler = [];
for (let i = 0, n = 0; n < 10e6; i++) { const r = `<rec><id>${i}</id><text>רשומה ${i} עם טקסט לבדיקה</text></rec>`; filler.push(r); n += Buffer.byteLength(r); }
const big = Buffer.from(xml.replace('</invoice>', `<history>${filler.join('')}</history></invoice>`), 'utf8');
const post = (body) => fetch(`${base}/api/render/1001`, { method: 'POST', headers: { 'Content-Type': 'application/xml' }, body });

test('a 10MB XML renders', async () => {
  const r = await post(big);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-render-pages'), '1');
});

test('bodies over the in-flight limit get 503 with Retry-After; small calls still pass', async () => {
  const rs = await Promise.all([post(big), post(big), post(xml)]);
  const statuses = rs.map((r) => r.status);
  assert.equal(statuses[0], 200);
  assert.equal(statuses[1], 503);
  assert.equal(rs[1].headers.get('retry-after'), '5');
  assert.equal(statuses[2], 200);
  await Promise.all(rs.map((r) => r.arrayBuffer()));
  // once the first finished, the next large call is accepted again
  assert.equal((await post(big)).status, 200);
});
