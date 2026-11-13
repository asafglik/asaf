// Regression tests for bugs found in the code review.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, degrees } from 'pdf-lib';
import { evalExpr, scopeFor, exprPath, interpolate } from '../shared/expr.js';
import { formatValue } from '../shared/format.js';
import { parseData } from '../server/data.js';
import { buildDocumentHtml } from '../server/render/html.js';
import { renderPdf, findChrome, closeBrowser } from '../server/render/pdf.js';

after(() => closeBrowser());
const s = scopeFor({ flag: 'N', yes: 'X', d: '12/11/2026', 'Total Sum': 7, c: { 'first-name': 'דנה' }, list: [{ a: 1 }, { a: 5 }] });
const chrome = !!findChrome();

test('min/max with two scalar arguments', () => {
  assert.equal(evalExpr('max(10, 0)', s), 10);
  assert.equal(evalExpr('min(3, 5)', s), 3);
  assert.equal(evalExpr('max(list, a)', s), 5);
  assert.equal(evalExpr('min(list.a)', s), 1);
});

test('boolean comparison uses the checkbox truth set', () => {
  assert.equal(evalExpr('flag == true', s), false);
  assert.equal(evalExpr('yes == true', s), true);
  assert.equal(formatValue('X', 'bool'), 'כן');
});

test('dates and thousands separators compare correctly', () => {
  assert.equal(evalExpr('d > "01/12/2026"', s), false);
  assert.equal(evalExpr('d < "01/12/2026"', s), true);
  assert.equal(evalExpr('"1,234" + 1', s), 1235);
});

test('paths with dashes and spaces', () => {
  assert.equal(exprPath('c.first-name'), 'c["first-name"]');
  assert.equal(evalExpr(exprPath('c.first-name'), s), 'דנה');
  assert.equal(evalExpr(exprPath('Total Sum'), s), 7);
  const { html } = buildDocumentHtml({ page: { size: 'A4' }, pages: [{ elements: [{ id: 'f', type: 'field', x: 0, y: 0, w: 50, h: 8, binding: 'c.first-name' }] }] }, { c: { 'first-name': 'דנה' } }, { fontsCss: '' });
  assert.ok(html.includes('דנה'));
});

test('comparison operators inside {{ }} in plain text', () => {
  assert.equal(interpolate('{{ 3<5 or 1>3 }}', s), 'true');
});

test('invalid format specs never throw', () => {
  assert.equal(formatValue(5, 'currency:₪').includes('5'), true);
  assert.doesNotThrow(() => formatValue(5, 'number:abc'));
  assert.doesNotThrow(() => formatValue(5, 'currency:XXXXX'));
});

test('XML numeric character references are decoded', () => {
  assert.equal(parseData('<a><n>&#1488;&#x5D1;</n></a>').n, 'אב');
});

test('two long tables on one page both continue', { skip: !chrome && 'no browser' }, async () => {
  const rows = Array.from({ length: 70 }, (_, i) => ({ a: `r${i}` }));
  const tbl = (id, x) => ({ id, type: 'table', x, y: 10, w: 90, h: 120, binding: 'rows', overflow: 'paginate', columns: [{ id: 'c', header: 'h', binding: 'a', width: 1 }] });
  const t = { page: { size: 'A4' }, pages: [{ elements: [tbl('t1', 5), tbl('t2', 110)] }] };
  const { pages, errors } = await renderPdf(t, { rows });
  assert.ok(pages >= 3, `pages ${pages}`);
  assert.deepEqual(errors, []);
});

test('rich text made of one long list is split across pages', { skip: !chrome && 'no browser' }, async () => {
  const items = Array.from({ length: 120 }, (_, i) => `<li>סעיף ${i}</li>`).join('');
  const t = { page: { size: 'A4' }, pages: [{ elements: [{ id: 'r', type: 'richtext', x: 10, y: 10, w: 180, h: 200, overflow: 'paginate', html: `<div><ol>${items}</ol></div>` }] }] };
  const { pages, errors } = await renderPdf(t, {});
  assert.ok(pages >= 2, `pages ${pages}`);
  assert.deepEqual(errors, []);
});

test('rotated and blank PDF background pages', { skip: !chrome && 'no browser' }, async () => {
  const src = await PDFDocument.create();
  const p1 = src.addPage([595, 842]);
  p1.drawText('x', { x: 50, y: 50 });
  p1.setRotation(degrees(90));
  src.addPage([595, 842]); // blank: no content stream
  const b64 = Buffer.from(await src.save()).toString('base64');
  const t = { page: { size: 'A4' }, sourcePdf: b64, pages: [{ background: { type: 'pdf', pageIndex: 0 }, elements: [] }, { background: { type: 'pdf', pageIndex: 1 }, elements: [] }] };
  const { pages } = await renderPdf(t, {});
  assert.equal(pages, 2);
});

test('repeated placeholders get unique names in the output', { skip: !chrome && 'no browser' }, async () => {
  const rows = Array.from({ length: 100 }, () => ({ a: 'x' }));
  const t = { page: { size: 'A4' }, pages: [{ elements: [
    { id: 't', type: 'table', x: 10, y: 10, w: 190, h: 200, binding: 'rows', overflow: 'paginate', columns: [{ id: 'c', header: 'h', binding: 'a', width: 1 }] },
    { id: 's', type: 'signature', placeholder: 'sig', x: 10, y: 250, w: 50, h: 15 },
  ] }] };
  const { placeholders } = await renderPdf(t, { rows });
  const names = placeholders.map((p) => p.name);
  assert.ok(names.length > 1);
  assert.equal(new Set(names).size, names.length);
  assert.ok(placeholders.every((p) => p.baseName === 'sig'));
});
