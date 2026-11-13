// Generates template 1002: vehicle delivery form (PDI) on the service-call data
// world (examples/service-call-pdi.xml - windows-1255, anonymized).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeData } from '../server/data.js';
import { decodeBytes } from '../shared/encoding.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const xml = decodeBytes(fs.readFileSync(path.join(here, 'service-call-pdi.xml')));
const { arrays } = describeData(xml, { detectLists: true });

let n = 0;
const id = () => `e${++n}`;
const S = (o) => ({ fontFamily: 'Assistant', fontSize: 9.5, ...o });
const NAVY = '#1b2a4a';
const LINE = '#c9d1de';
const SC = 'ServiceCall';

const label = (x, y, w, text) => ({ showOn: 'first', id: id(), type: 'text', x, y, w, h: 5, text, style: S({ color: '#5b6475', fontSize: 8 }) });
const value = (x, y, w, binding, style = {}) => ({ showOn: 'first', id: id(), type: 'field', x, y: y + 4.5, w, h: 6, binding, style: S({ fontSize: 10.5, bold: true, ...style }) });
const box = (x, y, w, h, title, showOn = 'first') => [
  { showOn, id: id(), type: 'rect', x, y, w, h, fill: '#f6f8fb', borderWidth: 0.5, borderColor: LINE, radius: 1.5 },
  { showOn, id: id(), type: 'text', x: x + 3, y: y + 2, w: w - 6, h: 6, text: title, style: S({ fontSize: 10.5, bold: true, color: NAVY }) },
  { showOn, id: id(), type: 'line', x: x + 3, y: y + 8.5, w: w - 6, h: 1, thickness: 0.5, color: LINE },
];

// ---------------------------------------------------------------- header / footer
const header = {
  enabled: true, height: 26, showOn: 'all',
  elements: [
    { id: id(), type: 'rect', x: 0, y: 0, w: 210, h: 22, fill: NAVY, borderWidth: 0 },
    { id: id(), type: 'field', x: 70, y: 4, w: 128, h: 8, binding: `${SC}.HEVRA.Name`, style: S({ fontSize: 15, bold: true, color: '#ffffff' }) },
    { id: id(), type: 'text', x: 70, y: 12.5, w: 128, h: 6, text: `ח.פ. {{${SC}.HEVRA.HP}} · {{${SC}.CarOrderFolder.Company.CompanyAddress}}, {{${SC}.HEVRA.TOWN}} · טל' {{${SC}.HEVRA.TEL}}`, style: S({ fontSize: 8.5, color: '#d6deeb' }) },
    { id: id(), type: 'text', x: 12, y: 5, w: 55, h: 6, text: 'קריאת שירות {{ServiceCall.STK}}', style: S({ fontSize: 10, bold: true, color: '#ffffff', align: 'left' }) },
    { id: id(), type: 'text', x: 12, y: 12.5, w: 55, h: 6, text: 'הזמנה {{ServiceCall.OrderNum}}', style: S({ fontSize: 8.5, color: '#d6deeb', align: 'left' }) },
  ],
};
const footer = {
  enabled: true, height: 14, showOn: 'all',
  elements: [
    { id: id(), type: 'line', x: 12, y: 2, w: 186, h: 1, thickness: 0.5, color: '#9aa4b5' },
    { id: id(), type: 'text', x: 12, y: 4, w: 90, h: 5, text: '{{ServiceCall.CarOrderFolder.BrandWebSite}}', style: S({ fontSize: 7.5, color: '#6b7587', align: 'left', direction: 'ltr' }) },
    { id: id(), type: 'text', x: 108, y: 4, w: 90, h: 5, text: 'עמוד {{page}} מתוך {{pages}}', style: S({ fontSize: 7.5, color: '#6b7587' }) },
  ],
};

// ---------------------------------------------------------------- page 1: details + accessories
const p1 = [
  { showOn: 'first', id: id(), type: 'text', x: 60, y: 29, w: 138, h: 9, text: 'טופס מסירת רכב – הכנה למסירה (PDI)', style: S({ fontSize: 16, bold: true, color: NAVY }) },
  { showOn: 'first', id: id(), type: 'text', x: 12, y: 30, w: 70, h: 12, text: 'נפתחה: {{hdate(ServiceCall.OpenDateH) | date:dd/MM/yyyy}} {{htime(ServiceCall.TimeOfServer)}}\nתאריך מסירה: {{ServiceCall.DeliveryDateForPrint}}', style: S({ fontSize: 8.5, align: 'left', color: '#3a4558' }) },

  // customer
  ...box(108, 42, 90, 46, 'פרטי הלקוח'),
  label(111, 52, 84, 'שם הלקוח'),
  value(111, 52, 84, `${SC}.Customer.CustomerName`),
  label(155, 63, 40, 'ת.ז.'),
  value(155, 63, 40, `${SC}.Customer.IDN`),
  label(111, 63, 42, 'טלפון נייד'),
  value(111, 63, 42, `${SC}.Customer.Mobile`, { direction: 'ltr', align: 'right' }),
  label(111, 74, 84, 'כתובת'),
  { showOn: 'first', id: id(), type: 'text', x: 111, y: 78.5, w: 84, h: 6, text: '{{ServiceCall.Customer.Street}} {{ServiceCall.Customer.HouseNum}}, {{ServiceCall.Customer.Town}}', style: S({ fontSize: 10.5, bold: true }) },

  // vehicle
  ...box(12, 42, 92, 46, 'פרטי הרכב'),
  label(15, 52, 86, 'דגם'),
  { showOn: 'first', id: id(), type: 'text', x: 15, y: 56.5, w: 86, h: 6, text: '{{ServiceCall.CarOrderFolder.Trademark}} {{ServiceCall.CarOrderFolder.FamilyDescription}} · {{ServiceCall.IndividualCarModel.LevelFinish}}', style: S({ fontSize: 10.5, bold: true }) },
  label(60, 63, 41, 'מספר רישוי'),
  value(60, 63, 41, `${SC}.EditLicenceNum`, { direction: 'ltr', align: 'right' }),
  label(15, 63, 43, 'צבע'),
  value(15, 63, 43, `${SC}.CarOrderFolder.ColorDescription`),
  label(60, 74, 41, 'שנת ייצור'),
  value(60, 74, 41, `${SC}.CarOrderFolder.ManufactureYear`),
  label(15, 74, 43, 'מנוע'),
  value(15, 74, 43, `${SC}.Engine`, { direction: 'ltr', align: 'right' }),

  // chassis + barcode
  { showOn: 'first', id: id(), type: 'text', x: 108, y: 92, w: 90, h: 6, text: 'מספר שלדה: {{ServiceCall.SHILDA}}', style: S({ fontSize: 9.5, bold: true }) },
  { showOn: 'first', id: id(), type: 'barcode', x: 12, y: 91, w: 80, h: 13, symbology: 'code39', valueMode: 'field', binding: `${SC}.SHILDA`, showText: false },
  { showOn: 'first', id: id(), type: 'text', x: 108, y: 98, w: 90, h: 6, text: 'סוכן: {{ServiceCall.CarOrderFolder.SalesManName}}', style: S({ fontSize: 8.5, color: '#3a4558' }) },

  // recall notice, only when there is one
  { showOn: 'first', id: id(), type: 'rect', x: 12, y: 107, w: 186, h: 12, fill: '#fff7e6', borderWidth: 0.75, borderColor: '#f0b44c', radius: 1.5, visibleIf: `!isEmpty(${SC}.RecallForServiceCall.ServiceCallRecall)` },
  { showOn: 'first', id: id(), type: 'text', x: 15, y: 109, w: 180, h: 8, visibleIf: `!isEmpty(${SC}.RecallForServiceCall.ServiceCallRecall)`,
    text: '⚠ קריאת שירות יזומה (Recall) {{ServiceCall.RecallForServiceCall.ServiceCallRecall[0].Recall}}: {{ServiceCall.RecallForServiceCall.ServiceCallRecall[0].RecallDescription}} – עד {{ServiceCall.RecallForServiceCall.ServiceCallRecall[0].RecallDateSt}}',
    style: S({ fontSize: 9.5, bold: true, color: '#8a4b00' }) },

  { showOn: 'first', id: id(), type: 'text', x: 60, y: 123, w: 138, h: 7, text: 'אביזרים והתקנות ({{count(ServiceCall.Accessories.AccessoryIssueForServiceCall, !isEmpty(PartCode))}})', style: S({ fontSize: 11.5, bold: true, color: NAVY }) },
  {
    id: id(), type: 'table', name: 'אביזרים', x: 12, y: 131, w: 186, h: 140, binding: `${SC}.Accessories.AccessoryIssueForServiceCall`,
    overflow: 'paginate', continueTop: 30, continueHeight: 240,
    style: S({ fontSize: 8.5 }), headerStyle: { background: NAVY, color: '#ffffff', fontSize: 8.5, bold: true, align: 'center' },
    altRowBackground: '#f3f6fb', borderWidth: 0.5, borderColor: LINE, cellPadding: 1,
    sortBy: 'NumRow',
    filter: '!isEmpty(PartCode)',
    columns: [
      { id: 'c1', header: '#', expression: '$row', width: 0.5, align: 'center' },
      { id: 'c2', header: 'מק"ט', binding: 'PartCode', width: 1.6, align: 'center' },
      { id: 'c3', header: 'תיאור', binding: 'PartDescription', width: 3.6 },
      { id: 'c4', header: 'כמות', binding: 'IssuedParts', width: 0.7, align: 'center', format: 'number' },
      { id: 'c5', header: 'תחנה', binding: 'StationName', width: 2.2 },
      { id: 'c6', header: 'תאריך', binding: 'DateOfDeliveryNoteSt', width: 1.1, align: 'center' },
    ],
  },
];

// ---------------------------------------------------------------- page 2: work done + signatures
const p2 = [
  { id: id(), type: 'text', x: 60, y: 29, w: 138, h: 8, text: 'עבודות שבוצעו ברכב', style: S({ fontSize: 13, bold: true, color: NAVY }) },
  {
    id: id(), type: 'table', name: 'תחנות', x: 12, y: 38, w: 186, h: 70, binding: `${SC}.Stations.StationInServiceCall`, overflow: 'paginate', sortDesc: false,
    style: S({ fontSize: 8.5 }), headerStyle: { background: '#e8ecf4', color: NAVY, fontSize: 8.5, bold: true, align: 'center' },
    borderWidth: 0.5, borderColor: LINE, cellPadding: 1, altRowBackground: '#f8f9fc', sortBy: 'StationOrder',
    columns: [
      { id: 's1', header: 'תחנה', binding: 'StationNum.UnitName', width: 3 },
      { id: 's2', header: 'כניסה', expression: 'format(Enterence, "date:dd/MM/yyyy") & " " & left(EnterenceTime, 5)', width: 1.6, align: 'center' },
      { id: 's3', header: 'יציאה', expression: 'format(Exit, "date:dd/MM/yyyy") & " " & left(ExitTime, 5)', width: 1.6, align: 'center' },
      { id: 's4', header: 'בוצע ע"י', binding: 'UserNum', width: 2 },
    ],
  },
  { id: id(), type: 'text', x: 60, y: 112, w: 138, h: 7, text: 'טיפולים תקופתיים (שטון)', style: S({ fontSize: 11, bold: true, color: NAVY }) },
  {
    id: id(), type: 'table', name: 'שטון', x: 12, y: 120, w: 186, h: 52, binding: `${SC}.ShatonForServiceCall.ServiceCallShaton`, overflow: 'paginate', filter: '!isEmpty(Shaton)',
    style: S({ fontSize: 8.5 }), headerStyle: { background: '#e8ecf4', color: NAVY, fontSize: 8.5, bold: true, align: 'center' },
    borderWidth: 0.5, borderColor: LINE, cellPadding: 1,
    columns: [
      { id: 't1', header: 'קוד', binding: 'Shaton', width: 0.8, align: 'center' },
      { id: 't2', header: 'תיאור', binding: 'ShatonDescription', width: 3 },
      { id: 't3', header: 'תאריך', binding: 'ShatonDate', width: 1, align: 'center' },
      { id: 't4', header: 'בוצע ע"י', binding: 'DoneBy', width: 2 },
    ],
  },

  // delivery checklist
  ...box(12, 178, 186, 30, 'נמסרו ללקוח', 'all'),
  ...[['ספר רכב', 'DeliveryFormCarBook'], ['מפתחות', 'DeliveryFormKeys'], ['רישיון רכב', 'RishayonHafala'], ['הדרכת נהיגה ברכב', 'Treatment']].flatMap(([t, f], i) => [
    { id: id(), type: 'checkbox', x: 190 - i * 46, y: 190, w: 4.5, h: 4.5, binding: `${SC}.CarOrderFolder.${f}`, style: { borderWidth: 0.75, borderColor: NAVY } },
    { id: id(), type: 'text', x: 150 - i * 46, y: 189.5, w: 38, h: 6, text: t, style: S({ fontSize: 9.5 }) },
  ]),
  { id: id(), type: 'text', x: 15, y: 198, w: 180, h: 7, text: 'מספר מפתחות: {{coalesce(ServiceCall.CarOrderFolder.DeliveryFormKeysNum, "____")}}    קריאת מונה ק"מ: ________', style: S({ fontSize: 9.5 }) },

  { id: id(), type: 'richtext', x: 12, y: 212, w: 186, h: 22, overflow: 'clip', style: S({ fontSize: 8.5, lineHeight: 1.45 }),
    html: '<p><b>הצהרת הלקוח:</b> קיבלתי את הרכב {{ServiceCall.CarOrderFolder.Trademark}} {{ServiceCall.CarOrderFolder.FamilyDescription}} שמספר הרישוי שלו {{ServiceCall.EditLicenceNum}}, לאחר שבדקתי אותו ומצאתי אותו תקין ושלם, יחד עם האביזרים המפורטים בטופס זה. אחריות היצרן בתוקף עד {{ServiceCall.CarOrderFolder.ResponsibilityEnd}}.</p>' },

  // signatures
  { id: id(), type: 'text', x: 136, y: 238, w: 62, h: 6, text: 'תאריך: {{today() | date:dd/MM/yyyy}}', style: S({ fontSize: 9.5 }) },
  { id: id(), type: 'signature', name: 'חתימת הלקוח', x: 136, y: 246, w: 62, h: 18, placeholder: 'customer_signature', label: 'חתימת הלקוח', signer: 'לקוח', required: true, style: { fontSize: 8, color: '#4b5563', padding: 0 } },
  { id: id(), type: 'signature', name: 'חתימת המוסר', x: 70, y: 246, w: 58, h: 18, placeholder: 'deliverer_signature', label: 'חתימת נציג המסירה', signer: 'נציג', required: true, style: { fontSize: 8, color: '#4b5563', padding: 0 } },
  { id: id(), type: 'upload', name: 'צילום רישיון', x: 12, y: 238, w: 50, h: 26, placeholder: 'driver_license_photo', label: 'צילום רישיון נהיגה', style: { fontSize: 8, color: '#6b7280', padding: 0 } },
];

const template = {
  id: '1002',
  name: 'טופס מסירת רכב – PDI',
  description: 'דוגמה על עולם נתונים אמיתי של קריאת שירות (XML ב-windows-1255): כותרות, פרטי לקוח ורכב, ברקוד שלדה, אביזרים עם מעבר עמודים, תנאי Recall, חתימות',
  version: 1,
  page: { size: 'A4', orientation: 'portrait' },
  schema: { format: 'xml', sample: xml, arrays },
  header,
  footer,
  pages: [{ id: 'p1', elements: p1 }, { id: 'p2', elements: p2 }],
};

fs.writeFileSync(path.join(here, 'template-1002.json'), JSON.stringify(template, null, 2));
const store = path.join(here, '..', 'storage', 'templates');
fs.mkdirSync(store, { recursive: true });
fs.writeFileSync(path.join(store, '1002.json'), JSON.stringify(template, null, 2));
console.log('template 1002 written, lists:', arrays.length);
