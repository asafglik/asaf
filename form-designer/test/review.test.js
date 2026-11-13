// Design review of a sample PDF: values -> data paths, labels, tables, findings, rebuild.
// The sample is produced here from template 1002 and the (anonymized) service call.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderPdf, findChrome, closeBrowser } from '../server/render/pdf.js';
import { describeData } from '../server/data.js';
import { decodeBytes } from '../shared/encoding.js';
import { analyzeDocument } from '../shared/pdfanalyze.js';
import { reviewPdf, variants, flattenData } from '../server/review.js';

after(() => closeBrowser());
const chrome = !!findChrome();
const template = JSON.parse(fs.readFileSync(new URL('../examples/template-1002.json', import.meta.url), 'utf8'));
const xml = decodeBytes(fs.readFileSync(new URL('../examples/service-call-pdi.xml', import.meta.url)));
const { data } = describeData(xml, { arrays: template.schema.arrays });

test('value variants: dates, numbers, Code39 text', () => {
  const v = (x) => variants(x).map((o) => o.text);
  assert.ok(v('20250123').includes('23/01/2025'));
  assert.ok(v('2025-01-23').includes('23/01/25'));
  assert.ok(v('55').includes('55.0'));
  assert.ok(v('169990').includes('169,990.00'));
  assert.ok(!v('01').includes('1.0'), 'leading zero: not a number');
  assert.ok(v('*ABC123*').includes('ABC123'));
});

test('flattened data keeps list rows', () => {
  const e = flattenData(data).find((x) => x.path.endsWith('AccessoryIssueForServiceCall[3].PartCode'));
  assert.equal(e.arrayPath, 'ServiceCall.Accessories.AccessoryIssueForServiceCall');
  assert.equal(e.index, 3);
  assert.equal(e.rel, 'PartCode');
});

test('review of a PDF generated from the data world', { skip: !chrome && 'no browser' }, async () => {
  const { pdf } = await renderPdf(template, xml);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), disableFontFace: true, verbosity: 0 }).promise;
  const pages = await analyzeDocument(pdfjs, doc);
  assert.ok(pages[0].texts.length > 20);
  assert.ok(pages[0].shapes.length > 0, 'lines / boxes are read');

  const r = reviewPdf({ pages, data });
  const byPath = (p) => r.mappings.find((m) => m.path === p || m.alternatives.includes(p));
  // values printed in the PDF are found in the data world, with the label beside them
  const lic = byPath('ServiceCall.EditLicenceNum');
  assert.ok(lic, 'license number found');
  assert.equal(lic.label, 'מספר רישוי');
  assert.ok(byPath('ServiceCall.Customer.CustomerName'));
  assert.ok(byPath('ServiceCall.CarOrderFolder.ColorDescription'));
  // the accessories list is recognized as a table with its columns
  const t = r.tables.find((x) => x.arrayPath === 'ServiceCall.Accessories.AccessoryIssueForServiceCall');
  assert.ok(t, 'accessories table');
  const rels = t.columns.map((c) => c.rel);
  assert.ok(rels.includes('PartCode') && rels.includes('PartDescription'), rels.join(','));
  assert.equal(t.columns.find((c) => c.rel === 'PartCode').header, 'מק"ט');
  // findings and a score
  assert.ok(r.score >= 1 && r.score <= 10);
  assert.ok(Array.isArray(r.issues));
  // rebuild: fields bound to the data, the table as a paginating table, page numbers live
  const els = r.operations.filter((o) => o.op === 'add_element').map((o) => o.element);
  assert.ok(els.some((e) => e.type === 'field' && e.binding === lic.path));
  assert.ok(els.some((e) => e.type === 'table' && e.binding === t.arrayPath && e.overflow === 'paginate'));
  assert.ok(els.some((e) => e.type === 'text' && e.text === 'עמוד {{page}} מתוך {{pages}}'));
});
