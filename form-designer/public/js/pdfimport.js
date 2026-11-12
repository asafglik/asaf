// PDF pages -> template pages with the original page as a vector background.
// pdf.js renders the pages for the design canvas; the server lays the original
// PDF page under the generated content when printing.
import { state, emit } from './state.js';
import { base64ToBytes } from './util.js';

let pdfjs = null;
async function lib() {
  if (!pdfjs) {
    pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  }
  return pdfjs;
}

let docCache = { b64: null, doc: null };
async function getDoc(b64) {
  if (docCache.b64 === b64 && docCache.doc) return docCache.doc;
  const { getDocument } = await lib();
  const doc = await getDocument({ data: base64ToBytes(b64) }).promise;
  docCache = { b64, doc };
  return doc;
}

/** Page count and size (mm) of a PDF given as base64. */
export async function inspectPdf(b64) {
  const doc = await getDoc(b64);
  const p = await doc.getPage(1);
  const vp = p.getViewport({ scale: 1 });
  return { pages: doc.numPages, widthMm: (vp.width * 25.4) / 72, heightMm: (vp.height * 25.4) / 72 };
}

const pending = new Set();
/** Render background images for the canvas (cached in state.bgImages). */
export async function ensureBackground(pageIndex) {
  if (!state.sourcePdf || state.bgImages[pageIndex] || pending.has(pageIndex)) return;
  pending.add(pageIndex);
  try {
    const doc = await getDoc(state.sourcePdf);
    if (pageIndex >= doc.numPages) return;
    const page = await doc.getPage(pageIndex + 1);
    const vp = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width;
    canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    state.bgImages[pageIndex] = canvas.toDataURL('image/png');
    emit('bg');
  } catch (e) {
    console.error(e);
  } finally {
    pending.delete(pageIndex);
  }
}

/**
 * Material for the design agent: page images, text with positions (mm, top-left
 * origin) and existing PDF form fields of the source PDF.
 */
export async function analyzePdf(b64, maxPages = 8) {
  const doc = await getDoc(b64);
  const out = [];
  const MMPT = 25.4 / 72;
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const page = await doc.getPage(i);
    const vp1 = page.getViewport({ scale: 1 });
    // image (JPEG keeps the request small)
    const scale = Math.min(2, 1600 / Math.max(vp1.width, vp1.height));
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width;
    canvas.height = vp.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const image = canvas.toDataURL('image/jpeg', 0.82);
    // text
    const tc = await page.getTextContent();
    const texts = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const [x, y] = vp1.convertToViewportPoint(it.transform[4], it.transform[5]);
      const h = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
      texts.push({ str: it.str.trim(), x: x * MMPT, y: (y - h) * MMPT, w: it.width * MMPT, h: h * MMPT });
    }
    // existing AcroForm fields
    const fields = [];
    for (const a of await page.getAnnotations()) {
      if (a.subtype !== 'Widget' || !a.rect) continue;
      const [x1, y1] = vp1.convertToViewportPoint(a.rect[0], a.rect[1]);
      const [x2, y2] = vp1.convertToViewportPoint(a.rect[2], a.rect[3]);
      const type = a.fieldType === 'Sig' ? 'signature' : a.checkBox || a.radioButton ? 'checkbox' : a.fieldType === 'Ch' ? 'choice' : 'text';
      fields.push({ name: a.fieldName || '', type, x: Math.min(x1, x2) * MMPT, y: Math.min(y1, y2) * MMPT, w: Math.abs(x2 - x1) * MMPT, h: Math.abs(y2 - y1) * MMPT, value: a.fieldValue || '' });
    }
    out.push({ image, width: vp1.width * MMPT, height: vp1.height * MMPT, texts, fields });
  }
  return out;
}
