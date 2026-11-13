// Generates the sample invoice template (template number 1001).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeData } from '../server/data.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const xml = fs.readFileSync(path.join(here, 'invoice.xml'), 'utf8');
const { data, arrays } = describeData(xml);
let n = 0;
const id = () => `e${++n}`;
const S = (o) => ({ fontFamily: 'Heebo', fontSize: 10, ...o });

const elements = [
  { id: id(), type: 'rect', x: 0, y: 0, w: 210, h: 34, fill: '#1f3a68', borderWidth: 0, showOn: 'all' },
  { id: id(), type: 'field', name: 'שם החברה', x: 70, y: 7, w: 128, h: 11, binding: 'company.name', style: S({ fontSize: 20, bold: true, color: '#ffffff' }) },
  { id: id(), type: 'text', x: 70, y: 18, w: 128, h: 12, text: 'ח.פ. {{company.taxId}}\n{{company.address}}', tr: { en: { text: 'Company No. {{company.taxId}}\n{{company.address}}' } }, style: S({ fontSize: 9, color: '#dbe4f3' }) },
  { id: id(), type: 'barcode', name: 'QR', x: 12, y: 5, w: 24, h: 24, symbology: 'qrcode', valueMode: 'expression', expression: '"INV:" & @number & ";TOTAL:" & round(sum(items.item, price*qty)*(1+vat/100),2)', style: { background: '#ffffff', padding: 1 } },
  { id: id(), type: 'text', x: 110, y: 40, w: 88, h: 10, text: 'חשבונית מס מספר {{@number}}', tr: { en: { text: 'Tax Invoice No. {{@number}}' } }, style: S({ fontSize: 16, bold: true, color: '#1f3a68' }) },
  { id: id(), type: 'text', x: 12, y: 40, w: 80, h: 14, text: 'תאריך: {{date | date:dd/MM/yyyy}}\nלתשלום עד: {{dueDate | date:dd/MM/yyyy}}', tr: { en: { text: 'Date: {{date | date:d MMMM yyyy}}\nDue: {{dueDate | date:d MMMM yyyy}}' } }, style: S({ align: 'left', fontSize: 9.5 }), showOn: 'first' },
  { id: id(), type: 'rect', x: 110, y: 52, w: 88, h: 26, fill: '#f3f6fb', borderWidth: 0.5, borderColor: '#c5d0e3', radius: 2, showOn: 'first' },
  { id: id(), type: 'text', x: 113, y: 54, w: 82, h: 22, text: 'לכבוד: {{customer.name}}\nת.ז.: {{customer.id}}\n{{customer.address}}\n{{customer.email}}', tr: { en: { text: 'To: {{customer.name}}\nID: {{customer.id}}\n{{customer.address}}\n{{customer.email}}' } }, style: S({ fontSize: 10, lineHeight: 1.35 }), showOn: 'first' },
  { id: id(), type: 'text', x: 12, y: 58, w: 60, h: 8, text: 'לקוח VIP ★', tr: { en: { text: '★ VIP customer' } }, visibleIf: 'customer.vip == true', style: S({ color: '#b26a00', bold: true, align: 'left', fontSize: 11 }), showOn: 'first' },
  {
    id: id(), type: 'table', name: 'פריטים', x: 12, y: 84, w: 186, h: 150, binding: 'items.item', overflow: 'paginate', continueTop: 40, continueHeight: 225,
    style: S({ fontSize: 9.5 }), headerStyle: { background: '#1f3a68', color: '#ffffff', fontSize: 9.5 }, altRowBackground: '#f3f6fb', borderWidth: 0.5, borderColor: '#c5d0e3', cellPadding: 1.2,
    columns: [
      { id: 'c1', header: '#', expression: '$row', width: 0.6, align: 'center' },
      { id: 'c2', header: 'מק"ט', tr: { en: { header: 'SKU' } }, binding: 'sku', width: 1.3, align: 'center', cellType: 'value' },
      { id: 'c3', header: 'תיאור', tr: { en: { header: 'Description' } }, binding: 'description', width: 4.5 },
      { id: 'c4', header: 'כמות', tr: { en: { header: 'Qty' } }, binding: 'qty', width: 1, align: 'center', format: 'number:0' },
      { id: 'c5', header: 'מחיר יחידה', binding: 'price', width: 1.6, align: 'left', format: 'currency', footer: 'סה"כ לפני מע"מ', tr: { en: { header: 'Unit price', footer: 'Subtotal' } } },
      { id: 'c6', header: 'סה"כ', tr: { en: { header: 'Total' } }, expression: 'price * qty', width: 1.7, align: 'left', format: 'currency', footer: '{{sum($rows, price*qty) | currency}}' },
    ],
  },
  { id: id(), type: 'text', x: 44, y: 238, w: 38, h: 7, text: 'מע"מ ({{vat}}%):', tr: { en: { text: 'VAT ({{vat}}%):' } }, style: S({ align: 'right' }), showOn: 'last' },
  { id: id(), type: 'computed', name: 'מע"מ', x: 12, y: 238, w: 32, h: 7, expression: 'sum(items.item, price*qty) * vat / 100', format: 'currency', style: S({ align: 'left' }), showOn: 'last' },
  { id: id(), type: 'text', x: 44, y: 246, w: 38, h: 8, text: 'סה"כ לתשלום:', tr: { en: { text: 'Total due:' } }, style: S({ align: 'right', bold: true, fontSize: 12 }), showOn: 'last' },
  { id: id(), type: 'computed', name: 'סה"כ לתשלום', x: 12, y: 246, w: 32, h: 8, expression: 'sum(items.item, price*qty) * (1 + vat / 100)', format: 'currency', style: S({ align: 'left', bold: true, fontSize: 12, color: '#1f3a68' }), showOn: 'last' },
  { id: id(), type: 'line', x: 12, y: 236, w: 70, h: 1, thickness: 0.75, color: '#1f3a68', showOn: 'last' },
  { id: id(), type: 'field', x: 90, y: 238, w: 108, h: 16, binding: 'notes', style: S({ fontSize: 9, color: '#444444', italic: true }), showOn: 'last' },
  { id: id(), type: 'barcode', x: 140, y: 262, w: 58, h: 16, symbology: 'code128', valueMode: 'field', binding: '@number', showText: true },
  { id: id(), type: 'signature', name: 'חתימת הלקוח', x: 12, y: 262, w: 60, h: 16, placeholder: 'customer_signature', label: 'חתימת הלקוח', tr: { en: { label: 'Customer signature' } }, signer: 'לקוח', required: true, showOn: 'last', style: { fontSize: 8, color: '#4b5563', padding: 0 } },
];

// footer band: printed at the bottom of every page (y is relative to the band)
const footer = {
  enabled: true, height: 15, showOn: 'all',
  elements: [
    { id: id(), type: 'line', x: 12, y: 2, w: 186, h: 1, thickness: 0.5, color: '#999999' },
    { id: id(), type: 'text', x: 12, y: 4, w: 186, h: 6, text: 'עמוד {{page}} מתוך {{pages}}', tr: { en: { text: 'Page {{page}} of {{pages}}' } }, style: S({ align: 'center', fontSize: 8, color: '#666666' }) },
  ],
};

const template = {
  id: '1001',
  name: 'חשבונית מס - דוגמה',
  defaultLanguage: 'he',
  languages: ['he', 'en'],
  description: 'תבנית לדוגמה: טבלת פריטים עם מעבר עמודים, שדות מחושבים, QR, ברקוד, כותרת תחתונה ואזור חתימה',
  version: 1,
  page: { size: 'A4', orientation: 'portrait' },
  schema: { format: 'xml', sample: xml, arrays },
  footer,
  pages: [{ id: 'p1', elements }],
};

fs.writeFileSync(path.join(here, 'template-1001.json'), JSON.stringify(template, null, 2));
const store = path.join(here, '..', 'storage', 'templates');
fs.mkdirSync(store, { recursive: true });
fs.writeFileSync(path.join(store, '1001.json'), JSON.stringify(template, null, 2));
console.log('arrays:', arrays, 'items:', data.items.item.length);
