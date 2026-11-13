// Designer bootstrap: toolbar actions, dialogs, pages, keyboard shortcuts.
import {
  state, on, emit, change, undo, redo, select, selectedElements, currentPage, uid,
  newTemplate, loadTemplate, fullTemplate, pageSizeMm, ensureBand, uniquePlaceholder,
} from './state.js';
import './agent.js';
import { api, keyQuery } from './api.js';
import { render, addElement, scrollEl, commitPropsEdit } from './canvas.js';
import { renderProps, pickFile } from './props.js';
import { renderTree, allValuePaths, arrayPaths } from './datatree.js';
import { TOOLS, createElement } from './factory.js';
import { ensureBackground, inspectPdf } from './pdfimport.js';
import { readFileAsText, readDataFile, fileToBase64, download } from './util.js';
import { escapeHtml, MM } from '/shared/elements.js';
import { FORMAT_PRESETS } from '/shared/format.js';

const $ = (s, r = document) => r.querySelector(s);

// ---------------------------------------------------------------- toast / status
let toastTimer;
function toast(msg, kind = '', onUndo = null) {
  const t = $('#toast');
  t.textContent = msg;
  if (onUndo) {
    const b = document.createElement('button');
    b.className = 'toast-undo';
    b.type = 'button';
    b.textContent = 'ביטול';
    b.onclick = () => { onUndo(); t.className = 'toast'; };
    t.appendChild(b);
  }
  t.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, kind === 'error' ? 6000 : onUndo ? 5000 : 2800);
}

const pagesText = (n) => (Number(n) === 1 ? 'עמוד אחד' : `${n} עמודים`);

function updateChrome() {
  const t = state.template;
  if (!t) return;
  $('#tpl-num').textContent = t.id ? `#${t.id}` : 'חדש';
  $('#tpl-name').textContent = t.name || 'ללא שם';
  $('#dirty-dot').classList.toggle('on', state.dirty);
  document.title = `${t.name || 'תבנית'}${t.id ? ' #' + t.id : ''} – מעצב טפסים`;
  $('#zoom-val').textContent = Math.round(state.zoom * 100) + '%';
  $('#status-page').textContent = state.band ? (state.band === 'header' ? 'כותרת עליונה' : 'כותרת תחתונה') : `עמוד ${state.pageIndex + 1} מתוך ${t.pages.length}`;
  renderPagesList();
}

// ---------------------------------------------------------------- dialogs
const dlg = $('#dlg');
function openDialog({ title, html, buttons = [], wide = false, onOpen }) {
  $('#dlg-title').textContent = title;
  $('#dlg-body').innerHTML = html;
  const foot = $('#dlg-foot');
  foot.innerHTML = '';
  dlg.classList.toggle('wide', !!wide);
  return new Promise((resolve) => {
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn' + (b.primary ? ' btn-primary' : '') + (b.danger ? ' btn-danger' : '');
      btn.textContent = b.label;
      btn.onclick = async () => {
        if (b.action) {
          try {
            btn.disabled = true;
            const r = await b.action($('#dlg-body'));
            if (r === false) { btn.disabled = false; return; }
            dlg.close();
            resolve(r);
          } catch (e) {
            btn.disabled = false;
            toast(e.message, 'error');
          }
        } else {
          dlg.close();
          resolve(b.value);
        }
      };
      foot.appendChild(btn);
    }
    dlg.onclose = () => resolve(undefined);
    dlg.showModal();
    onOpen?.($('#dlg-body'));
  });
}

on((w) => {
  if (typeof w === 'string' && w.startsWith('dialog:')) {
    const d = JSON.parse(w.slice(7));
    openDialog({ ...d, buttons: [{ label: 'סגירה', primary: true }] });
  }
  if (typeof w === 'string' && w.startsWith('action:')) runAction(w.slice(7));
  if (w === 'reparse') applySchema(state.template.schema, { silent: true });
  if (w === 'need-bg') {
    const bg = currentPage().background;
    if (bg?.type === 'pdf') ensureBackground(bg.pageIndex);
  }
  if (w === 'focus-props') document.querySelector('#props input, #props textarea')?.focus();
  if (typeof w === 'string' && w.startsWith('open-band:')) openBand(w.slice(10));
  if (typeof w === 'string' && w.startsWith('toast:')) {
    const t = JSON.parse(w.slice(6));
    toast(t.msg, '', t.undo ? () => undo() : null);
  }
  updateChrome();
});

// ---------------------------------------------------------------- toolbox
function renderTools() {
  $('#tools').innerHTML = TOOLS.map((t, i) => `
    <button class="tool" draggable="true" data-tool="${i}" title="${escapeHtml(t.hint)}">
      <span class="tool-icon">${t.icon}</span><span class="tool-label">${escapeHtml(t.label)}</span>
    </button>`).join('');
}
$('#tools').addEventListener('dragstart', (ev) => {
  const b = ev.target.closest('.tool');
  if (!b) return;
  const t = TOOLS[+b.dataset.tool];
  ev.dataTransfer.setData('application/x-fd-tool', JSON.stringify({ type: t.type, symbology: t.symbology }));
  ev.dataTransfer.effectAllowed = 'copy';
});
$('#tools').addEventListener('click', (ev) => {
  const b = ev.target.closest('.tool');
  if (!b) return;
  const t = TOOLS[+b.dataset.tool];
  addElement(createElement(t.type, { symbology: t.symbology }));
});

// tabs
document.querySelector('.tabs').addEventListener('click', (ev) => {
  const b = ev.target.closest('.tab');
  if (!b) return;
  showTab(b.dataset.tab);
});
function showTab(name) {
  document.querySelectorAll('.tab').forEach((x) => { x.classList.toggle('on', x.dataset.tab === name); x.setAttribute('aria-selected', String(x.dataset.tab === name)); });
  document.querySelectorAll('.tab-pane').forEach((x) => x.classList.toggle('on', x.dataset.pane === name));
}

// ---------------------------------------------------------------- pages panel
function renderPagesList() {
  const t = state.template;
  const { w, h } = pageSizeMm();
  const bandCard = (band, label) => {
    const b = t[band];
    const n = b?.elements?.length || 0;
    return `<button class="page-card band-card${state.band === band ? ' on' : ''}" data-band="${band}">
      <span class="page-thumb band-thumb ${band}" style="aspect-ratio:${w}/${h}"><i></i></span>
      <span class="page-meta">${label}<small>${b && b.enabled !== false ? `${n} רכיבים · ${Number(b.height) || 0} מ"מ` : 'לחצו להוספה'}</small></span></button>`;
  };
  $('#pages-list').innerHTML = bandCard('header', 'כותרת עליונה') + bandCard('footer', 'כותרת תחתונה') + '<div class="pages-sep"></div>' + t.pages.map((p, i) => `
    <button class="page-card${i === state.pageIndex && !state.band ? ' on' : ''}" data-page="${i}">
      <span class="page-thumb" style="aspect-ratio:${w}/${h}">${p.background ? '<span class="pt-bg">רקע</span>' : ''}<span class="pt-n">${i + 1}</span></span>
      <span class="page-meta">עמוד ${i + 1}<small>${p.elements.length} רכיבים</small></span>
      <span class="page-move"><span data-pmove="${i}:-1" title="הזזה למעלה">▲</span><span data-pmove="${i}:1" title="הזזה למטה">▼</span></span>
    </button>`).join('');
}
$('#pages-list').addEventListener('pointerdown', () => commitPropsEdit());
$('#data-tree').addEventListener('pointerdown', () => commitPropsEdit());
$('#pages-list').addEventListener('click', (ev) => {
  const mv = ev.target.closest('[data-pmove]');
  if (mv) {
    const [i, d] = mv.dataset.pmove.split(':').map(Number);
    const j = i + d;
    if (j < 0 || j >= state.template.pages.length) return;
    change((t) => { [t.pages[i], t.pages[j]] = [t.pages[j], t.pages[i]]; });
    gotoPage(j);
    return;
  }
  const c = ev.target.closest('.page-card');
  if (c && c.dataset.band) openBand(c.dataset.band);
  else if (c) gotoPage(+c.dataset.page);
});

function openBand(band) {
  if (!state.template[band]) {
    change((t) => ensureBand(t, band));
  }
  state.band = band;
  state.selection = [];
  emit('page');
  emit('selection');
}

function gotoPage(i) {
  state.band = null;
  state.pageIndex = Math.max(0, Math.min(i, state.template.pages.length - 1));
  state.selection = [];
  emit('page');
  emit('selection');
}

// ---------------------------------------------------------------- data world
async function applySchema(schema, { silent } = {}) {
  if (!schema || !schema.sample) {
    state.data = {};
    state.tree = null;
    emit('data');
    updateDatalists();
    return;
  }
  try {
    const r = await api.post('/api/data/parse', { content: schema.sample, format: schema.format, arrays: schema.arrays });
    state.data = r.data;
    state.tree = r.tree;
    emit('data');
    updateDatalists();
    return r;
  } catch (e) {
    if (!silent) throw e;
    toast('שגיאה בקריאת נתוני הדוגמה: ' + e.message, 'error');
  }
}

function updateDatalists() {
  $('#dl-paths').innerHTML = allValuePaths().map((p) => `<option value="${escapeHtml(p)}">`).join('');
  $('#dl-arrays').innerHTML = arrayPaths().map((p) => `<option value="${escapeHtml(p)}">`).join('');
}
$('#dl-formats').innerHTML = FORMAT_PRESETS.filter((f) => f.value).map((f) => `<option value="${escapeHtml(f.value)}">${escapeHtml(f.label)}</option>`).join('');

async function dataDialog() {
  const sc = state.template.schema;
  await openDialog({
    title: 'עולם הנתונים',
    wide: true,
    html: `
      <p>הדביקו דוגמה של מבנה הנתונים (XML או JSON) או טענו קובץ. אותו מבנה יישלח לשרת בעת הפקת ה-PDF.</p>
      <div class="btn-row"><button type="button" class="btn" id="data-file">טעינת קובץ...</button>
        <button type="button" class="btn" id="data-sample-xml">דוגמת XML</button><button type="button" class="btn" id="data-sample-json">דוגמת JSON</button>
        <span class="muted" id="data-detect"></span></div>
      <textarea id="data-text" class="mono code-area" dir="ltr" spellcheck="false" placeholder="&lt;invoice&gt;...&lt;/invoice&gt;  או  { &quot;customer&quot;: {...} }">${escapeHtml(sc?.sample || '')}</textarea>
      <p class="hint">ב-XML: אלמנט השורש מושמט מהנתיבים, מאפיינים נכתבים כ-<code>@name</code>, ואלמנט שחוזר על עצמו הופך לרשימה (מתאים לטבלה). רשימות שזוהו בדוגמה יישארו רשימות גם כשמגיע פריט אחד.</p>
      <div id="data-err" class="expr-err"></div>`,
    buttons: [
      { label: 'ביטול' },
      { label: 'החלת הנתונים', primary: true, action: async (body) => {
        const content = $('#data-text', body).value;
        if (!content.trim()) {
          change((t) => { t.schema = null; });
          await applySchema(null);
          return true;
        }
        let r;
        try {
          r = await api.post('/api/data/parse', { content, detectLists: true });
        } catch (e) {
          $('#data-err', body).textContent = e.message;
          return false;
        }
        change((t) => { t.schema = { format: r.format, sample: content, arrays: r.arrays }; });
        state.data = r.data;
        state.tree = r.tree;
        emit('data');
        updateDatalists();
        showTab('data');
        toast('עולם הנתונים עודכן');
        return true;
      } },
    ],
    onOpen: (body) => {
      const ta = $('#data-text', body);
      const detect = () => { const v = ta.value.trim(); $('#data-detect', body).textContent = v ? (v.startsWith('<') ? 'זוהה: XML' : 'זוהה: JSON') : ''; };
      ta.addEventListener('input', detect);
      detect();
      $('#data-file', body).onclick = async () => {
        const f = await pickFile('.xml,.json,application/json,text/xml');
        if (f) { ta.value = await readDataFile(f); detect(); }
      };
      $('#data-sample-xml', body).onclick = () => { ta.value = SAMPLE_XML; detect(); };
      $('#data-sample-json', body).onclick = () => { ta.value = SAMPLE_JSON; detect(); };
    },
  });
}

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<document id="1">
  <customer>
    <name>ישראל ישראלי</name>
    <id>012345678</id>
    <address>הרצל 1, תל אביב</address>
  </customer>
  <date>2026-11-12</date>
  <lines>
    <line><item>מוצר א</item><qty>2</qty><price>100</price></line>
    <line><item>מוצר ב</item><qty>1</qty><price>250.5</price></line>
  </lines>
</document>`;
const SAMPLE_JSON = JSON.stringify({
  id: 1,
  customer: { name: 'ישראל ישראלי', id: '012345678', address: 'הרצל 1, תל אביב' },
  date: '2026-11-12',
  lines: [{ item: 'מוצר א', qty: 2, price: 100 }, { item: 'מוצר ב', qty: 1, price: 250.5 }],
}, null, 2);

// ---------------------------------------------------------------- open / save
async function confirmDiscard() {
  if (!state.dirty) return true;
  const r = await openDialog({
    title: 'שינויים שלא נשמרו',
    html: '<p>בתבנית הנוכחית יש שינויים שלא נשמרו.</p>',
    buttons: [
      { label: 'ביטול', value: false },
      { label: 'המשך בלי לשמור', danger: true, value: true },
      { label: 'שמירה והמשך', primary: true, value: 'save' },
    ],
  });
  if (r === 'save') {
    await save();
    return !state.dirty;
  }
  return !!r;
}

async function openTemplate(id) {
  const t = await api.get(`/api/templates/${encodeURIComponent(id)}`);
  loadTemplate(t);
  try { localStorage.setItem('fd-last', id); } catch { /* ignore */ }
  history.replaceState(null, '', `#${encodeURIComponent(id)}`);
  await applySchema(t.schema, { silent: true });
  zoomFit();
  updateChrome();
}

async function openDialogList() {
  const list = await api.get('/api/templates');
  const rows = (q = '') => list
    .filter((t) => !q || `${t.id} ${t.name} ${t.description}`.toLowerCase().includes(q.toLowerCase()))
    .map((t) => `<button type="button" class="tpl-row" data-id="${escapeHtml(t.id)}"><span class="tpl-num">#${escapeHtml(t.id)}</span><span class="tpl-row-main"><b>${escapeHtml(t.name || 'ללא שם')}</b><small>${escapeHtml(t.description || '')}</small></span><span class="muted">${t.pages} עמ' · ${t.updatedAt ? new Date(t.updatedAt).toLocaleDateString('he-IL') : ''}</span></button>`)
    .join('') || '<p class="muted">לא נמצאו תבניות</p>';
  const id = await openDialog({
    title: 'פתיחת תבנית',
    html: `<input type="search" id="tpl-q" class="input-lg" placeholder="חיפוש לפי מספר או שם..."><div class="tpl-list" id="tpl-list">${rows()}</div>`,
    buttons: [{ label: 'ביטול' }, { label: '+ תבנית חדשה', value: '__new' }],
    onOpen: (body) => {
      const q = $('#tpl-q', body);
      q.focus();
      q.oninput = () => { $('#tpl-list', body).innerHTML = rows(q.value); };
      $('#tpl-list', body).onclick = (ev) => {
        const r = ev.target.closest('.tpl-row');
        if (r) { dlg.close(); dlg.dataset.picked = r.dataset.id; }
      };
    },
  }).then((v) => v ?? (dlg.dataset.picked ? (() => { const p = dlg.dataset.picked; delete dlg.dataset.picked; return p; })() : undefined));
  if (id === '__new') return runAction('new');
  if (id && (await confirmDiscard())) await openTemplate(id);
}

async function save({ asNew = false } = {}) {
  const t = state.template;
  if (!t.id || asNew) {
    const { id: next } = await api.get('/api/next-id');
    const res = await openDialog({
      title: asNew ? 'שמירה בשם' : 'שמירת תבנית חדשה',
      html: `<label class="f"><span>מספר תבנית</span><input id="sv-id" class="input-lg" value="${escapeHtml(asNew || !t.id ? next : t.id)}" dir="ltr"></label>
             <label class="f"><span>שם</span><input id="sv-name" class="input-lg" value="${escapeHtml(t.name || '')}"></label>
             <p class="hint">מספר התבנית הוא המזהה שהמערכת הקוראת שולחת לשרת יחד עם הנתונים.</p>`,
      buttons: [{ label: 'ביטול' }, { label: 'שמירה', primary: true, action: async (body) => {
        const id = $('#sv-id', body).value.trim();
        const name = $('#sv-name', body).value.trim();
        const payload = { ...fullTemplate(), id, name };
        const saved = await api.post('/api/templates', payload).catch(async (e) => {
          if (/כבר קיימת/.test(e.message) && confirm(`תבנית ${id} כבר קיימת. לדרוס אותה?`)) {
            return api.post('/api/templates?overwrite=1', payload);
          }
          throw e;
        });
        return saved;
      } }],
    });
    if (!res) return;
    state.template.id = res.id;
    state.template.name = res.name;
    state.template.updatedAt = res.updatedAt;
    history.replaceState(null, '', `#${encodeURIComponent(res.id)}`);
    try { localStorage.setItem('fd-last', res.id); } catch { /* ignore */ }
  } else {
    const saved = await api.put(`/api/templates/${encodeURIComponent(t.id)}`, fullTemplate());
    state.template.updatedAt = saved.updatedAt;
  }
  state.dirty = false;
  updateChrome();
  toast(`התבנית נשמרה (#${state.template.id})`, 'ok');
}

// ---------------------------------------------------------------- import PDF / Word
async function importDialog() {
  const choice = await openDialog({
    title: 'יצירת תבנית מקובץ',
    html: `
      <div class="choice-grid">
        <button type="button" class="choice" data-c="pdf"><b>PDF</b><span>כל עמוד בקובץ הופך לעמוד בתבנית, והעמוד המקורי משמש כרקע מדויק (וקטורי). מוסיפים מעליו שדות, טבלאות וברקודים.</span></button>
        <button type="button" class="choice" data-c="docx-layout"><b>Word – כפריסה מדויקת</b><span>הקובץ מומר ל-PDF בשרת (נדרש LibreOffice) ומשמש כרקע.</span></button>
        <button type="button" class="choice" data-c="docx-rich"><b>Word – כטקסט לעריכה</b><span>תוכן המסמך נכנס כרכיב טקסט מעוצב שאפשר לערוך ולשלב בו שדות {{...}}, כולל מעבר עמודים.</span></button>
      </div>
      <label class="f f-check"><input type="checkbox" id="imp-append"><span>הוספה לתבנית הנוכחית (במקום תבנית חדשה)</span></label>`,
    buttons: [{ label: 'ביטול' }],
    onOpen: (body) => {
      body.querySelectorAll('.choice').forEach((b) => {
        b.onclick = () => { dlg.dataset.choice = b.dataset.c + (body.querySelector('#imp-append').checked ? ':append' : ''); dlg.close(); };
      });
    },
  }).then(() => { const c = dlg.dataset.choice; delete dlg.dataset.choice; return c; });
  if (!choice) return;
  const [kind, appendFlag] = choice.split(':');
  const append = appendFlag === 'append';
  if (!append && !(await confirmDiscard())) return;
  const file = await pickFile(kind === 'pdf' ? 'application/pdf,.pdf' : '.docx,.doc,.rtf,.odt');
  if (!file) return;
  toast('מייבא...');
  try {
    if (kind === 'docx-rich') {
      const r = await api.post('/api/import/docx', { dataBase64: await fileToBase64(file), fileName: file.name, mode: 'html' });
      if (!append) startNew(file.name.replace(/\.[^.]+$/, ''));
      const { w, h } = pageSizeMm();
      const el = createElement('richtext', { html: r.html, overflow: 'paginate' });
      Object.assign(el, { x: 15, y: 15, w: w - 30, h: h - 30, name: file.name });
      change((t) => currentPage().elements.push(el));
      select(el.id);
      toast('המסמך יובא כטקסט מעוצב. לחיצה כפולה לעריכה.', 'ok');
      return;
    }
    let b64;
    if (kind === 'pdf') b64 = await fileToBase64(file);
    else b64 = (await api.post('/api/import/docx', { dataBase64: await fileToBase64(file), fileName: file.name, mode: 'pdf' })).pdfBase64;
    const info = await inspectPdf(b64);
    if (append && state.sourcePdf && state.sourcePdf !== b64) {
      const ok = await openDialog({ title: 'החלפת קובץ מקור', html: '<p>לתבנית כבר יש קובץ PDF מקור. ייבוא יחליף אותו, ורקעים קיימים יצביעו על הקובץ החדש. להמשיך?</p>', buttons: [{ label: 'ביטול', value: false }, { label: 'המשך', primary: true, value: true }] });
      if (!ok) return;
    }
    if (!append) startNew(file.name.replace(/\.[^.]+$/, ''));
    state.sourcePdf = b64;
    state.bgImages = {};
    change((t) => {
      if (!append) {
        t.page = { size: 'custom', width: Math.round(info.widthMm * 10) / 10, height: Math.round(info.heightMm * 10) / 10, orientation: 'portrait' };
        t.pages = [];
      }
      for (let i = 0; i < info.pages; i++) t.pages.push({ id: uid('p'), background: { type: 'pdf', pageIndex: i }, elements: [] });
    });
    gotoPage(append ? state.template.pages.length - info.pages : 0);
    zoomFit();
    toast(`יובא${info.pages === 1 ? ' עמוד אחד' : `ו ${info.pages} עמודים`}. הוסיפו שדות מעל הרקע.`, 'ok');
  } catch (e) {
    toast(e.message, 'error');
  }
}

function startNew(name) {
  const t = newTemplate('');
  t.name = name || 'תבנית חדשה';
  const schema = state.template?.schema;
  loadTemplate(t);
  if (schema) { state.template.schema = schema; }
  history.replaceState(null, '', '#');
  state.dirty = true;
}

// ---------------------------------------------------------------- preview
async function previewDialog() {
  const sample = state.template.schema?.sample || '';
  let url = null;
  const run = async (body) => {
    const data = $('#pv-data', body).value;
    const frame = $('#pv-frame', body);
    $('#pv-status', body).textContent = 'מפיק PDF...';
    const t0 = performance.now();
    try {
      const res = await api.raw('POST', '/api/preview', { template: fullTemplate(), data });
      const blob = await res.blob();
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(blob);
      frame.src = url;
      const warns = JSON.parse(decodeURIComponent(res.headers.get('X-Render-Warnings') || '%5B%5D'));
      $('#pv-status', body).innerHTML = `${pagesText(res.headers.get('X-Render-Pages'))} · ${((performance.now() - t0) / 1000).toFixed(1)} שנ'` + (warns.length ? ` · <span class="warn" title="${escapeHtml(warns.join('\n'))}">⚠ ${warns.length} אזהרות</span>` : '');
      $('#pv-dl', body).onclick = () => download(`${state.template.id || 'preview'}.pdf`, blob);
    } catch (e) {
      $('#pv-status', body).innerHTML = `<span class="warn">${escapeHtml(e.message)}</span>`;
    }
  };
  await openDialog({
    title: 'תצוגה מקדימה – PDF',
    wide: true,
    html: `<div class="pv">
      <div class="pv-side"><label class="f f-col"><span>נתונים לבדיקה (XML / JSON)</span><textarea id="pv-data" class="mono" dir="ltr" spellcheck="false">${escapeHtml(sample)}</textarea></label>
      <div class="btn-row"><button type="button" class="btn btn-primary" id="pv-run">הפקה מחדש</button><button type="button" class="btn" id="pv-dl">הורדה</button></div>
      <p id="pv-status" class="muted"></p></div>
      <iframe id="pv-frame" class="pv-frame" title="PDF"></iframe></div>`,
    buttons: [{ label: 'סגירה' }],
    onOpen: (body) => {
      $('#pv-run', body).onclick = () => run(body);
      run(body);
    },
  });
  if (url) URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------- misc dialogs
async function apiHelp() {
  const id = state.template.id || '1001';
  const origin = location.origin;
  const fmt = state.template.schema?.format || 'xml';
  const ct = fmt === 'xml' ? 'application/xml' : 'application/json';
  const file = fmt === 'xml' ? 'data.xml' : 'data.json';
  await openDialog({
    title: 'הפקת PDF מהשרת',
    wide: true,
    html: `<p>המערכת הקוראת שולחת את מספר התבנית ואת הנתונים (באותו מבנה של עולם הנתונים) ומקבלת PDF.</p>
    <h3>שליחת XML/JSON כגוף הבקשה</h3>
    <pre dir="ltr">curl -X POST "${origin}/api/render/${escapeHtml(id)}" \\
  -H "Content-Type: ${ct}" \\
  --data-binary @${file} -o out.pdf</pre>
    <h3>בקשת JSON עם תשובה ב-Base64</h3>
    <pre dir="ltr">POST ${origin}/api/render
{ "templateId": "${escapeHtml(id)}", "data": "&lt;...xml...&gt;", "output": "base64" }
→ { "pdfBase64": "...", "pages": 2, "warnings": [] }</pre>
    <p>פרמטרים: <code dir="ltr">?download=1</code> להורדה, <code dir="ltr">?fileName=x.pdf</code> לשם הקובץ, <code dir="ltr">?output=base64</code>. אם הוגדר מפתח API יש לשלוח כותרת <code dir="ltr">x-api-key</code>.</p>
    <p>להתקנה בשרת לקוח: מעתיקים את התיקייה, מריצים <code dir="ltr">npm install --omit=dev</code> ו-<code dir="ltr">npm run start:render</code>, ומעתיקים את קובצי התבניות מ-<code dir="ltr">storage/templates</code>. פרטים ב-README.</p>`,
    buttons: [{ label: 'סגירה', primary: true }],
  });
}

async function placeholdersDialog() {
  const { templatePlaceholders } = await import('/shared/elements.js');
  const { w, h } = pageSizeMm();
  const list = templatePlaceholders(fullTemplate(), w, h);
  const rows = list.map((p) => `<tr><td><code dir="ltr">${escapeHtml(p.name)}</code></td><td>${p.type === 'signature' ? 'חתימה' : 'העלאת תמונה'}</td><td>${escapeHtml(p.label)}</td><td>${p.band ? (p.band === 'header' ? 'כותרת עליונה' : 'כותרת תחתונה') : p.page}</td><td><bdi>${p.mm.x}, ${p.mm.y}</bdi></td><td><bdi>${p.mm.width} × ${p.mm.height}</bdi></td><td><bdi>${p.pdf.x}, ${p.pdf.y}</bdi></td></tr>`).join('');
  await openDialog({
    title: 'אזורי חתימה ואזורי העלאת תמונה',
    wide: true,
    html: list.length ? `<table class="help-table ph-table"><thead><tr><th>שם</th><th>סוג</th><th>תווית</th><th>עמוד</th><th>X, Y (מ"מ)</th><th>רוחב × גובה (מ"מ)</th><th>X, Y (נק' PDF)</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="hint">המיקום במ"מ נמדד מהפינה השמאלית העליונה של הדף. נקודות PDF נמדדות מהפינה השמאלית התחתונה (כמו בספריות חתימה דיגיטלית).<br>
      ב-API: <code dir="ltr">GET /api/templates/${escapeHtml(state.template.id || '{id}')}/placeholders</code>, וגם בתשובה לשמירת התבנית. בהפקה עם <code dir="ltr">output=json</code> מוחזרים המיקומים בפועל בכל עמוד (גם אחרי מעבר עמודים).</p>`
      : '<p class="muted">אין בתבנית אזורי חתימה או העלאת תמונה. הוסיפו אותם מסרגל הרכיבים.</p>',
    buttons: [{ label: 'סגירה', primary: true }],
  });
}

async function fontsDialog() {
  const list = () => state.fonts.map((f) => `<li><span style="font-family:'${escapeHtml(f.family)}'">${escapeHtml(f.family)} – אבגד abc 123</span><span class="muted">${{ bundled: 'מובנה', system: 'Office', uploaded: 'הועלה' }[f.source]}</span>${f.source === 'uploaded' ? `<button type="button" class="mini danger" data-del-font="${escapeHtml(f.family)}">✕</button>` : ''}</li>`).join('');
  await openDialog({
    title: 'גופנים',
    html: `<ul class="font-list" id="font-list">${list()}</ul>
      <h3>העלאת גופן</h3>
      <div class="f-grid"><label class="f"><span>שם המשפחה</span><input id="fu-family" placeholder="My Font"></label>
      <label class="f"><span>משקל</span><select id="fu-weight"><option value="400">רגיל</option><option value="700">מודגש</option></select></label></div>
      <button type="button" class="btn" id="fu-pick">בחירת קובץ TTF / OTF / WOFF...</button>
      <p class="hint">גופנים שהועלו נשמרים בשרת (storage/fonts) ומוטמעים בקובצי ה-PDF. בהתקנה בשרת לקוח יש להעתיק גם את התיקייה הזו.</p>`,
    buttons: [{ label: 'סגירה', primary: true }],
    onOpen: (body) => {
      $('#fu-pick', body).onclick = async () => {
        const fam = $('#fu-family', body).value.trim();
        if (!fam) return toast('הזינו שם משפחה לגופן', 'error');
        const f = await pickFile('.ttf,.otf,.woff,.woff2');
        if (!f) return;
        state.fonts = await api.post('/api/fonts', { family: fam, weight: +$('#fu-weight', body).value, fileName: f.name, dataBase64: await fileToBase64(f) });
        reloadFontCss();
        $('#font-list', body).innerHTML = list();
        emit('fonts');
        toast('הגופן נוסף', 'ok');
      };
      $('#font-list', body).onclick = async (ev) => {
        const b = ev.target.closest('[data-del-font]');
        if (!b) return;
        state.fonts = await api.del(`/api/fonts/${encodeURIComponent(b.dataset.delFont)}`);
        reloadFontCss();
        $('#font-list', body).innerHTML = list();
        emit('fonts');
      };
    },
  });
}

function reloadFontCss() {
  const l = document.querySelector('link[href^="/fonts.css"]');
  l.href = '/fonts.css?t=' + Date.now();
}

async function historyDialog() {
  if (!state.template.id) return toast('התבנית עוד לא נשמרה');
  const list = await api.get(`/api/templates/${encodeURIComponent(state.template.id)}/history`);
  const v = await openDialog({
    title: 'גרסאות קודמות',
    html: list.length ? `<div class="tpl-list">${list.map((h) => `<button type="button" class="tpl-row" data-v="${h.version}"><span class="tpl-row-main"><b>${new Date(h.savedAt).toLocaleString('he-IL')}</b></span><span class="muted">שחזור</span></button>`).join('')}</div>` : '<p class="muted">אין גרסאות קודמות</p>',
    buttons: [{ label: 'סגירה' }],
    onOpen: (body) => body.addEventListener('click', (ev) => {
      const r = ev.target.closest('[data-v]');
      if (r) { dlg.dataset.picked = r.dataset.v; dlg.close(); }
    }),
  }).then(() => { const p = dlg.dataset.picked; delete dlg.dataset.picked; return p; });
  if (!v) return;
  const t = await api.get(`/api/templates/${encodeURIComponent(state.template.id)}/history/${v}`);
  loadTemplate({ ...t, id: state.template.id });
  state.dirty = true;
  await applySchema(t.schema, { silent: true });
  updateChrome();
  toast('הגרסה נטענה. שמרו כדי לשחזר אותה.');
}

// ---------------------------------------------------------------- zoom
function setZoom(z) {
  state.zoom = Math.max(0.25, Math.min(4, Math.round(z * 100) / 100));
  emit('zoom');
}
function zoomFit() {
  const { w } = pageSizeMm();
  const avail = scrollEl().clientWidth - 64;
  setZoom(Math.min(1.6, Math.max(0.4, avail / (w * MM))));
}
scrollEl().addEventListener('wheel', (ev) => {
  if (!ev.ctrlKey) return;
  ev.preventDefault();
  setZoom(state.zoom * (ev.deltaY < 0 ? 1.1 : 1 / 1.1));
}, { passive: false });

// ---------------------------------------------------------------- clipboard / keyboard
let clipboard = null;
function copySel() {
  const els = selectedElements();
  if (els.length) clipboard = JSON.parse(JSON.stringify(els));
}
function paste(offset = 5) {
  if (!clipboard) return;
  const copies = clipboard.map((e) => ({ ...JSON.parse(JSON.stringify(e)), id: uid(), x: e.x + offset, y: e.y + offset }));
  change(() => {
    for (const c of copies) if (c.placeholder) c.placeholder = uniquePlaceholder(c.type); // names must stay unique
    currentPage().elements.push(...copies);
  });
  clipboard = copies;
  select(copies.map((c) => c.id));
}
function deleteSel() {
  const ids = new Set(state.selection);
  if (!ids.size) return;
  change((t) => { const p = currentPage(); p.elements = p.elements.filter((e) => !ids.has(e.id)); });
  select([]);
}
function nudge(dx, dy) {
  const els = selectedElements().filter((e) => !e.locked);
  if (!els.length) return;
  change(() => els.forEach((e) => { e.x = Math.round((e.x + dx) * 10) / 10; e.y = Math.round((e.y + dy) * 10) / 10; }));
}
function zOrder(front) {
  const ids = new Set(state.selection);
  change((t) => {
    const p = currentPage();
    const sel = p.elements.filter((e) => ids.has(e.id));
    const rest = p.elements.filter((e) => !ids.has(e.id));
    p.elements = front ? [...rest, ...sel] : [...sel, ...rest];
  });
}

document.addEventListener('keydown', (ev) => {
  const tag = (ev.target.tagName || '').toLowerCase();
  const typing = ['input', 'textarea', 'select'].includes(tag) || ev.target.isContentEditable;
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod && ev.key.toLowerCase() === 's') { ev.preventDefault(); runAction('save'); return; }
  if (mod && ev.key.toLowerCase() === 'o') { ev.preventDefault(); runAction('open'); return; }
  if (typing || dlg.open) return;
  const step = ev.shiftKey ? 5 : ev.altKey ? 0.1 : 1;
  if (mod && ev.key.toLowerCase() === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); }
  else if (mod && ev.key.toLowerCase() === 'y') { ev.preventDefault(); redo(); }
  else if (mod && ev.key.toLowerCase() === 'c') copySel();
  else if (mod && ev.key.toLowerCase() === 'x') { copySel(); deleteSel(); }
  else if (mod && ev.key.toLowerCase() === 'v') paste();
  else if (mod && ev.key.toLowerCase() === 'd') { ev.preventDefault(); copySel(); paste(); }
  else if (mod && ev.key.toLowerCase() === 'a') { ev.preventDefault(); select(currentPage().elements.map((e) => e.id)); }
  else if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); deleteSel(); }
  else if (ev.key === 'Escape') select([]);
  else if (ev.key === 'ArrowLeft') { ev.preventDefault(); nudge(-step, 0); }
  else if (ev.key === 'ArrowRight') { ev.preventDefault(); nudge(step, 0); }
  else if (ev.key === 'ArrowUp') { ev.preventDefault(); nudge(0, -step); }
  else if (ev.key === 'ArrowDown') { ev.preventDefault(); nudge(0, step); }
  else if (ev.key === 'PageDown') gotoPage(state.pageIndex + 1);
  else if (ev.key === 'PageUp') gotoPage(state.pageIndex - 1);
});

// ---------------------------------------------------------------- actions
async function runAction(a) {
  try {
    switch (a) {
      case 'new':
        if (await confirmDiscard()) { startNew(); zoomFit(); updateChrome(); renderTree(); }
        break;
      case 'open': await openDialogList(); break;
      case 'save': await save(); break;
      case 'save-as': await save({ asNew: true }); break;
      case 'import': await importDialog(); break;
      case 'data': await dataDialog(); break;
      case 'preview': await previewDialog(); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'zoom-in': setZoom(state.zoom * 1.2); break;
      case 'zoom-out': setZoom(state.zoom / 1.2); break;
      case 'zoom-fit': zoomFit(); break;
      case 'delete': deleteSel(); break;
      case 'duplicate': copySel(); paste(); break;
      case 'z-front': zOrder(true); break;
      case 'z-back': zOrder(false); break;
      case 'page-add':
        change((t) => t.pages.splice(state.pageIndex + 1, 0, { id: uid('p'), elements: [] }));
        gotoPage(state.pageIndex + 1);
        break;
      case 'page-dup': {
        const copy = JSON.parse(JSON.stringify(currentPage()));
        copy.id = uid('p');
        change((t) => {
          copy.elements.forEach((e) => { e.id = uid(); if (e.placeholder) e.placeholder = uniquePlaceholder(e.type); });
          t.pages.splice(state.pageIndex + 1, 0, copy);
        });
        gotoPage(state.pageIndex + 1);
        break;
      }
      case 'page-del':
        if (state.template.pages.length < 2) return toast('בתבנית חייב להיות לפחות עמוד אחד');
        change((t) => t.pages.splice(state.pageIndex, 1));
        gotoPage(Math.min(state.pageIndex, state.template.pages.length - 1));
        break;
      case 'band-exit': gotoPage(state.pageIndex); break;
      case 'agent-tab': showTab('agent'); break;
      case 'manage': location.href = '/'; break;
      case 'header': openBand('header'); showTab('pages'); break;
      case 'footer': openBand('footer'); showTab('pages'); break;
      case 'placeholders': await placeholdersDialog(); break;
      case 'api-help': await apiHelp(); break;
      case 'fonts': await fontsDialog(); break;
      case 'history': await historyDialog(); break;
      case 'export':
        download(`template-${state.template.id || 'new'}.json`, JSON.stringify(fullTemplate(), null, 2));
        break;
      case 'import-json': {
        const f = await pickFile('.json,application/json');
        if (!f || !(await confirmDiscard())) return;
        const t = JSON.parse(await readFileAsText(f));
        if (!t.pages) throw new Error('הקובץ אינו תבנית תקינה');
        loadTemplate({ ...t, id: '' });
        state.dirty = true;
        history.replaceState(null, '', '#');
        await applySchema(t.schema, { silent: true });
        zoomFit();
        updateChrome();
        toast(`התבנית נטענה כתבנית חדשה${t.id ? ` (במקור #${t.id})` : ''}. לחצו "שמירה" ובחרו מספר.`);
        break;
      }
      case 'delete-template': {
        if (!state.template.id) return;
        const ok = await openDialog({ title: 'מחיקת תבנית', html: `<p>למחוק את תבנית <b>#${escapeHtml(state.template.id)}</b> (${escapeHtml(state.template.name)})? אי אפשר לבטל את הפעולה.</p>`, buttons: [{ label: 'ביטול', value: false }, { label: 'מחיקה', danger: true, value: true }] });
        if (!ok) return;
        await api.del(`/api/templates/${encodeURIComponent(state.template.id)}`);
        state.dirty = false;
        startNew();
        state.dirty = false;
        updateChrome();
        toast('התבנית נמחקה');
        break;
      }
      case 'menu': {
        const m = $('#menu-pop');
        m.hidden = !m.hidden;
        break;
      }
    }
  } catch (e) {
    console.error(e);
    toast(e.message, 'error');
  }
}

document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-action]');
  const menu = $('#menu-pop');
  if (!ev.target.closest('.menu')) menu.hidden = true;
  if (b && b.closest('.canvas-empty')) { runAction(b.dataset.action); return; }
  if (!b || b.closest('#props') || b.closest('.dlg')) {
    if (b && b.closest('.dlg') && b.dataset.action) { /* handled in dialog */ }
    return;
  }
  if (b.closest('.menu-pop')) menu.hidden = true;
  runAction(b.dataset.action);
});
// buttons with data-action inside the data tree empty state
$('#data-tree').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-action="data"]');
  if (b) { ev.stopPropagation(); runAction('data'); }
}, true);

$('#show-data').addEventListener('change', (ev) => {
  state.showData = ev.target.checked;
  emit('all');
});

window.addEventListener('beforeunload', (ev) => {
  if (state.dirty) { ev.preventDefault(); ev.returnValue = ''; }
});

// ---------------------------------------------------------------- start
async function init() {
  renderTools();
  try {
    [state.fonts, state.symbologies] = await Promise.all([api.get('/api/fonts'), api.get('/api/symbologies')]);
  } catch (e) {
    toast(e.message, 'error');
  }
  let id = decodeURIComponent(location.hash.slice(1));
  if (id === 'new') {
    startNew();
    state.dirty = false;
    zoomFit();
    renderTree();
    updateChrome();
    renderProps();
    return;
  }
  if (!id) { try { id = localStorage.getItem('fd-last') || ''; } catch { /* ignore */ } }
  let opened = false;
  if (id) {
    try { await openTemplate(id); opened = true; } catch { /* fall through */ }
  }
  if (!opened) {
    const list = await api.get('/api/templates').catch(() => []);
    if (list.length) {
      try { await openTemplate(list[0].id); opened = true; } catch { /* ignore */ }
    }
  }
  if (!opened) { startNew(); state.dirty = false; zoomFit(); renderTree(); }
  updateChrome();
  renderProps();
}

window.addEventListener('resize', () => { if (state.template) render(); });
window.addEventListener('hashchange', async () => {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id || id === state.template?.id) return;
  if (!(await confirmDiscard())) return;
  if (id === 'new') { startNew(); state.dirty = false; zoomFit(); renderTree(); updateChrome(); renderProps(); return; }
  await openTemplate(id).catch((e) => toast(e.message, 'error'));
});
init();

export { toast, openDialog };
