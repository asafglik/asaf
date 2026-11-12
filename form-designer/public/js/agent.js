// Smart design agent panel: automatic layout from a sample PDF, and free-text
// design requests. Every agent answer is applied as one undoable change.
import { state, on, emit, change, undo, undoDepth, uid, uniquePlaceholder, ensureBand, allContainers, fullTemplate, select } from './state.js';
import { api } from './api.js';
import { createElement } from './factory.js';
import { analyzePdf, inspectPdf, ensureBackground } from './pdfimport.js';
import { fileToBase64 } from './util.js';
import { escapeHtml } from '/shared/elements.js';
import { pickFile } from './props.js';
import { sanitizeRichHtml } from './sanitize.js';
import { cleanElement } from '/shared/elements.js';

const pane = document.getElementById('agent-pane');
let status = { available: false };
const chat = []; // { role: 'user'|'agent'|'error', text, ops? }
let busy = false;

const SUGGESTIONS = [
  'הוסף כותרת תחתונה עם "עמוד X מתוך Y" במרכז',
  'הוסף אזור חתימה ללקוח ולנציג בתחתית העמוד האחרון',
  'הגדל את הכותרת הראשית, הדגש אותה ושנה את צבעה לכחול כהה',
  'הצג את ההערות רק כשיש בהן תוכן',
  'יישר את כל השדות לגופן David בגודל 11',
];

function render() {
  const hasPdf = !!state.sourcePdf;
  pane.innerHTML = `
    ${status.available
    ? '<div class="ag-status on"><span class="dot"></span>הסוכן החכם פעיל</div>'
    : '<div class="ag-off"><b>הסוכן החכם עדיין לא הופעל בשרת.</b><br>בינתיים "עיצוב אוטומטי" משתמש בזיהוי בסיסי (שדות טופס ותוויות). להפעלה מלאה פנו למנהל המערכת (הגדרת מפתח Claude API – ראו README).</div>'}
    <section class="ag-card">
      <h3>עיצוב אוטומטי מקובץ דוגמה</h3>
      <p class="hint">הסוכן קורא את ה-PDF (תמונה, טקסטים ושדות טופס קיימים) ואת עולם הנתונים, וממקם לבד שדות, טבלאות, תיבות סימון ואזורי חתימה.</p>
      <div class="seg ag-mode">
        <button class="${state.agentMode !== 'rebuild' ? 'on' : ''}" data-mode="overlay" type="button" title="ה-PDF נשאר רקע, ומעליו נוספים שדות">שדות מעל ה-PDF</button>
        <button class="${state.agentMode === 'rebuild' ? 'on' : ''}" data-mode="rebuild" type="button" title="המסמך נבנה מחדש מרכיבים, בלי רקע">בנייה מחדש</button>
      </div>
      <textarea id="ag-instr" rows="2" placeholder="הנחיות נוספות (רשות): למשל &quot;תאריכים בפורמט dd/MM/yyyy&quot;">${escapeHtml(state.agentInstr || '')}</textarea>
      <div class="btn-row">
        ${hasPdf ? '<button class="btn btn-primary" data-ag="auto" type="button">✨ עיצוב אוטומטי</button>' : ''}
        <button class="btn${hasPdf ? '' : ' btn-primary'}" data-ag="upload" type="button">${hasPdf ? 'PDF אחר...' : '✨ העלאת PDF דוגמה...'}</button>
      </div>
      ${!state.tree ? '<p class="hint warn">כדאי להגדיר קודם עולם נתונים, כדי שהשדות יקושרו לנתונים.</p>' : ''}
    </section>
    <section class="ag-card ag-chat-card">
      <h3>בקשות עיצוב</h3>
      <div class="ag-chat" id="ag-chat">
        ${chat.length ? chat.map(msgHtml).join('') : `<div class="ag-sugg">${SUGGESTIONS.map((s) => `<button class="chip" data-sugg="${escapeHtml(s)}" type="button"${status.available ? '' : ' disabled aria-disabled="true"'}>${escapeHtml(s)}</button>`).join('')}</div>`}
        ${busy ? '<div class="ag-msg agent busy"><span class="spinner"></span> הסוכן עובד...</div>' : ''}
      </div>
      <div class="ag-input">
        <textarea id="ag-req" rows="3" placeholder="${status.available ? 'מה לשנות בעיצוב? (Ctrl+Enter לשליחה)' : 'זמין לאחר הפעלת הסוכן החכם'}"${status.available ? '' : ' disabled'}></textarea>
        <button class="btn btn-primary" data-ag="send" type="button"${status.available && !busy ? '' : ' disabled'}>שליחה</button>
      </div>
    </section>`;
  const c = document.getElementById('ag-chat');
  c.scrollTop = c.scrollHeight;
}

function msgHtml(m, i) {
  if (m.role === 'user') return `<div class="ag-msg user">${escapeHtml(m.text)}</div>`;
  if (m.role === 'error') return `<div class="ag-msg error">${escapeHtml(m.text)}</div>`;
  return `<div class="ag-msg agent">${escapeHtml(m.text)}${m.applied ? `<div class="ag-meta">${m.applied} שינויים הוחלו${m.undoable ? ` · <button class="link" data-undo="${i}" type="button">ביטול</button>` : ''}</div>` : ''}</div>`;
}

// ---------------------------------------------------------------- applying operations
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function deepMerge(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (BAD_KEYS.has(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) deepMerge(target[k], v);
    else target[k] = v;
  }
  return target;
}

const TYPES = new Set(['text', 'field', 'computed', 'richtext', 'table', 'image', 'barcode', 'checkbox', 'signature', 'upload', 'line', 'rect', 'ellipse']);

function normalizeElement(raw) {
  if (!TYPES.has(raw.type)) return null;
  const base = createElement(raw.type, { symbology: raw.symbology });
  const el = cleanElement(deepMerge(base, { ...raw }));
  if (el.type === 'richtext') el.html = sanitizeRichHtml(el.html);
  if (el.type === 'image' && el.src && !/^data:image\/(png|jpe?g|gif|webp);/i.test(el.src)) el.src = '';
  el.id = uid();
  for (const k of ['x', 'y', 'w', 'h']) el[k] = Math.round((Number(el[k]) || 0) * 10) / 10;
  if (el.type === 'table') el.columns = (el.columns || []).map((c) => ({ id: uid('c'), width: 1, ...c }));
  if ((el.type === 'signature' || el.type === 'upload') && (!el.placeholder || placeholderTaken(el.placeholder))) {
    el.placeholder = uniquePlaceholder(el.type);
  }
  return el;
}

function placeholderTaken(name) {
  return allContainers().some((c) => (c.elements || []).some((e) => e.placeholder === name));
}

function findById(t, id) {
  for (const c of [...t.pages, t.header, t.footer].filter(Boolean)) {
    const i = (c.elements || []).findIndex((e) => e.id === id);
    if (i >= 0) return { c, i, el: c.elements[i] };
  }
  return null;
}

/** Apply agent operations as a single undoable change. Returns how many applied. */
export function applyOperations(ops, { rebuild = false } = {}) {
  let n = 0;
  const added = [];
  change((t) => {
    if (rebuild) t.pages.forEach((p) => { delete p.background; p.elements = []; });
    for (const o of ops) {
      const e = o.element || {};
      if (o.op === 'add_element') {
        const el = normalizeElement(e);
        if (!el) continue;
        let container;
        if (o.target === 'header' || o.target === 'footer') container = ensureBand(t, o.target);
        else {
          const pi = Math.max(0, (o.page || 1) - 1);
          while (t.pages.length <= pi) t.pages.push({ id: uid('p'), elements: [] });
          container = t.pages[pi];
        }
        container.elements.push(el);
        added.push(el.id);
        n++;
      } else if (o.op === 'update_element') {
        const f = findById(t, o.id);
        if (!f) continue;
        delete e.id;
        if (e.type && e.type !== f.el.type) delete e.type;
        deepMerge(f.el, e);
        Object.assign(f.el, cleanElement(f.el));
        if (f.el.type === 'richtext') f.el.html = sanitizeRichHtml(f.el.html);
        n++;
      } else if (o.op === 'delete_element') {
        const f = findById(t, o.id);
        if (!f) continue;
        f.c.elements.splice(f.i, 1);
        n++;
      } else if (o.op === 'set_header' || o.op === 'set_footer') {
        const b = ensureBand(t, o.op === 'set_header' ? 'header' : 'footer');
        if (e.enabled !== undefined) b.enabled = e.enabled !== false;
        if (Number.isFinite(Number(e.height))) b.height = Math.max(5, Math.min(200, Number(e.height)));
        if (['all', 'notFirst', 'firstOnly', 'notLast', 'lastOnly'].includes(e.showOn)) b.showOn = e.showOn;
        n++;
      } else if (o.op === 'set_template') {
        if (typeof e.name === 'string') t.name = e.name.slice(0, 200);
        if (typeof e.description === 'string') t.description = e.description.slice(0, 500);
        if (e.page && typeof e.page === 'object') {
          const pg = {};
          if (['A4', 'A5', 'A3', 'Letter', 'Legal', 'custom'].includes(e.page.size)) pg.size = e.page.size;
          if (['portrait', 'landscape'].includes(e.page.orientation)) pg.orientation = e.page.orientation;
          for (const k of ['width', 'height']) if (Number(e.page[k]) > 0) pg[k] = Math.min(2000, Number(e.page[k]));
          t.page = { ...t.page, ...pg };
        }
        n++;
      }
    }
  });
  state.selection = [];
  const onPage = new Set((state.band ? state.template[state.band] : state.template.pages[state.pageIndex])?.elements.map((x) => x.id) || []);
  select(added.filter((id) => onPage.has(id)));
  return n;
}

// ---------------------------------------------------------------- actions
async function autoDesign() {
  if (busy || !state.sourcePdf) return;
  const mode = state.agentMode === 'rebuild' ? 'rebuild' : 'overlay';
  const instructions = document.getElementById('ag-instr')?.value || '';
  state.agentInstr = instructions;
  busy = true;
  chat.push({ role: 'user', text: mode === 'rebuild' ? 'בנה את המסמך מחדש מקובץ הדוגמה' : 'מקם שדות מעל קובץ הדוגמה' });
  render();
  try {
    const pages = await analyzePdf(state.sourcePdf);
    const r = await api.post('/api/ai/auto-design', { template: fullTemplateLite(), tree: state.tree, pages, mode, instructions });
    const applied = r.operations.length ? applyOperations(r.operations, { rebuild: mode === 'rebuild' && !r.heuristic }) : 0;
    chat.push({ role: 'agent', text: r.message || 'בוצע.', applied, undoable: applied > 0, depth: undoDepth() });
  } catch (e) {
    chat.push({ role: 'error', text: e.message });
  } finally {
    busy = false;
    render();
  }
}

async function uploadAndDesign() {
  const f = await pickFile('application/pdf,.pdf');
  if (!f) return;
  const b64 = await fileToBase64(f);
  const info = await inspectPdf(b64);
  state.sourcePdf = b64;
  state.bgImages = {};
  change((t) => {
    t.page = { size: 'custom', width: Math.round(info.widthMm * 10) / 10, height: Math.round(info.heightMm * 10) / 10, orientation: 'portrait' };
    const old = t.pages;
    t.pages = [];
    for (let i = 0; i < info.pages; i++) t.pages.push({ id: uid('p'), background: { type: 'pdf', pageIndex: i }, elements: i === 0 && old.length === 1 ? old[0].elements : [] });
    if (!t.name || t.name === 'תבנית חדשה') t.name = f.name.replace(/\.[^.]+$/, '');
  });
  state.pageIndex = 0;
  state.band = null;
  ensureBackground(0);
  emit('page');
  await autoDesign();
}

async function sendRequest(text) {
  text = (text || '').trim();
  if (!text || busy) return;
  busy = true;
  chat.push({ role: 'user', text });
  render();
  try {
    const bg = state.template.pages[state.pageIndex]?.background;
    const r = await api.post('/api/ai/request', {
      template: fullTemplateLite(true),
      tree: state.tree,
      request: text,
      pageIndex: state.band ? 0 : state.pageIndex,
      pageImage: bg?.type === 'pdf' ? state.bgImages[bg.pageIndex] : bg?.type === 'image' ? bg.src : undefined,
      selection: state.selection,
      history: chat.filter((m) => m.role === 'user').slice(0, -1).map((m) => m.text),
    });
    const applied = r.operations.length ? applyOperations(r.operations) : 0;
    chat.push({ role: 'agent', text: r.message || 'בוצע.', applied, undoable: applied > 0, depth: undoDepth() });
  } catch (e) {
    chat.push({ role: 'error', text: e.message });
  } finally {
    busy = false;
    render();
  }
}

/** Template for the agent: without the (large) source PDF. */
function fullTemplateLite(withSample = false) {
  const t = fullTemplate();
  delete t.sourcePdf;
  if (!withSample && t.schema) t.schema = { ...t.schema, sample: undefined };
  return t;
}

pane.addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.mode) { state.agentMode = b.dataset.mode; render(); }
  else if (b.dataset.ag === 'auto') autoDesign();
  else if (b.dataset.ag === 'upload') uploadAndDesign().catch((e) => { chat.push({ role: 'error', text: e.message }); render(); });
  else if (b.dataset.ag === 'send') sendRequest(document.getElementById('ag-req').value);
  else if (b.dataset.sugg) { const ta = document.getElementById('ag-req'); ta.value = b.dataset.sugg; ta.focus(); }
  else if (b.dataset.undo !== undefined) {
    const m = chat[+b.dataset.undo];
    if (!m || !m.undoable) return;
    if (undoDepth() !== m.depth) {
      // the user changed things after the agent: undoing now would undo their change instead
      emit('toast:' + JSON.stringify({ msg: 'אחרי שינויי הסוכן בוצעו שינויים נוספים. בטלו אותם קודם (Ctrl+Z) או בטלו ידנית.' }));
      return;
    }
    undo();
    m.undoable = false;
    m.text += ' (בוטל)';
    render();
  }
});
pane.addEventListener('keydown', (ev) => {
  if (ev.target.id === 'ag-req' && ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
    ev.preventDefault();
    sendRequest(ev.target.value);
  }
  ev.stopPropagation();
});
pane.addEventListener('input', (ev) => { if (ev.target.id === 'ag-instr') state.agentInstr = ev.target.value; });

on((w) => { if (['load', 'data', 'page'].includes(w) && !busy) render(); });
api.get('/api/ai/status').then((s) => { status = s; render(); }).catch(() => render());
render();
