// Worker thread: decode + parse the data and build the document HTML, so large
// XML (tens of MB) never blocks the HTTP server's event loop.
import { parentPort } from 'node:worker_threads';
import { parseData } from '../data.js';
import { buildDocumentHtml } from './html.js';
import { decodeBytes } from '../../shared/encoding.js';
import { interpolate, makeScope } from '../../shared/expr.js';
import { formatValue } from '../../shared/format.js';

parentPort.on('message', ({ id, template, data, charset, format, lang, namePattern, index }) => {
  try {
    let input = data;
    if (input instanceof Uint8Array) input = decodeBytes(Buffer.from(input.buffer, input.byteOffset, input.byteLength), charset);
    const obj = typeof input === 'string' ? parseData(input, { format, arrays: template.schema?.arrays || [] }) : input || {};
    const out = buildDocumentHtml(template, obj, { lang });
    // file name for bulk rendering, from a pattern over the data ("invoice-{{number}}")
    let name = '';
    if (namePattern) {
      try { name = interpolate(String(namePattern), makeScope({ ...obj, $index: (index ?? 0) + 1 }), { escape: (v) => formatValue(v) }); } catch { name = ''; }
    }
    parentPort.postMessage({ id, ok: true, html: out.html, errors: out.errors, width: out.width, height: out.height, name });
  } catch (e) {
    parentPort.postMessage({ id, ok: false, message: e.message, status: e.status });
  }
});
