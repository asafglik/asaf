// Multi-language templates.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { localizeElement, localizeTemplate, missingTranslations, templateLanguages } from '../shared/i18n.js';
import { buildDocumentHtml } from '../server/render/html.js';
import { formatValue, setFormatLanguage } from '../shared/format.js';
import { parseData } from '../server/data.js';

const t1001 = JSON.parse(fs.readFileSync(new URL('../examples/template-1001.json', import.meta.url), 'utf8'));
const xml = fs.readFileSync(new URL('../examples/invoice.xml', import.meta.url), 'utf8');

test('translations replace texts; missing ones fall back to the default language', () => {
  const el = { id: 'a', type: 'text', x: 10, y: 0, w: 50, h: 5, text: 'שלום', style: { align: 'right' }, tr: { en: { text: 'Hello' } } };
  const en = localizeElement(el, 'en', 'he');
  assert.equal(en.text, 'Hello');
  assert.equal(en.style.direction, 'ltr');
  assert.equal(en.style.align, 'left');
  assert.equal(localizeElement({ ...el, tr: {} }, 'en', 'he').text, 'שלום');
  assert.equal(localizeElement(el, 'ar', 'he').style.align, 'right', 'same direction: no mirroring');
});

test('layout mirrors for the other direction, but not over a PDF background', () => {
  const t = { pages: [{ elements: [{ id: 'a', type: 'text', x: 10, w: 50, text: 'x' }] }, { background: { type: 'pdf', pageIndex: 0 }, elements: [{ id: 'b', type: 'text', x: 10, w: 50, text: 'y' }] }] };
  const en = localizeTemplate(t, 'en', { pageWidth: 210 });
  assert.equal(en.pages[0].elements[0].x, 150);
  assert.equal(en.pages[1].elements[0].x, 10);
  assert.equal(localizeTemplate({ ...t, mirrorLayout: 'never' }, 'en', { pageWidth: 210 }).pages[0].elements[0].x, 10);
});

test('sample invoice prints in English', () => {
  assert.deepEqual(templateLanguages(t1001), ['he', 'en']);
  assert.deepEqual(missingTranslations(t1001, 'en').map((m) => m.text), []);
  const { html } = buildDocumentHtml(t1001, parseData(xml), { fontsCss: '', lang: 'en' });
  assert.match(html, /<html lang="en" dir="ltr">/);
  assert.match(html, /Tax Invoice No\./);
  assert.match(html, /12 November 2026/);
  assert.match(html, /Page <span class="fd-pn">/);
  const he = buildDocumentHtml(t1001, parseData(xml), { fontsCss: '' }).html;
  assert.match(he, /חשבונית מס מספר/);
  assert.match(he, /<html lang="he" dir="rtl">/);
});

test('$lang in expressions and localized yes/no', () => {
  const t = { pages: [{ elements: [{ id: 'a', type: 'text', x: 0, y: 0, w: 50, h: 5, text: '{{ $lang }} {{ ok | bool }}' }] }] };
  assert.match(buildDocumentHtml(t, { ok: true }, { fontsCss: '', lang: 'en' }).html, /en Yes/);
  assert.match(buildDocumentHtml(t, { ok: true }, { fontsCss: '' }).html, /he כן/);
  setFormatLanguage('he');
  assert.equal(formatValue(true, 'bool'), 'כן');
});
