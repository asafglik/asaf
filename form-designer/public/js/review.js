// Design review of a sample PDF: score, findings, value-to-field mapping, and
// actions (rebuild the document as a template / place fields over the PDF).
import { state, emit, change, uid, fullTemplate } from './state.js';
import { api } from './api.js';
import { analyzePdf, inspectPdf, ensureBackground } from './pdfimport.js';
import { fileToBase64 } from './util.js';
import { escapeHtml } from '/shared/elements.js';

const SEV = { high: ['חשוב', 'sev-high'], medium: ['בינוני', 'sev-med'], low: ['קל', 'sev-low'] };
let last = null; // { report, b64, info, fileName }

export function lastReview() {
  return last;
}

/** Analyze a PDF file and review it against the template's data world. */
export async function reviewFile(file, { aiAvailable }) {
  const b64 = await fileToBase64(file);
  const info = await inspectPdf(b64);
  const pages = await analyzePdf(b64, 12, { images: aiAvailable });
  const t = fullTemplate();
  delete t.sourcePdf;
  const report = await api.post('/api/ai/review', { pages, template: t, data: state.data, tree: state.tree, useAi: aiAvailable });
  last = { report, b64, info, fileName: file.name, pages: pages.length };
  return last;
}

function scoreColor(s) {
  return s >= 7.5 ? '#15803d' : s >= 5 ? '#b45309' : '#c62828';
}

function issuesHtml(report) {
  const ai = report.ai;
  const list = [...(ai?.issues || []).map((i) => ({ ...i, source: 'ai' })), ...report.issues.map((i) => ({ ...i, source: 'rules' }))]
    .sort((a, b) => ['high', 'medium', 'low'].indexOf(a.severity) - ['high', 'medium', 'low'].indexOf(b.severity));
  if (!list.length) return '<p class="muted">לא נמצאו בעיות מהותיות.</p>';
  return `<ol class="rv-issues">${list.map((i) => `
    <li class="rv-issue ${SEV[i.severity]?.[1] || ''}">
      <div class="rv-issue-head"><span class="rv-sev">${SEV[i.severity]?.[0] || ''}</span><b>${escapeHtml(i.title)}</b>
        <span class="muted">${escapeHtml(i.category || '')}${i.page ? ` · עמוד ${i.page}` : ''}${i.source === 'ai' ? ' · ✨ סוכן' : ''}</span></div>
      <div class="rv-detail">${escapeHtml(i.detail || '')}</div>
      <div class="rv-rec">💡 ${escapeHtml(i.recommendation || '')}</div>
    </li>`).join('')}</ol>`;
}

function mappingsHtml(report) {
  if (!report.mappings.length) return '<p class="muted">לא נמצאו ערכים מעולם הנתונים בקובץ. ודאו שעולם הנתונים הוא אותה רשומה שממנה הופק ה-PDF.</p>';
  const short = (p) => p.replace(/^ServiceCall\./, '');
  return `<table class="rv-map"><thead><tr><th></th><th>עמוד</th><th>תווית בטופס</th><th>ערך שהודפס</th><th>שדה בעולם הנתונים</th></tr></thead><tbody>
    ${report.mappings.map((m, i) => `<tr>
      <td><input type="checkbox" data-map-on="${i}" checked aria-label="לכלול"></td>
      <td class="num">${m.page}</td>
      <td>${m.label ? escapeHtml(m.label) : '<span class="muted">—</span>'}</td>
      <td class="val" dir="auto">${escapeHtml(m.value)}</td>
      <td>${m.alternatives.length
        ? `<select data-map-path="${i}" dir="ltr">${[m.path, ...m.alternatives].map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(short(p))}</option>`).join('')}</select>${m.fixedByAgent ? ' <span class="rv-tag" title="הסוכן תיקן את השדה">✨</span>' : ''}`
        : `<code dir="ltr">${escapeHtml(short(m.path))}</code>`}</td>
    </tr>`).join('')}</tbody></table>`;
}

function tablesHtml(report) {
  if (!report.tables.length) return '';
  const first = new Map();
  for (const t of report.tables) if (!first.has(t.arrayPath)) first.set(t.arrayPath, t);
  return `<div class="rv-tables">${[...first.values()].map((t) => {
    const pages = report.tables.filter((o) => o.arrayPath === t.arrayPath).map((o) => o.page);
    return `<div class="rv-table"><b>טבלה: ${escapeHtml(t.arrayPath.split('.').slice(-2).join('.'))}</b> <span class="muted">עמוד ${pages.join(', ')} · ${t.rows} שורות</span>
      <div class="rv-cols">${t.columns.map((c) => `<span class="rv-col"><b>${escapeHtml(c.header)}</b><code dir="ltr">${escapeHtml(c.rel)}</code></span>`).join('')}</div></div>`;
  }).join('')}</div>`;
}

/** The report in a full-screen panel. onAction(name, choices) runs the chosen action. */
export function showReview({ report, fileName, pages }, { aiAvailable, onAction }) {
  document.querySelector('.rv-modal')?.remove();
  const ai = report.ai;
  const score = ai?.score ?? report.score;
  const st = report.stats;
  const m = document.createElement('div');
  m.className = 'rv-modal';
  m.innerHTML = `
  <div class="rv-panel" role="dialog" aria-label="חוות דעת על הטופס">
    <header class="rv-head">
      <div class="rv-score" style="--c:${scoreColor(score)}"><b>${Number(score).toFixed(1)}</b><span>/10</span></div>
      <div class="rv-title"><h2>חוות דעת על הטופס</h2><div class="muted">${escapeHtml(fileName || '')} · ${pages} עמודים</div></div>
      <button class="mini rv-close" type="button" aria-label="סגירה">✕</button>
    </header>
    <div class="rv-body">
      <div class="rv-stats">
        <span><b>${st.matchedValues}</b> ערכים זוהו בעולם הנתונים</span>
        <span><b>${report.tables.length ? new Set(report.tables.map((t) => t.arrayPath)).size : 0}</b> טבלאות מרשימות</span>
        <span><b>${st.coverage}%</b> מהשדות בנתונים מוצגים</span>
        <span><b>${report.issues.length + (ai?.issues?.length || 0)}</b> הערות לשיפור</span>
      </div>
      <p class="rv-summary">${escapeHtml(ai?.summary || autoSummary(report))}</p>
      ${report.aiError ? `<p class="warn">הסוכן החכם לא זמין כרגע (${escapeHtml(report.aiError)}). מוצגת חוות דעת אוטומטית.</p>` : ''}
      ${!aiAvailable ? '<p class="hint">חוות הדעת מבוססת על ניתוח אוטומטי של הקובץ. עם הסוכן החכם (מפתח Claude בשרת) מתקבלת גם ביקורת עיצובית מלאה לפי תמונת העמודים, ותיקון של שדות לא חד-משמעיים.</p>' : ''}
      ${ai?.quick_wins?.length ? `<section><h3>הצעדים עם ההשפעה הגדולה ביותר</h3><ul class="rv-wins">${ai.quick_wins.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul></section>` : ''}
      ${ai?.strengths?.length ? `<section><h3>מה עובד טוב</h3><ul class="rv-wins ok">${ai.strengths.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul></section>` : ''}
      <section><h3>מה כדאי לשפר</h3>${issuesHtml(report)}</section>
      <section><h3>התאמת שדות: איזה שדה מעולם הנתונים מופיע ליד כל טקסט</h3>
        <p class="hint">כל ערך שהודפס בקובץ נמצא בעולם הנתונים. התווית היא הטקסט שליד הערך. כשאותו ערך קיים בכמה שדות, בחרו את הנכון ברשימה.</p>
        ${tablesHtml(report)}${mappingsHtml(report)}</section>
    </div>
    <footer class="rv-foot">
      <button class="btn btn-primary" data-rv="rebuild" type="button" title="הטופס נבנה מחדש מרכיבים: טקסטים, קווים, שדות מקושרים וטבלאות">בנייה כתבנית מעוצבת</button>
      <button class="btn" data-rv="overlay" type="button" title="ה-PDF נשאר רקע, והשדות מונחים מעל הערכים שהודפסו (ומכסים אותם)">שדות מעל ה-PDF</button>
      ${aiAvailable ? '<button class="btn" data-rv="ai-rebuild" type="button" title="הסוכן בונה עיצוב משופר לפי חוות הדעת">✨ עיצוב משופר עם הסוכן</button>' : ''}
      <span class="spacer"></span>
      <button class="btn" data-rv="close" type="button">סגירה</button>
    </footer>
  </div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.addEventListener('click', (ev) => {
    if (ev.target === m || ev.target.closest('.rv-close') || ev.target.closest('[data-rv="close"]')) return close();
    const b = ev.target.closest('[data-rv]');
    if (!b) return;
    const choices = report.mappings.map((mp, i) => ({
      ...mp,
      on: m.querySelector(`[data-map-on="${i}"]`)?.checked !== false,
      path: m.querySelector(`[data-map-path="${i}"]`)?.value || mp.path,
    }));
    close();
    onAction(b.dataset.rv, choices);
  });
  m.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(); ev.stopPropagation(); });
  m.querySelector('.rv-close').focus();
}

function autoSummary(r) {
  const high = r.issues.filter((i) => i.severity === 'high').length;
  return `זוהו ${r.stats.matchedValues} ערכים שמקורם בעולם הנתונים ו-${new Set(r.tables.map((t) => t.arrayPath)).size} טבלאות. `
    + (high ? `יש ${high} בעיות חשובות לטיפול. ` : '')
    + `הטופס מציג כ-${r.stats.coverage}% מהשדות הקיימים בנתונים.`;
}

// ---------------------------------------------------------------- actions
const near = (a, b) => Math.abs(a - b) < 0.8;

/** The rule-based rebuild, with the user's mapping choices. */
export function rebuildOps(report, choices) {
  const byPos = (op) => choices.find((c) => c.page === op.page && near(c.y - 0.3, op.element.y) && c.x < op.element.x + op.element.w && c.x + c.w > op.element.x);
  return report.operations.flatMap((op) => {
    const e = op.element;
    if (op.op === 'add_element' && (e?.type === 'field' || e?.type === 'barcode')) {
      const c = byPos(op);
      if (c && !c.on) return []; // excluded: keep the printed text as fixed text? no - leave it out
      if (c && e.type === 'field') return [{ ...op, element: { ...e, binding: c.path } }];
    }
    return [op];
  });
}

/** Fields over the original PDF: each covers the value printed in the sample. */
export function overlayOps(report, choices) {
  const ops = [];
  for (const c of choices) {
    if (!c.on) continue;
    ops.push({
      op: 'add_element', target: 'page', page: c.page, id: '',
      element: { type: 'field', x: c.x - 0.6, y: c.y - 0.4, w: c.w + 1.6, h: c.h * 1.3, binding: c.path, format: c.kind === 'date' || c.kind === 'number' || c.kind === 'visual' ? c.format : '', name: c.label || '', style: { fontFamily: 'Arial', fontSize: 9, background: '#ffffff', padding: 0, align: /[֐-׿]/.test(c.value) ? 'right' : 'left', direction: /[֐-׿]/.test(c.value) ? 'rtl' : 'ltr' } },
    });
  }
  const seen = new Set();
  for (const t of report.tables) {
    if (seen.has(t.arrayPath)) continue;
    seen.add(t.arrayPath);
    ops.push({
      op: 'add_element', target: 'page', page: t.page, id: '',
      element: { type: 'table', x: t.x, y: t.y, w: t.w, h: t.h, binding: t.arrayPath, overflow: 'paginate', style: { fontFamily: 'Arial', fontSize: 8, background: '#ffffff' }, headerStyle: { background: '#e8ecf4', bold: true, align: 'center', fontSize: 8 }, borderWidth: 0.5, borderColor: '#9aa4b5', cellPadding: 0.8, rowStyle: { background: '#ffffff' }, columns: t.columns.map((col) => ({ header: col.header, binding: col.rel, width: col.width, format: col.format })) },
    });
  }
  return ops;
}

/** Make the template's pages match the sample PDF (size, count, optional backgrounds). */
export function preparePages(info, b64, { withBackground }) {
  if (withBackground) state.sourcePdf = b64;
  state.bgImages = {};
  change((t) => {
    t.page = { ...(t.page || {}), size: 'custom', width: Math.round(info.widthMm * 10) / 10, height: Math.round(info.heightMm * 10) / 10, orientation: 'portrait' };
    t.pages = [];
    const n = withBackground ? info.pages : 1;
    for (let i = 0; i < n; i++) t.pages.push({ id: uid('p'), ...(withBackground ? { background: { type: 'pdf', pageIndex: i } } : {}), elements: [] });
    if (!withBackground) { delete t.header; delete t.footer; }
  });
  state.pageIndex = 0;
  state.band = null;
  if (withBackground) ensureBackground(0);
  emit('page');
}
