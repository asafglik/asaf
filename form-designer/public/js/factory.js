// Default element definitions for the toolbox.
import { uid, uniquePlaceholder } from './state.js';

export const TOOLS = [
  { type: 'text', label: 'טקסט קבוע', icon: 'T', hint: 'טקסט רגיל, אפשר לשלב שדות {{...}}' },
  { type: 'field', label: 'שדה נתונים', icon: '{ }', hint: 'ערך מעולם הנתונים' },
  { type: 'computed', label: 'שדה מחושב', icon: 'ƒx', hint: 'נוסחה: sum, if, round...' },
  { type: 'richtext', label: 'טקסט מעוצב', icon: '¶', hint: 'עריכה כמו ב-Word, מעבר עמודים' },
  { type: 'table', label: 'טבלה', icon: '▦', hint: 'טבלה מרשימה בנתונים' },
  { type: 'image', label: 'תמונה', icon: '🖼', hint: 'תמונה קבועה או מהנתונים' },
  { type: 'barcode', label: 'ברקוד', icon: '|||', hint: 'Code128, EAN, ITF...', symbology: 'code128' },
  { type: 'barcode', label: 'QR', icon: '▣', hint: 'QR, DataMatrix, PDF417', symbology: 'qrcode', key: 'qr' },
  { type: 'signature', label: 'אזור חתימה', icon: '✍', hint: 'מקום לחתימה – מיקומו מוחזר ב-API' },
  { type: 'upload', label: 'אזור העלאת תמונה', icon: '⬚', hint: 'מקום להעלאת תמונה – מיקומו מוחזר ב-API' },
  { type: 'input', label: 'שדה טקסט למילוי', icon: '✎', hint: 'מקום למילוי טקסט – מיקומו ונתוניו מוחזרים ב-API', inputType: 'text' },
  { type: 'input', label: 'שדה תאריך למילוי', icon: '📅', hint: 'מקום למילוי תאריך – מיקומו ונתוניו מוחזרים ב-API', inputType: 'date' },
  { type: 'input', label: 'תיבת סימון למילוי', icon: '☐', hint: 'תיבה לסימון בחתימה – מיקומה ונתוניה מוחזרים ב-API', inputType: 'checkbox' },
  { type: 'checkbox', label: 'תיבת סימון', icon: '☑', hint: 'מסומנת לפי ערך' },
  { type: 'line', label: 'קו', icon: '—', hint: 'קו אופקי או אנכי' },
  { type: 'rect', label: 'מלבן', icon: '▭', hint: 'מסגרת / רקע' },
  { type: 'ellipse', label: 'אליפסה', icon: '◯', hint: 'עיגול / אליפסה' },
];

export const TYPE_LABELS = {
  text: 'טקסט קבוע', field: 'שדה נתונים', computed: 'שדה מחושב', richtext: 'טקסט מעוצב', table: 'טבלה',
  image: 'תמונה', barcode: 'ברקוד', checkbox: 'תיבת סימון', signature: 'אזור חתימה', upload: 'אזור העלאת תמונה', input: 'שדה למילוי', line: 'קו', rect: 'מלבן', ellipse: 'אליפסה',
};

const baseStyle = () => ({ fontFamily: 'Heebo', fontSize: 11, color: '#000000', align: 'right', valign: 'top', direction: 'rtl' });

export function createElement(type, opts = {}) {
  const e = { id: uid(), type, x: 20, y: 20, w: 60, h: 8 };
  switch (type) {
    case 'text':
      Object.assign(e, { text: opts.text ?? 'טקסט', style: baseStyle() });
      break;
    case 'field':
      Object.assign(e, { binding: opts.binding || '', format: '', style: baseStyle() });
      break;
    case 'computed':
      Object.assign(e, { expression: opts.expression || '', format: 'number:2', style: baseStyle() });
      break;
    case 'richtext':
      Object.assign(e, {
        w: 120, h: 40,
        html: opts.html || '<p>טקסט מעוצב. לחיצה כפולה לעריכה, ואפשר לשלב שדות כמו {{customer.name}}.</p>',
        overflow: opts.overflow || 'clip',
        style: { ...baseStyle(), lineHeight: 1.4 },
      });
      break;
    case 'table': {
      const cols = (opts.columns || [
        { header: 'עמודה 1', binding: '' },
        { header: 'עמודה 2', binding: '' },
        { header: 'עמודה 3', binding: '' },
      ]).map((c) => ({ id: uid('c'), width: 1, align: '', format: '', ...c }));
      Object.assign(e, {
        w: 170, h: 60, binding: opts.binding || '', columns: cols,
        style: { ...baseStyle(), fontSize: 10 },
        headerStyle: { background: '#e8ecf4', color: '#000000', bold: true, align: 'center' },
        borderWidth: 0.5, borderColor: '#8a94a6', cellPadding: 1, altRowBackground: '', overflow: 'paginate', showHeader: true,
      });
      break;
    }
    case 'image':
      Object.assign(e, { w: 40, h: 30, source: opts.binding ? 'field' : 'static', binding: opts.binding || '', src: opts.src || '', fit: 'contain', style: { padding: 0 } });
      break;
    case 'barcode': {
      const twoD = ['qrcode', 'datamatrix', 'azteccode'].includes(opts.symbology);
      Object.assign(e, {
        w: twoD ? 25 : 50, h: twoD ? 25 : 15,
        symbology: opts.symbology || 'code128',
        valueMode: opts.binding ? 'field' : 'static', value: '123456789', binding: opts.binding || '', expression: '',
        showText: true, style: { padding: 0 },
      });
      break;
    }
    case 'signature':
      Object.assign(e, { w: 55, h: 18, placeholder: opts.placeholder || uniquePlaceholder('signature'), label: opts.label ?? 'חתימה', signer: '', required: true, binding: '', style: { fontSize: 8, color: '#4b5563', padding: 0 } });
      break;
    case 'upload':
      Object.assign(e, { w: 40, h: 40, placeholder: opts.placeholder || uniquePlaceholder('upload'), label: opts.label ?? 'העלאת תמונה', required: false, binding: '', fit: 'contain', style: { fontSize: 8, color: '#6b7280', padding: 0 } });
      break;
    case 'input': {
      const kind = ['text', 'date', 'checkbox'].includes(opts.inputType) ? opts.inputType : 'text';
      const base = { text: 'text', date: 'date', checkbox: 'check' }[kind];
      const label = { text: 'שם מלא', date: 'תאריך', checkbox: 'אני מאשר/ת את התנאים' }[kind];
      Object.assign(e, {
        w: kind === 'checkbox' ? 60 : kind === 'date' ? 35 : 60, h: kind === 'checkbox' ? 6 : 11,
        inputType: kind, placeholder: opts.placeholder || uniquePlaceholder(base), label: opts.label ?? label,
        title: '', subtitle: '', description: '', required: false, binding: opts.binding || '',
        ...(kind === 'date' ? { format: 'date:dd/MM/yyyy' } : {}),
        style: { fontSize: 10, color: '#4b5563', padding: 0 },
      });
      break;
    }
    case 'checkbox':
      Object.assign(e, { w: 5, h: 5, binding: opts.binding || '', style: { borderWidth: 0.75, borderColor: '#000000' } });
      break;
    case 'line':
      Object.assign(e, { w: 80, h: 1, orientation: 'horizontal', thickness: 0.75, color: '#000000', lineStyle: 'solid' });
      break;
    case 'rect':
      Object.assign(e, { w: 60, h: 30, borderWidth: 0.75, borderColor: '#000000', fill: '', radius: 0, lineStyle: 'solid' });
      break;
    case 'ellipse':
      Object.assign(e, { w: 30, h: 30, borderWidth: 0.75, borderColor: '#000000', fill: '', lineStyle: 'solid' });
      break;
  }
  return e;
}

/** Element for a node dragged from the data tree. */
function guessFormat(sample) {
  const s = String(sample ?? '').trim();
  if (/^-?\d+\.\d+$/.test(s)) return 'number:2';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return 'date:dd/MM/yyyy';
  return '';
}

export function elementFromNode(node, styleFrom) {
  if (node.kind === 'array') {
    const cols = (node.children || []).filter((c) => c.kind === 'value').slice(0, 8).map((c) => {
      const f = guessFormat(c.sample);
      return { header: c.name.replace(/^@/, ''), binding: c.path, format: f, align: f.startsWith('number') ? 'left' : '' };
    });
    const t = createElement('table', { binding: node.path, columns: cols.length ? cols : undefined });
    if (styleFrom) {
      // same look as the tables already in the template
      for (const k of ['style', 'headerStyle', 'footerStyle', 'altRowBackground', 'borderWidth', 'borderColor', 'cellPadding']) {
        if (styleFrom[k] !== undefined) t[k] = JSON.parse(JSON.stringify(styleFrom[k]));
      }
    }
    return t;
  }
  const e = createElement('field', { binding: node.path });
  e.name = node.name;
  return e;
}
