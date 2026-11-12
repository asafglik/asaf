// HTML -> PDF with headless Chrome/Chromium/Edge, then (for templates built
// from an uploaded PDF/Word file) the original pages are laid underneath the
// generated content with pdf-lib, keeping them as sharp vector graphics.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { PDFDocument } from 'pdf-lib';
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
    throw new Error('לא נמצא דפדפן Chrome/Chromium/Edge בשרת. התקינו Chrome או הגדירו CHROME_PATH.');
  }
  browserPromise = puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--font-render-hinting=none', '--disable-extensions'],
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
  if (active < config.maxConcurrent) { active++; return; }
  await new Promise((r) => waiting.push(r));
  active++;
}
function release() {
  active--;
  const n = waiting.shift();
  if (n) n();
}

async function htmlToPdf(html, width, height) {
  await acquire();
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      if (u.startsWith('data:') || u === 'about:blank' || (config.allowRemoteImages && /^https?:/i.test(u) && req.resourceType() === 'image')) req.continue();
      else req.abort();
    });
    await page.setViewport({ width: Math.ceil(width * 3.78) + 2, height: Math.ceil(height * 3.78) + 2 });
    await page.setContent(html, { waitUntil: 'load', timeout: 60000 });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const { map, placeholders } = await page.evaluate(paginate);
    const pdf = await page.pdf({
      width: `${width}mm`,
      height: `${height}mm`,
      printBackground: true,
      omitBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      timeout: 120000,
    });
    return { pdf: Buffer.from(pdf), map, placeholders };
  } finally {
    if (page) await page.close().catch(() => {});
    release();
  }
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
      let emb = bgCache.get(bg.pageIndex);
      if (!emb) {
        [emb] = await out.embedPdf(src, [bg.pageIndex]);
        bgCache.set(bg.pageIndex, emb);
      }
      page.drawPage(emb, { x: 0, y: 0, width: w, height: h });
    }
    page.drawPage(ovPages[i], { x: 0, y: 0, width: w, height: h });
  }
  return Buffer.from(await out.save());
}

/**
 * Render a template with data (object, or XML/JSON text) to a PDF buffer.
 * Returns { pdf, errors, pages }.
 */
export async function renderPdf(template, data, { format } = {}) {
  const obj = typeof data === 'string' || Buffer.isBuffer(data)
    ? parseData(String(data), { format, arrays: template.schema?.arrays || [] })
    : data || {};
  const { html, errors, width, height } = buildDocumentHtml(template, obj);
  const { pdf, map, placeholders: phMm } = await htmlToPdf(html, width, height);
  // positions in mm (top-left origin) and in PDF points (bottom-left origin)
  const placeholders = phMm.map((p) => ({
    name: p.name, type: p.type, label: p.label, required: p.required, page: p.page,
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
  await acquire();
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => (req.url().startsWith('data:') || req.url() === 'about:blank' ? req.continue() : req.abort()));
    await page.setViewport({ width: Math.ceil(width * 3.78), height: Math.ceil(height * 3.78), deviceScaleFactor: 1.5 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const el = (await page.$$('.fd-page'))[pageIndex];
    if (!el) return null;
    await el.evaluate((n) => { n.style.background = '#fff'; });
    const buf = await el.screenshot({ type: 'jpeg', quality: 80 });
    return 'data:image/jpeg;base64,' + Buffer.from(buf).toString('base64');
  } finally {
    if (page) await page.close().catch(() => {});
    release();
  }
}
