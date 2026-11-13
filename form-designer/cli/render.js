#!/usr/bin/env node
// Render a PDF without the HTTP server.
//   node cli/render.js --template 1001 --data invoice.xml --out invoice.pdf
//   node cli/render.js --template-file my-template.json --data data.json --out out.pdf
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
  const data = !args.data ? '{}' : decodeBytes(fs.readFileSync(args.data === '-' ? 0 : args.data));
  const { pdf, errors, pages } = await renderPdf(template, data, { format: args.format, lang: args.lang });
  const out = args.out || `${template.id || 'out'}.pdf`;
  fs.writeFileSync(out, pdf);
  console.log(`${out}: ${pages} page(s)`);
  for (const e of errors) console.warn('warning:', e);
} catch (e) {
  console.error('error:', e.message);
  process.exitCode = 1;
} finally {
  await closeBrowser();
}
