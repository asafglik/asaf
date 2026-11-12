// Server-side cleaning of templates: rich text HTML is reduced to an
// allow-list of formatting tags, and every value that ends up in CSS is
// stripped of characters that could break out of a style declaration.
import sanitizeHtml from 'sanitize-html';
import { cleanElement } from '../shared/elements.js';

const RICH = {
  allowedTags: ['p', 'div', 'span', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sub', 'sup', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'colgroup', 'col', 'blockquote', 'hr', 'img', 'a'],
  allowedAttributes: {
    '*': ['style', 'dir', 'align', 'colspan', 'rowspan', 'width'],
    img: ['src', 'alt', 'width', 'height', 'style'],
    a: ['href'],
    font: ['color', 'face', 'size'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['data'] },
  allowedStyles: {
    '*': {
      color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i],
      'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i],
      'font-size': [/^[\d.]+(pt|px|em|rem|%)$/, /^(x{0,2}-?small|medium|x{0,3}-?large)$/],
      'font-family': [/^[\p{L}\p{N}\s,'"-]+$/u],
      'font-weight': [/^(bold|normal|[1-9]00)$/],
      'font-style': [/^(italic|normal)$/],
      'text-decoration': [/^[a-z\s-]+$/],
      'text-decoration-line': [/^[a-z\s-]+$/],
      'text-align': [/^(left|right|center|justify|start|end)$/],
      direction: [/^(rtl|ltr)$/],
      'line-height': [/^[\d.]+(pt|px|em|%)?$/],
      width: [/^[\d.]+(pt|px|mm|%)$/],
      'margin-right': [/^[\d.]+(pt|px|em)$/],
      'margin-left': [/^[\d.]+(pt|px|em)$/],
      'padding-right': [/^[\d.]+(pt|px|em)$/],
      'padding-left': [/^[\d.]+(pt|px|em)$/],
      'vertical-align': [/^(top|middle|bottom|baseline)$/],
    },
  },
  // keep {{placeholders}} untouched
  parser: { decodeEntities: true },
};

export function sanitizeRichHtml(html) {
  return sanitizeHtml(String(html || ''), RICH);
}

const FORMATS = new Set(['xml', 'json']);
const SHOW = new Set(['all', 'notFirst', 'firstOnly', 'notLast', 'lastOnly']);

function cleanList(list) {
  return (Array.isArray(list) ? list : []).filter((e) => e && typeof e === 'object').map((e) => {
    const c = cleanElement(e);
    if (c.type === 'richtext') c.html = sanitizeRichHtml(c.html);
    return c;
  });
}

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/** Normalize and clean a template before it is stored or rendered. */
export function sanitizeTemplate(t) {
  const out = { ...t };
  out.pages = (Array.isArray(t.pages) ? t.pages : []).map((p) => ({
    ...p,
    color: p.color ? cleanElement({ type: 'rect', fill: p.color }).fill : undefined,
    elements: cleanList(p.elements),
  }));
  for (const band of ['header', 'footer']) {
    if (!t[band]) continue;
    const b = t[band];
    out[band] = { enabled: b.enabled !== false, height: Math.max(0, Math.min(200, num(b.height, 20))), showOn: SHOW.has(b.showOn) ? b.showOn : 'all', elements: cleanList(b.elements) };
  }
  if (t.schema) {
    out.schema = {
      format: FORMATS.has(t.schema.format) ? t.schema.format : null,
      sample: typeof t.schema.sample === 'string' ? t.schema.sample : t.schema.sample ? JSON.stringify(t.schema.sample) : '',
      arrays: (Array.isArray(t.schema.arrays) ? t.schema.arrays : []).map(String),
    };
  }
  if (out.customers) out.customers = (Array.isArray(out.customers) ? out.customers : []).map(String);
  if (out.sourcePdf && typeof out.sourcePdf !== 'string') delete out.sourcePdf;
  for (const k of ['name', 'description']) if (out[k] !== undefined) out[k] = String(out[k]).slice(0, 500);
  return out;
}
