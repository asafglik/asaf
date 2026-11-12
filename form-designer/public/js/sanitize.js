// Browser-side allow-list cleaning of rich text HTML (templates loaded from a
// file, Word import, or produced by the design agent) before it is shown.
const TAGS = new Set(['P', 'DIV', 'SPAN', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SUB', 'SUP', 'FONT', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'COLGROUP', 'COL', 'BLOCKQUOTE', 'HR', 'IMG', 'A']);
const ATTRS = new Set(['style', 'dir', 'align', 'colspan', 'rowspan', 'width', 'height', 'src', 'alt', 'href', 'color', 'face', 'size']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'TEMPLATE', 'SVG', 'MATH', 'NOSCRIPT', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'BASE', 'FRAME', 'FRAMESET']);

function cleanStyle(v) {
  return /url\s*\(|expression\s*\(|javascript:|@import|behavior\s*:/i.test(v) ? '' : v.replace(/[<>]/g, '');
}

function walk(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 8) { child.remove(); continue; } // comments
    if (child.nodeType !== 1) continue;
    if (DROP.has(child.tagName)) { child.remove(); continue; }
    if (!TAGS.has(child.tagName)) {
      walk(child);
      child.replaceWith(...child.childNodes); // keep the text, drop the tag
      continue;
    }
    for (const a of [...child.attributes]) {
      const name = a.name.toLowerCase();
      if (!ATTRS.has(name)) { child.removeAttribute(a.name); continue; }
      if (name === 'href' && !/^(https?:|mailto:)/i.test(a.value.trim())) child.removeAttribute(a.name);
      else if (name === 'src' && !/^(data:image\/(png|jpe?g|gif|webp);|https?:)/i.test(a.value.trim())) child.removeAttribute(a.name);
      else if (name === 'style') child.setAttribute('style', cleanStyle(a.value));
    }
    walk(child);
  }
}

export function sanitizeRichHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${String(html || '')}</body>`, 'text/html');
  walk(doc.body);
  return doc.body.innerHTML;
}

/** Clean the rich text of every element in a template (in place). */
export function sanitizeTemplateHtml(t) {
  for (const c of [...(t.pages || []), t.header, t.footer].filter(Boolean)) {
    for (const e of c.elements || []) if (e && e.type === 'richtext') e.html = sanitizeRichHtml(e.html);
  }
  return t;
}
