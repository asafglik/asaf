// Reads the structure of a PDF page with pdf.js: texts (logical order, position,
// size, bold), existing form fields, and drawn lines / boxes. Used by the
// designer (browser) and by tests (Node). Units: mm from the top-left corner.

const MMPT = 25.4 / 72;
const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 };

function mul(m, n) {
  // m x n (PDF matrices [a b c d e f])
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function colorHex(args) {
  const a = args && args[0];
  if (typeof a === 'string') return a.startsWith('#') ? a : `#${a}`;
  if (args && args.length >= 3 && args.every((v) => typeof v === 'number')) {
    return '#' + args.slice(0, 3).map((v) => Math.round(v > 1 ? v : v * 255).toString(16).padStart(2, '0')).join('');
  }
  return '#000000';
}

/** Lines and rectangles drawn on the page (axis-aligned only). */
async function shapesOf(pdfjs, page, vp) {
  const OPS = pdfjs.OPS;
  const ops = await page.getOperatorList();
  const paint = new Set([OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const fills = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const strokes = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let gs = { stroke: '#000000', fill: '#000000', lw: 1 };
  const gsStack = [];
  const out = [];
  const toMm = (x, y) => {
    const [ux, uy] = apply(ctm, x, y);
    const [vx, vy] = vp.convertToViewportPoint(ux, uy);
    return [vx * MMPT, vy * MMPT];
  };
  for (let i = 0; i < ops.fnArray.length && out.length < 1500; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.save) { stack.push(ctm); gsStack.push({ ...gs }); }
    else if (fn === OPS.restore) { ctm = stack.pop() || ctm; gs = gsStack.pop() || gs; }
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.setStrokeRGBColor) gs.stroke = colorHex(args);
    else if (fn === OPS.setFillRGBColor) gs.fill = colorHex(args);
    else if (fn === OPS.setLineWidth) gs.lw = args[0];
    else if (fn === OPS.constructPath) {
      const [paintOp, list] = args;
      if (!paint.has(paintOp) || !list) continue;
      for (const data of list) {
        const pts = [];
        let curved = false;
        for (let j = 0; j < data.length;) {
          const op = data[j];
          if (op === DRAW.moveTo || op === DRAW.lineTo) { pts.push([data[j + 1], data[j + 2]]); j += 3; }
          else if (op === DRAW.curveTo) { curved = true; j += 7; }
          else if (op === DRAW.quadraticCurveTo) { curved = true; j += 5; }
          else j += 1;
        }
        if (curved || pts.length < 2) continue;
        const mm = pts.map(([x, y]) => toMm(x, y));
        const xs = mm.map((p) => p[0]);
        const ys = mm.map((p) => p[1]);
        const x0 = Math.min(...xs);
        const x1 = Math.max(...xs);
        const y0 = Math.min(...ys);
        const y1 = Math.max(...ys);
        const lwMm = Math.max(0.1, Math.abs(gs.lw * (ctm[0] || 1)) * MMPT);
        const lwPt = Math.round((lwMm / MMPT) * 100) / 100;
        if (mm.length === 2 || (y1 - y0 < 0.6 || x1 - x0 < 0.6)) {
          if (x1 - x0 < 1 && y1 - y0 < 1) continue;
          out.push({ kind: 'line', x: x0, y: y0, w: x1 - x0, h: y1 - y0, color: gs.stroke, width: lwPt, fill: fills.has(paintOp) ? gs.fill : null });
        } else if (mm.length >= 4) {
          out.push({ kind: 'rect', x: x0, y: y0, w: x1 - x0, h: y1 - y0, stroke: strokes.has(paintOp) ? gs.stroke : null, fill: fills.has(paintOp) ? gs.fill : null, width: lwPt });
        }
      }
    }
  }
  return out;
}

/**
 * Analyze a pdf.js document. renderImage(page) (optional) returns a data URL.
 * Returns [{ width, height, texts, fields, shapes, image }] (mm).
 */
export async function analyzeDocument(pdfjs, doc, { maxPages = 12, renderImage = null, shapes = true } = {}) {
  const out = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const texts = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      const size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
      texts.push({
        str: it.str.replace(/\s+/g, ' ').trim(), x: x * MMPT, y: (y - size) * MMPT, w: it.width * MMPT, h: size * MMPT,
        size: Math.round(size * 10) / 10, font: it.fontName, dir: it.dir,
      });
    }
    // bold: fonts whose glyphs are clearly wider than the narrowest font at the same size
    const ratio = {};
    for (const t of texts) {
      if (t.str.length < 3) continue;
      (ratio[t.font] = ratio[t.font] || []).push(t.w / MMPT / (t.str.length * t.size));
    }
    const med = (a) => a.slice().sort((p, q) => p - q)[Math.floor(a.length / 2)];
    const r = Object.fromEntries(Object.entries(ratio).map(([f, a]) => [f, med(a)]));
    const minR = Math.min(...Object.values(r));
    for (const t of texts) t.bold = !!(r[t.font] && r[t.font] > minR * 1.06);

    const fields = [];
    for (const a of await page.getAnnotations()) {
      if (a.subtype !== 'Widget' || !a.rect) continue;
      const [x1, y1] = vp.convertToViewportPoint(a.rect[0], a.rect[1]);
      const [x2, y2] = vp.convertToViewportPoint(a.rect[2], a.rect[3]);
      const type = a.fieldType === 'Sig' ? 'signature' : a.checkBox || a.radioButton ? 'checkbox' : a.fieldType === 'Ch' ? 'choice' : 'text';
      fields.push({ name: a.fieldName || '', type, x: Math.min(x1, x2) * MMPT, y: Math.min(y1, y2) * MMPT, w: Math.abs(x2 - x1) * MMPT, h: Math.abs(y2 - y1) * MMPT, value: a.fieldValue || '' });
    }
    let shapeList = [];
    if (shapes) {
      try { shapeList = await shapesOf(pdfjs, page, vp); } catch { shapeList = []; }
    }
    const image = renderImage ? await renderImage(page) : undefined;
    out.push({ width: vp.width * MMPT, height: vp.height * MMPT, texts, fields, shapes: shapeList, image });
  }
  return out;
}
