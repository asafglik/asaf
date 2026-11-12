// End-to-end: needs Chrome/Chromium/Edge (skipped when none is installed).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { renderPdf, findChrome, closeBrowser } from '../server/render/pdf.js';
import { buildDocumentHtml } from '../server/render/html.js';

const template = JSON.parse(fs.readFileSync(new URL('../examples/template-1001.json', import.meta.url), 'utf8'));
const xml = fs.readFileSync(new URL('../examples/invoice.xml', import.meta.url), 'utf8');
const chrome = findChrome();

after(() => closeBrowser());

test('HTML contains bound and computed values, escaped', () => {
  const { html, errors } = buildDocumentHtml(template, { company: { name: '<b>X</b>' }, items: { item: [] } }, { fontsCss: '' });
  assert.deepEqual(errors, []);
  assert.ok(html.includes('&lt;b&gt;X&lt;/b&gt;'));
  assert.ok(!html.includes('<b>X</b>'));
});

test('single page invoice from XML', { skip: !chrome && 'no browser' }, async () => {
  const { pdf, pages, errors } = await renderPdf(template, xml);
  assert.equal(pages, 1);
  assert.deepEqual(errors, []);
  const doc = await PDFDocument.load(pdf);
  assert.equal(doc.getPageCount(), 1);
});

test('long table continues on new pages', { skip: !chrome && 'no browser' }, async () => {
  const items = Array.from({ length: 80 }, (_, i) => ({ sku: `S${i}`, description: `פריט ${i}`, qty: 1, price: 10 }));
  const { pdf, pages } = await renderPdf(template, { '@number': '1', vat: 17, items: { item: items } });
  assert.ok(pages >= 3, `expected 3+ pages, got ${pages}`);
  assert.equal((await PDFDocument.load(pdf)).getPageCount(), pages);
});

test('PDF background is merged under the content', { skip: !chrome && 'no browser' }, async () => {
  const { pdf: bg } = await renderPdf(template, xml);
  const t = {
    page: { size: 'A4' },
    sourcePdf: bg.toString('base64'),
    pages: [{ background: { type: 'pdf', pageIndex: 0 }, elements: [{ id: 'a', type: 'field', x: 10, y: 10, w: 50, h: 10, binding: 'x' }] }],
  };
  const { pdf, pages } = await renderPdf(t, { x: 'stamp' });
  assert.equal(pages, 1);
  assert.equal((await PDFDocument.load(pdf)).getPageCount(), 1);
});
