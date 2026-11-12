// Properties panel for the selected element(s), or the page when nothing is selected.
import { state, on, change, selectedElements, currentPage, uid, emit, pageSizeMm } from './state.js';
import { escapeHtml, PAGE_SIZES } from '/shared/elements.js';
import { FORMAT_PRESETS } from '/shared/format.js';
import { validateExpr, tryEval, FUNCTION_HELP } from '/shared/expr.js';
import { TYPE_LABELS } from './factory.js';
import { allValuePaths, arrayPaths, itemPaths } from './datatree.js';
import { designScope } from './canvas.js';
import { startRichEdit } from './richtext.js';
import { readFileAsDataUrl } from './util.js';

const panel = document.getElementById('props');

// ---------------------------------------------------------------- path helpers
function getPath(o, path) {
  return path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
}
function setPath(o, path, v) {
  const keys = path.split('.');
  let cur = o;
  for (const k of keys.slice(0, -1)) {
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  if (v === undefined) delete cur[keys[keys.length - 1]];
  else cur[keys[keys.length - 1]] = v;
}

// ---------------------------------------------------------------- field builders
const opt = (v, l, cur) => `<option value="${escapeHtml(v)}"${String(cur ?? '') === String(v) ? ' selected' : ''}>${escapeHtml(l)}</option>`;

function val(els, key, dflt = '') {
  const v = getPath(els[0], key);
  const same = els.every((e) => JSON.stringify(getPath(e, key)) === JSON.stringify(v));
  return same ? (v ?? dflt) : '';
}

const fields = {
  num: (label, key, { step = 0.5, min, suffix = '', dflt = '' } = {}) => (els) =>
    `<label class="f"><span>${label}</span><span class="f-num"><input type="number" data-key="${key}" data-type="num" step="${step}"${min !== undefined ? ` min="${min}"` : ''} value="${escapeHtml(val(els, key, dflt))}">${suffix ? `<em>${suffix}</em>` : ''}</span></label>`,
  text: (label, key, { placeholder = '', list = '' } = {}) => (els) =>
    `<label class="f"><span>${label}</span><input type="text" data-key="${key}" value="${escapeHtml(val(els, key))}" placeholder="${escapeHtml(placeholder)}"${list ? ` list="${list}"` : ''} dir="auto"></label>`,
  area: (label, key, { rows = 3, placeholder = '', mono = false } = {}) => (els) =>
    `<label class="f f-col"><span>${label}</span><textarea data-key="${key}" rows="${rows}" placeholder="${escapeHtml(placeholder)}" dir="auto"${mono ? ' class="mono"' : ''}>${escapeHtml(val(els, key))}</textarea></label>`,
  color: (label, key, { allowEmpty = true } = {}) => (els) => {
    const v = val(els, key);
    return `<label class="f"><span>${label}</span><span class="f-color"><input type="color" data-key="${key}" value="${escapeHtml(v || '#ffffff')}"${!v && allowEmpty ? ' data-empty="1"' : ''}>${allowEmpty ? `<button class="mini" data-clear="${key}" title="ללא צבע">✕</button>` : ''}<code>${escapeHtml(v || 'ללא')}</code></span></label>`;
  },
  select: (label, key, options, dflt = '') => (els) =>
    `<label class="f"><span>${label}</span><select data-key="${key}">${options.map(([v, l]) => opt(v, l, val(els, key, dflt))).join('')}</select></label>`,
  check: (label, key, dflt = false) => (els) => {
    const v = val(els, key, dflt);
    return `<label class="f f-check"><input type="checkbox" data-key="${key}" data-type="bool"${v === true ? ' checked' : ''}><span>${label}</span></label>`;
  },
  toggles: (items) => (els) =>
    `<div class="f f-toggles">${items.map(([key, l, title]) => `<button class="tg${val(els, key) === true ? ' on' : ''}" data-toggle="${key}" title="${title}">${l}</button>`).join('')}</div>`,
  segmented: (label, key, options, dflt) => (els) => {
    const cur = val(els, key, dflt);
    return `<div class="f"><span>${label}</span><div class="seg">${options.map(([v, l, t]) => `<button class="${String(cur) === v ? 'on' : ''}" data-seg="${key}" data-val="${v}" title="${t || ''}">${l}</button>`).join('')}</div></div>`;
  },
  font: (label, key) => (els) => {
    const cur = val(els, key, 'Heebo');
    const groups = { bundled: 'גופנים מובנים', system: 'גופני Office', uploaded: 'גופנים שהועלו' };
    let h = `<label class="f"><span>${label}</span><select data-key="${key}">`;
    for (const [g, gl] of Object.entries(groups)) {
      const list = state.fonts.filter((f) => f.source === g);
      if (list.length) h += `<optgroup label="${gl}">${list.map((f) => `<option value="${escapeHtml(f.family)}" style="font-family:'${escapeHtml(f.family)}'"${f.family === cur ? ' selected' : ''}>${escapeHtml(f.family)}</option>`).join('')}</optgroup>`;
    }
    return h + '</select></label>';
  },
  format: (label, key) => (els) =>
    `<label class="f"><span>${label}</span><input type="text" data-key="${key}" value="${escapeHtml(val(els, key))}" list="dl-formats" placeholder="ללא" dir="ltr"></label>`,
  expr: (label, key, { scopeFor, placeholder = 'price * qty' } = {}) => (els) => {
    const v = val(els, key);
    const err = v ? validateExpr(v) : null;
    let preview = '';
    if (v && !err && els.length === 1) {
      const r = tryEval(v, scopeFor ? scopeFor(els[0]) : designScope());
      preview = r.error ? `<div class="expr-err">${escapeHtml(r.error)}</div>` : `<div class="expr-val">= ${escapeHtml(String(r.value instanceof Date ? r.value.toLocaleDateString('he-IL') : Array.isArray(r.value) ? `[${r.value.length} פריטים]` : r.value ?? ''))}</div>`;
    }
    return `<label class="f f-col"><span>${label} <button class="link" data-action="expr-help" type="button">פונקציות</button></span><textarea data-key="${key}" rows="2" class="mono" dir="ltr" spellcheck="false" placeholder="${escapeHtml(placeholder)}">${escapeHtml(v)}</textarea>${err ? `<div class="expr-err">${escapeHtml(err)}</div>` : preview}</label>`;
  },
  html: (h) => () => h,
};

function group(title, builders, open = true) {
  return (els) => `<details class="pg"${open ? ' open' : ''}><summary>${title}</summary><div class="pg-body">${builders.map((b) => b(els)).join('')}</div></details>`;
}

// ---------------------------------------------------------------- groups
const SHOW_ON = [['all', 'כל העמודים'], ['first', 'עמוד ראשון בלבד'], ['last', 'עמוד אחרון בלבד'], ['notFirst', 'כל העמודים מלבד הראשון'], ['notLast', 'כל העמודים מלבד האחרון']];

const geometry = group('מיקום וגודל', [
  fields.html('<div class="f-grid">'),
  fields.num('X', 'x', { suffix: 'מ"מ' }),
  fields.num('Y', 'y', { suffix: 'מ"מ' }),
  fields.num('רוחב', 'w', { suffix: 'מ"מ', min: 0.5 }),
  fields.num('גובה', 'h', { suffix: 'מ"מ', min: 0.5 }),
  fields.html('</div>'),
  fields.num('סיבוב', 'rotation', { step: 1, suffix: '°' }),
  fields.check('נעול (לא ניתן להזיז)', 'locked'),
]);

const fontGroup = (withValign = true) => group('גופן ויישור', [
  fields.font('גופן', 'style.fontFamily'),
  fields.html('<div class="f-grid">'),
  fields.num('גודל', 'style.fontSize', { step: 0.5, min: 4, suffix: 'pt', dflt: 11 }),
  fields.num('מרווח שורות', 'style.lineHeight', { step: 0.05, min: 0.5, dflt: 1.25 }),
  fields.html('</div>'),
  fields.toggles([['style.bold', '<b>B</b>', 'מודגש'], ['style.italic', '<i>I</i>', 'נטוי'], ['style.underline', '<u>U</u>', 'קו תחתון'], ['style.strike', '<s>S</s>', 'קו חוצה']]),
  fields.color('צבע', 'style.color', { allowEmpty: false }),
  fields.segmented('יישור', 'style.align', [['right', '⇥', 'ימין'], ['center', '≡', 'מרכז'], ['left', '⇤', 'שמאל'], ['justify', '☰', 'מיושר']], 'right'),
  ...(withValign ? [fields.segmented('אנכי', 'style.valign', [['top', '⤒', 'למעלה'], ['middle', '↕', 'מרכז'], ['bottom', '⤓', 'למטה']], 'top')] : []),
  fields.segmented('כיוון', 'style.direction', [['rtl', 'ימין←', 'מימין לשמאל'], ['ltr', '→שמאל', 'משמאל לימין']], 'rtl'),
  fields.num('ריווח אותיות', 'style.letterSpacing', { step: 0.1, suffix: 'pt' }),
]);

const boxGroup = group('מסגרת ורקע', [
  fields.color('רקע', 'style.background'),
  fields.html('<div class="f-grid">'),
  fields.num('עובי מסגרת', 'style.borderWidth', { step: 0.25, min: 0, suffix: 'pt' }),
  fields.num('ריפוד', 'style.padding', { step: 0.5, min: 0, suffix: 'מ"מ', dflt: 0.5 }),
  fields.html('</div>'),
  fields.color('צבע מסגרת', 'style.borderColor', { allowEmpty: false }),
  fields.select('סגנון', 'style.borderStyle', [['solid', 'רציף'], ['dashed', 'מקווקו'], ['dotted', 'נקודות'], ['double', 'כפול']], 'solid'),
  fields.select('צדדים', 'style.borderSides', [['all', 'כל הצדדים'], ['bottom', 'תחתון'], ['top', 'עליון'], ['top,bottom', 'עליון ותחתון'], ['right', 'ימין'], ['left', 'שמאל']], 'all'),
  fields.num('עיגול פינות', 'style.radius', { step: 0.5, min: 0, suffix: 'מ"מ' }),
], false);

const behavior = group('התנהגות', [
  fields.select('הצג ב', 'showOn', SHOW_ON, 'all'),
  fields.expr('הצג רק אם (תנאי)', 'visibleIf', { placeholder: 'customer.vip == true' }),
  fields.html('<p class="hint">"עמוד ראשון/אחרון" מתייחס לעמודים שנוצרים כשטבלה או טקסט ארוך גולשים לעמודים נוספים.</p>'),
], false);

const nameField = fields.text('שם הרכיב', 'name', { placeholder: 'לזיהוי בלבד' });

function insertFieldSelect(target) {
  return () => `<label class="f"><span>הוספת שדה</span><select data-insert="${target}"><option value="">בחרו שדה להוספה...</option>${allValuePaths().map((p) => opt(p, p)).join('')}<option value="page">מספר עמוד</option><option value="pages">סה"כ עמודים</option></select></label>`;
}

const CONTENT = {
  text: group('תוכן', [
    fields.area('טקסט', 'text', { rows: 4, placeholder: 'טקסט קבוע. שדות: {{customer.name}}  עיצוב: {{total | currency}}' }),
    insertFieldSelect('text'),
    fields.html('<p class="hint">לחיצה כפולה על הרכיב עורכת אותו ישירות. Ctrl+Enter לסיום.</p>'),
  ]),
  field: group('נתונים', [
    fields.text('שדה', 'binding', { list: 'dl-paths', placeholder: 'customer.name' }),
    fields.format('עיצוב', 'format'),
    fields.html('<div class="f-grid">'),
    fields.text('לפני', 'prefix'),
    fields.text('אחרי', 'suffix'),
    fields.html('</div>'),
    fields.text('אם ריק', 'emptyText', { placeholder: 'טקסט כשאין ערך' }),
  ]),
  computed: group('נוסחה', [
    fields.expr('ביטוי', 'expression'),
    fields.format('עיצוב', 'format'),
    fields.html('<div class="f-grid">'),
    fields.text('לפני', 'prefix'),
    fields.text('אחרי', 'suffix'),
    fields.html('</div>'),
  ]),
  richtext: group('טקסט מעוצב', [
    fields.html('<button class="btn btn-block" data-action="rt-edit">✎ עריכת הטקסט</button>'),
    fields.select('כשהטקסט ארוך מהתיבה', 'overflow', [['clip', 'לחתוך'], ['paginate', 'להמשיך בעמוד הבא']], 'clip'),
    fields.html('<div class="f-grid">'),
    fields.num('Y בעמוד המשך', 'continueTop', { suffix: 'מ"מ' }),
    fields.num('גובה בעמוד המשך', 'continueHeight', { suffix: 'מ"מ' }),
    fields.html('</div>'),
    fields.area('HTML (מתקדם)', 'html', { rows: 4, mono: true }),
  ]),
  image: group('תמונה', [
    fields.segmented('מקור', 'source', [['static', 'קובץ קבוע'], ['field', 'מהנתונים']], 'static'),
    (els) => (val(els, 'source', 'static') === 'field'
      ? fields.text('שדה (Base64 / כתובת)', 'binding', { list: 'dl-paths' })(els)
      : '<button class="btn btn-block" data-action="image-upload">העלאת תמונה...</button>'),
    fields.select('התאמה', 'fit', [['contain', 'התאם (שמור יחס)'], ['cover', 'מלא וחתוך'], ['fill', 'מתח']], 'contain'),
  ]),
  barcode: group('ברקוד', [
    (els) => fields.select('סוג', 'symbology', state.symbologies.map((s) => [s.id, s.label]), 'code128')(els),
    fields.segmented('ערך', 'valueMode', [['static', 'קבוע'], ['field', 'שדה'], ['expression', 'ביטוי']], 'static'),
    (els) => {
      const m = val(els, 'valueMode', 'static');
      if (m === 'field') return fields.text('שדה', 'binding', { list: 'dl-paths' })(els);
      if (m === 'expression') return fields.expr('ביטוי', 'expression')(els);
      return fields.text('ערך', 'value', { placeholder: 'אפשר {{field}}' })(els);
    },
    fields.check('הצג טקסט מתחת', 'showText', true),
    fields.color('צבע', 'color', { allowEmpty: false }),
  ]),
  checkbox: group('תיבת סימון', [
    fields.text('שדה', 'binding', { list: 'dl-paths' }),
    fields.expr('או תנאי', 'expression'),
    fields.html('<p class="hint">מסומנת כשהערך הוא true / 1 / Y / כן / X.</p>'),
  ]),
  line: group('קו', [
    fields.segmented('כיוון', 'orientation', [['horizontal', 'אופקי'], ['vertical', 'אנכי']], 'horizontal'),
    fields.num('עובי', 'thickness', { step: 0.25, min: 0.1, suffix: 'pt' }),
    fields.color('צבע', 'color', { allowEmpty: false }),
    fields.select('סגנון', 'lineStyle', [['solid', 'רציף'], ['dashed', 'מקווקו'], ['dotted', 'נקודות'], ['double', 'כפול']], 'solid'),
  ]),
  rect: group('צורה', [
    fields.color('מילוי', 'fill'),
    fields.num('עובי מסגרת', 'borderWidth', { step: 0.25, min: 0, suffix: 'pt' }),
    fields.color('צבע מסגרת', 'borderColor', { allowEmpty: false }),
    fields.select('סגנון', 'lineStyle', [['solid', 'רציף'], ['dashed', 'מקווקו'], ['dotted', 'נקודות']], 'solid'),
    fields.num('עיגול פינות', 'radius', { step: 0.5, min: 0, suffix: 'מ"מ' }),
  ]),
};
CONTENT.ellipse = CONTENT.rect;

// ---------------------------------------------------------------- table
function tableGroups(el) {
  const items = itemPaths(el.binding);
  const dl = `<datalist id="dl-item">${items.map((p) => `<option value="${escapeHtml(p)}">`).join('')}</datalist>`;
  const cols = (el.columns || []).map((c, i) => `
    <details class="col-card" data-col="${i}"${state.openCol === c.id ? ' open' : ''} data-colid="${c.id}">
      <summary><span class="col-n">${i + 1}</span><span class="col-t">${escapeHtml(c.header || '(ללא כותרת)')}</span><span class="col-b">${escapeHtml(c.expression ? 'ƒ ' + c.expression : c.binding || '')}</span>
        <span class="col-actions"><button class="mini" data-colmove="${i}:-1" title="הזז ימינה">→</button><button class="mini" data-colmove="${i}:1" title="הזז שמאלה">←</button><button class="mini danger" data-coldel="${i}" title="מחיקה">✕</button></span></summary>
      <div class="pg-body">
        ${colField('כותרת', i, 'header', c.header)}
        <label class="f"><span>סוג תא</span><select data-colkey="${i}.cellType">${[['', 'ערך'], ['text', 'טקסט עם שדות'], ['image', 'תמונה'], ['barcode', 'ברקוד']].map(([v, l]) => opt(v, l, c.cellType || '')).join('')}</select></label>
        ${c.cellType === 'text' ? colField('טקסט', i, 'text', c.text, { placeholder: '{{sku}} - {{description}}' }) : colField('שדה', i, 'binding', c.binding, { list: 'dl-item', placeholder: 'שדה בשורה' })}
        ${c.cellType === 'text' ? '' : `<label class="f f-col"><span>או ביטוי מחושב</span><textarea class="mono" dir="ltr" rows="1" data-colkey="${i}.expression" placeholder="price * qty">${escapeHtml(c.expression || '')}</textarea>${c.expression && validateExpr(c.expression) ? `<div class="expr-err">${escapeHtml(validateExpr(c.expression))}</div>` : ''}</label>`}
        ${c.cellType === 'barcode' ? `<label class="f"><span>סוג ברקוד</span><select data-colkey="${i}.symbology">${state.symbologies.map((s) => opt(s.id, s.label, c.symbology || 'code128')).join('')}</select></label>` : ''}
        ${c.cellType === 'image' || c.cellType === 'barcode' ? colField('גובה (מ"מ)', i, 'imageHeight', c.imageHeight ?? 10, { type: 'number' }) : ''}
        <div class="f-grid">
          ${colField('רוחב יחסי', i, 'width', c.width ?? 1, { type: 'number', step: 0.1 })}
          <label class="f"><span>יישור</span><select data-colkey="${i}.align">${[['', 'ברירת מחדל'], ['right', 'ימין'], ['center', 'מרכז'], ['left', 'שמאל']].map(([v, l]) => opt(v, l, c.align || '')).join('')}</select></label>
        </div>
        ${colField('עיצוב', i, 'format', c.format, { list: 'dl-formats', placeholder: 'ללא', dir: 'ltr' })}
        <div class="f-grid">
          <label class="f f-check"><input type="checkbox" data-colkey="${i}.bold" data-type="bool"${c.bold ? ' checked' : ''}><span>מודגש</span></label>
          <label class="f"><span>צבע</span><input type="color" data-colkey="${i}.color" value="${escapeHtml(c.color || '#000000')}"></label>
        </div>
        ${colField('שורת סיכום', i, 'footer', c.footer, { placeholder: '{{sum($rows, price*qty) | currency}}' })}
      </div>
    </details>`).join('');

  return [
    group('נתוני הטבלה', [
      () => `<label class="f"><span>רשימה</span><input type="text" data-key="binding" list="dl-arrays" value="${escapeHtml(el.binding || '')}" dir="ltr" placeholder="items.item"></label>`,
      fields.expr('סינון שורות (תנאי)', 'filter', { scopeFor: () => designScope(), placeholder: 'qty > 0' }),
      fields.html('<div class="f-grid">'),
      fields.text('מיון לפי', 'sortBy', { list: 'dl-item' }),
      fields.check('סדר יורד', 'sortDesc'),
      fields.html('</div>'),
    ]),
    () => `<details class="pg" open><summary>עמודות (${(el.columns || []).length})</summary><div class="pg-body">${dl}<div class="cols">${cols}</div><button class="btn btn-block" data-action="col-add">+ הוספת עמודה</button>
      <p class="hint">בשורת הסיכום: <code>$rows</code> = שורות הטבלה. בעמודות: <code>$row</code> = מספר שורה.</p></div></details>`,
    group('מעבר עמודים', [
      fields.select('כשהטבלה ארוכה', 'overflow', [['paginate', 'להמשיך בעמוד חדש'], ['clip', 'לחתוך']], 'paginate'),
      fields.html('<div class="f-grid">'),
      fields.num('Y בעמוד המשך', 'continueTop', { suffix: 'מ"מ' }),
      fields.num('גובה בעמוד המשך', 'continueHeight', { suffix: 'מ"מ' }),
      fields.html('</div>'),
      fields.html('<p class="hint">עמוד ההמשך הוא העתק של העמוד הנוכחי. כותרת הטבלה חוזרת, שורת הסיכום בסוף בלבד. השאירו ריק כדי להשתמש באותו מיקום.</p>'),
    ], false),
    fields.font ? fontGroup(false) : null,
    group('עיצוב הטבלה', [
      fields.check('הצג שורת כותרת', 'showHeader', true),
      fields.color('רקע כותרת', 'headerStyle.background'),
      fields.color('צבע טקסט כותרת', 'headerStyle.color', { allowEmpty: false }),
      fields.num('גודל גופן כותרת', 'headerStyle.fontSize', { suffix: 'pt', dflt: '' }),
      fields.segmented('יישור כותרת', 'headerStyle.align', [['right', 'ימין'], ['center', 'מרכז'], ['left', 'שמאל']], 'center'),
      fields.color('רקע שורות לסירוגין', 'altRowBackground'),
      fields.color('רקע שורת סיכום', 'footerStyle.background'),
      fields.html('<div class="f-grid">'),
      fields.num('עובי קווים', 'borderWidth', { step: 0.25, min: 0, suffix: 'pt' }),
      fields.num('ריפוד תא', 'cellPadding', { step: 0.25, min: 0, suffix: 'מ"מ', dflt: 1 }),
      fields.html('</div>'),
      fields.color('צבע קווים', 'borderColor', { allowEmpty: false }),
      fields.num('גובה שורה מינימלי', 'rowHeight', { step: 0.5, suffix: 'מ"מ' }),
      fields.segmented('יישור אנכי', 'valign', [['top', 'למעלה'], ['middle', 'מרכז'], ['bottom', 'למטה']], 'top'),
      fields.expr('הדגשת שורה אם', 'rowHighlightIf', { placeholder: 'qty > 10' }),
      fields.color('צבע הדגשה', 'rowHighlightColor'),
    ], false),
  ].filter(Boolean);
}

function colField(label, i, key, v, { type = 'text', list = '', placeholder = '', step = '', dir = 'auto' } = {}) {
  return `<label class="f"><span>${label}</span><input type="${type}" data-colkey="${i}.${key}" value="${escapeHtml(v ?? '')}"${list ? ` list="${list}"` : ''}${step ? ` step="${step}"` : ''} placeholder="${escapeHtml(placeholder)}" dir="${dir}"></label>`;
}

// ---------------------------------------------------------------- page panel
function pagePanel() {
  const t = state.template;
  const page = currentPage();
  const { w, h } = pageSizeMm();
  const bg = page.background || {};
  const custom = t.page?.size === 'custom' || !PAGE_SIZES[t.page?.size];
  return `
  <div class="props-title"><strong>תבנית</strong><span class="muted">${t.id ? '#' + escapeHtml(t.id) : 'לא נשמרה'}</span></div>
  <details class="pg" open><summary>פרטי התבנית</summary><div class="pg-body">
    <label class="f"><span>שם</span><input type="text" data-tkey="name" value="${escapeHtml(t.name || '')}"></label>
    <label class="f f-col"><span>תיאור</span><textarea data-tkey="description" rows="2">${escapeHtml(t.description || '')}</textarea></label>
  </div></details>
  <details class="pg" open><summary>גודל דף</summary><div class="pg-body">
    <label class="f"><span>גודל</span><select data-tkey="page.size">${[...Object.keys(PAGE_SIZES), 'custom'].map((s) => opt(s, s === 'custom' ? 'מותאם אישית' : s, custom ? 'custom' : t.page.size)).join('')}</select></label>
    ${custom ? `<div class="f-grid"><label class="f"><span>רוחב</span><input type="number" data-tkey="page.width" data-type="num" value="${w}"></label><label class="f"><span>גובה</span><input type="number" data-tkey="page.height" data-type="num" value="${h}"></label></div>` : ''}
    <div class="f"><span>כיוון</span><div class="seg"><button class="${t.page?.orientation !== 'landscape' ? 'on' : ''}" data-tseg="page.orientation" data-val="portrait">לאורך</button><button class="${t.page?.orientation === 'landscape' ? 'on' : ''}" data-tseg="page.orientation" data-val="landscape">לרוחב</button></div></div>
    <p class="hint">${Math.round(w * 10) / 10} × ${Math.round(h * 10) / 10} מ"מ</p>
  </div></details>
  <details class="pg" open><summary>עמוד ${state.pageIndex + 1}</summary><div class="pg-body">
    <label class="f"><span>צבע רקע</span><input type="color" data-pkey="color" value="${escapeHtml(page.color || '#ffffff')}"></label>
    <div class="f"><span>רקע</span><span class="muted">${bg.type === 'pdf' ? `עמוד ${bg.pageIndex + 1} מקובץ מקור` : bg.type === 'image' ? 'תמונה' : 'ללא'}</span></div>
    <div class="btn-row"><button class="btn" data-action="bg-image">תמונת רקע...</button>${bg.type ? '<button class="btn" data-action="bg-clear">הסרת רקע</button>' : ''}</div>
  </div></details>
  <details class="pg"><summary>רשת והצמדה</summary><div class="pg-body">
    <label class="f"><span>הצמדה לרשת</span><select data-skey="grid">${[[0, 'ללא'], [0.5, '0.5 מ"מ'], [1, '1 מ"מ'], [2, '2 מ"מ'], [2.5, '2.5 מ"מ'], [5, '5 מ"מ']].map(([v, l]) => opt(v, l, state.grid)).join('')}</select></label>
    <label class="f f-check"><input type="checkbox" data-skey="showGrid" data-type="bool"${state.showGrid ? ' checked' : ''}><span>הצג רשת</span></label>
  </div></details>
  <p class="hint pad">בחרו רכיב בדף כדי לערוך את המאפיינים שלו. גררו רכיבים מהסרגל או שדות מעולם הנתונים.</p>`;
}

// ---------------------------------------------------------------- render
export function renderProps() {
  if (!state.template) return;
  const els = selectedElements();
  if (!els.length) {
    panel.innerHTML = pagePanel();
    return;
  }
  const types = new Set(els.map((e) => e.type));
  const type = types.size === 1 ? els[0].type : null;
  let html = `<div class="props-title"><strong>${type ? TYPE_LABELS[type] : `${els.length} רכיבים`}</strong>
    <span class="props-actions">
      <button class="mini" data-action="z-front" title="הבא לחזית">⬆</button>
      <button class="mini" data-action="z-back" title="שלח לרקע">⬇</button>
      <button class="mini" data-action="duplicate" title="שכפול (Ctrl+D)">⧉</button>
      <button class="mini danger" data-action="delete" title="מחיקה (Delete)">🗑</button>
    </span></div>`;
  if (els.length > 1) {
    html += `<div class="align-bar">
      <button class="mini" data-align="right" title="יישור לימין">⇥</button><button class="mini" data-align="hcenter" title="מרכוז אופקי">↔</button><button class="mini" data-align="left" title="יישור לשמאל">⇤</button>
      <button class="mini" data-align="top" title="יישור למעלה">⤒</button><button class="mini" data-align="vcenter" title="מרכוז אנכי">↕</button><button class="mini" data-align="bottom" title="יישור למטה">⤓</button>
      <button class="mini" data-align="same-w" title="אותו רוחב">↔=</button><button class="mini" data-align="same-h" title="אותו גובה">↕=</button>
      <button class="mini" data-align="dist-v" title="פיזור אנכי שווה">☰</button></div>`;
  }
  const parts = [];
  if (type) {
    if (els.length === 1) parts.push(() => `<div class="pg-body tight">${nameField(els)}</div>`);
    if (type === 'table') parts.push(...tableGroups(els[0]));
    else if (CONTENT[type]) parts.push(CONTENT[type]);
    if (['text', 'field', 'computed', 'richtext'].includes(type)) parts.push(fontGroup(type !== 'richtext'));
    if (['text', 'field', 'computed', 'richtext', 'image', 'barcode'].includes(type)) parts.push(boxGroup);
  }
  parts.push(geometry, behavior);
  html += parts.map((p) => p(els)).join('');
  panel.innerHTML = html;
}

// ---------------------------------------------------------------- events
function parseInput(t) {
  if (t.type === 'checkbox') return t.checked;
  if (t.dataset.type === 'num' || t.type === 'number') return t.value === '' ? undefined : Number(t.value);
  return t.value;
}

function applyToSelected(key, v) {
  const els = selectedElements();
  change(() => els.forEach((e) => setPath(e, key, v)), 'props-edit');
}

panel.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.dataset.key) {
    let v = parseInput(t);
    if (t.type === 'color') t.removeAttribute('data-empty');
    applyToSelected(t.dataset.key, v);
    rerenderSoon();
  } else if (t.dataset.colkey) {
    const [i, key] = t.dataset.colkey.split(/\.(.+)/);
    const el = selectedElements()[0];
    const c = el.columns[+i];
    state.openCol = c.id;
    change(() => setPath(c, key, parseInput(t)), 'props-edit');
    rerenderSoon();
  } else if (t.dataset.tkey) {
    change((tpl) => setPath(tpl, t.dataset.tkey, parseInput(t)), t.dataset.tkey.startsWith('page') ? 'all' : 'meta');
  } else if (t.dataset.pkey) {
    change(() => setPath(currentPage(), t.dataset.pkey, parseInput(t)), 'all');
  } else if (t.dataset.skey) {
    state[t.dataset.skey] = t.dataset.type === 'bool' ? t.checked : Number(t.value);
    emit('all');
  } else if (t.dataset.insert) {
    const p = t.value;
    if (!p) return;
    const el = selectedElements()[0];
    const ta = panel.querySelector(`[data-key="${t.dataset.insert}"]`);
    const ins = `{{${p}}}`;
    const cur = el[t.dataset.insert] || '';
    const pos = ta && document.activeElement !== ta && ta.selectionStart !== undefined ? ta.selectionStart : cur.length;
    change(() => { el[t.dataset.insert] = cur.slice(0, pos) + ins + cur.slice(pos); }, 'props-edit');
    rerenderSoon();
  }
});

// live update while typing in expressions / text for a responsive canvas
let typingTimer = null;
panel.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.type === 'color' && t.dataset.key) {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => applyToSelected(t.dataset.key, t.value), 150);
  }
});

let rerenderTimer = null;
function rerenderSoon() {
  clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(() => {
    const active = document.activeElement;
    const key = active && panel.contains(active) ? active.dataset.key || active.dataset.colkey : null;
    const scrollTop = panel.scrollTop;
    renderProps();
    panel.scrollTop = scrollTop;
    if (key) {
      const again = panel.querySelector(`[data-key="${CSS.escape(key)}"], [data-colkey="${CSS.escape(key)}"]`);
      if (again) again.focus();
    }
  }, 0);
}

panel.addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  const els = selectedElements();
  if (b.dataset.toggle) {
    const k = b.dataset.toggle;
    const on = !(els.length && getPath(els[0], k) === true);
    applyToSelected(k, on);
    rerenderSoon();
  } else if (b.dataset.seg) {
    applyToSelected(b.dataset.seg, b.dataset.val);
    rerenderSoon();
  } else if (b.dataset.tseg) {
    change((tpl) => setPath(tpl, b.dataset.tseg, b.dataset.val), 'all');
  } else if (b.dataset.clear) {
    applyToSelected(b.dataset.clear, '');
    rerenderSoon();
  } else if (b.dataset.align) {
    alignSelected(b.dataset.align);
  } else if (b.dataset.coldel !== undefined) {
    ev.preventDefault();
    const i = +b.dataset.coldel;
    change(() => els[0].columns.splice(i, 1), 'props-edit');
    rerenderSoon();
  } else if (b.dataset.colmove) {
    ev.preventDefault();
    const [i, d] = b.dataset.colmove.split(':').map(Number);
    const cols = els[0].columns;
    const j = i + d;
    if (j < 0 || j >= cols.length) return;
    change(() => { [cols[i], cols[j]] = [cols[j], cols[i]]; }, 'props-edit');
    rerenderSoon();
  } else if (b.dataset.action === 'col-add') {
    const c = { id: uid('c'), header: 'עמודה', binding: '', width: 1 };
    state.openCol = c.id;
    change(() => els[0].columns.push(c), 'props-edit');
    rerenderSoon();
  } else if (b.dataset.action === 'rt-edit') {
    const node = document.querySelector(`.design-page .fd-el[data-id="${CSS.escape(els[0].id)}"]`);
    if (node) startRichEdit(els[0], node);
  } else if (b.dataset.action === 'image-upload') {
    pickFile('image/*').then(async (f) => {
      if (!f) return;
      const src = await readFileAsDataUrl(f);
      change(() => { els[0].src = src; els[0].source = 'static'; }, 'props-edit');
    });
  } else if (b.dataset.action === 'bg-image') {
    pickFile('image/*').then(async (f) => {
      if (!f) return;
      const src = await readFileAsDataUrl(f);
      change(() => { currentPage().background = { type: 'image', src }; }, 'all');
    });
  } else if (b.dataset.action === 'bg-clear') {
    change(() => { delete currentPage().background; }, 'all');
  } else if (b.dataset.action === 'expr-help') {
    ev.preventDefault();
    showExprHelp();
  } else if (b.dataset.action) {
    emit('action:' + b.dataset.action);
  }
});

// keep the column card open state
panel.addEventListener('toggle', (ev) => {
  const d = ev.target;
  if (d.classList?.contains('col-card') && d.open) state.openCol = d.dataset.colid;
}, true);

export function pickFile(accept) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });
}

function alignSelected(how) {
  const els = selectedElements().filter((e) => !e.locked);
  if (els.length < 2) return;
  const minX = Math.min(...els.map((e) => e.x));
  const maxX = Math.max(...els.map((e) => e.x + e.w));
  const minY = Math.min(...els.map((e) => e.y));
  const maxY = Math.max(...els.map((e) => e.y + e.h));
  const ref = els[0];
  change(() => {
    for (const e of els) {
      if (how === 'left') e.x = minX;
      if (how === 'right') e.x = maxX - e.w;
      if (how === 'hcenter') e.x = (minX + maxX) / 2 - e.w / 2;
      if (how === 'top') e.y = minY;
      if (how === 'bottom') e.y = maxY - e.h;
      if (how === 'vcenter') e.y = (minY + maxY) / 2 - e.h / 2;
      if (how === 'same-w') e.w = ref.w;
      if (how === 'same-h') e.h = ref.h;
    }
    if (how === 'dist-v') {
      const s = [...els].sort((a, b) => a.y - b.y);
      const total = s.reduce((a, e) => a + e.h, 0);
      const gap = (maxY - minY - total) / (s.length - 1);
      let y = minY;
      for (const e of s) { e.y = Math.round(y * 10) / 10; y += e.h + gap; }
    }
  });
}

export function showExprHelp() {
  const rows = FUNCTION_HELP.map(([f, d]) => `<tr><td dir="ltr"><code>${escapeHtml(f)}</code></td><td>${escapeHtml(d)}</td></tr>`).join('');
  emit('dialog:' + JSON.stringify({
    title: 'נוסחאות ופונקציות',
    html: `<p>ביטויים משתמשים בשמות השדות מעולם הנתונים. בתוך טבלה, שמות השדות מתייחסים לשורה הנוכחית.</p>
      <table class="help-table"><tbody>${rows}</tbody></table>
      <p><b>אופרטורים:</b> <code dir="ltr">+ - * / %</code>, השוואה <code dir="ltr">== != &lt; &gt; &lt;= &gt;=</code>, לוגיקה <code dir="ltr">and or not</code>, שרשור <code>&amp;</code></p>
      <p><b>בטקסט:</b> <code dir="ltr">{{customer.name}}</code>, <code dir="ltr">{{price * qty | currency}}</code>, <code dir="ltr">{{date | date:dd/MM/yyyy}}</code>, <code dir="ltr">{{page}}</code> / <code dir="ltr">{{pages}}</code></p>
      <p><b>XML:</b> מאפיין (attribute) נכתב עם @, לדוגמה <code dir="ltr">@number</code>.</p>`,
  }));
}

on((w) => {
  if (['selection', 'load', 'all', 'data', 'fonts'].includes(w)) renderProps();
});
