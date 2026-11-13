// HTML -> PDF with headless Chrome/Chromium/Edge, then (for templates built
// from an uploaded PDF/Word file) the original pages are laid underneath the
// generated content with pdf-lib, keeping them as sharp vector graphics.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { PDFDocument, degrees } from 'pdf-lib';
import { config } from '../config.js';
import { paginate } from './paginate.js';
import { buildDocumentHtml } from './html.js';
import { parseData } from '../data.js';

function chromeCandidates() {
  const c = [];
  if (config.chromePath) c.push(config.chromePath);
  if (process.platform === 'win32') {
    const pf = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    for (const base of pf) {
      c.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      c.push(path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      c.push(path.join(base, 'Chromium', 'Application', 'chrome.exe'));
    }
  } else if (process.platform === 'darwin') {
    c.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    c.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    c.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    c.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium');
  }
  // browsers downloaded by "npx puppeteer browsers install chrome" or Playwright
  const caches = [path.join(os.homedir(), '.cache', 'puppeteer', 'chrome'), '/opt/pw-browsers', path.join(os.homedir(), '.cache', 'ms-playwright')];
  for (const base of caches) {
    try {
      for (const v of fs.readdirSync(base)) {
        if (!/^(chromium|chrome|linux|win|mac)/.test(v)) continue;
        for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
          c.push(path.join(base, v, sub));
        }
        try {
          for (const sub2 of fs.readdirSync(path.join(base, v))) {
            c.push(path.join(base, v, sub2, 'chrome'), path.join(base, v, sub2, 'chrome.exe'));
          }
        } catch { /* not a directory */ }
      }
    } catch { /* no cache */ }
  }
  return c;
}

export function findChrome() {
  for (const p of chromeCandidates()) {
    try {
      if (p && fs.statSync(p).isFile()) return p;
    } catch { /* try next */ }
  }
  return null;
}

let browserPromise = null;

async function getBrowser() {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    if (b && b.connected) return b;
    browserPromise = null;
  }
  const executablePath = findChrome();
  if (!executablePath) {
    throw Object.assign(new Error('לא נמצא דפדפן Chrome/Chromium/Edge בשרת. התקינו Chrome או הגדירו CHROME_PATH.'), { status: 503 });
  }
  browserPromise = puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--font-render-hinting=none', '--disable-extensions',
      '--disable-background-networking', '--disable-sync', '--no-first-run', '--disable-webrtc',
      // no route to any network (including WebSocket / loopback) unless remote images are allowed
      ...(config.allowRemoteImages ? [] : ['--proxy-server=127.0.0.1:9', '--proxy-bypass-list=<-loopback>']),
    ],
  });
  const b = await browserPromise;
  b.on('disconnected', () => { browserPromise = null; });
  return b;
}

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    browserPromise = null;
    if (b) await b.close().catch(() => {});
  }
}

// simple semaphore so a burst of requests does not open unlimited tabs
let active = 0;
const waiting = [];
async function acquire() {
  if (active < config.maxConcurrent && !waiting.length) { active++; return; }
  if (waiting.length >= config.maxQueue) throw Object.assign(new Error('השרת עמוס, נסו שוב בעוד רגע'), { status: 503 });
  await new Promise((r) => waiting.push(r)); // the slot is handed over by release()
}

/** Run fn(page) on a fresh tab with scripts off, closing it after at most renderTimeoutMs. */
async function withPage(width, height, fn) {
  await acquire();
  let page;
  let timer;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      if (u.startsWith('data:') || u === 'about:blank' || (config.allowRemoteImages && /^https?:/i.test(u) && req.resourceType() === 'image')) req.continue();
      else req.abort();
    });
    await page.setViewport({ width: Math.ceil(width * 3.78) + 2, height: Math.ceil(height * 3.78) + 2 });
    const deadline = new Promise((_, rej) => {
      timer = setTimeout(() => rej(Object.assign(new Error('זמן ההפקה חרג מהמותר'), { status: 504 })), config.renderTimeoutMs);
    });
    return await Promise.race([fn(page), deadline]);
  } finally {
    clearTimeout(timer);
    if (page) {
      const closed = await Promise.race([page.close().then(() => true, () => false), new Promise((r) => setTimeout(() => r(false), 5000))]);
      if (!closed) await closeBrowser(); // stuck tab: restart the browser
    }
    release();
  }
}
function release() {
  const n = waiting.shift();
  if (n) n(); // hand the slot to the next waiter (active stays the same)
  else active--;
}

async function htmlToPdf(html, width, height) {
  return withPage(width, height, async (page) => {
    await page.setContent(html, { waitUntil: 'load', timeout: config.renderTimeoutMs });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const { map, placeholders, warnings } = await page.evaluate(paginate);
    const pdf = await page.pdf({
      width: `${width}mm`,
      height: `${height}mm`,
      printBackground: true,
      omitBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      timeout: config.renderTimeoutMs,
    });
    return { pdf: Buffer.from(pdf), map, placeholders, warnings };
  });
}

const PT = 72 / 25.4;

async function mergeBackgrounds(template, overlayBytes, map, width, height) {
  const usesPdf = (template.pages || []).some((p) => p.background && p.background.type === 'pdf');
  if (!usesPdf || !template.sourcePdf) return overlayBytes;
  const out = await PDFDocument.create();
  const src = await PDFDocument.load(Buffer.from(template.sourcePdf, 'base64'), { ignoreEncryption: true });
  const overlay = await PDFDocument.load(overlayBytes);
  const bgCache = new Map();
  const ovPages = await out.embedPdf(overlay, overlay.getPageIndices());
  const w = width * PT;
  const h = height * PT;
  for (let i = 0; i < ovPages.length; i++) {
    const tpl = (template.pages || [])[map[i]] || {};
    const bg = tpl.background;
    const page = out.addPage([w, h]);
    if (bg && bg.type === 'pdf' && bg.pageIndex < src.getPageCount()) {
      let cached = bgCache.get(bg.pageIndex);
      if (cached === undefined) {
        const sp = src.getPage(bg.pageIndex);
        if (!sp.node.Contents()) cached = null; // blank source page: nothing to draw
        else {
          // only the visible (crop) area, and honour the page rotation like PDF viewers do
          const cb = sp.getCropBox();
          const emb = await out.embedPage(sp, { left: cb.x, bottom: cb.y, right: cb.x + cb.width, top: cb.y + cb.height });
          cached = { emb, rot: ((sp.getRotation().angle % 360) + 360) % 360 };
        }
        bgCache.set(bg.pageIndex, cached);
      }
      if (cached) {
        const { emb, rot } = cached;
        const place = rot === 90 ? { x: 0, y: h, width: h, height: w, rotate: degrees(-90) }
          : rot === 180 ? { x: w, y: h, width: w, height: h, rotate: degrees(180) }
            : rot === 270 ? { x: w, y: 0, width: h, height: w, rotate: degrees(90) }
              : { x: 0, y: 0, width: w, height: h };
        page.drawPage(emb, place);
      }
    }
    page.drawPage(ovPages[i], { x: 0, y: 0, width: w, height: h });
  }
  return Buffer.from(await out.save());
}

/**
 * Render a template with data (object, or XML/JSON text) to a PDF buffer.
 * Returns { pdf, errors, pages }.
 */
export async function renderPdf(template, data, { format, lang } = {}) {
  const obj = typeof data === 'string' || Buffer.isBuffer(data)
    ? parseData(data, { format, arrays: template.schema?.arrays || [] })
    : data || {};
  const { html, errors, width, height } = buildDocumentHtml(template, obj, { lang });
  const { pdf, map, placeholders: phMm, warnings } = await htmlToPdf(html, width, height);
  errors.push(...warnings);
  // positions in mm (top-left origin) and in PDF points (bottom-left origin)
  const placeholders = phMm.map((p) => ({
    name: p.name, baseName: p.baseName, type: p.type, label: p.label, required: p.required, page: p.page,
    mm: { x: p.x, y: p.y, width: p.width, height: p.height },
    pdf: { x: +(p.x * PT).toFixed(2), y: +((height - p.y - p.height) * PT).toFixed(2), width: +(p.width * PT).toFixed(2), height: +(p.height * PT).toFixed(2) },
  }));
  let out = await mergeBackgrounds(template, pdf, map, width, height);
  if (out === pdf) {
    // set document metadata on the plain output as well
    const doc = await PDFDocument.load(pdf);
    doc.setTitle(template.name || `Template ${template.id}`);
    doc.setCreator('Form Designer');
    doc.setProducer('Form Designer');
    out = Buffer.from(await doc.save());
  }
  return { pdf: out, errors, pages: map.length, placeholders };
}

export async function renderHtml(template, data, { format } = {}) {
  const obj = typeof data === 'string' ? parseData(data, { format, arrays: template.schema?.arrays || [] }) : data || {};
  return buildDocumentHtml(template, obj);
}

/** Screenshot of one designed page with data (for the design agent). JPEG data URL. */
export async function renderPageImage(template, data, pageIndex = 0) {
  const obj = typeof data === 'string' ? parseData(data, { arrays: template.schema?.arrays || [] }) : data || {};
  const t = { ...template, pages: template.pages.map((p, i) => (i === pageIndex ? p : { ...p, elements: [] })) };
  const { html, width, height } = buildDocumentHtml(t, obj);
  return withPage(width, height, async (page) => {
    await page.setContent(html, { waitUntil: 'load', timeout: config.renderTimeoutMs });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const el = (await page.$$('.fd-page'))[pageIndex];
    if (!el) return null;
    await el.evaluate((n) => { n.style.background = '#fff'; });
    const buf = await el.screenshot({ type: 'jpeg', quality: 80 });
    return 'data:image/jpeg;base64,' + Buffer.from(buf).toString('base64');
  });
}
