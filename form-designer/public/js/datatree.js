// The data world panel: the structure of the sample XML/JSON as a tree.
// Drag a field onto the page to create a data field, or a list to create a table.
import { state, on, selectedElements, change } from './state.js';
import { escapeHtml } from '/shared/elements.js';
import { exprPath } from '/shared/expr.js';

const panel = document.getElementById('data-tree');
const filterInput = document.getElementById('data-filter');

function walk(node, fn, insideArray = false) {
  for (const c of node.children || []) {
    fn(c, insideArray);
    walk(c, fn, insideArray || c.kind === 'array');
  }
}

/** Root-level value paths (not inside lists). */
export function allValuePaths() {
  const out = [];
  if (!state.tree) return out;
  walk(state.tree, (n, inArr) => {
    if (!inArr && (n.kind === 'value' || n.kind === 'array')) out.push(n.path);
  });
  return out;
}

export function arrayPaths() {
  const out = [];
  if (!state.tree) return out;
  walk(state.tree, (n, inArr) => { if (n.kind === 'array' && !inArr) out.push(n.path); });
  return out;
}

/** Item-relative paths for a list (for table columns). */
export function itemPaths(arrayPath) {
  let found = null;
  if (!state.tree) return [];
  walk(state.tree, (n) => { if (!found && n.kind === 'array' && n.path === arrayPath) found = n; });
  if (!found) return [];
  const out = [];
  const rec = (n) => {
    for (const c of n.children || []) {
      if (c.kind === 'value' || c.kind === 'array') out.push(c.path);
      if (c.kind === 'object') rec(c);
    }
  };
  rec(found);
  return out;
}

const KIND_ICON = { object: '📁', array: '☰', value: '•' };

function nodeHtml(n, depth, arrayPath) {
  const inArr = arrayPath !== null;
  const name = n.name || 'שורש';
  const meta = n.kind === 'array' ? `<span class="dt-count">${n.count} פריטים</span>` : n.sample ? `<span class="dt-sample" title="${escapeHtml(n.sample)}">${escapeHtml(n.sample)}</span>` : '';
  const kids = (n.children || []).map((c) => nodeHtml(c, depth + 1, n.kind === 'array' ? n.path : arrayPath)).join('');
  const rel = inArr ? ' dt-rel' : '';
  const title = n.kind === 'array' ? 'גררו לדף ליצירת טבלה' : inArr ? `שדה בתוך רשימה (${n.path}) - לשימוש בעמודות טבלה` : 'גררו לדף ליצירת שדה, או לחצו להוספה לרכיב הנבחר';
  return `<li class="dt-node dt-${n.kind}${rel}" data-path="${escapeHtml(n.path)}" data-key="${escapeHtml(`${arrayPath ?? ''}::${n.path}`)}">
    <div class="dt-row" draggable="true" title="${escapeHtml(title)}" style="padding-inline-start:${depth * 12 + 6}px">
      ${n.kind !== 'value' && kids ? '<button class="dt-toggle" aria-label="פתח/סגור">▾</button>' : '<span class="dt-toggle-sp"></span>'}
      <span class="dt-icon">${KIND_ICON[n.kind]}</span><span class="dt-name">${escapeHtml(name)}</span>${meta}
    </div>
    ${kids ? `<ul>${kids}</ul>` : ''}
  </li>`;
}

const nodeIndex = new Map();

export function renderTree() {
  nodeIndex.clear();
  if (!state.tree) {
    panel.innerHTML = '<div class="empty-hint">עדיין לא הוגדר עולם נתונים.<br><button class="btn btn-primary" data-action="data">טעינת XML / JSON</button></div>';
    return;
  }
  const index = (n, arrayPath) => {
    nodeIndex.set(`${arrayPath ?? ''}::${n.path}`, { ...n, rel: arrayPath !== null, arrayPath });
    for (const c of n.children || []) index(c, n.kind === 'array' ? n.path : arrayPath);
  };
  index(state.tree, null);
  const fmt = state.template?.schema?.format?.toUpperCase() || '';
  panel.innerHTML = `<div class="dt-head">${fmt ? `<span class="badge">${escapeHtml(fmt)}</span>` : ''}<button class="link" data-action="data">שינוי</button></div><ul class="dt-root">${(state.tree.children || []).map((c) => nodeHtml(c, 0, null)).join('')}</ul>`;
  applyFilter();
}

function applyFilter() {
  const q = filterInput.value.trim().toLowerCase();
  panel.querySelectorAll('.dt-node').forEach((li) => {
    li.style.display = !q || li.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}
filterInput.addEventListener('input', applyFilter);

function nodeOf(li) {
  return nodeIndex.get(li.dataset.key);
}

panel.addEventListener('dragstart', (ev) => {
  const li = ev.target.closest('.dt-node');
  if (!li) return;
  const n = nodeOf(li);
  if (!n) return;
  const payload = { path: n.path, name: n.name, kind: n.kind, rel: n.rel, arrayPath: n.arrayPath, children: (n.children || []).map((c) => ({ name: c.name, path: c.path, kind: c.kind, sample: c.sample })), sample: n.sample };
  ev.dataTransfer.setData('application/x-fd-node', JSON.stringify(payload));
  ev.dataTransfer.setData('text/plain', `{{${n.path}}}`);
  ev.dataTransfer.effectAllowed = 'copy';
});

panel.addEventListener('click', (ev) => {
  const tg = ev.target.closest('.dt-toggle');
  if (tg) {
    tg.closest('.dt-node').classList.toggle('collapsed');
    return;
  }
  const row = ev.target.closest('.dt-row');
  if (!row || ev.detail > 1) return; // the second click of a double click adds a new field instead
  const n = nodeOf(row.closest('.dt-node'));
  const sel = selectedElements();
  if (!n || sel.length !== 1) return;
  const el = sel[0];
  // quick bind: click a field to bind it to the selected element. A field inside a
  // list is relative to the row only in that list's table; elsewhere it is the first item.
  const inTable = el.type === 'table' && n.rel;
  const abs = n.rel && n.kind !== 'array' ? `${n.arrayPath}[0].${n.path}` : n.path;
  clearTimeout(clickTimer);
  clickTimer = setTimeout(() => change(() => {
    if (inTable) el.columns.push({ id: 'c' + Math.random().toString(36).slice(2, 8), header: n.name.replace(/^@/, ''), binding: n.path, width: 1 });
    else if (el.type === 'field' || el.type === 'checkbox') el.binding = abs;
    else if (el.type === 'image') { el.source = 'field'; el.binding = abs; }
    else if (el.type === 'signature' || el.type === 'upload') el.binding = abs;
    else if (el.type === 'barcode') { el.valueMode = 'field'; el.binding = abs; }
    else if (el.type === 'table' && n.kind === 'array') el.binding = n.path;
    else if (el.type === 'text') el.text = (el.text || '') + `{{${exprPath(abs)}}}`;
    else if (el.type === 'computed') el.expression = (el.expression || '') + exprPath(abs);
  }), 250);
});
let clickTimer = null;

// double click a field: add it to the page
panel.addEventListener('dblclick', (ev) => {
  const row = ev.target.closest('.dt-row');
  if (!row) return;
  clearTimeout(clickTimer);
  const n = nodeOf(row.closest('.dt-node'));
  if (!n) return;
  const node = { ...n, children: n.children };
  if (n.rel && n.kind !== 'array') node.path = `${n.arrayPath}[0].${n.path}`;
  import('./canvas.js').then(({ addElement }) => import('./factory.js').then(({ elementFromNode }) => addElement(elementFromNode(node))));
});

on((w) => { if (w === 'data' || w === 'load') renderTree(); });
