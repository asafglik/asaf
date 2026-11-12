// Builds the HTML of template elements. Used by the server renderer (final
// PDF) and by the designer canvas (live preview with sample data), so what
// the designer shows is what the PDF prints.

import { evalExpr, interpolate, makeScope, PAGE_TOKENS } from './expr.js';
import { formatValue, valueToString } from './format.js';

export const MM = 96 / 25.4; // CSS px per mm

export const PAGE_SIZES = {
  A4: [210, 297],
  A5: [148, 210],
  A3: [297, 420],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
};

export const DEFAULT_STYLE = {
  fontFamily: 'Heebo',
  fontSize: 11,
  bold: false,
  italic: false,
  underline: false,
  color: '#000000',
  background: '',
  align: 'right',
  valign: 'top',
  direction: 'rtl',
  lineHeight: 1.25,
  padding: 0.5,
  borderWidth: 0,
  borderColor: '#000000',
  borderStyle: 'solid',
  borderSides: 'all',
  radius: 0,
  letterSpacing: 0,
};

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeText(s) {
  return escapeHtml(s).replace(/\r?\n/g, '<br>');
}

const GENERIC = /^(serif|sans-serif|monospace|cursive|system-ui)$/;
export function fontStack(family) {
  if (!family) return 'sans-serif';
  const fams = String(family).split(',').map((f) => f.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  return fams.map((f) => (GENERIC.test(f) ? f : `'${f.replace(/'/g, '')}'`)).join(', ') + ', sans-serif';
}

function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

/** CSS for text-like styling (font, color, alignment, borders). */
export function textCss(st = {}) {
  const s = { ...DEFAULT_STYLE, ...st };
  const css = [
    `font-family:${fontStack(s.fontFamily)}`,
    `font-size:${n(s.fontSize, 11)}pt`,
    `font-weight:${s.bold ? 700 : 400}`,
    `font-style:${s.italic ? 'italic' : 'normal'}`,
    `color:${s.color || '#000'}`,
    `text-align:${s.align || 'right'}`,
    `direction:${s.direction || 'rtl'}`,
    `line-height:${n(s.lineHeight, 1.25)}`,
  ];
  const deco = [s.underline && 'underline', s.strike && 'line-through'].filter(Boolean).join(' ');
  if (deco) css.push(`text-decoration:${deco}`);
  if (s.letterSpacing) css.push(`letter-spacing:${n(s.letterSpacing)}pt`);
  return css.join(';');
}

export function boxCss(st = {}) {
  const s = { ...DEFAULT_STYLE, ...st };
  const css = [];
  if (s.background) css.push(`background:${s.background}`);
  const bw = n(s.borderWidth);
  if (bw > 0) {
    const b = `${bw}pt ${s.borderStyle || 'solid'} ${s.borderColor || '#000'}`;
    const sides = s.borderSides || 'all';
    if (sides === 'all') css.push(`border:${b}`);
    else for (const side of sides.split(',')) css.push(`border-${side.trim()}:${b}`);
  }
  if (n(s.radius)) css.push(`border-radius:${n(s.radius)}mm`);
  css.push(`padding:${n(s.padding, 0.5)}mm`);
  return css.join(';');
}

const VALIGN = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };

export function rowScope(scope, item, index) {
  const vars = item && typeof item === 'object' && !Array.isArray(item) ? { ...item } : { $value: item };
  vars.$item = item;
  vars.$index = index;
  vars.$row = index + 1;
  return makeScope(vars, scope);
}

function safeEval(src, scope, ctx) {
  try {
    return evalExpr(src, scope);
  } catch (e) {
    ctx.errors?.push(`${src}: ${e.message}`);
    return ctx.design ? `#${e.message}` : '#שגיאה';
  }
}

function pageTokensToHtml(html, ctx) {
  if (ctx.design) return html.split(PAGE_TOKENS.page).join('1').split(PAGE_TOKENS.pages).join('1');
  return html.split(PAGE_TOKENS.page).join('<span class="fd-pn">1</span>').split(PAGE_TOKENS.pages).join('<span class="fd-pc">1</span>');
}

function textValueHtml(text, scope, ctx) {
  const html = interpolate(text ?? '', scope, {
    escape: escapeText,
    onError: (e, ex) => ctx.errors?.push(`${ex}: ${e.message}`),
  });
  return pageTokensToHtml(html, ctx);
}

function placeholder(label) {
  return `<span class="fd-ph">${escapeHtml(label)}</span>`;
}

function valueHtml(v, fmt, el, ctx, label) {
  const str = formatValue(v, fmt);
  if (str === '') {
    if (el.emptyText) return escapeText(el.emptyText);
    return ctx.design && label ? placeholder(label) : '';
  }
  return escapeText((el.prefix || '') + str + (el.suffix || ''));
}

// ---------------------------------------------------------------- images
export function imageSrc(value) {
  if (!value) return '';
  let v = valueToString(value).trim();
  if (/^data:image\//i.test(v)) return v;
  if (/^https?:\/\//i.test(v) || v.startsWith('/')) return v;
  v = v.replace(/\s+/g, '');
  let mime = 'image/png';
  if (v.startsWith('/9j/')) mime = 'image/jpeg';
  else if (v.startsWith('R0lGOD')) mime = 'image/gif';
  else if (v.startsWith('PHN2') || v.startsWith('PD94')) mime = 'image/svg+xml';
  else if (v.startsWith('UklGR')) mime = 'image/webp';
  return `data:${mime};base64,${v}`;
}

function imageHtml(src, fit) {
  if (!src) return '';
  return `<img src="${escapeHtml(src)}" style="width:100%;height:100%;object-fit:${fit || 'contain'};display:block" alt="">`;
}

// ---------------------------------------------------------------- barcodes
function barcodeValue(el, scope, ctx) {
  if (el.valueMode === 'field') return valueToString(safeEval(el.binding, scope, ctx));
  if (el.valueMode === 'expression') return valueToString(safeEval(el.expression, scope, ctx));
  return textValueHtml(el.value ?? '', scope, { ...ctx, design: true }).replace(/<br>/g, '\n')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

function barcodeHtml(el, scope, ctx, wMm, hMm) {
  const text = barcodeValue(el, scope, ctx);
  if (!text) return ctx.design ? placeholder(el.binding || el.expression || 'ברקוד') : '';
  const opts = {
    symbology: el.symbology || 'code128',
    text,
    showText: el.showText !== false,
    color: el.color || '#000000',
    rotate: el.rotate || 'N',
    widthMm: wMm,
    heightMm: hMm,
  };
  try {
    return ctx.barcode(opts);
  } catch (e) {
    ctx.errors?.push(`ברקוד: ${e.message}`);
    return ctx.design ? placeholder('ברקוד לא תקין: ' + text) : '';
  }
}

// ---------------------------------------------------------------- tables
export function tableRows(el, scope, ctx) {
  let list = el.binding ? safeEval(el.binding, scope, ctx) : [];
  if (list === null || list === undefined || list === '') list = [];
  if (!Array.isArray(list)) list = [list];
  if (el.filter) list = list.filter((it, i) => {
    const v = safeEval(el.filter, rowScope(scope, it, i), ctx);
    return v && v !== 'false' && v !== '0';
  });
  if (el.sortBy) {
    const keyed = list.map((it, i) => ({ it, k: safeEval(el.sortBy, rowScope(scope, it, i), ctx) }));
    keyed.sort((a, b) => {
      const na = Number(a.k);
      const nb = Number(b.k);
      const r = Number.isFinite(na) && Number.isFinite(nb) ? na - nb : valueToString(a.k).localeCompare(valueToString(b.k), 'he');
      return el.sortDesc ? -r : r;
    });
    list = keyed.map((x) => x.it);
  }
  return list;
}

function cellCss(col, base) {
  const css = [];
  if (col.align) css.push(`text-align:${col.align}`);
  if (col.bold) css.push('font-weight:700');
  if (col.color) css.push(`color:${col.color}`);
  if (col.fontSize) css.push(`font-size:${col.fontSize}pt`);
  if (col.background) css.push(`background:${col.background}`);
  if (col.valign) css.push(`vertical-align:${col.valign}`);
  return (base ? base + ';' : '') + css.join(';');
}

function tableCellContent(col, item, rs, ctx, el) {
  if (col.cellType === 'image') {
    const v = col.expression ? safeEval(col.expression, rs, ctx) : safeEval(col.binding, rs, ctx);
    const src = imageSrc(v);
    const h = n(col.imageHeight, 10);
    return src ? `<img src="${escapeHtml(src)}" style="max-width:100%;height:${h}mm;object-fit:contain" alt="">` : '';
  }
  if (col.cellType === 'barcode') {
    const fake = { symbology: col.symbology || 'code128', valueMode: col.expression ? 'expression' : 'field', binding: col.binding, expression: col.expression, showText: col.showText !== false };
    return `<div style="height:${n(col.imageHeight, 10)}mm">${barcodeHtml(fake, rs, ctx, null, n(col.imageHeight, 10))}</div>`;
  }
  if (col.cellType === 'text') return textValueHtml(col.text || '', rs, ctx);
  const v = col.expression ? safeEval(col.expression, rs, ctx) : col.binding ? safeEval(col.binding, rs, ctx) : '';
  return valueHtml(v, col.format, col, ctx, ctx.design && item === undefined ? col.binding : '');
}

function tableHtml(el, scope, ctx) {
  const cols = el.columns || [];
  const total = cols.reduce((a, c) => a + Math.max(0.1, n(c.width, 1)), 0) || 1;
  const bw = n(el.borderWidth, 0.5);
  const bc = el.borderColor || '#000000';
  const cellBorder = bw > 0 ? `border:${bw}pt solid ${bc}` : 'border:none';
  const pad = `padding:${n(el.cellPadding, 1)}mm ${n(el.cellPadding, 1) * 1.5}mm`;
  const head = { ...DEFAULT_STYLE, ...(el.style || {}), ...(el.headerStyle || {}) };
  const rowStyle = el.rowStyle || {};

  let rows = tableRows(el, scope, ctx);
  let designRows = false;
  if (ctx.design && rows.length === 0) {
    rows = [undefined, undefined];
    designRows = true;
  }
  if (ctx.design && rows.length > 60) rows = rows.slice(0, 60);

  let h = `<table class="fd-tbl" style="width:100%;table-layout:fixed;border-collapse:collapse;${textCss(el.style)}">`;
  h += '<colgroup>' + cols.map((c) => `<col style="width:${(Math.max(0.1, n(c.width, 1)) / total) * 100}%">`).join('') + '</colgroup>';
  if (el.showHeader !== false) {
    const hcss = `${cellBorder};${pad};background:${head.background || '#e8ecf4'};color:${head.color || '#000'};font-weight:${head.bold === false ? 400 : 700};font-size:${n(head.fontSize, 11)}pt;text-align:${head.align || 'center'};vertical-align:middle`;
    h += '<thead><tr>' + cols.map((c) => `<th style="${hcss}">${textValueHtml(c.header ?? '', scope, ctx)}</th>`).join('') + '</tr></thead>';
  }
  h += '<tbody>';
  rows.forEach((item, i) => {
    const rs = designRows ? scope : rowScope(scope, item, i);
    let bg = rowStyle.background || '';
    if (el.altRowBackground && i % 2 === 1) bg = el.altRowBackground;
    if (el.rowHighlightIf && !designRows) {
      const v = safeEval(el.rowHighlightIf, rs, ctx);
      if (v && v !== 'false') bg = el.rowHighlightColor || '#fff3cd';
    }
    const minH = n(el.rowHeight, 0) ? `height:${n(el.rowHeight)}mm;` : '';
    h += `<tr class="fd-row" style="${minH}${bg ? `background:${bg}` : ''}">`;
    for (const c of cols) {
      h += `<td style="${cellCss(c, `${cellBorder};${pad};vertical-align:${el.valign || 'top'}`)}">${designRows ? placeholder(c.expression ? 'ƒ ' + c.expression : c.binding || '') : tableCellContent(c, item, rs, ctx, el)}</td>`;
    }
    h += '</tr>';
  });
  h += '</tbody>';
  if (cols.some((c) => c.footer)) {
    const fs = { ...(el.footerStyle || {}) };
    const fcss = `${cellBorder};${pad};font-weight:${fs.bold === false ? 400 : 700};background:${fs.background || '#f5f5f5'}`;
    const fscope = makeScope({ $rows: tableRows(el, scope, { ...ctx, errors: null }) }, scope);
    h += '<tfoot><tr>' + cols.map((c) => `<td style="${cellCss(c, fcss)}">${textValueHtml(c.footer || '', fscope, ctx)}</td>`).join('') + '</tr></tfoot>';
  }
  h += '</table>';
  return h;
}

// ---------------------------------------------------------------- element
export function isVisible(el, scope, ctx) {
  if (!el.visibleIf || ctx.design) return true;
  const v = safeEval(el.visibleIf, scope, ctx);
  return !!v && v !== 'false' && v !== '0' && !(Array.isArray(v) && v.length === 0);
}

/** Inner HTML for an element (content only, no positioning). */
export function elementInnerHtml(el, scope, ctx) {
  const st = el.style || {};
  switch (el.type) {
    case 'text':
      return textValueHtml(el.text, scope, ctx);
    case 'field': {
      const v = el.binding ? safeEval(el.binding, scope, ctx) : '';
      return valueHtml(v, el.format, el, ctx, el.binding ? `«${el.binding}»` : '«שדה»');
    }
    case 'computed': {
      const v = el.expression ? safeEval(el.expression, scope, ctx) : '';
      return valueHtml(v, el.format, el, ctx, el.expression ? `ƒ ${el.expression}` : 'ƒ');
    }
    case 'richtext': {
      const html = interpolate(el.html || '', scope, {
        escape: (x) => x,
        escapeValue: escapeText,
        onError: (e, ex) => ctx.errors?.push(`${ex}: ${e.message}`),
      });
      return pageTokensToHtml(html, ctx);
    }
    case 'image': {
      if (el.source === 'field') {
        const v = el.binding ? safeEval(el.binding, scope, ctx) : '';
        const src = imageSrc(v);
        if (!src) return ctx.design ? placeholder('🖼 ' + (el.binding || 'תמונה')) : '';
        return imageHtml(src, el.fit);
      }
      return el.src ? imageHtml(el.src, el.fit) : ctx.design ? placeholder('🖼 תמונה') : '';
    }
    case 'barcode':
      return barcodeHtml(el, scope, ctx, n(el.w), n(el.h));
    case 'table':
      return tableHtml(el, scope, ctx);
    case 'line':
    case 'rect':
    case 'ellipse':
      return '';
    case 'checkbox': {
      const v = el.binding ? safeEval(el.binding, scope, ctx) : el.expression ? safeEval(el.expression, scope, ctx) : false;
      const on = v === true || v === 'true' || v === '1' || v === 1 || v === 'Y' || v === 'y' || v === 'כן' || v === 'X' || v === 'x';
      const size = Math.min(n(el.w), n(el.h));
      return `<div style="width:${size}mm;height:${size}mm;border:${n(st.borderWidth, 0.75) || 0.75}pt solid ${st.borderColor || '#000'};display:flex;align-items:center;justify-content:center;font-size:${size * 2}pt;line-height:1;box-sizing:border-box">${on ? '✓' : ''}</div>`;
    }
    default:
      return '';
  }
}

/** Positioned outer style for an element. */
export function elementOuterCss(el) {
  const st = { ...DEFAULT_STYLE, ...(el.style || {}) };
  const base = [`left:${n(el.x)}mm`, `top:${n(el.y)}mm`, `width:${n(el.w)}mm`, `height:${n(el.h)}mm`];
  if (el.rotation) base.push(`transform:rotate(${n(el.rotation)}deg)`, 'transform-origin:center');
  switch (el.type) {
    case 'line': {
      const thick = n(el.thickness, 0.75);
      const color = el.color || '#000';
      const vertical = el.orientation === 'vertical';
      base.push('display:block');
      base.push(vertical ? `border-left:${thick}pt ${el.lineStyle || 'solid'} ${color}` : `border-top:${thick}pt ${el.lineStyle || 'solid'} ${color}`);
      return base.join(';');
    }
    case 'rect':
    case 'ellipse': {
      const bw = n(el.borderWidth, 0.75);
      base.push(`border:${bw}pt ${el.lineStyle || 'solid'} ${el.borderColor || '#000'}`);
      if (el.fill) base.push(`background:${el.fill}`);
      base.push(el.type === 'ellipse' ? 'border-radius:50%' : `border-radius:${n(el.radius)}mm`);
      return base.join(';');
    }
    case 'image':
    case 'barcode':
      return base.join(';') + ';' + boxCss({ ...st, padding: st.padding ?? 0 });
    case 'table':
      return base.join(';') + ';' + textCss(st);
    default:
      return base.join(';') + ';' + textCss(st) + ';' + boxCss(st) + `;display:flex;flex-direction:column;justify-content:${VALIGN[st.valign] || 'flex-start'}`;
  }
}

/** Full positioned element HTML. */
export function elementHtml(el, scope, ctx) {
  if (!isVisible(el, scope, ctx)) return '';
  const attrs = [`class="fd-el fd-${el.type}"`, `data-id="${escapeHtml(el.id)}"`, `style="${escapeHtml(elementOuterCss(el))}"`];
  if (el.showOn && el.showOn !== 'all') attrs.push(`data-show-on="${escapeHtml(el.showOn)}"`);
  if (el.type === 'table' || el.type === 'richtext') {
    if (el.overflow === 'paginate') {
      attrs.push('data-flow="1"');
      if (el.continueTop !== undefined && el.continueTop !== null && el.continueTop !== '') attrs.push(`data-ctop="${n(el.continueTop)}"`);
      if (el.continueHeight) attrs.push(`data-cheight="${n(el.continueHeight)}"`);
    }
  }
  const inner = elementInnerHtml(el, scope, ctx);
  const wrap = ['text', 'field', 'computed'].includes(el.type) ? `<div class="fd-in">${inner}</div>` : inner;
  return `<div ${attrs.join(' ')}>${wrap}</div>`;
}

export const BASE_CSS = `
.fd-page{position:relative;overflow:hidden;background:#fff;box-sizing:border-box}
.fd-el{position:absolute;box-sizing:border-box;overflow:hidden;white-space:normal;word-wrap:break-word;overflow-wrap:break-word}
.fd-el.fd-table,.fd-el.fd-richtext{overflow:hidden}
.fd-in{white-space:pre-wrap}
.fd-richtext p{margin:0 0 .35em}
.fd-richtext table{border-collapse:collapse}
.fd-richtext td,.fd-richtext th{border:0.5pt solid #000;padding:1mm 1.5mm;vertical-align:top}
.fd-richtext h1{font-size:1.6em;margin:0 0 .3em}.fd-richtext h2{font-size:1.35em;margin:0 0 .3em}.fd-richtext h3{font-size:1.15em;margin:0 0 .3em}
.fd-richtext ul,.fd-richtext ol{margin:0 0 .35em;padding-inline-start:1.4em}
.fd-tbl tr{break-inside:avoid}
.fd-ph{color:#7a869a;font-style:italic}
.fd-barcode svg{width:100%;height:100%;display:block}
`;
