// Template + data -> printable HTML document (one .fd-page per template page;
// the paginator adds continuation pages for long tables / rich text).
import { elementHtml, BASE_CSS, PAGE_SIZES, escapeHtml, bandElements } from '../../shared/elements.js';
import { scopeFor } from '../../shared/expr.js';
import { sanitizeTemplate } from '../sanitize.js';
import { barcodeSvg } from '../barcode.js';
import { fontsCssForTemplate } from '../fonts.js';

export function pageSize(template) {
  const p = template.page || {};
  let [w, h] = PAGE_SIZES[p.size] || [Number(p.width) || 210, Number(p.height) || 297];
  if (p.size === 'custom' || !PAGE_SIZES[p.size]) {
    w = Number(p.width) || 210;
    h = Number(p.height) || 297;
  }
  if (p.orientation === 'landscape' && w < h) [w, h] = [h, w];
  return { width: w, height: h };
}

export function buildDocumentHtml(template, data, { fontsCss } = {}) {
  template = sanitizeTemplate(template);
  const { width, height } = pageSize(template);
  const errors = [];
  const ctx = { design: false, errors, barcode: barcodeSvg };
  const scope = scopeFor(data);
  const bands = bandElements(template, height);
  const pages = (template.pages || []).map((pg, i) => {
    const bg = pg.background || null;
    const pdfBg = bg && bg.type === 'pdf' && template.sourcePdf;
    let bgHtml = '';
    if (bg && bg.type === 'image' && bg.src) {
      bgHtml = `<img class="fd-bg" src="${escapeHtml(bg.src)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:fill" alt="">`;
    }
    let els = (pg.elements || []).map((el) => elementHtml(el, scope, ctx)).join('');
    if (!pg.noBands) {
      els += bands.map((b) => {
        const h = elementHtml(b.el, scope, ctx);
        return h ? h.replace('<div ', `<div data-band="${b.band}" data-doc-show="${b.docShow}" `) : '';
      }).join('');
    }
    const style = `width:${width}mm;height:${height}mm;${pdfBg ? 'background:transparent' : `background:${pg.color || '#fff'}`}`;
    return `<section class="fd-page" data-tpl-page="${i}" style="${style}">${bgHtml}${els}</section>`;
  });
  const css = fontsCss ?? fontsCssForTemplate(template);
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<style>${css}</style>
<style>
@page{size:${width}mm ${height}mm;margin:0}
html,body{margin:0;padding:0;background:transparent}
body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.fd-page{break-after:page;page-break-after:always}
.fd-page:last-child{break-after:auto;page-break-after:auto}
${BASE_CSS}
</style></head><body>${pages.join('')}</body></html>`;
  return { html, errors, width, height };
}
