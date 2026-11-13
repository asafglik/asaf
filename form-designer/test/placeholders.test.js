// Fill-in areas (text / date / checkbox input, signature, upload) with metadata:
// the render API returns their positions, metadata and the values they got.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

const { renderPdf, closeBrowser } = await import('../server/render/pdf.js');
const { templatePlaceholders } = await import('../shared/elements.js');
after(() => closeBrowser());

const tpl = {
  id: 't-ph',
  name: 'טופס מילוי',
  page: { size: 'A4' },
  pages: [{ id: 'p1', elements: [
    { id: 'a', type: 'input', inputType: 'text', placeholder: 'full_name', label: 'שם מלא', title: 'פרטי המקבל', subtitle: 'כפי שמופיע בת.ז.', description: 'שם פרטי ומשפחה', required: true, binding: 'customer.name', x: 20, y: 30, w: 60, h: 11 },
    { id: 'b', type: 'input', inputType: 'date', placeholder: 'delivery_date', label: 'תאריך', title: 'תאריך מסירה', binding: 'delivered', format: 'date:dd/MM/yyyy', x: 100, y: 30, w: 35, h: 11 },
    { id: 'c', type: 'input', inputType: 'checkbox', placeholder: 'agree', label: 'אני מאשר/ת', title: 'אישור תנאים', required: true, binding: 'agreed', x: 20, y: 50, w: 60, h: 6 },
    { id: 'd', type: 'input', inputType: 'text', placeholder: 'notes', label: 'הערות', x: 20, y: 60, w: 100, h: 11 },
    { id: 'e', type: 'signature', placeholder: 'customer_sign', label: 'חתימה', title: 'חתימת הלקוח', subtitle: 'בעת קבלת הרכב', description: 'חתימה מלאה', required: true, signer: 'לקוח', x: 20, y: 80, w: 60, h: 18 },
    { id: 'f', type: 'upload', placeholder: 'id_photo', label: 'צילום ת.ז.', title: 'צילום תעודה', x: 120, y: 80, w: 40, h: 40 },
  ] }],
};
const data = { customer: { name: 'ישראל ישראלי' }, delivered: '2026-11-13', agreed: 'Y' };

test('template placeholders carry the designer metadata', () => {
  const list = templatePlaceholders(tpl, 210, 297);
  assert.equal(list.length, 6);
  const n = list.find((p) => p.name === 'full_name');
  assert.deepEqual([n.type, n.kind, n.title, n.subtitle, n.description, n.required], ['input', 'text', 'פרטי המקבל', 'כפי שמופיע בת.ז.', 'שם פרטי ומשפחה', true]);
  assert.equal(list.find((p) => p.name === 'delivery_date').format, 'dd/MM/yyyy');
  assert.equal(list.find((p) => p.name === 'customer_sign').signer, 'לקוח');
  assert.equal(list.find((p) => p.name === 'id_photo').title, 'צילום תעודה');
});

test('render returns positions, metadata and values, also attached to the PDF', async () => {
  const { pdf, placeholders } = await renderPdf(tpl, data);
  const by = Object.fromEntries(placeholders.map((p) => [p.name, p]));
  assert.equal(placeholders.length, 6);
  assert.deepEqual([by.full_name.kind, by.full_name.value, by.full_name.filled, by.full_name.title, by.full_name.required], ['text', 'ישראל ישראלי', true, 'פרטי המקבל', true]);
  assert.equal(by.full_name.mm.x, 20);
  assert.equal(by.full_name.mm.y, 30);
  assert.equal(by.delivery_date.value, '13/11/2026');
  assert.deepEqual([by.agree.kind, by.agree.value], ['checkbox', true]);
  assert.deepEqual([by.notes.value, by.notes.filled], ['', false]);
  assert.deepEqual([by.customer_sign.subtitle, by.customer_sign.filled, by.customer_sign.description], ['בעת קבלת הרכב', false, 'חתימה מלאה']);
  assert.ok(by.id_photo.pdf.y > 0);

  const doc = await PDFDocument.load(pdf);
  const names = doc.catalog.lookup(PDFName.of('Names'), PDFDict).lookup(PDFName.of('EmbeddedFiles'), PDFDict).lookup(PDFName.of('Names'), PDFArray);
  const spec = names.lookup(1, PDFDict);
  const stream = spec.lookup(PDFName.of('EF'), PDFDict).lookup(PDFName.of('F'), PDFRawStream);
  const att = JSON.parse(Buffer.from(decodePDFRawStream(stream).decode()).toString('utf8'));
  assert.equal(att.placeholders.length, 6);
  assert.equal(att.placeholders.find((p) => p.name === 'full_name').value, 'ישראל ישראלי');
});
