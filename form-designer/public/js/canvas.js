// The design surface: renders the current page with the same element HTML
// the server prints, and handles selection, moving, resizing and dropping.
import { state, on, change, select, currentPage, selectedElements, pageSizeMm, canvasSizeMm, findElement, emit, uid } from './state.js';
import { elementInnerHtml, elementOuterCss, BASE_CSS, MM, escapeHtml, bandElements, isVisible } from '/shared/elements.js';
import { scopeFor, exprPath } from '/shared/expr.js';
import { createElement, elementFromNode } from './factory.js';
import { keyQuery } from './api.js';
import { startRichEdit, isRichEditing } from './richtext.js';
import { sanitizeRichHtml } from './sanitize.js';

const scroll = document.getElementById('canvas-scroll');
let pageEl = null;
let selLayer = null;
let renderErrors = [];

// shared CSS of the printed elements
const st = document.createElement('style');
st.textContent = BASE_CSS;
document.head.appendChild(st);

function barcodeImg(o) {
  const q = new URLSearchParams({ type: o.symbology, text: o.text, showText: o.showText ? '1' : '0', color: o.color || '#000000' });
  const k = keyQuery();
  return `<img src="/api/barcode?${escapeHtml(q.toString())}${k ? '&amp;' + k : ''}" style="width:100%;height:100%;display:block" alt="" draggable="false">`;
}

export function designCtx() {
  renderErrors = [];
  return { design: true, errors: renderErrors, barcode: barcodeImg };
}

export function designScope() {
  return scopeFor(state.showData ? state.data : {});
}

function elementNode(el, scope, ctx) {
  const d = document.createElement('div');
  d.className = `fd-el fd-${el.type}` + (el.locked ? ' is-locked' : '') + (el.visibleIf ? ' has-cond' : '') + (el.showOn && el.showOn !== 'all' ? ' has-showon' : '');
  d.dataset.id = el.id;
  d.style.cssText = elementOuterCss(el);
  if (el.visibleIf && state.showData && !isVisible(el, scope, { ...ctx, design: false, errors: null })) {
    d.classList.add('is-cond-hidden');
    d.title = 'מוסתר לפי התנאי עם נתוני הדוגמה';
  }
  let inner;
  try {
    inner = elementInnerHtml(el.type === 'richtext' ? { ...el, html: sanitizeRichHtml(el.html) } : el, scope, ctx);
  } catch (e) {
    inner = `<span class="fd-ph">${escapeHtml(e.message)}</span>`;
  }
  d.innerHTML = ['text', 'field', 'computed'].includes(el.type) ? `<div class="fd-in">${inner}</div>` : inner;
  if (el.type === 'line') d.classList.add(el.orientation === 'vertical' ? 'is-vline' : 'is-hline');
  return d;
}

export function render() {
  if (!state.template) return;
  const { w, h } = canvasSizeMm();
  const page = currentPage();
  const z = state.zoom;
  scroll.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'page-wrap';
  wrap.style.width = `${w * MM * z}px`;
  wrap.style.height = `${h * MM * z}px`;
  pageEl = document.createElement('div');
  pageEl.className = 'fd-page design-page' + (state.showGrid ? ' show-grid' : '') + (state.band ? ' band-page' : '');
  pageEl.style.cssText = `width:${w}mm;height:${h}mm;transform:scale(${z});background-color:${page.color || '#fff'}`;
  if (state.showGrid) pageEl.style.backgroundSize = `${10 * MM}px ${10 * MM}px, ${10 * MM}px ${10 * MM}px`;

  const bg = page.background;
  if (bg && (bg.type === 'image' || bg.type === 'pdf')) {
    const src = bg.type === 'image' ? bg.src : state.bgImages[bg.pageIndex];
    if (src) {
      const img = document.createElement('img');
      img.className = 'fd-bg';
      img.src = src;
      img.draggable = false;
      pageEl.appendChild(img);
    } else if (bg.type === 'pdf') {
      emit('need-bg');
    }
  }

  const scope = designScope();
  const ctx = designCtx();
  // header / footer of the template, shown faded on every page
  if (!state.band) {
    const t = state.template;
    for (const band of ['header', 'footer']) {
      const b = t[band];
      if (!b || b.enabled === false) continue;
      const g = document.createElement('div');
      g.className = `band-guide band-${band}`;
      g.style.cssText = band === 'header' ? `top:0;height:${b.height}mm` : `bottom:0;height:${b.height}mm`;
      g.innerHTML = `<span>${band === 'header' ? 'כותרת עליונה' : 'כותרת תחתונה'}</span>`;
      g.dataset.band = band;
      g.title = 'לחיצה כפולה לעריכת ' + (band === 'header' ? 'הכותרת העליונה' : 'הכותרת התחתונה');
      pageEl.appendChild(g);
    }
    for (const b of bandElements(t, h)) {
      const node = elementNode(b.el, scope, ctx);
      node.classList.add('band-ghost');
      node.removeAttribute('data-id');
      pageEl.appendChild(node);
    }
  } else {
    const lab = document.createElement('div');
    lab.className = 'band-label';
    lab.textContent = state.band === 'header' ? 'עריכת כותרת עליונה – מופיעה בכל עמוד' : 'עריכת כותרת תחתונה – מופיעה בכל עמוד';
    wrap.appendChild(lab);
    const back = document.createElement('button');
    back.className = 'band-back';
    back.type = 'button';
    back.textContent = '← חזרה לעמוד';
    back.addEventListener('click', () => emit('action:band-exit'));
    wrap.appendChild(back);
    if (!page.elements.length) {
      const e = document.createElement('div');
      e.className = 'band-empty';
      e.textContent = 'הוסיפו לכאן לוגו, טקסט או {{page}} מסרגל הרכיבים';
      pageEl.appendChild(e);
    }
  }
  for (const el of page.elements) pageEl.appendChild(elementNode(el, scope, ctx));
  if (isBlankTemplate()) pageEl.appendChild(emptyState());
  selLayer = document.createElement('div');
  selLayer.className = 'sel-layer';
  pageEl.appendChild(selLayer);
  wrap.appendChild(pageEl);
  scroll.appendChild(wrap);
  renderSelection();
  document.getElementById('status-errors').textContent = renderErrors.length ? `⚠ ${renderErrors.length} שגיאות בביטויים` : '';
  document.getElementById('status-errors').title = renderErrors.join('\n');
}

function isBlankTemplate() {
  const t = state.template;
  return !state.band && t.pages.length === 1 && !t.pages[0].elements.length && !t.pages[0].background && !(t.header?.elements?.length) && !(t.footer?.elements?.length);
}

function emptyState() {
  const d = document.createElement('div');
  d.className = 'canvas-empty';
  const hasData = !!state.tree;
  d.innerHTML = `<div class="ce-box"><h3>מתחילים תבנית חדשה</h3><p>בחרו איך להתחיל. אפשר גם פשוט לגרור רכיבים מהסרגל.</p>
    <div class="ce-cards">
      <button class="ce-card" data-action="data" type="button"><span class="ce-step">1</span><b>עולם נתונים</b><span>${hasData ? 'מוגדר ✓ – גררו שדות מלשונית "נתונים"' : 'הדביקו דוגמת XML או JSON'}</span></button>
      <button class="ce-card" data-action="import" type="button"><span class="ce-step">2</span><b>ייבוא PDF או Word</b><span>טופס קיים כרקע או כטקסט לעריכה</span></button>
      <button class="ce-card" data-action="agent-tab" type="button"><span class="ce-step">✨</span><b>סוכן חכם</b><span>מיקום שדות אוטומטי מקובץ דוגמה</span></button>
    </div></div>`;
  return d;
}

function guessFormat(sample) {
  const s = String(sample ?? '').trim();
  if (/^-?\d+\.\d+$/.test(s)) return 'number:2';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return 'date:dd/MM/yyyy';
  return '';
}

export function renderSelection() {
  if (!selLayer) return;
  selLayer.innerHTML = '';
  const els = selectedElements();
  const hs = 9 / state.zoom;
  for (const el of els) {
    const box = document.createElement('div');
    box.className = 'sel-box' + (el.locked ? ' locked' : '');
    box.style.cssText = `left:${el.x}mm;top:${el.y}mm;width:${el.w}mm;height:${el.h}mm;border-width:${1.5 / state.zoom}px`;
    if (els.length === 1 && !el.locked) {
      for (const dir of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
        const hd = document.createElement('div');
        hd.className = `handle h-${dir}`;
        hd.dataset.dir = dir;
        hd.style.width = hd.style.height = `${hs}px`;
        hd.style.margin = `${-hs / 2}px`;
        box.appendChild(hd);
      }
    }
    selLayer.appendChild(box);
  }
  const info = document.getElementById('status-sel');
  if (els.length === 1) {
    const e = els[0];
    info.textContent = `X ${fmt(e.x)}  Y ${fmt(e.y)}  ר ${fmt(e.w)}  ג ${fmt(e.h)} מ"מ`;
  } else info.textContent = els.length ? `${els.length} רכיבים נבחרו` : '';
}

const fmt = (n) => (Math.round(n * 10) / 10).toString();

// ---------------------------------------------------------------- geometry
function toMm(clientX, clientY) {
  const r = pageEl.getBoundingClientRect();
  const k = MM * state.zoom;
  return { x: (clientX - r.left) / k, y: (clientY - r.top) / k };
}

function snap(v) {
  const g = state.grid;
  return g > 0 ? Math.round(v / g) * g : Math.round(v * 10) / 10;
}

// ---------------------------------------------------------------- pointer
let drag = null;

export function commitPropsEdit() {
  const ae = document.activeElement;
  if (ae && document.getElementById('props').contains(ae)) ae.blur();
}

scroll.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0 || !pageEl || isRichEditing()) return;
  commitPropsEdit();
  if (ev.target.closest('.inline-editor') || ev.target.closest('.canvas-empty .ce-box') || ev.target.closest('.band-back')) return;
  const handle = ev.target.closest('.handle');
  const elNode = ev.target.closest('.fd-el[data-id]');
  const start = toMm(ev.clientX, ev.clientY);

  if (handle) {
    const el = selectedElements()[0];
    drag = { kind: 'resize', dir: handle.dataset.dir, el, orig: { ...el }, start };
  } else if (elNode && pageEl.contains(elNode)) {
    const id = elNode.dataset.id;
    if (ev.shiftKey || ev.ctrlKey || ev.metaKey) {
      select(id, true);
      return;
    }
    if (!state.selection.includes(id)) select(id);
    const els = selectedElements().filter((e) => !e.locked);
    drag = { kind: 'move', els, origs: els.map((e) => ({ x: e.x, y: e.y })), start, moved: false };
  } else if (ev.target.closest('.design-page') || ev.target === scroll || ev.target.closest('.page-wrap')) {
    if (!(ev.shiftKey || ev.ctrlKey)) select([]);
    drag = { kind: 'marquee', start, additive: ev.shiftKey || ev.ctrlKey };
  } else return;
  scroll.setPointerCapture(ev.pointerId);
  ev.preventDefault();
});

scroll.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  const p = toMm(ev.clientX, ev.clientY);
  const dx = p.x - drag.start.x;
  const dy = p.y - drag.start.y;
  if (drag.kind === 'move') {
    if (!drag.moved && Math.abs(dx) < 0.6 && Math.abs(dy) < 0.6) return;
    drag.moved = true;
    drag.els.forEach((e, i) => {
      const nx = snap(drag.origs[i].x + dx);
      const ny = snap(drag.origs[i].y + dy);
      drag.cur = drag.cur || [];
      drag.cur[i] = { x: nx, y: ny };
      const node = pageEl.querySelector(`.fd-el[data-id="${CSS.escape(e.id)}"]`);
      if (node) { node.style.left = nx + 'mm'; node.style.top = ny + 'mm'; }
    });
    const boxes = selLayer.querySelectorAll('.sel-box');
    drag.els.forEach((e, i) => {
      const b = boxes[state.selection.indexOf(e.id)];
      if (b) { b.style.left = drag.cur[i].x + 'mm'; b.style.top = drag.cur[i].y + 'mm'; }
    });
    document.getElementById('status-sel').textContent = drag.cur.length === 1 ? `X ${fmt(drag.cur[0].x)}  Y ${fmt(drag.cur[0].y)}` : '';
  } else if (drag.kind === 'resize') {
    const o = drag.orig;
    let { x, y, w, h } = o;
    const d = drag.dir;
    if (d.includes('e')) w = Math.max(1, snap(o.x + o.w + dx) - o.x);
    if (d.includes('s')) h = Math.max(0.5, snap(o.y + o.h + dy) - o.y);
    if (d.includes('w')) { const nx = Math.min(snap(o.x + dx), o.x + o.w - 1); w = o.x + o.w - nx; x = nx; }
    if (d.includes('n')) { const ny = Math.min(snap(o.y + dy), o.y + o.h - 0.5); h = o.y + o.h - ny; y = ny; }
    if (ev.shiftKey && o.w && o.h) { const r = o.w / o.h; if (d.length === 2) h = w / r; }
    drag.cur = { x, y, w, h };
    const node = pageEl.querySelector(`.fd-el[data-id="${CSS.escape(o.id)}"]`);
    if (node) Object.assign(node.style, { left: x + 'mm', top: y + 'mm', width: w + 'mm', height: h + 'mm' });
    const b = selLayer.querySelector('.sel-box');
    if (b) Object.assign(b.style, { left: x + 'mm', top: y + 'mm', width: w + 'mm', height: h + 'mm' });
    document.getElementById('status-sel').textContent = `ר ${fmt(w)}  ג ${fmt(h)} מ"מ`;
  } else if (drag.kind === 'marquee') {
    let m = selLayer.querySelector('.marquee');
    if (!m) { m = document.createElement('div'); m.className = 'marquee'; selLayer.appendChild(m); }
    const x = Math.min(p.x, drag.start.x);
    const y = Math.min(p.y, drag.start.y);
    drag.rect = { x, y, w: Math.abs(dx), h: Math.abs(dy) };
    Object.assign(m.style, { left: x + 'mm', top: y + 'mm', width: drag.rect.w + 'mm', height: drag.rect.h + 'mm', borderWidth: 1 / state.zoom + 'px' });
  }
});

function endDrag() {
  const d = drag;
  drag = null;
  if (!d) return;
  if (d.kind === 'move' && d.moved && d.cur) {
    change(() => d.els.forEach((e, i) => { e.x = d.cur[i].x; e.y = d.cur[i].y; }));
  } else if (d.kind === 'resize' && d.cur) {
    change(() => Object.assign(d.el, d.cur));
  } else if (d.kind === 'marquee') {
    const r = d.rect;
    selLayer.querySelector('.marquee')?.remove();
    if (r && (r.w > 1 || r.h > 1)) {
      const hit = currentPage().elements.filter((e) => e.x < r.x + r.w && e.x + e.w > r.x && e.y < r.y + r.h && e.y + Math.max(e.h, 0.5) > r.y).map((e) => e.id);
      select(d.additive ? [...new Set([...state.selection, ...hit])] : hit);
    }
  }
}
scroll.addEventListener('pointerup', endDrag);
scroll.addEventListener('pointercancel', endDrag);

// ---------------------------------------------------------------- double click
scroll.addEventListener('dblclick', (ev) => {
  // pointer capture retargets the event to the scroller, so hit-test again
  const hit = document.elementFromPoint(ev.clientX, ev.clientY);
  const node = hit && hit.closest('.design-page .fd-el[data-id]');
  if (!node) {
    const ghost = hit && (hit.closest('.band-ghost') || hit.closest('.band-guide'));
    const band = ghost && (ghost.dataset.band || (ghost.getBoundingClientRect().top - pageEl.getBoundingClientRect().top < 40 * state.zoom ? 'header' : 'footer'));
    if (band) emit('open-band:' + band);
    return;
  }
  if (!node) return;
  const el = findElement(node.dataset.id);
  if (!el || el.locked) return;
  if (el.type === 'richtext') startRichEdit(el, node);
  else if (el.type === 'text') inlineTextEdit(el, node);
  else emit('focus-props');
});

function inlineTextEdit(el, node) {
  const ta = document.createElement('textarea');
  ta.className = 'inline-editor';
  ta.value = el.text || '';
  ta.dir = el.style?.direction || 'rtl';
  ta.style.cssText = node.style.cssText + ';position:absolute;z-index:50;resize:none;outline:2px solid #2563eb;background:#fffef5;padding:0.5mm;margin:0;box-sizing:border-box;overflow:auto';
  ta.style.display = 'block';
  pageEl.appendChild(ta);
  ta.focus();
  ta.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const v = ta.value;
    ta.remove();
    if (save && v !== el.text) change(() => { el.text = v; });
    else render();
  };
  ta.addEventListener('blur', () => finish(true));
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') finish(false);
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) finish(true);
  });
}

// ---------------------------------------------------------------- drop from toolbox / data tree
scroll.addEventListener('dragover', (ev) => {
  if ([...ev.dataTransfer.types].some((t) => t.startsWith('application/x-fd'))) {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
  }
});

scroll.addEventListener('drop', (ev) => {
  ev.preventDefault();
  const p = pageEl ? toMm(ev.clientX, ev.clientY) : { x: 20, y: 20 };
  clearDropTarget();
  let el = null;
  const tool = ev.dataTransfer.getData('application/x-fd-tool');
  const node = ev.dataTransfer.getData('application/x-fd-node');
  if (tool) {
    const t = JSON.parse(tool);
    el = createElement(t.type, t);
  } else if (node) {
    const n = JSON.parse(node);
    const target = dropTargetAt(ev.clientX, ev.clientY);
    if (target && dropOnElement(target, n)) return;
    const lastTable = [...state.template.pages, state.template.header, state.template.footer].filter(Boolean).flatMap((c) => c.elements || []).filter((e) => e.type === 'table').pop();
    el = elementFromNode(n, lastTable);
  }
  if (!el) return;
  addElement(el, p);
});

// ---- dropping a data field onto an existing element binds it
function dropTargetAt(x, y) {
  const hit = document.elementFromPoint(x, y);
  const node = hit && hit.closest('.design-page .fd-el[data-id]');
  if (!node) return null;
  const el = findElement(node.dataset.id);
  // a table only takes the drop over its rows, not over the empty part of its box
  if (el?.type === 'table') {
    const tb = node.querySelector('table');
    const r = tb && tb.getBoundingClientRect();
    if (!r || y > r.bottom || y < r.top) return null;
  }
  return el;
}

function dropOnElement(el, n) {
  if (el.locked) return false;
  const path = n.path;
  if (el.type === 'table') {
    if (n.kind === 'array') { change(() => { el.binding = path; }); return true; }
    // row fields are relative to the row; root fields still resolve inside a row
    change(() => el.columns.push({ id: uid('c'), header: n.name.replace(/^@/, ''), binding: path, width: 1, format: guessFormat(n.sample) }));
    select(el.id);
    emit('toast:' + JSON.stringify({ msg: `נוספה עמודה "${n.name.replace(/^@/, '')}" לטבלה`, undo: true }));
    return true;
  }
  if (n.kind === 'array') return false;
  const full = n.rel && n.arrayPath ? `${n.arrayPath}[0].${path}` : path;
  if (['line', 'rect', 'ellipse'].includes(el.type)) return false;
  change(() => {
    if (el.type === 'text') el.text = (el.text || '') + `{{${exprPath(full)}}}`;
    else if (el.type === 'richtext') el.html = (el.html || '').replace(/(<\/p>)?\s*$/, ` {{${exprPath(full)}}}$1`);
    else if (el.type === 'computed') el.expression = (el.expression || '') + exprPath(full);
    else if (el.type === 'image' || el.type === 'signature' || el.type === 'upload') { el.binding = full; if (el.type === 'image') el.source = 'field'; }
    else if (el.type === 'barcode') { el.valueMode = 'field'; el.binding = full; }
    else el.binding = full;
  });
  select(el.id);
  emit('toast:' + JSON.stringify({ msg: `השדה ${full} קושר לרכיב`, undo: true }));
  return true;
}

let dropHi = null;
function clearDropTarget() {
  if (dropHi) dropHi.classList.remove('drop-target');
  dropHi = null;
}
scroll.addEventListener('dragover', (ev) => {
  if (![...ev.dataTransfer.types].includes('application/x-fd-node')) return;
  const hit = document.elementFromPoint(ev.clientX, ev.clientY);
  const node = hit && hit.closest('.design-page .fd-el[data-id]');
  if (node !== dropHi) {
    clearDropTarget();
    if (node && !['line', 'rect', 'ellipse'].includes(findElement(node.dataset.id)?.type) && dropTargetAt(ev.clientX, ev.clientY)) {
      node.classList.add('drop-target');
      dropHi = node;
    }
  }
});
scroll.addEventListener('dragleave', (ev) => { if (!scroll.contains(ev.relatedTarget)) clearDropTarget(); });

/** Usable vertical range on a page: below the header band, above the footer band. */
function freeRange() {
  const { h } = canvasSizeMm();
  if (state.band) return { top: 0, bottom: h };
  const t = state.template;
  const top = t.header && t.header.enabled !== false ? Number(t.header.height) || 0 : 0;
  const bottom = h - (t.footer && t.footer.enabled !== false ? Number(t.footer.height) || 0 : 0);
  return { top, bottom: Math.max(top + 5, bottom) };
}

/** First spot at or below `y` where the element does not overlap others. */
function freeSpot(el, x, y) {
  const { top, bottom } = freeRange();
  const others = currentPage().elements;
  const hits = (yy) => others.some((o) => x < o.x + o.w && x + el.w > o.x && yy < o.y + Math.max(o.h, 1) && yy + el.h > o.y);
  for (let yy = Math.max(top, y); yy + el.h <= bottom; yy += 2) if (!hits(yy)) return yy;
  for (let yy = top; yy + el.h <= bottom; yy += 2) if (!hits(yy)) return yy;
  return Math.max(top, Math.min(y, bottom - el.h));
}

export function addElement(el, at) {
  const { w } = canvasSizeMm();
  const { top, bottom } = freeRange();
  if (!at) {
    // centre of the visible area, moved down to the first free place
    const r = scroll.getBoundingClientRect();
    const c = pageEl ? toMm(r.left + r.width / 2, r.top + Math.min(r.height / 3, 220)) : { x: 20, y: 20 };
    const x = Math.max(0, Math.min(c.x - el.w / 2, w - el.w));
    at = { x, y: freeSpot(el, x, c.y) };
  }
  // keep it on the page and out of the header / footer bands
  if (el.h > bottom - top) el.h = Math.max(5, bottom - top - 2);
  el.x = snap(Math.max(0, Math.min(at.x, w - el.w)));
  el.y = snap(Math.max(top, Math.min(at.y, bottom - Math.max(el.h, 1))));
  change((t) => currentPage().elements.push(el));
  select(el.id);
}

export function scrollEl() {
  return scroll;
}

on((what) => {
  if (what === 'selection') renderSelection();
  else if (['all', 'load', 'zoom', 'data', 'page', 'bg', 'props-edit'].includes(what)) render();
});
