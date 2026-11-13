#!/usr/bin/env node
// Render a PDF without the HTTP server.
//   node cli/render.js --template 1001 --data invoice.xml --out invoice.pdf
//   node cli/render.js --template-file my-template.json --data data.json --out out.pdf
//   node cli/render.js --template 1001 --data-dir ./invoices --out-dir ./pdf [--file-name "invoice-{{number}}"]
import fs from 'node:fs';
import path from 'node:path';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=');
    args[k] = v !== undefined ? v : process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true;
  }
}

if (args.help || (!args.template && !args['template-file'])) {
  console.log(`Usage:
  form-render --template <id> --data-dir <folder of .xml/.json> --out-dir <folder> [--file-name "inv-{{number}}"] [--merged all.pdf]
  form-render --template <id> --data <file.xml|file.json|-> --out <file.pdf> [--lang en] [--storage <dir>]
  form-render --template-file <template.json> --data <file> --out <file.pdf>`);
  process.exit(args.help ? 0 : 1);
}
if (args.storage) process.env.FD_STORAGE = path.resolve(args.storage);

const { getTemplate } = await import('../server/storage.js');
const { renderPdf, closeBrowser } = await import('../server/render/pdf.js');

try {
  const template = args['template-file'] ? JSON.parse(fs.readFileSync(args['template-file'], 'utf8')) : getTemplate(String(args.template));
  const { decodeBytes } = await import('../shared/encoding.js');
  if (args['data-dir']) {
    // bulk: every .xml / .json file in the folder is one record
    const { renderBatch, mergePdfs } = await import('../server/batch.js');
    const files = fs.readdirSync(args['data-dir']).filter((f) => /\.(xml|json)$/i.test(f)).sort();
    const records = files.map((f) => decodeBytes(fs.readFileSync(path.join(args['data-dir'], f))));
    const outDir = args['out-dir'] || 'out';
    fs.mkdirSync(outDir, { recursive: true });
    const started = Date.now();
    let done = 0;
    const results = await renderBatch(template, records, {
      format: args.format, lang: args.lang,
      fileName: args['file-name'] || '',
      onResult: (r) => {
        done++;
        if (r.ok) fs.writeFileSync(path.join(outDir, args['file-name'] ? r.fileName : files[r.index].replace(/\.(xml|json)$/i, '.pdf')), r.pdf);
        else console.warn(`${files[r.index]}: ${r.error}`);
        if (done % 50 === 0 || done === records.length) process.stdout.write(`\r${done}/${records.length}`);
      },
    });
    if (args.merged) fs.writeFileSync(args.merged, await mergePdfs(results));
    const ok = results.filter((r) => r.ok).length;
    console.log(`\n${ok} PDF(s) in ${outDir}, ${results.length - ok} failed, ${((Date.now() - started) / 1000).toFixed(1)}s`);
    if (ok < results.length) process.exitCode = 2;
  } else {
    const data = !args.data ? '{}' : decodeBytes(fs.readFileSync(args.data === '-' ? 0 : args.data));
    const { pdf, errors, pages } = await renderPdf(template, data, { format: args.format, lang: args.lang });
    const out = args.out || `${template.id || 'out'}.pdf`;
    fs.writeFileSync(out, pdf);
    console.log(`${out}: ${pages} page(s)`);
    for (const e of errors) console.warn('warning:', e);
  }
} catch (e) {
  console.error('error:', e.message);
  process.exitCode = 1;
} finally {
  await closeBrowser();
}
