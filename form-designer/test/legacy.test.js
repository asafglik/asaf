// Legacy data: windows-1255 XML, Caché $H dates, ddMMyyyy, visual (reversed) Hebrew, single-item lists.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodeBytes, charsetOf } from '../shared/encoding.js';
import { formatValue, fixVisualHebrew, fromHorolog, parseDateAs } from '../shared/format.js';
import { evalExpr, scopeFor } from '../shared/expr.js';
import { describeData } from '../server/data.js';

const sample = new URL('../examples/service-call-pdi.xml', import.meta.url);
const hebrew1255 = (s) => Buffer.from([...s].map((c) => (c >= 'א' && c <= 'ת' ? 0xe0 + c.charCodeAt(0) - 0x5d0 : c.charCodeAt(0))));

test('windows-1255 is decoded from the XML declaration, charset or fallback', () => {
  const body = Buffer.concat([Buffer.from("<?xml version='1.0' encoding='WINDOWS-1255' ?><a><n>"), hebrew1255('שלום'), Buffer.from('</n></a>')]);
  assert.match(decodeBytes(body), /שלום/);
  const noDecl = Buffer.concat([Buffer.from('<a><n>'), hebrew1255('שלום'), Buffer.from('</n></a>')]);
  assert.match(decodeBytes(noDecl), /שלום/, 'invalid UTF-8 falls back to windows-1255');
  assert.match(decodeBytes(noDecl, charsetOf('application/xml; charset=windows-1255')), /שלום/);
  assert.equal(decodeBytes(Buffer.from('﻿<a>שלום</a>', 'utf8')), '<a>שלום</a>');
});

test('the sample service call parses, with single-item lists detected', () => {
  const r = describeData(decodeBytes(fs.readFileSync(sample)), { detectLists: true });
  assert.equal(r.data.ServiceCall.Customer.Town, 'רמת גן');
  assert.ok(r.arrays.includes('ServiceCall.Complains.ComplainsInServiceCall'));
  assert.ok(r.arrays.includes('ServiceCall.RecallForServiceCall.ServiceCallRecall'));
  assert.ok(Array.isArray(r.data.ServiceCall.RecallForServiceCall.ServiceCallRecall));
  // without detection the stored list markings decide
  const plain = describeData(decodeBytes(fs.readFileSync(sample)), { arrays: [] });
  assert.ok(!Array.isArray(plain.data.ServiceCall.RecallForServiceCall.ServiceCallRecall));
});

test('Caché $H dates and times, ddMMyyyy and explicit layouts', () => {
  assert.equal(formatValue('66524', 'hdate'), '19/02/2023');
  assert.equal(formatValue('57889', 'htime'), '16:04');
  assert.equal(fromHorolog(1).getDate(), 1);
  assert.equal(formatValue('14052023', 'date'), '14/05/2023');
  assert.equal(formatValue('20230514', 'date'), '14/05/2023');
  assert.equal(formatValue('250415', 'date:dd/MM/yyyy<yyMMdd'), '15/04/2025');
  assert.equal(parseDateAs('19/02/23', 'dd/MM/yy').getFullYear(), 2023);
  assert.equal(formatValue(evalExpr('date("250415", "yyMMdd")', scopeFor({})), 'date'), '15/04/2025');
});

test('visual (reversed) Hebrew is turned to logical order', () => {
  assert.equal(fixVisualHebrew('95 ןיזנב -קלד לכימ'), 'מיכל דלק- בנזין 95');
  assert.equal(fixVisualHebrew('02/12/2024 10:20:20 ךיראתמ יאמש חוד'), 'דוח שמאי מתאריך 10:20:20 02/12/2024');
  assert.equal(fixVisualHebrew('םינמדזמ תוחוקל Idp - תוינוכמ'), 'מכוניות - Idp לקוחות מזדמנים');
  assert.equal(fixVisualHebrew('ABC 123'), 'ABC 123', 'no Hebrew: unchanged');
  assert.equal(formatValue('םולש', 'visual'), 'שלום');
});

// end to end: the render API receives the raw windows-1255 bytes
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-legacy-'));
fs.mkdirSync(path.join(tmp, 'templates'), { recursive: true });
fs.copyFileSync(new URL('../examples/template-1002.json', import.meta.url), path.join(tmp, 'templates', '1002.json'));
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

test('render API with a windows-1255 body', { skip: !findChrome() && 'no browser' }, async () => {
  const r = await fetch(`${base}/api/render/1002?output=json`, { method: 'POST', headers: { 'Content-Type': 'application/xml' }, body: fs.readFileSync(sample) });
  const j = await r.json();
  assert.equal(r.status, 200, j.error);
  assert.equal(j.pages, 3);
  assert.deepEqual(j.warnings, []);
  assert.deepEqual(j.placeholders.map((p) => p.name).sort(), ['customer_signature', 'deliverer_signature', 'driver_license_photo']);
  assert.ok(j.placeholders.every((p) => p.page === 3));
});
