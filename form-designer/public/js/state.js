// Designer state, undo/redo history and change notifications.
import { PAGE_SIZES } from '/shared/elements.js';

const listeners = new Set();

export const state = {
  template: null,
  sourcePdf: null, // base64 of an imported PDF (kept out of the undo history)
  pageIndex: 0,
  band: null, // null = a page, 'header' | 'footer' = editing that band
  selection: [],
  zoom: 1,
  grid: 1, // snap step in mm (0 = off)
  showGrid: true,
  showData: true,
  data: {},
  tree: null,
  dirty: false,
  fonts: [],
  symbologies: [],
  bgImages: {}, // pdf page index -> data URL used on the canvas
};

const undoStack = [];
const redoStack = [];
const MAX_UNDO = 100;

export function on(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(what = 'all') {
  for (const fn of listeners) fn(what);
}

function snapshot() {
  return JSON.stringify(state.template);
}

/** Record the current template for undo, then apply a mutation. */
export function change(fn, what = 'all') {
  undoStack.push(snapshot());
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
  fn(state.template);
  state.dirty = true;
  emit(what);
}

export function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  state.template = JSON.parse(undoStack.pop());
  fixSelection();
  state.dirty = true;
  emit('all');
}

export function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  state.template = JSON.parse(redoStack.pop());
  fixSelection();
  state.dirty = true;
  emit('all');
}

export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }

export function resetHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
}

function fixSelection() {
  if (state.pageIndex >= state.template.pages.length) state.pageIndex = state.template.pages.length - 1;
  if (state.band && !state.template[state.band]) state.band = null;
  const ids = new Set(currentPage().elements.map((e) => e.id));
  state.selection = state.selection.filter((id) => ids.has(id));
}

export function ensureBand(t, band) {
  if (!t[band]) t[band] = { enabled: true, height: band === 'header' ? 25 : 18, showOn: 'all', elements: [] };
  if (!Array.isArray(t[band].elements)) t[band].elements = [];
  return t[band];
}

/** The element container being edited: a page, or the header / footer band. */
export function currentPage() {
  if (state.band) return ensureBand(state.template, state.band);
  return state.template.pages[state.pageIndex];
}

/** Size of the design surface: the page, or just the band being edited. */
export function canvasSizeMm() {
  const { w, h } = pageSizeMm();
  if (state.band) return { w, h: Number(currentPage().height) || 20 };
  return { w, h };
}

export function allContainers(t = state.template) {
  return [...t.pages, ...(t.header ? [t.header] : []), ...(t.footer ? [t.footer] : [])];
}

export function findElement(id) {
  for (const p of allContainers()) {
    const e = (p.elements || []).find((x) => x.id === id);
    if (e) return e;
  }
  return null;
}

export function selectedElements() {
  const page = currentPage();
  return state.selection.map((id) => page.elements.find((e) => e.id === id)).filter(Boolean);
}

export function select(ids, additive = false) {
  ids = Array.isArray(ids) ? ids : [ids];
  if (additive) {
    const s = new Set(state.selection);
    for (const id of ids) (s.has(id) ? s.delete(id) : s.add(id));
    state.selection = [...s];
  } else state.selection = ids.filter(Boolean);
  emit('selection');
}

/** A placeholder name not yet used in the template (signature_1, upload_2...). */
export function uniquePlaceholder(base) {
  const used = new Set();
  for (const c of allContainers()) for (const e of c.elements || []) if (e.placeholder) used.add(e.placeholder);
  let i = 1;
  while (used.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

export function uid(prefix = 'e') {
  return prefix + Math.random().toString(36).slice(2, 9);
}

export function pageSizeMm(t = state.template) {
  const p = t.page || {};
  let [w, h] = PAGE_SIZES[p.size] || [Number(p.width) || 210, Number(p.height) || 297];
  if (p.size === 'custom' || !PAGE_SIZES[p.size]) { w = Number(p.width) || 210; h = Number(p.height) || 297; }
  if (p.orientation === 'landscape' && w < h) [w, h] = [h, w];
  return { w, h };
}

export function newTemplate(id = '') {
  return {
    id,
    name: 'תבנית חדשה',
    description: '',
    version: 1,
    page: { size: 'A4', orientation: 'portrait' },
    schema: null,
    pages: [{ id: uid('p'), elements: [] }],
  };
}

export function loadTemplate(t) {
  const copy = JSON.parse(JSON.stringify(t));
  state.sourcePdf = copy.sourcePdf || null;
  delete copy.sourcePdf;
  if (!copy.pages || !copy.pages.length) copy.pages = [{ id: uid('p'), elements: [] }];
  for (const p of copy.pages) p.elements = p.elements || [];
  state.template = copy;
  state.pageIndex = 0;
  state.band = null;
  state.selection = [];
  state.bgImages = {};
  state.dirty = false;
  resetHistory();
  emit('load');
}

/** The template as it is saved / sent for rendering. */
export function fullTemplate() {
  const t = JSON.parse(JSON.stringify(state.template));
  if (state.sourcePdf && t.pages.some((p) => p.background && p.background.type === 'pdf')) t.sourcePdf = state.sourcePdf;
  return t;
}
