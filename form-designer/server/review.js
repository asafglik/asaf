// Design review of an uploaded sample PDF that was produced from the data world.
//  1. Values printed in the PDF are matched to data paths (exact value, dates
//     and numbers in other formats, reversed Hebrew, values broken over lines).
//  2. Each matched value gets its label (the text beside / under it).
//  3. Rows of the same list become table suggestions (columns + headers).
//  4. Rule-based findings: readability, consistency, wasted space, data use.
//  5. Optional basic rebuild: the page as native elements bound to the data.
import { parseDate, formatDate, fixVisualHebrew, isNumeric } from '../shared/format.js';

// ---------------------------------------------------------------- data values
const SKIP_KEYS = /^(HEVRA|@)/;

/** Every leaf value: { path, value, arrayPath, index, rel } (path has [i] for list items). */
export function flattenData(data) {
  const out = [];
  // arrayPath for nested lists: computed from the path without indexes
  const walk = (v, path, arr) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) {
      v.forEach((it, i) => walk(it, `${path}[${i}]`, { arrayPath: path.replace(/\[\d+\]/g, ''), index: i, base: `${path}[${i}]` }));
      return;
    }
    if (typeof v === 'object') {
      if ('#text' in v && Object.keys(v).every((k) => k === '#text' || k.startsWith('@'))) return walk(v['#text'], path, arr);
      for (const [k, c] of Object.entries(v)) walk(c, path ? `${path}.${k}` : k, arr);
      return;
    }
    const s = String(v).replace(/\s+/g, ' ').trim();
    if (!s) return;
    out.push({ path, value: s, arrayPath: arr ? arr.arrayPath : null, index: arr ? arr.index : null, rel: arr ? path.slice(arr.base.length + 1).replace(/\[\d+\]/g, '[0]') : null });
  };
  walk(data, '', null);
  return out.map((e) => ({ ...e, path: e.path.replace(/^\./, '') }));
}

// ---------------------------------------------------------------- normalizing
const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<' };
export function norm(s) {
  return String(s ?? '')
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')
    .replace(/[״]/g, '"').replace(/[׳]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
const loose = (s) => norm(s).replace(/[\s"'`]/g, '').replace(/[()[\]{}<>]/g, (c) => MIRROR[c]).toLowerCase();
const strict = (s) => norm(s).replace(/\s+/g, '').toLowerCase();

const DATE_LIKE = /^(\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{8})(?:[ T]\d{1,2}:\d{2}(:\d{2})?Z?)?$/;

/** Ways a data value may appear when printed: [{ text, kind, format }] */
export function variants(value) {
  const v = norm(value);
  const out = [{ text: v, kind: 'exact' }];
  const unstar = v.replace(/^\*(.+)\*$/, '$1');
  if (unstar !== v) out.push({ text: unstar, kind: 'exact' });
  if (/[֐-׿]/.test(v)) out.push({ text: fixVisualHebrew(v), kind: 'visual', format: 'visual' });
  if (/^-?\d+(\.\d+)?$/.test(v) && v.replace(/^-/, '').length >= 2 && !/^-?0\d/.test(v)) {
    const n = Number(v);
    for (const d of [0, 1, 2]) {
      out.push({ text: n.toFixed(d), kind: 'number', format: `plain:${d}` });
      out.push({ text: new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n), kind: 'number', format: `number:${d}` });
    }
  }
  if (DATE_LIKE.test(v)) {
    const d = parseDate(v);
    if (d && d.getFullYear() > 1900 && d.getFullYear() < 2200) {
      for (const p of ['dd/MM/yyyy', 'dd/MM/yy', 'd/M/yyyy', 'yyyy-MM-dd', 'dd.MM.yyyy']) out.push({ text: formatDate(d, p), kind: 'date', format: `date:${p}` });
    }
  }
  const t = v.match(/^(\d{1,2}:\d{2})(:\d{2})?Z?$/);
  if (t) out.push({ text: t[1], kind: 'time', format: 'text' });
  return out;
}

// ---------------------------------------------------------------- PDF text candidates
function lines(texts) {
  // group texts into visual lines
  const sorted = texts.map((t, i) => ({ ...t, i })).sort((a, b) => a.y - b.y || b.x - a.x);
  const out = [];
  for (const t of sorted) {
    const line = out.find((l) => Math.abs(l.y - t.y) < Math.max(0.8, t.h * 0.35));
    if (line) line.items.push(t);
    else out.push({ y: t.y, items: [t] });
  }
  for (const l of out) l.items.sort((a, b) => b.x - a.x); // right to left
  return out;
}

const box = (items) => {
  const x0 = Math.min(...items.map((t) => t.x));
  const y0 = Math.min(...items.map((t) => t.y));
  const x1 = Math.max(...items.map((t) => t.x + t.w));
  const y1 = Math.max(...items.map((t) => t.y + t.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/** Single texts, neighbours on a line, and texts wrapped onto the next lines. */
function candidates(texts) {
  const out = texts.map((t, i) => ({ str: t.str, idx: [i], ...box([t]) }));
  for (const l of lines(texts)) {
    for (let a = 0; a < l.items.length; a++) {
      for (let n = 2; n <= 4 && a + n <= l.items.length; n++) {
        const run = l.items.slice(a, a + n);
        const gaps = run.slice(1).map((t, k) => run[k].x - (t.x + t.w));
        if (gaps.some((g) => g > 3 || g < -2)) break;
        const rtl = run.map((t) => t.str).join(' ');
        const ltr = [...run].reverse().map((t) => t.str).join(' ');
        out.push({ str: rtl, idx: run.map((t) => t.i), ...box(run) });
        out.push({ str: ltr, idx: run.map((t) => t.i), ...box(run) });
      }
    }
  }
  // wrapped cells: the next 1-2 lines start under the same right edge
  const idxOf = new Map(texts.map((t, i) => [t, i]));
  for (const t of texts) {
    const stack = [t];
    for (let k = 0; k < 2; k++) {
      const last = stack[stack.length - 1];
      // continuation line: same right edge (Hebrew) or same left edge (numbers / dates)
      const next = texts.find((o) => o !== last && o.y > last.y + last.h * 0.6 && o.y < last.y + last.h * 1.9 && (Math.abs((o.x + o.w) - (last.x + last.w)) < 1.5 || Math.abs(o.x - last.x) < 1.2 || Math.abs(o.x + o.w / 2 - (last.x + last.w / 2)) < 2.5));
      if (!next) break;
      stack.push(next);
      const idx = stack.map((s) => idxOf.get(s));
      out.push({ str: stack.map((s) => s.str).join(''), idx, ...box(stack), wrapped: true });
      out.push({ str: stack.map((s) => s.str).join(' '), idx, ...box(stack), wrapped: true });
    }
  }
  return out;
}

// ---------------------------------------------------------------- matching
export function matchValues(pages, data) {
  const entries = flattenData(data);
  const index = new Map(); // strict text -> [{ entry, variant }]
  const valueCount = new Map();
  for (const e of entries) valueCount.set(e.value, (valueCount.get(e.value) || 0) + 1);
  for (const e of entries) {
    for (const v of variants(e.value)) {
      if (strict(v.text).length < 2) continue;
      for (const key of new Set([strict(v.text), loose(v.text)])) {
        if (!index.has(key)) index.set(key, []);
        index.get(key).push({ e, v });
      }
    }
  }
  const matches = [];
  pages.forEach((p, pi) => {
    const used = new Set();
    // a single word glued to other words on its line is part of a phrase (a label), not a value
    const inPhrase = (i) => {
      const t = p.texts[i];
      if (/\d/.test(t.str) || t.str.includes(' ')) return false;
      return p.texts.some((o, j) => j !== i && Math.abs(o.y - t.y) < 0.8 && /\p{L}/u.test(o.str) && (Math.abs(o.x + o.w - t.x) < 2.2 || Math.abs(t.x + t.w - o.x) < 2.2));
    };
    const cands = candidates(p.texts).sort((a, b) => b.idx.length - a.idx.length);
    for (const c of cands) {
      if (c.idx.some((i) => used.has(i))) continue;
      let hits = index.get(strict(c.str)) || index.get(loose(c.str));
      if (!hits) continue;
      if (c.idx.length === 1 && !c.wrapped && inPhrase(c.idx[0])) continue;
      // very short numbers / words are too ambiguous outside tables
      const len = strict(c.str).length;
      hits = hits.filter((h) => len >= 2 || h.e.arrayPath);
      if (!hits.length) continue;
      c.idx.forEach((i) => used.add(i));
      const first = p.texts[c.idx[0]];
      matches.push({
        page: pi + 1, text: norm(c.str), x: c.x, y: c.y, w: c.w, h: c.h, idx: c.idx, size: first.size, bold: !!first.bold, dir: first.dir, wrapped: !!c.wrapped,
        hits: hits.map((h) => ({ path: h.e.path, arrayPath: h.e.arrayPath, index: h.e.index, rel: h.e.rel, kind: h.v.kind, format: h.v.format || '' })),
      });
    }
  });
  return { matches, entries, valueCount };
}

/** Best data path for a match outside tables: unique values first, shallow paths, no company duplicates. */
function bestHit(m) {
  const score = (h) => (h.arrayPath ? 2 : 0) + h.path.split('.').length + (/\.HEVRA\./.test(h.path) ? 5 : 0) + (h.kind === 'exact' ? 0 : 1);
  return [...m.hits].sort((a, b) => score(a) - score(b))[0];
}

/** Words of one line, right to left; pieces that touch are one word (מק + " + ט). */
function joinWords(items) {
  const w = items.slice().sort((a, b) => b.x - a.x);
  return w.map((t, i) => (i && w[i - 1].x - (t.x + t.w) > 0.25 ? ' ' : '') + t.str).join('').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------- labels
const LABEL_RE = /[:：]\s*_*$/;
function labelFor(m, page, matchedIdx) {
  const texts = page.texts.map((t, i) => ({ ...t, i })).filter((t) => !matchedIdx.has(t.i) && /\p{L}/u.test(t.str));
  const cy = m.y + m.h / 2;
  const sameLine = (t) => Math.abs(t.y + t.h / 2 - cy) < Math.max(1.2, m.h * 0.5);
  const overlapX = (t) => t.x < m.x + m.w + 2 && t.x + t.w > m.x - 2;
  const cands = [];
  for (const t of texts) {
    const colon = LABEL_RE.test(t.str);
    if (sameLine(t) && t.x >= m.x + m.w - 1) {
      // Hebrew forms: "label: value" - the label is to the right
      const gap = t.x - (m.x + m.w);
      if (gap < 45) cands.push({ t, where: 'right', d: colon ? gap * 0.25 - 3 : gap });
    } else if (sameLine(t) && t.x + t.w <= m.x + 1 && colon) {
      const gap = m.x - (t.x + t.w);
      if (gap < 30) cands.push({ t, where: 'left', d: gap + 2 });
    } else if (overlapX(t) && !colon && t.y + t.h < m.y + 0.5 && m.y - (t.y + t.h) < 5) {
      // a caption above the value; "label:" above belongs to another value
      cands.push({ t, where: 'above', d: (m.y - (t.y + t.h)) * 2 });
    } else if (overlapX(t) && !colon && t.y > m.y + m.h - 0.5 && t.y - (m.y + m.h) < 5) {
      // a caption under the value has no colon
      cands.push({ t, where: 'below', d: (t.y - (m.y + m.h)) * 2 });
    }
  }
  const best = cands.sort((a, b) => a.d - b.d)[0];
  if (!best) return null;
  // the whole label: neighbouring words on the same line ("מספר" + "רישוי")
  const words = [best.t];
  for (let grow = true; grow;) {
    grow = false;
    for (const t of texts) {
      if (words.includes(t) || Math.abs(t.y - best.t.y) > 0.8) continue;
      if (words.some((w) => Math.abs(t.x + t.w - w.x) < 2.5 || Math.abs(w.x + w.w - t.x) < 2.5)) { words.push(t); grow = true; }
    }
  }
  const text = joinWords(words);
  return { text: text.replace(LABEL_RE, '').trim(), where: best.where };
}

// ---------------------------------------------------------------- tables
/** Indexes of texts repeated at the same place on (almost) every page. */
function repeatedTexts(pages) {
  const sig = (t) => `${t.str}|${Math.round(t.x)}|${Math.round(t.y)}`;
  const counts = new Map();
  pages.forEach((p) => new Set(p.texts.map(sig)).forEach((k) => counts.set(k, (counts.get(k) || 0) + 1)));
  return pages.map((p) => new Set(pages.length >= 3 ? p.texts.map((t, i) => (counts.get(sig(t)) >= Math.ceil(pages.length * 0.8) ? i : -1)).filter((i) => i >= 0) : []));
}

function detectTables(pages, matches) {
  const tables = [];
  const rep = repeatedTexts(pages);
  pages.forEach((p, pi) => {
    let pool = matches.filter((m) => m.page === pi + 1 && !m.table && !m.idx.some((i) => rep[pi].has(i)));
    for (let guard = 0; guard < 8; guard++) {
      const score = new Map();
      for (const m of pool) {
        for (const h of m.hits) {
          if (!h.arrayPath) continue;
          const s = score.get(h.arrayPath) || { n: 0, idx: new Set() };
          s.n++;
          s.idx.add(h.index);
          score.set(h.arrayPath, s);
        }
      }
      const best = [...score.entries()].filter(([, s]) => s.n >= 4 && s.idx.size >= 2).sort((a, b) => b[1].n - a[1].n)[0];
      if (!best) break;
      const arrayPath = best[0];
      let members = pool.filter((m) => m.hits.some((h) => h.arrayPath === arrayPath));
      // a value can belong to several rows (same part code in rows 1-3): the row is the
      // item index shared by most values printed on the same line
      const linesOf = [];
      for (const m of [...members].sort((m1, m2) => m1.y - m2.y)) {
        const l = linesOf.find((x) => Math.abs(x.y - m.y) < 1.5);
        if (l) l.ms.push(m);
        else linesOf.push({ y: m.y, ms: [m] });
      }
      const rowOf = new Map();
      for (const l of linesOf) {
        const votes = new Map();
        for (const m of l.ms) for (const i of new Set(m.hits.filter((h) => h.arrayPath === arrayPath).map((h) => h.index))) votes.set(i, (votes.get(i) || 0) + 1);
        const best = [...votes].sort((v1, v2) => v2[1] - v1[1] || v1[0] - v2[0])[0];
        if (!best) continue;
        for (const m of l.ms) if (m.hits.some((h) => h.arrayPath === arrayPath && h.index === best[0])) rowOf.set(m, best[0]);
      }
      members = members.filter((m) => rowOf.has(m));
      // several fields of the item hold the same value (PartCode, Part.CAT): the simplest one
      const hitOf = (m) => m.hits.filter((h) => h.arrayPath === arrayPath && h.index === rowOf.get(m))
        .sort((h1, h2) => h1.rel.split('.').length - h2.rel.split('.').length || (h1.kind === 'exact' ? 0 : 1) - (h2.kind === 'exact' ? 0 : 1))[0];
      // the table is one contiguous block: keep the largest vertical cluster
      members.sort((m1, m2) => m1.y - m2.y);
      const clusters = [];
      for (const m of members) {
        const last = clusters[clusters.length - 1];
        if (last && m.y - last[last.length - 1].y < 14) last.push(m);
        else clusters.push([m]);
      }
      members = clusters.sort((c1, c2) => c2.length - c1.length)[0] || [];
      const dropArray = () => { pool = pool.filter((m) => !m.hits.some((h) => h.arrayPath === arrayPath)); };
      if (members.length < 4) { dropArray(); continue; }
      // one column per item field, positioned at the median x
      const cols = new Map();
      for (const m of pool) if (m.table === arrayPath && !members.includes(m)) delete m.table;
      for (const m of members) {
        const h = hitOf(m);
        m.table = arrayPath;
        m.row = h.index;
        m.rel = h.rel;
        m.format = h.format;
        const c = cols.get(h.rel) || { rel: h.rel, xs: [], x0: [], x1: [], format: h.format, kind: h.kind, rows: new Set() };
        c.xs.push(m.x + m.w / 2);
        c.x0.push(m.x);
        c.x1.push(m.x + m.w);
        c.rows.add(h.index);
        cols.set(h.rel, c);
      }
      const b = box(members);
      const mid = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
      // keep fields that appear in at least 2 rows (a column), most rows first
      let columns = [...cols.values()].filter((c) => c.rows.size >= 2).map((c) => ({ rel: c.rel, x: mid(c.xs), x0: Math.min(...c.x0), x1: Math.max(...c.x1), format: c.kind === 'date' || c.kind === 'number' ? c.format : '' }));
      // one column per position (two fields printed in the same place = the same column):
      // keep the field seen in more rows, then the simpler path
      const rowsOf = (c) => cols.get(c.rel).rows.size;
      const depth = (c) => c.rel.split('.').length;
      columns.sort((a, c2) => (Math.abs(rowsOf(c2) - rowsOf(a)) > 2 ? rowsOf(c2) - rowsOf(a) : 0) || depth(a) - depth(c2) || a.rel.length - c2.rel.length);
      columns = columns.filter((c, i) => !columns.slice(0, i).some((o) => Math.abs(o.x - c.x) < 3));
      columns.sort((a, c2) => c2.x - a.x); // right to left
      if (columns.length < 2) { members.forEach((m) => { delete m.table; }); dropArray(); continue; }
      // header: the line of text just above the first row, inside the table width
      const headerTexts = p.texts.filter((t) => t.y + t.h <= b.y + 0.5 && b.y - (t.y + t.h) < 9 && t.x + t.w > b.x - 2 && t.x < b.x + b.w + 2);
      const headerY = headerTexts.length ? Math.max(...headerTexts.map((t) => t.y)) : null;
      const header = headerTexts.filter((t) => headerY !== null && Math.abs(t.y - headerY) < 1.5);
      // each header text belongs to the column whose centre is nearest; a header may be several words
      const owned = new Map(columns.map((c) => [c, []]));
      for (const t of header) {
        const cx = t.x + t.w / 2;
        const c = columns.slice().sort((c1, c2) => Math.abs(c1.x - cx) - Math.abs(c2.x - cx))[0];
        // a header over an empty column (no values) belongs to no column
        if (c && cx > c.x0 - 4 && cx < c.x1 + 4) owned.get(c).push(t);
      }
      for (const c of columns) {
        const ts = owned.get(c).sort((t1, t2) => t2.x - t1.x);
        c.header = ts.length ? joinWords(ts) : c.rel.split('.').pop();
      }
      const top = header.length ? Math.min(...header.map((t) => t.y)) - 1 : b.y - 1;
      // column widths from the gaps between column centres
      const xs = columns.map((c) => c.x);
      const edges = [b.x + b.w + 1, ...xs.slice(1).map((x, i) => (xs[i] + x) / 2), b.x - 1];
      columns.forEach((c, i) => { c.width = Math.max(0.3, Math.round(((edges[i] - edges[i + 1]) / 10) * 10) / 10); });
      tables.push({ page: pi + 1, arrayPath, x: b.x - 1, y: top, w: b.w + 2, h: b.y + b.h - top + 1, rows: best[1].idx.size, columns, headerIdx: header.map((t) => p.texts.indexOf(t)) });
      dropArray(); // one table per list on a page
    }
  });
  return tables;
}

// ---------------------------------------------------------------- findings
const SEV_W = { high: 1.4, medium: 0.7, low: 0.3 };

function findings(pages, matches, tables, entries, data) {
  const out = [];
  const add = (severity, category, title, detail, recommendation, extra = {}) => out.push({ severity, category, title, detail, recommendation, ...extra });
  const all = pages.flatMap((p, pi) => p.texts.map((t) => ({ ...t, page: pi + 1 })));
  if (!all.length) {
    add('high', 'מבנה', 'לא נמצא טקסט בקובץ', 'הקובץ נראה כמו סריקה (תמונה בלבד).', 'כדי לזהות שדות יש להעלות PDF שהופק מהמערכת (עם טקסט), או לעבוד במצב "שדות מעל ה-PDF".');
    return out;
  }
  // readability
  const small = all.filter((t) => t.size < 7);
  if (small.length > 5) add('high', 'קריאות', `טקסט קטן מדי (${small.length} טקסטים מתחת ל-7pt)`, `הגודל הקטן ביותר: ${Math.min(...small.map((t) => t.size))}pt.`, 'גודל מינימלי מומלץ 8pt לטקסט רגיל ו-7pt להערות שוליים.', { page: small[0].page, area: box(small.slice(0, 1)) });
  const sizes = new Set(all.map((t) => Math.round(t.size)));
  if (sizes.size > 5) add('medium', 'היררכיה', `${sizes.size} גדלי גופן שונים`, `גדלים: ${[...sizes].sort((a, b) => b - a).join(', ')}pt.`, 'מומלץ 3-4 רמות בלבד: כותרת ראשית, כותרת אזור, טקסט, הערה. ההיררכיה תהיה ברורה יותר.');
  // values broken across lines in narrow columns (dates, codes)
  const wrapped = matches.filter((m) => m.wrapped && /^[\d/.:-]+$/.test(m.text.replace(/\s/g, ''))).sort((a, b) => b.text.length - a.text.length);
  if (wrapped.length) add('high', 'טבלאות', `ערכים נשברים לשתי שורות (${wrapped.length})`, `למשל "${wrapped[0].text}" בעמוד ${wrapped[0].page}: תאריכים ומספרים מתפצלים בעמודה צרה.`, 'להרחיב את העמודה או לקצר את הפורמט (למשל dd/MM/yy), ולמנוע שבירת שורה בתאים מספריים.', { page: wrapped[0].page, area: wrapped[0] });
  // decimals on quantities ("55.0", "1.0")
  const dec0 = matches.filter((m) => /^-?\d+\.0+$/.test(m.text));
  if (dec0.length >= 3) add('low', 'עיצוב ערכים', `כמויות מוצגות עם ספרה עשרונית מיותרת (${dec0.length})`, `למשל "${dec0[0].text}".`, 'להשתמש בעיצוב number (מסתיר .0) ולהציג מינוס בצד הנכון (‎-55).', { page: dec0[0].page, area: dec0[0] });
  // inconsistent date formats
  const dateFormats = new Set(matches.flatMap((m) => m.hits.filter((h) => h.kind === 'date').slice(0, 1).map((h) => h.format)));
  if (dateFormats.size > 1) add('medium', 'עקביות', `${dateFormats.size} פורמטים שונים של תאריך`, [...dateFormats].map((f) => f.replace('date:', '')).join(' · '), 'לאחד לפורמט אחד בכל המסמך (מומלץ dd/MM/yyyy).');
  // barcode text with Code39 stars
  const stars = all.filter((t) => /^\*[A-Z0-9 .$/+%-]{4,}\*$/.test(t.str));
  if (stars.length) add('low', 'ברקוד', 'הטקסט שמתחת לברקוד כולל כוכביות', `"${stars[0].str}" – אלה תווי ההתחלה/הסיום של Code39 ולא חלק מהערך.`, 'להציג את המספר בלי כוכביות (בברקוד של המערכת התווים מתווספים אוטומטית).', { page: stars[0].page, area: stars[0] });
  // empty placeholders "_____"
  const blanks = all.filter((t) => /_{4,}/.test(t.str));
  if (blanks.length) add('low', 'שדות ריקים', `${blanks.length} שדות ריקים עם קו תחתון`, `למשל "${blanks[0].str}".`, 'אם הערך מגיע מהנתונים – לקשר אותו לשדה; אם הוא נשאר ריק – להסתיר את התווית כשאין ערך (תנאי הצגה) או להשאיר אזור כתיבה ברור.', { page: blanks[0].page, area: blanks[0] });
  // labels without values ("קוד רדיו:" and nothing next to it)
  const orphan = all.filter((t) => /:\s*$/.test(t.str) && !t.bold && !matches.some((m) => m.page === t.page && Math.abs(m.y - t.y) < 1.5 && m.x + m.w < t.x + 1 && t.x - (m.x + m.w) < 45));
  if (orphan.length >= 3) add('medium', 'שדות ריקים', `${orphan.length} תוויות בלי ערך`, orphan.slice(0, 6).map((t) => `"${t.str.replace(/:\s*$/, '')}"`).join(', '), 'להסתיר תווית כשהשדה ריק (תנאי "לא ריק"), כדי שהטופס ייראה מלא ומסודר.');
  // repeated header on every page
  if (pages.length >= 3) {
    const sig = (t) => `${t.str}|${Math.round(t.x)}|${Math.round(t.y)}`;
    const counts = new Map();
    pages.forEach((p) => new Set(p.texts.map(sig)).forEach((s) => counts.set(s, (counts.get(s) || 0) + 1)));
    const rep = pages[0].texts.filter((t) => counts.get(sig(t)) >= Math.ceil(pages.length * 0.8));
    if (rep.length >= 5) {
      const hb = box(rep);
      const pct = Math.round(((hb.y + hb.h) / pages[0].height) * 100);
      if (pct >= 12) add('medium', 'שטח', `הכותרת חוזרת במלואה בכל עמוד (${pct}% מגובה העמוד)`, `${rep.length} טקסטים זהים בראש כל אחד מ-${pages.length} העמודים.`, 'בעמודי המשך להשתמש בכותרת מקוצרת (מספר הכרטיס, דגם ועמוד X מתוך Y) – "כותרת עליונה" עם הצגה "מלבד הראשון", ופרטים מלאים רק בעמוד הראשון.', { page: 2 });
    }
    // nearly empty pages
    pages.forEach((p, pi) => {
      const own = p.texts.filter((t) => counts.get(sig(t)) < Math.ceil(pages.length * 0.8));
      if (pi > 0 && own.length < 6) add('medium', 'שטח', `עמוד ${pi + 1} כמעט ריק`, `רק ${own.length} טקסטים מעבר לכותרת.`, 'לאחד תוכן לעמודים קודמים או להשתמש במעבר עמודים אוטומטי במקום עמודים קבועים.', { page: pi + 1 });
    });
  }
  // many empty table rows (lines without text)
  pages.forEach((p, pi) => {
    const hl = p.shapes.filter((s) => s.kind === 'line' && s.h < 0.3 && s.w > 60).map((s) => s.y).sort((a, b) => a - b);
    let empty = 0;
    for (let i = 1; i < hl.length; i++) {
      const y0 = hl[i - 1];
      const y1 = hl[i];
      if (y1 - y0 > 3 && y1 - y0 < 9 && !p.texts.some((t) => t.y + t.h / 2 > y0 && t.y + t.h / 2 < y1)) empty++;
    }
    if (empty >= 4) add('medium', 'טבלאות', `עמוד ${pi + 1}: ${empty} שורות טבלה ריקות`, 'הטבלאות בנויות עם מספר שורות קבוע.', 'טבלה דינמית (מעולם הנתונים) מציגה בדיוק את השורות הקיימות וממשיכה לעמוד הבא רק כשצריך.', { page: pi + 1 });
  });
  // data coverage
  const usedPaths = new Set(matches.flatMap((m) => (m.table ? [] : [bestHit(m)?.path])).filter(Boolean));
  const usedArrays = new Set(tables.map((t) => t.arrayPath));
  const interesting = entries.filter((e) => !e.arrayPath && !SKIP_KEYS.test(e.path.split('.').pop()) && !/\.HEVRA\./.test(e.path) && e.value.length >= 3 && !/^(0|1|false|true)$/i.test(e.value));
  const unused = interesting.filter((e) => !usedPaths.has(e.path));
  const coverage = interesting.length ? Math.round(((interesting.length - unused.length) / interesting.length) * 100) : 0;
  const keyFields = unused.filter((e) => /(Name|Phone|Mobile|Mail|Email|Address|Street|Town|City|IDN|Id$|Date|Model|Color|License|Licence)/i.test(e.path)).slice(0, 8);
  if (keyFields.length) add('low', 'נתונים', `שדות חשובים מעולם הנתונים שלא מופיעים בטופס (${keyFields.length})`, keyFields.map((e) => `${e.path.split('.').slice(-2).join('.')} = "${e.value.slice(0, 30)}"`).join(' · '), 'לשקול להוסיף אותם (למשל טלפון ומייל של הלקוח) – הם כבר קיימים בנתונים.');
  const arrays = new Set(entries.filter((e) => e.arrayPath).map((e) => e.arrayPath));
  return { issues: out, coverage, usedFields: usedPaths.size, unusedFields: unused.length, listsInData: arrays.size, listsUsed: usedArrays.size };
}

// ---------------------------------------------------------------- basic rebuild
const r1 = (v) => Math.round(v * 10) / 10;

export function rebuildOperations(pages, matches, tables) {
  const ops = [];
  const add = (page, element, target = 'page') => ops.push({ op: 'add_element', target, page, id: '', element });
  // texts repeated on (almost) every page go to the header band once
  const sig = (t) => `${t.str}|${Math.round(t.x)}|${Math.round(t.y)}`;
  const counts = new Map();
  pages.forEach((p) => new Set(p.texts.map(sig)).forEach((s) => counts.set(s, (counts.get(s) || 0) + 1)));
  const repeated = (t) => pages.length >= 3 && counts.get(sig(t)) >= Math.ceil(pages.length * 0.8);
  const repTexts = pages.length >= 3 ? pages[0].texts.filter(repeated) : [];
  const headerH = repTexts.length >= 5 ? r1(Math.max(...repTexts.map((t) => t.y + t.h)) + 2) : 0;
  if (headerH) ops.push({ op: 'set_header', target: 'header', page: 1, id: '', element: { enabled: true, height: headerH, showOn: 'all' } });

  pages.forEach((p, pi) => {
    const page = pi + 1;
    const pageTables = tables.filter((t) => t.page === page);
    const inTable = (o) => pageTables.some((t) => o.x + (o.w || 0) / 2 > t.x && o.x + (o.w || 0) / 2 < t.x + t.w && o.y + (o.h || 0) / 2 > t.y && o.y + (o.h || 0) / 2 < t.y + t.h);
    const pageMatches = matches.filter((m) => m.page === page && !m.table);
    const matchedIdx = new Set(pageMatches.flatMap((m) => m.idx));
    const bandOf = (o) => (headerH && pi > 0 && o.y < headerH ? 'skip' : headerH && pi === 0 && o.y < headerH ? 'header' : 'page');
    // lines and boxes
    let n = 0;
    for (const s of p.shapes) {
      if (n > 250 || inTable(s)) continue;
      const where = bandOf(s);
      if (where === 'skip') continue;
      if (s.kind === 'line') {
        const vertical = s.h > s.w;
        add(page, { type: 'line', x: r1(s.x), y: r1(s.y), w: r1(Math.max(vertical ? 1 : s.w, 1)), h: r1(Math.max(vertical ? s.h : 1, 1)), orientation: vertical ? 'vertical' : 'horizontal', thickness: Math.max(0.25, Math.min(3, s.width || 0.5)), color: s.color || '#000000' }, where);
        n++;
      } else if (s.fill && !/^#f{6}$/i.test(s.fill)) {
        add(page, { type: 'rect', x: r1(s.x), y: r1(s.y), w: r1(s.w), h: r1(s.h), fill: s.fill, borderWidth: s.stroke ? Math.max(0.25, s.width || 0.5) : 0, borderColor: s.stroke || '#000000' }, where);
        n++;
      } else if (s.stroke) {
        add(page, { type: 'rect', x: r1(s.x), y: r1(s.y), w: r1(s.w), h: r1(s.h), borderWidth: Math.max(0.25, s.width || 0.5), borderColor: s.stroke }, where);
        n++;
      }
    }
    // fixed texts (merge items of a line that touch)
    const style = (t) => ({ fontFamily: 'Arial', fontSize: Math.max(6, Math.round(t.size * 0.98 * 2) / 2), bold: !!t.bold, align: t.dir === 'ltr' && !/[֐-׿]/.test(t.str) ? 'left' : 'right', direction: /[֐-׿]/.test(t.str) ? 'rtl' : 'ltr', padding: 0, lineHeight: 1.1 });
    const widen = (o) => {
      const w = o.w * 1.12 + 2;
      const rtl = /[\u0590-\u05FF]/.test(o.str || o.text || '');
      return { x: r1(rtl ? o.x + o.w - w + 0.5 : o.x - 0.5), w: r1(w) };
    };
    // "עמוד 1 מתוך 6" / "Page 1 of 6": a live page number instead of fixed text
    const skip = new Set();
    for (const l of lines(p.texts)) {
      const words = l.items.map((t) => t.str);
      const a = words.findIndex((w) => /^(עמוד|Page)$/i.test(w));
      const b = words.findIndex((w) => /^(מתוך|of)$/i.test(w));
      if (a < 0 || b < 0) continue;
      const nums = l.items.filter((t) => /^\d{1,3}$/.test(t.str) && Math.abs(l.items.indexOf(t) - a) <= 3);
      if (nums.length < 2) continue;
      const parts = [l.items[a], l.items[b], ...nums.slice(0, 2)];
      parts.forEach((t) => skip.add(t.i));
      const bb = box(parts);
      const heb = /עמוד/.test(l.items[a].str);
      const where = bandOf(bb);
      if (where !== 'skip') add(page, { type: 'text', x: r1(bb.x - 1), y: r1(bb.y - 0.3), w: r1(bb.w + 3), h: r1(bb.h * 1.35), text: heb ? 'עמוד {{page}} מתוך {{pages}}' : 'Page {{page}} of {{pages}}', style: style(l.items[a]) }, where);
    }
    p.texts.forEach((t, i) => {
      if (skip.has(i) || matchedIdx.has(i) || inTable(t) || pageTables.some((tb) => tb.headerIdx.includes(i))) return;
      const where = bandOf(t);
      if (where === 'skip') return;
      if (/^\*[A-Z0-9 .$/+%-]{4,}\*$/.test(t.str)) return; // barcode text, handled below
      add(page, { type: 'text', ...widen(t), y: r1(t.y - 0.3), h: r1(t.h * 1.35), text: t.str, style: style(t) }, where);
    });
    // values bound to the data
    for (const m of pageMatches) {
      const where = bandOf(m);
      if (where === 'skip') continue;
      const h = bestHit(m);
      if (/^\*.+\*$/.test(m.text)) {
        // the printed text has the Code39 start/stop stars; the barcode adds them itself
        const plain = m.hits.find((x) => !/^\*.*\*$/.test(String(x.path)) && x.kind === 'exact' && x.path !== h.path) || h;
        add(page, { type: 'barcode', x: r1(m.x), y: r1(Math.max(0, m.y - 11)), w: r1(Math.max(m.w, 30)), h: r1(11 + m.h), symbology: 'code39', valueMode: 'expression', expression: `replace(${plain.path}, "*", "")`, showText: true }, where);
        continue;
      }
      add(page, { type: 'field', ...widen(m), y: r1(m.y - 0.3), h: r1(m.h * (m.wrapped ? 1 : 1.35)), binding: h.path, format: h.kind === 'date' || h.kind === 'visual' || h.kind === 'number' ? h.format : '', name: m.label || '', style: style(m) }, where);
    }
    // tables (a list continued on later pages is one paginating table)
    for (const tb of pageTables) {
      if (tables.some((o) => o.arrayPath === tb.arrayPath && o.page < tb.page)) continue;
      add(page, {
        type: 'table', x: r1(tb.x), y: r1(tb.y), w: r1(tb.w), h: r1(Math.max(tb.h, Math.min(p.height - tb.y - 20, 120))), binding: tb.arrayPath, overflow: 'paginate',
        style: { fontFamily: 'Arial', fontSize: 8 }, headerStyle: { background: '#e8ecf4', color: '#000000', bold: true, align: 'center', fontSize: 8 }, borderWidth: 0.5, borderColor: '#9aa4b5', cellPadding: 0.8,
        columns: tb.columns.map((c) => ({ header: c.header, binding: c.rel, width: c.width, format: c.format, align: /^number|^plain/.test(c.format) ? 'center' : '' })),
      });
    }
  });
  return ops;
}

// ---------------------------------------------------------------- report
export function reviewPdf({ pages = [], data = {} }) {
  const { matches, entries } = matchValues(pages, data);
  const tables = detectTables(pages, matches);
  // values inside a detected table, or from a list shown as a table, are table content
  for (const m of matches) {
    if (!m.table && tables.some((t) => t.page === m.page && m.x + m.w / 2 > t.x && m.x + m.w / 2 < t.x + t.w && m.y + m.h / 2 > t.y && m.y + m.h / 2 < t.y + t.h)) m.cell = true;
  }
  const tableLists = new Set(tables.map((t) => t.arrayPath));
  for (const m of matches) if (!m.table && tableLists.has(bestHit(m).arrayPath)) m.cell = true;
  const single = matches.filter((m) => !m.cell);
  // labels for single values (a word wrongly matched elsewhere can still be part of a label)
  for (const m of single) {
    if (m.table) continue;
    const p = pages[m.page - 1];
    const matchedIdx = new Set(single.filter((x) => x.page === m.page && !x.table).flatMap((x) => x.idx));
    const l = labelFor(m, p, matchedIdx);
    m.label = l ? l.text : '';
    m.labelWhere = l ? l.where : '';
  }
  const f = findings(pages, single, tables, entries, data);
  let score = 10;
  for (const i of f.issues) score -= SEV_W[i.severity] || 0;
  score = Math.max(1, Math.round(score * 10) / 10);
  const seen = new Set();
  const mappings = single.filter((m) => !m.table).map((m) => {
    const h = bestHit(m);
    const alt = [...new Set(m.hits.map((x) => x.path).filter((p) => p !== h.path))].slice(0, 6);
    return { page: m.page, label: m.label, value: m.text, path: h.path, alternatives: alt, kind: h.kind, format: h.format || '', x: r1(m.x), y: r1(m.y), w: r1(m.w), h: r1(m.h) };
  }).filter((m) => {
    // the same field repeated on every page is listed once
    const k = `${m.path}|${Math.round(m.x)}|${Math.round(m.y)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return {
    score,
    stats: { pages: pages.length, texts: pages.reduce((a, p) => a + p.texts.length, 0), matchedValues: mappings.length, tables: tables.length, coverage: f.coverage, usedFields: f.usedFields, unusedFields: f.unusedFields },
    issues: f.issues,
    mappings,
    tables: tables.map(({ headerIdx, ...t }) => t),
    operations: rebuildOperations(pages, single, tables),
  };
}

export { isNumeric };
