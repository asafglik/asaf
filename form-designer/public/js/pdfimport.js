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
