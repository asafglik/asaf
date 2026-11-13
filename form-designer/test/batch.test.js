// Bulk rendering: many records -> streamed ZIP / merged PDF / JSON.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-batch-'));
fs.mkdirSync(path.join(tmp, 'templates'), { recursive: true });
fs.copyFileSync(new URL('../examples/template-1001.json', import.meta.url), path.join(tmp, 'templates', '1001.json'));
process.env.FD_STORAGE = tmp;

const { app } = await import('../server/index.js');
const { closeBrowser } = await import('../server/render/pdf.js');
const { recordFileName } = await import('../server/batch.js');
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
const records = Array.from({ length: 6 }, (_, i) => xml.replace(/number="[^"]*"/, `number="INV-${i + 1}"`));
const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Entry names and bodies of a stored ZIP. */
function unzip(buf) {
  const out = {};
  let o = 0;
  while (buf.readUInt32LE(o) === 0x04034b50) {
    const size = buf.readUInt32LE(o + 18);
    const nlen = buf.readUInt16LE(o + 26);
    const name = buf.subarray(o + 30, o + 30 + nlen).toString('utf8');
    out[name] = buf.subarray(o + 30 + nlen, o + 30 + nlen + size);
    o += 30 + nlen + size;
  }
  assert.equal(buf.readUInt32LE(buf.length - 22), 0x06054b50);
  return out;
}

test('file name pattern per record stays unique', () => {
  const used = new Set();
  assert.equal(recordFileName('inv-{{n}}', { n: 'A/1' }, 0, used), 'inv-A_1.pdf');
  assert.equal(recordFileName('inv-{{n}}', { n: 'A/1' }, 1, used), 'inv-A_1_2.pdf');
  assert.equal(recordFileName('', {}, 2, used), '00003.pdf');
});

test('ZIP with one PDF per record and a manifest', async () => {
  const r = await post('/api/render-batch/1001', { records: [...records, '<broken'], fileName: 'invoice-{{number}}' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/zip');
  const files = unzip(Buffer.from(await r.arrayBuffer()));
  const pdfs = Object.keys(files).filter((n) => n.endsWith('.pdf')).sort();
  assert.equal(pdfs.length, 6);
  assert.ok(pdfs.includes('invoice-INV-3.pdf'), pdfs.join());
  assert.equal(files['invoice-INV-1.pdf'].subarray(0, 5).toString(), '%PDF-');
  const m = JSON.parse(files['manifest.json']);
  assert.deepEqual([m.count, m.ok, m.failed], [7, 6, 1]);
  assert.equal(m.items[6].ok, false);
});

test('merged PDF and split of one XML with a list', async () => {
  const many = `<invoices>${records.slice(0, 3).map((x) => x.replace(/<\?xml[^>]*\?>/, '').replace(/^\s*<invoice>/, '<invoice>')).join('')}</invoices>`;
  const r = await post('/api/render-batch/1001?output=merged', { data: many, split: 'invoice' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-batch-count'), '3');
  const doc = await PDFDocument.load(Buffer.from(await r.arrayBuffer()));
  assert.equal(doc.getPageCount(), 3);
});

test('JSON output and limits', async () => {
  const r = await post('/api/render-batch/1001', { records: records.slice(0, 2), output: 'json' });
  const j = await r.json();
  assert.equal(j.ok, 2);
  assert.ok(j.items[0].pdfBase64.length > 1000);
  assert.equal((await post('/api/render-batch/1001', { records: [] })).status, 400);
});
