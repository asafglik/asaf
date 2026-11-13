// Design agent paths that work without an AI key: a form built from the data
// world alone, and a Word file turned into a sample PDF for the agent.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-ai-'));
fs.mkdirSync(path.join(tmp, 'templates'), { recursive: true });
process.env.FD_STORAGE = tmp;
delete process.env.ANTHROPIC_API_KEY;

const { app } = await import('../server/index.js');
const { heuristicFromData } = await import('../server/ai.js');
const { describeData } = await import('../server/data.js');
const { renderPdf, closeBrowser } = await import('../server/render/pdf.js');
const { sanitizeTemplate } = await import('../server/sanitize.js');
const { ZipWriter } = await import('../server/batch.js');

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
const { tree, data } = describeData(xml, { format: 'xml', detectLists: true });

test('a basic form is built from the data world alone', async () => {
  const r = heuristicFromData({ template: { name: 'חשבונית', page: { size: 'A4' } }, tree });
  assert.equal(r.heuristic, true);
  const els = r.operations.map((o) => o.element);
  const fields = els.filter((e) => e.type === 'field');
  assert.ok(fields.length >= 8, `fields: ${fields.length}`);
  assert.ok(fields.some((f) => f.binding === 'customer.name'));
  const table = els.find((e) => e.type === 'table');
  assert.ok(table, 'a table for the items list');
  assert.match(table.binding, /items/);
  assert.ok(table.columns.some((c) => c.binding === 'price'));
  assert.ok(els.some((e) => e.type === 'signature'));
  // everything stays on the page
  for (const e of els) {
    assert.ok(e.x >= 0 && e.y >= 0 && e.x + e.w <= 210.01 && e.y + e.h <= 297.01, JSON.stringify(e));
  }
  // and it renders with the data
  const tpl = sanitizeTemplate({ page: { size: 'A4' }, pages: [{ id: 'p1', elements: els.map((e, i) => ({ id: `e${i}`, ...e })) }] });
  const out = await renderPdf(tpl, data);
  assert.ok(out.pages >= 1);
  assert.deepEqual(out.errors, []);
  assert.equal(out.placeholders.filter((p) => p.kind === 'signature').length, 1);
});

test('auto-design in "data" mode answers without an AI key', async () => {
  const res = await fetch(`${base}/api/ai/auto-design`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template: { name: 'x', page: { size: 'A4' }, pages: [{ id: 'p', elements: [] }] }, tree, pages: [], mode: 'data' }) });
  assert.equal(res.status, 200);
  const r = await res.json();
  assert.equal(r.heuristic, true);
  assert.ok(r.operations.length > 5);
  const none = await fetch(`${base}/api/ai/auto-design`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template: {}, tree: null, mode: 'data' }) });
  assert.equal(none.status, 400);
});

// a minimal .docx built in memory
async function makeDocx() {
  const parts = [];
  const z = new ZipWriter((b) => { parts.push(b); });
  await z.add('[Content_Types].xml', Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'));
  await z.add('_rels/.rels', Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'));
  await z.add('word/document.xml', Buffer.from('<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>טופס בקשה</w:t></w:r></w:p><w:p><w:r><w:t>שם הלקוח: ______</w:t></w:r></w:p><w:p><w:r><w:t>חתימה: ______</w:t></w:r></w:p></w:body></w:document>'));
  await z.finish();
  return Buffer.concat(parts);
}

test('a Word file becomes a sample PDF for the design agent', async () => {
  const docx = await makeDocx();
  const res = await fetch(`${base}/api/import/docx`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataBase64: docx.toString('base64'), mode: 'sample', fileName: 'sample.docx' }) });
  const r = await res.json();
  assert.equal(res.status, 200, JSON.stringify(r));
  assert.ok(['html', 'libreoffice'].includes(r.via));
  assert.equal(Buffer.from(r.pdfBase64, 'base64').subarray(0, 5).toString(), '%PDF-');
});
