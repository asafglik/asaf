// Bulk rendering: many records with one template -> a ZIP of PDFs, one merged PDF,
// or JSON. Records run on the render pool (FD_MAX_CONCURRENT tabs) so a batch of
// thousands never overloads the server or hits the request queue limit.
import { PDFDocument } from 'pdf-lib';
import { renderPdf } from './render/pdf.js';
import { parseData } from './data.js';
import { config } from './config.js';
import { interpolate, makeScope } from '../shared/expr.js';
import { formatValue } from '../shared/format.js';

/** File name for one record from a pattern such as "invoice-{{invoice.number}}.pdf". */
export function recordFileName(pattern, data, index, used) {
  let name = '';
  if (pattern) {
    try {
      name = interpolate(String(pattern), makeScope({ ...data, $index: index + 1 }), { escape: (v) => formatValue(v) });
    } catch { name = ''; }
  }
  name = name.replace(/[^\p{L}\p{N}._ -]+/gu, '_').replace(/^[._ ]+/, '').slice(0, 150) || `${String(index + 1).padStart(5, '0')}`;
  if (!name.toLowerCase().endsWith('.pdf')) name += '.pdf';
  // names stay unique inside the ZIP
  let out = name;
  for (let i = 2; used.has(out.toLowerCase()); i++) out = name.replace(/\.pdf$/i, `_${i}.pdf`);
  used.add(out.toLowerCase());
  return out;
}

/**
 * Render every record. onResult(result) is called as each record finishes (in
 * completion order); the returned array is in input order.
 */
export async function renderBatch(template, records, { format, lang, fileName, concurrency, onResult } = {}) {
  const workers = Math.max(1, Math.min(Number(concurrency) || config.maxConcurrent, config.maxConcurrent, records.length));
  const used = new Set();
  const results = new Array(records.length);
  let next = 0;
  const one = async (i) => {
    const started = Date.now();
    let data;
    let name;
    try {
      const r = records[i];
      data = typeof r === 'string' ? parseData(r, { format, arrays: template.schema?.arrays || [] }) : r && typeof r === 'object' ? r : {};
      name = recordFileName(fileName, data, i, used);
      let out;
      for (let attempt = 0; ; attempt++) {
        try {
          out = await renderPdf(template, data, { lang });
          break;
        } catch (e) {
          // the shared queue is full (other requests): wait and try again
          if (e.status === 503 && attempt < 20) await new Promise((res) => setTimeout(res, 250 * (attempt + 1)));
          else throw e;
        }
      }
      return { index: i, fileName: name, ok: true, pages: out.pages, warnings: out.errors, placeholders: out.placeholders, pdf: out.pdf, ms: Date.now() - started };
    } catch (e) {
      return { index: i, fileName: name || recordFileName('', {}, i, used), ok: false, error: e.status && e.status < 500 ? e.message : e.status === 504 ? e.message : 'שגיאה בהפקה', ms: Date.now() - started };
    }
  };
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < records.length) {
      const i = next++;
      const r = await one(i);
      results[i] = r;
      if (onResult) await onResult(r);
    }
  }));
  return results;
}

/** One PDF with all records, in input order. */
export async function mergePdfs(results) {
  const doc = await PDFDocument.create();
  for (const r of results) {
    if (!r.ok) continue;
    const src = await PDFDocument.load(r.pdf);
    const pages = await doc.copyPages(src, src.getPageIndices());
    pages.forEach((p) => doc.addPage(p));
  }
  doc.setCreator('Form Designer');
  doc.setProducer('Form Designer');
  return Buffer.from(await doc.save());
}

export function manifestOf(template, results, ms) {
  return {
    templateId: template.id,
    count: results.length,
    ok: results.filter((r) => r?.ok).length,
    failed: results.filter((r) => r && !r.ok).length,
    ms,
    items: results.map((r) => (r.ok
      ? { index: r.index, fileName: r.fileName, ok: true, pages: r.pages, warnings: r.warnings, placeholders: r.placeholders }
      : { index: r.index, fileName: r.fileName, ok: false, error: r.error })),
  };
}

// ---------------------------------------------------------------- streaming ZIP (stored, no compression)
// PDFs are already compressed, so "store" keeps it fast. Entries are written as
// soon as each record finishes.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosTime(d = new Date()) {
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)) & 0xffff,
    date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff,
  };
}

export class ZipWriter {
  constructor(write) {
    this.write = write; // (Buffer) => Promise|void
    this.offset = 0;
    this.entries = [];
  }

  async add(name, data) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const { time, date } = dosTime();
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6); // UTF-8 names
    h.writeUInt16LE(0, 8); // stored
    h.writeUInt16LE(time, 10);
    h.writeUInt16LE(date, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(nameBuf.length, 26);
    h.writeUInt16LE(0, 28);
    this.entries.push({ nameBuf, crc, size: data.length, offset: this.offset, time, date });
    await this.write(Buffer.concat([h, nameBuf]));
    await this.write(data);
    this.offset += 30 + nameBuf.length + data.length;
  }

  async finish() {
    const parts = [];
    let size = 0;
    for (const e of this.entries) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(20, 4);
      c.writeUInt16LE(20, 6);
      c.writeUInt16LE(0x0800, 8);
      c.writeUInt16LE(0, 10);
      c.writeUInt16LE(e.time, 12);
      c.writeUInt16LE(e.date, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(e.size, 20);
      c.writeUInt32LE(e.size, 24);
      c.writeUInt16LE(e.nameBuf.length, 28);
      c.writeUInt32LE(e.offset, 42);
      parts.push(c, e.nameBuf);
      size += 46 + e.nameBuf.length;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(this.offset, 16);
    await this.write(Buffer.concat([...parts, end]));
  }
}
