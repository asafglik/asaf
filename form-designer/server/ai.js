// Smart design agent.
//  - autoDesign: looks at an uploaded sample PDF (page images, text positions,
//    existing PDF form fields) and the data world, and places fields, tables
//    and signature areas on the template.
//  - designRequest: applies a free-text design request ("make the title bigger,
//    add a footer with page numbers") to the current template.
// Both return { message, operations } that the designer applies (and can undo).
// Uses Claude when an Anthropic API key is configured; otherwise autoDesign
// falls back to a rule-based detector (PDF form fields and "label:" text).
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';

export function aiAvailable() {
  return !!(config.anthropicApiKey || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client = null;
function getClient() {
  if (!client) client = new Anthropic(config.anthropicApiKey ? { apiKey: config.anthropicApiKey } : {});
  return client;
}

// ---------------------------------------------------------------- prompt
const SYSTEM = `You are the layout engine of a form designer (Hebrew, right-to-left documents).
You edit a form template by returning operations. Coordinates and sizes are in millimetres, origin at the top-left corner of the page. Font sizes are in points.

TEMPLATE MODEL
Every element: { "type", "x", "y", "w", "h", "name"?, "style"?, "visibleIf"?, "showOn"? }
style: { fontFamily, fontSize, bold, italic, underline, color "#rrggbb", background, align "right|center|left|justify", valign "top|middle|bottom", direction "rtl|ltr", lineHeight, padding (mm), borderWidth (pt), borderColor, borderSides "all|bottom|top|top,bottom|right|left", radius }
Fonts available: Heebo, Rubik, Assistant, Noto Sans Hebrew, Alef, Varela Round, Secular One, Suez One, Frank Ruhl Libre, David Libre, Noto Serif Hebrew, Miriam Libre, Arial, Times New Roman, Courier New, David, Miriam.
Types:
- text: { text } fixed text; may embed data as {{path}} or {{expression | format}}; {{page}} and {{pages}} are page numbers.
- field: { binding: "path.to.value", format?, prefix?, suffix?, emptyText? }
- computed: { expression, format? }  e.g. "sum(items.item, price * qty) * 1.18"
- richtext: { html, overflow: "clip|paginate" } formatted HTML (p, b, i, u, span style, ul/ol, table), may contain {{path}}
- table: { binding: "path.to.list", columns: [{ header, binding (relative to the row) | expression, width (relative weight), align, format, footer? }], overflow: "paginate", headerStyle: { background, color }, altRowBackground, borderWidth, borderColor }
  In column footers $rows is the list, e.g. footer "{{sum($rows, price * qty) | currency}}".
- image: { source: "static|field", binding? }
- barcode: { symbology: "code128|qrcode|ean13|datamatrix|pdf417|code39|itf14", valueMode: "field|expression|static", binding?, expression?, value?, showText }
- checkbox: { binding } ticked when the value is true/1/Y/כן/X
- signature: { placeholder: "unique_name", label: "חתימת הלקוח", signer?, required? } a signature area (line + label). placeholder names: lowercase latin letters, digits and _.
- upload: { placeholder: "unique_name", label } an area where an image will be uploaded later.
- line: { orientation: "horizontal|vertical", thickness (pt), color }   (horizontal line: h = 1)
- rect / ellipse: { fill, borderWidth, borderColor, radius }
Formats: number:2, plain:0, currency, currency:USD, percent:1, date:dd/MM/yyyy, date:d MMMM yyyy, datetime, upper, bool:כן/לא
Expressions: paths, + - * / %, == != < > <= >=, and/or/not, cond ? a : b, & (concat), functions sum/avg/min/max/count(list, itemExpr), round, if, coalesce, isEmpty, today, addDays, upper, len, join, format.
Translations: element.tr = { en: { text: "..." } } (also html / label / prefix / suffix / emptyText, and column.tr = { en: { header, footer } }). template.languages lists the print languages; $lang is the print language in expressions.
visibleIf: an expression; the element prints only when it is true (e.g. "customer.vip == true", "!isEmpty(notes)").
showOn: all | first | last | notFirst | notLast (relative to the pages a long table produces).
Header / footer bands repeat on every page: set with set_header / set_footer ({ enabled, height, showOn: all|notFirst|firstOnly|notLast|lastOnly }); their elements are added with target "header"/"footer" and use coordinates relative to the band (y = 0 is the top of the band).

OPERATIONS (field "element_json" always holds a JSON object encoded as a string, "{}" when unused)
- add_element: target page|header|footer, page (1-based, for target page), element_json = the full element (no id needed)
- update_element: id, element_json = only the properties to change (style is merged)
- delete_element: id
- set_header / set_footer: element_json = { enabled, height, showOn }
- set_template: element_json = { name?, description?, page?: { size: "A4|A5|A3|Letter|custom", orientation, width, height } }

RULES
- Bind only to paths that exist in the data world. Inside a table, column bindings are relative to the row.
- Lists (arrays) become tables. Keep tables inside the page margins and leave room for totals.
- Hebrew text is right-aligned with direction rtl unless it is numbers/codes in their own field.
- Keep elements inside the page, do not overlap unrelated elements, align related fields on a grid.
- Answer in Hebrew in "message": a short summary of what you did and anything the user should check.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    operations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['add_element', 'update_element', 'delete_element', 'set_header', 'set_footer', 'set_template'] },
          target: { type: 'string', enum: ['page', 'header', 'footer'] },
          page: { type: 'integer' },
          id: { type: 'string' },
          element_json: { type: 'string' },
        },
        required: ['op', 'target', 'page', 'id', 'element_json'],
        additionalProperties: false,
      },
    },
  },
  required: ['message', 'operations'],
  additionalProperties: false,
};

// ---------------------------------------------------------------- helpers
function flattenTree(node, out = [], inArray = '') {
  for (const c of node?.children || []) {
    if (c.kind === 'array') {
      out.push(`${inArray ? `  [row of ${inArray}] ` : ''}${c.path}  (LIST, ${c.count} items) -> table`);
      flattenTree(c, out, c.path);
    } else if (c.kind === 'object') {
      flattenTree(c, out, inArray);
    } else {
      out.push(`${inArray ? `  [row of ${inArray}] ` : ''}${c.path}${c.sample ? `  e.g. "${String(c.sample).slice(0, 40)}"` : ''}`);
    }
  }
  return out;
}

/** Template without heavy payloads (images, source PDF, sample data). */
function compactTemplate(t) {
  const strip = (els) => (els || []).map((e) => {
    const c = { ...e };
    if (c.src) c.src = '(image)';
    if (c.html && c.html.length > 1500) c.html = c.html.slice(0, 1500) + '…';
    return c;
  });
  return {
    name: t.name,
    page: t.page,
    header: t.header ? { ...t.header, elements: strip(t.header.elements) } : null,
    footer: t.footer ? { ...t.footer, elements: strip(t.footer.elements) } : null,
    pages: (t.pages || []).map((p, i) => ({ page: i + 1, background: p.background ? p.background.type : null, elements: strip(p.elements) })),
  };
}

function imageBlock(dataUrl) {
  const m = /^data:(image\/(png|jpeg|webp|gif));base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[3] } };
}

function parseOps(result) {
  const ops = [];
  for (const o of result.operations || []) {
    let element = {};
    try {
      element = o.element_json ? JSON.parse(o.element_json) : {};
    } catch {
      continue; // skip malformed operation
    }
    if (!element || typeof element !== 'object') continue;
    ops.push({ op: o.op, target: o.target || 'page', page: o.page || 1, id: o.id || '', element });
  }
  return { message: result.message || '', operations: ops };
}

async function callClaude(content, { effort = 'high' } = {}) {
  const stream = getClient().beta.messages.stream({
    model: config.aiModel,
    max_tokens: 64000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort, format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw Object.assign(new Error('הסוכן סירב לבקשה'), { status: 422 });
  if (msg.stop_reason === 'max_tokens') throw Object.assign(new Error('תשובת הסוכן נקטעה (ארוכה מדי). נסו בקשה ממוקדת יותר.'), { status: 422 });
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw Object.assign(new Error('תשובת הסוכן אינה JSON תקין'), { status: 502 });
  }
  return parseOps(parsed);
}

function wrapApiError(e) {
  if (e instanceof Anthropic.AuthenticationError) return Object.assign(new Error('מפתח Anthropic API לא תקין'), { status: 502 });
  if (e instanceof Anthropic.RateLimitError) return Object.assign(new Error('הסוכן עמוס כרגע, נסו שוב בעוד רגע'), { status: 503 });
  if (e instanceof Anthropic.APIConnectionError) return Object.assign(new Error('אין חיבור לשירות הסוכן (api.anthropic.com)'), { status: 502 });
  if (e instanceof Anthropic.APIError) return Object.assign(new Error(`שגיאת סוכן ${e.status}: ${e.message}`), { status: 502 });
  return e;
}

// ---------------------------------------------------------------- auto design
/**
 * pages: [{ image (data URL), width, height (mm), texts: [{ str, x, y, w, h }], fields: [{ name, type, x, y, w, h, value }] }]
 * mode: "overlay" (keep the PDF as background, add data fields) | "rebuild" (recreate the layout with native elements)
 */
export async function autoDesign({ template, tree, pages = [], mode = 'overlay', instructions = '' }) {
  if (!aiAvailable()) return heuristicDesign({ tree, pages });
  const content = [];
  pages.slice(0, 8).forEach((p, i) => {
    const img = imageBlock(p.image);
    if (img) content.push(img);
    const texts = (p.texts || []).slice(0, 600).map((t) => `${round(t.x)},${round(t.y)},${round(t.w)},${round(t.h)} "${t.str}"`).join('\n');
    const fields = (p.fields || []).map((f) => `${f.type} "${f.name}" at ${round(f.x)},${round(f.y)} size ${round(f.w)}x${round(f.h)}`).join('\n');
    content.push({ type: 'text', text: `PAGE ${i + 1} (${round(p.width)} x ${round(p.height)} mm). The image above is this page.\nText found on the page (x,y,w,h mm "text"; Hebrew may appear in reversed character order, trust the image):\n${texts || '(none - scanned page?)'}\n${fields ? `Existing PDF form fields:\n${fields}` : ''}` });
  });
  content.push({
    type: 'text',
    text: `DATA WORLD (bind only to these paths):\n${flattenTree(tree).join('\n') || '(no data world defined - use descriptive placeholder paths such as customer.name and say so in the message)'}

CURRENT TEMPLATE:
${JSON.stringify(compactTemplate(template))}

TASK: ${mode === 'rebuild'
    ? 'Recreate this document as a native template: reproduce its fixed texts, titles, lines, boxes and tables with elements (fonts, sizes, bold, alignment as in the image), and put data fields / tables bound to the data world where the values go. The PDF background will be removed, so everything visible must become elements. Use add_element for page 1..N.'
    : 'The sample PDF stays as the page background. Do NOT recreate text already printed on it. Add data fields, computed fields, tables, checkboxes and signature / upload areas exactly over the blank places where values belong (next to labels, on lines, inside boxes, in table rows). Fit fields to the blank area and use a font size that fits the line height.'}
Add a signature element wherever the document asks for a signature, and an upload element where a photo / ID copy is expected.
${instructions ? `User instructions: ${instructions}` : ''}`,
  });
  try {
    return await callClaude(content, { effort: 'high' });
  } catch (e) {
    throw wrapApiError(e);
  }
}

// ---------------------------------------------------------------- free-text request
export async function designRequest({ template, tree, request, pageIndex = 0, pageImage, designImage, selection = [], history = [] }) {
  if (!aiAvailable()) throw Object.assign(new Error('הסוכן החכם לא מוגדר: יש להגדיר ANTHROPIC_API_KEY בשרת'), { status: 501 });
  if (!String(request || '').trim()) throw Object.assign(new Error('כתבו מה לשנות'), { status: 400 });
  const content = [];
  const shot = imageBlock(designImage);
  if (shot) content.push(shot, { type: 'text', text: `The image above shows page ${pageIndex + 1} as currently designed, filled with sample data (without the PDF background).` });
  const bg = imageBlock(pageImage);
  if (bg) content.push(bg, { type: 'text', text: `The image above is the original PDF page used as the background of page ${pageIndex + 1}.` });
  content.push({
    type: 'text',
    text: `DATA WORLD:\n${flattenTree(tree).join('\n') || '(none)'}

CURRENT TEMPLATE (element ids are needed for update/delete):
${JSON.stringify(compactTemplate(template))}

The user is looking at page ${pageIndex + 1}.${selection.length ? ` Selected element ids: ${selection.join(', ')} ("this", "the selected" refer to them).` : ''}
${history.length ? `Earlier requests in this session:\n${history.slice(-6).map((h) => `- ${h}`).join('\n')}\n` : ''}
REQUEST: ${request}`,
  });
  try {
    return await callClaude(content, { effort: 'medium' });
  } catch (e) {
    throw wrapApiError(e);
  }
}

// ---------------------------------------------------------------- design review
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'number' },
    summary: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          category: { type: 'string' },
          page: { type: 'integer' },
          title: { type: 'string' },
          detail: { type: 'string' },
          recommendation: { type: 'string' },
        },
        required: ['severity', 'category', 'page', 'title', 'detail', 'recommendation'],
        additionalProperties: false,
      },
    },
    mapping_fixes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { page: { type: 'integer' }, value: { type: 'string' }, label: { type: 'string' }, path: { type: 'string' } },
        required: ['page', 'value', 'label', 'path'],
        additionalProperties: false,
      },
    },
    quick_wins: { type: 'array', items: { type: 'string' } },
  },
  required: ['score', 'summary', 'strengths', 'issues', 'mapping_fixes', 'quick_wins'],
  additionalProperties: false,
};

/**
 * The agent's design review of a sample PDF produced from the data world. `report`
 * is the rule-based review (matched values, tables, findings) it builds on.
 */
export async function aiReview({ pages = [], tree, report }) {
  if (!aiAvailable()) return null;
  const content = [];
  pages.slice(0, 4).forEach((p, i) => {
    const img = imageBlock(p.image);
    if (img) content.push(img, { type: 'text', text: `Page ${i + 1} of the sample document.` });
  });
  const brief = {
    stats: report.stats,
    findings: report.issues.map((x) => `[${x.severity}] ${x.title}: ${x.detail}`),
    mappings: report.mappings.slice(0, 120).map((m) => ({ page: m.page, label: m.label, value: m.value, path: m.path, alternatives: m.alternatives })),
    tables: report.tables.map((t) => ({ page: t.page, list: t.arrayPath, rows: t.rows, columns: t.columns.map((c) => `${c.header} = ${c.rel}`) })),
  };
  content.push({
    type: 'text',
    text: `You are a senior designer of printed business forms (Hebrew, right-to-left: invoices, work cards, delivery forms).
The pages above are a sample document generated by the customer's current system from the data world below. An automatic analysis already matched printed values to data paths.

DATA WORLD (paths):
${flattenTree(tree).slice(0, 400).join('\n')}

AUTOMATIC ANALYSIS:
${JSON.stringify(brief)}

Write a design review in Hebrew:
- score: 1-10 for the current design (readability, hierarchy, use of space, consistency, how well the data is presented).
- summary: 2-3 sentences.
- strengths: what works and should be kept.
- issues: concrete problems with a concrete recommendation each (sizes in pt / mm, what to merge, hide when empty, show as a table, page structure, header on continuation pages, signatures, etc.). Do not repeat the automatic findings word for word; add what a designer sees in the images.
- mapping_fixes: for mapped values whose path looks wrong (choose from "alternatives" or from the data world by the label meaning, e.g. front vs rear tyre), and for labels that have no value but a matching data path exists - give the correct path. Only paths that exist in the data world.
- quick_wins: up to 5 short actions with the biggest improvement.`,
  });
  try {
    const stream = getClient().beta.messages.stream({
      model: config.aiModel,
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: REVIEW_SCHEMA } },
      messages: [{ role: 'user', content }],
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal' || msg.stop_reason === 'max_tokens') return null;
    return JSON.parse(msg.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
  } catch (e) {
    throw wrapApiError(e);
  }
}

// ---------------------------------------------------------------- translation
const TRANSLATE_SCHEMA = {
  type: 'object',
  properties: { translations: { type: 'array', items: { type: 'string' } } },
  required: ['translations'],
  additionalProperties: false,
};

const LANG_NAMES = { he: 'Hebrew', en: 'English', ar: 'Arabic', ru: 'Russian', fr: 'French', am: 'Amharic' };

/** Translate form texts. Placeholders {{...}} and HTML tags are kept as they are. */
export async function translateTexts({ from = 'he', to, texts = [] }) {
  if (!aiAvailable()) throw Object.assign(new Error('התרגום האוטומטי משתמש בסוכן החכם: יש להגדיר ANTHROPIC_API_KEY בשרת'), { status: 501 });
  if (!LANG_NAMES[to] || !Array.isArray(texts)) throw Object.assign(new Error('שפת יעד לא נתמכת'), { status: 400 });
  if (!texts.length) return { translations: [] };
  const list = texts.slice(0, 400).map((t) => String(t).slice(0, 4000));
  try {
    const stream = getClient().beta.messages.stream({
      model: config.aiModel,
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: TRANSLATE_SCHEMA } },
      system: 'You translate the texts of printed business forms (invoices, contracts, delivery forms). Keep every {{...}} placeholder, HTML tag and attribute exactly as it is, translate only the human-readable text, use the formal business register of the target language, and keep numbers, codes and product names unchanged. Return the translations in the same order and count as the input.',
      messages: [{ role: 'user', content: `Translate from ${LANG_NAMES[from] || from} to ${LANG_NAMES[to]}. Input (JSON array of ${list.length} strings):\n${JSON.stringify(list)}` }],
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw Object.assign(new Error('הסוכן סירב לתרגם'), { status: 422 });
    const out = JSON.parse(msg.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
    const tr = Array.isArray(out.translations) ? out.translations.map(String) : [];
    return { translations: list.map((_, i) => tr[i] ?? '') };
  } catch (e) {
    throw wrapApiError(e);
  }
}

const round = (v) => Math.round(Number(v) * 10) / 10;

// ---------------------------------------------------------------- rule-based fallback
const SIGN_WORDS = /חתימ|signature|sign here/i;
const PHOTO_WORDS = /צילום|תמונ|photo|צרף|העתק ת/i;

function norm(s) {
  return String(s || '').replace(/[\s"'״׳:.\-_()]/g, '').toLowerCase();
}

/** Match a label to a data path by name similarity (works for latin names and exact Hebrew names). */
function matchPath(label, paths) {
  const l = norm(label);
  if (!l) return '';
  let best = '';
  let score = 0;
  for (const p of paths) {
    const last = norm(p.split('.').pop());
    const full = norm(p);
    let s = 0;
    if (last === l || full === l) s = 3;
    else if (l.includes(last) && last.length > 2) s = 2;
    else if (last.includes(l) && l.length > 2) s = 1;
    if (s > score) { score = s; best = p; }
  }
  return best;
}

export function heuristicDesign({ tree, pages = [] }) {
  const values = [];
  const lists = [];
  const walk = (n, inArr) => (n?.children || []).forEach((c) => {
    if (c.kind === 'array' && !inArr) lists.push(c.path);
    if (c.kind === 'value' && !inArr) values.push(c.path);
    walk(c, inArr || c.kind === 'array');
  });
  walk(tree, false);
  const ops = [];
  let sig = 0;
  let up = 0;
  pages.forEach((p, pi) => {
    const page = pi + 1;
    // 1. existing AcroForm fields -> elements at the same position
    for (const f of p.fields || []) {
      const name = (f.name || '').split('.').pop();
      if (f.type === 'signature' || SIGN_WORDS.test(name)) {
        ops.push(add(page, { type: 'signature', x: f.x, y: f.y, w: f.w, h: f.h, placeholder: slug(name) || `signature_${++sig}`, label: 'חתימה' }));
      } else if (f.type === 'checkbox') {
        ops.push(add(page, { type: 'checkbox', x: f.x, y: f.y, w: f.w, h: f.h, binding: matchPath(name, values) || name }));
      } else {
        ops.push(add(page, { type: 'field', x: f.x, y: f.y, w: f.w, h: f.h, binding: matchPath(name, values) || name, name, style: { fontSize: Math.max(7, Math.min(12, f.h * 2)), align: 'right', valign: 'middle' } }));
      }
    }
    const overlapsField = (x, y, w, h) => (p.fields || []).some((f) => x < f.x + f.w && x + w > f.x && y < f.y + f.h && y + h > f.y);
    // 2. "label:" text -> a field in the blank space to its left (RTL)
    const texts = p.texts || [];
    for (const t of texts) {
      const str = String(t.str || '').trim();
      if (!str) continue;
      if (SIGN_WORDS.test(str) && str.length < 40) {
        // signature line to the left of "Signature:", or above the label when nothing is beside it
        const w = Math.min(70, t.x - 12);
        const box = w >= 30 ? { x: t.x - 2 - w, y: t.y - 10, w, h: 13 } : { x: Math.max(5, t.x - 2), y: Math.max(2, t.y - 14), w: Math.max(40, t.w + 4), h: 14 };
        if (!overlapsField(box.x, box.y, box.w, box.h)) ops.push(add(page, { type: 'signature', ...box, placeholder: `signature_${++sig}`, label: str.replace(/[:_.]+$/, '') }));
        continue;
      }
      if (PHOTO_WORDS.test(str) && str.length < 40) {
        ops.push(add(page, { type: 'upload', x: t.x, y: t.y + t.h + 2, w: Math.max(40, t.w), h: 30, placeholder: `upload_${++up}`, label: str }));
        continue;
      }
      if (!/[:：]\s*_*$|_{3,}$/.test(str)) continue;
      const label = str.replace(/[:：_\s]+$/, '');
      // free space to the left of the label on the same line
      const sameLine = texts.filter((o) => o !== t && Math.abs(o.y - t.y) < t.h * 0.6 && o.x + o.w <= t.x);
      const leftEdge = sameLine.length ? Math.max(...sameLine.map((o) => o.x + o.w)) + 2 : 12;
      const w = Math.min(90, t.x - 1 - leftEdge);
      if (w < 8 || overlapsField(t.x - 1 - w, t.y - 0.5, w, Math.max(5, t.h + 1))) continue;
      ops.push(add(page, {
        type: 'field', x: t.x - 1 - w, y: t.y - 0.5, w, h: Math.max(5, t.h + 1),
        binding: matchPath(label, values) || '', name: label, emptyText: '',
        style: { fontSize: Math.max(7, Math.min(12, t.h * 2.2)), align: 'right', valign: 'middle' },
      }));
    }
  });
  const fields = ops.filter((o) => o.element.type === 'field').length;
  const unbound = ops.filter((o) => o.element.type === 'field' && !o.element.binding).length;
  return {
    heuristic: true,
    message: `זיהוי אוטומטי בסיסי (ללא סוכן AI): נוספו ${fields} שדות, ${sig} אזורי חתימה ו-${up} אזורי העלאת תמונה.`
      + (unbound ? ` ${unbound} שדות לא קושרו לעולם הנתונים – בחרו להם שדה בלוח המאפיינים.` : '')
      + (lists.length ? ` רשימות בנתונים (${lists.join(', ')}) – גררו אותן לדף ליצירת טבלה.` : '')
      + ' להפעלת הסוכן החכם (זיהוי מבוסס תמונה ועיצוב לפי בקשה) הגדירו ANTHROPIC_API_KEY בשרת.',
    operations: ops,
  };
}

function add(page, element) {
  for (const k of ['x', 'y', 'w', 'h']) element[k] = round(element[k]);
  return { op: 'add_element', target: 'page', page, id: '', element };
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
}
