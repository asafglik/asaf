// Word import: as editable rich text (mammoth, always available) or as an
// exact page layout through LibreOffice -> PDF (when LibreOffice is installed).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import mammoth from 'mammoth';
import { config } from './config.js';
import { sanitizeRichHtml } from './sanitize.js';

export async function docxToHtml(buffer) {
  const result = await mammoth.convertToHtml(
    { buffer },
    {
      styleMap: [
        "p[style-name='Title'] => h1:fresh",
        "p[style-name='כותרת'] => h1:fresh",
        "p[style-name='כותרת 1'] => h1:fresh",
        "p[style-name='כותרת 2'] => h2:fresh",
        "p[style-name='כותרת 3'] => h3:fresh",
        'u => u',
      ],
    },
  );
  return { html: sanitizeRichHtml(result.value), messages: result.messages.map((m) => m.message).slice(0, 20) };
}

export function findSoffice() {
  const c = [];
  if (config.sofficePath) c.push(config.sofficePath);
  if (process.platform === 'win32') {
    for (const base of [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)']].filter(Boolean)) {
      c.push(path.join(base, 'LibreOffice', 'program', 'soffice.exe'));
    }
  } else if (process.platform === 'darwin') {
    c.push('/Applications/LibreOffice.app/Contents/MacOS/soffice');
  } else {
    c.push('/usr/bin/soffice', '/usr/bin/libreoffice', '/usr/local/bin/soffice', '/opt/libreoffice/program/soffice', '/snap/bin/libreoffice');
  }
  return c.find((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  }) || null;
}

let officeBusy = Promise.resolve();
/** LibreOffice conversions run one at a time. */
export function officeToPdf(buffer, ext) {
  const run = officeBusy.then(() => convert(buffer, ext));
  officeBusy = run.catch(() => {});
  return run;
}

async function convert(buffer, ext = 'docx') {
  const soffice = findSoffice();
  if (!soffice) throw Object.assign(new Error('LibreOffice לא מותקן בשרת - אפשר לייבא את הקובץ כטקסט עשיר, או להמיר ל-PDF ולייבא את ה-PDF'), { status: 501 });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-import-'));
  try {
    const safeExt = ['doc', 'docx', 'rtf', 'odt'].includes(ext) ? ext : 'docx';
    const input = path.join(tmp, `input.${safeExt}`);
    fs.writeFileSync(input, buffer);
    const profile = 'file://' + path.join(tmp, 'profile').replace(/\\/g, '/');
    await new Promise((resolve, reject) => {
      execFile(soffice, [`-env:UserInstallation=${profile}`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', tmp, input], { timeout: 120000 }, (err, stdout, stderr) => {
        if (err) reject(new Error('המרת Word ל-PDF נכשלה: ' + (stderr || err.message)));
        else resolve();
      });
    });
    const out = path.join(tmp, 'input.pdf');
    if (!fs.existsSync(out)) throw new Error('המרת Word ל-PDF נכשלה');
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
