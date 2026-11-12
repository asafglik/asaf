// Font registry: bundled open fonts with Hebrew support (fontsource packages),
// fonts uploaded through the designer, and system font aliases.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, config } from './config.js';

const BUNDLED = [
  { family: 'Heebo', pkg: 'heebo', category: 'sans' },
  { family: 'Rubik', pkg: 'rubik', category: 'sans' },
  { family: 'Assistant', pkg: 'assistant', category: 'sans' },
  { family: 'Noto Sans Hebrew', pkg: 'noto-sans-hebrew', category: 'sans' },
  { family: 'Alef', pkg: 'alef', category: 'sans' },
  { family: 'Varela Round', pkg: 'varela-round', category: 'sans' },
  { family: 'Secular One', pkg: 'secular-one', category: 'display' },
  { family: 'Suez One', pkg: 'suez-one', category: 'display' },
  { family: 'Frank Ruhl Libre', pkg: 'frank-ruhl-libre', category: 'serif' },
  { family: 'David Libre', pkg: 'david-libre', category: 'serif' },
  { family: 'Noto Serif Hebrew', pkg: 'noto-serif-hebrew', category: 'serif' },
  { family: 'Miriam Libre', pkg: 'miriam-libre', category: 'sans' },
  { family: 'Arimo', pkg: 'arimo', category: 'sans' },
  { family: 'Tinos', pkg: 'tinos', category: 'serif' },
  { family: 'Cousine', pkg: 'cousine', category: 'mono' },
];

// Office font names mapped to metric-compatible bundled fonts. The installed
// font is used when the server has it (local()), otherwise the alias.
const ALIASES = [
  { family: 'Arial', locals: ['Arial', 'ArialMT'], pkg: 'arimo' },
  { family: 'Times New Roman', locals: ['Times New Roman', 'TimesNewRomanPSMT'], pkg: 'tinos' },
  { family: 'Courier New', locals: ['Courier New', 'CourierNewPSMT'], pkg: 'cousine' },
  { family: 'David', locals: ['David'], pkg: 'david-libre' },
  { family: 'Miriam', locals: ['Miriam'], pkg: 'miriam-libre' },
];

const SUBSETS = /-(hebrew|latin|latin-ext)-\d+-(normal|italic)$/;

function fontsourceDir(pkg) {
  return path.join(ROOT, 'node_modules', '@fontsource', pkg);
}

/** Parse fontsource CSS into face descriptors (hebrew/latin subsets only). */
function bundledFaces(pkg, familyOverride, locals) {
  const dir = fontsourceDir(pkg);
  if (!fs.existsSync(dir)) return [];
  const faces = [];
  for (const weight of [400, 700]) {
    for (const file of [`${weight}.css`, `${weight}-italic.css`]) {
      const cssPath = path.join(dir, file);
      if (!fs.existsSync(cssPath)) continue;
      const css = fs.readFileSync(cssPath, 'utf8');
      const blocks = css.split('@font-face').slice(1);
      for (const b of blocks) {
        const woff2 = b.match(/url\(\.\/files\/([^)]+\.woff2)\)/);
        if (!woff2) continue;
        const name = woff2[1].replace(/\.woff2$/, '');
        if (!SUBSETS.test(name)) continue;
        faces.push({
          family: familyOverride,
          weight,
          style: /italic/.test(file) ? 'italic' : 'normal',
          file: path.join(dir, 'files', woff2[1]),
          range: (b.match(/unicode-range:\s*([^;]+);/) || [])[1] || '',
          locals,
          format: 'woff2',
        });
      }
    }
  }
  return faces;
}

function uploadedDir() {
  return path.join(config.storageDir, 'fonts');
}

function readUploaded() {
  try {
    return JSON.parse(fs.readFileSync(path.join(uploadedDir(), 'fonts.json'), 'utf8'));
  } catch {
    return [];
  }
}

function uploadedFaces() {
  return readUploaded().filter((f) => FAMILY_RE.test(f.family || '') && f.file && path.basename(f.file) === f.file).map((f) => ({
    family: f.family,
    weight: f.weight || 400,
    style: f.style || 'normal',
    file: path.join(uploadedDir(), f.file),
    range: '',
    format: { ttf: 'truetype', otf: 'opentype', woff: 'woff', woff2: 'woff2' }[path.extname(f.file).slice(1).toLowerCase()] || 'truetype',
    uploaded: true,
  }));
}

let facesCache = null;
function allFaces() {
  if (!facesCache) {
    facesCache = [
      ...BUNDLED.flatMap((f) => bundledFaces(f.pkg, f.family)),
      ...ALIASES.flatMap((a) => bundledFaces(a.pkg, a.family, a.locals)),
    ];
  }
  return [...facesCache, ...uploadedFaces()];
}

export function listFonts() {
  const fams = new Map();
  for (const f of BUNDLED) fams.set(f.family, { family: f.family, source: 'bundled', category: f.category });
  for (const a of ALIASES) fams.set(a.family, { family: a.family, source: 'system', category: 'office' });
  for (const u of readUploaded()) if (FAMILY_RE.test(u.family || '')) fams.set(u.family, { family: u.family, source: 'uploaded', category: 'custom' });
  return [...fams.values()];
}

const FAMILY_RE = /^[\p{L}\p{N} _-]{1,60}$/u;
const safeFamily = (f) => String(f || '').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 60);

function faceCss(face, url) {
  const src = [];
  for (const l of face.locals || []) src.push(`local('${l}')`);
  src.push(`url(${url}) format('${face.format}')`);
  const style = face.style === 'italic' ? 'italic' : 'normal';
  const weight = Number(face.weight) || 400;
  return `@font-face{font-family:'${safeFamily(face.family)}';font-style:${style};font-weight:${weight};font-display:block;src:${src.join(',')};${face.range ? `unicode-range:${face.range};` : ''}}`;
}

/** CSS for the designer: fonts served over HTTP. */
export function fontsCssForWeb() {
  return allFaces().map((f) => faceCss(f, `/fonts/${f.uploaded ? 'u/' : 'b/'}${encodeURIComponent(path.basename(f.file))}`)).join('\n');
}

export function resolveFontFile(kind, name) {
  const base = path.basename(name);
  const face = allFaces().find((f) => path.basename(f.file) === base && !!f.uploaded === (kind === 'u'));
  return face ? face.file : null;
}

const dataUrlCache = new Map();
function dataUrl(face) {
  let u = dataUrlCache.get(face.file);
  if (!u) {
    const mime = { woff2: 'font/woff2', woff: 'font/woff', truetype: 'font/ttf', opentype: 'font/otf' }[face.format];
    u = `data:${mime};base64,${fs.readFileSync(face.file).toString('base64')}`;
    if (!face.uploaded) dataUrlCache.set(face.file, u);
  }
  return u;
}

/** CSS with embedded fonts for the families a template uses (for PDF rendering). */
export function fontsCssForTemplate(template) {
  const json = JSON.stringify(template);
  const faces = allFaces().filter((f) => f.family === 'Heebo' || json.includes(f.family));
  return faces.map((f) => faceCss(f, dataUrl(f))).join('\n');
}

export function saveUploadedFont({ family, weight = 400, style = 'normal', fileName, dataBase64 }) {
  const bad = (m) => Object.assign(new Error(m), { status: 400 });
  family = String(family || '').trim();
  if (!FAMILY_RE.test(family)) throw bad('שם גופן יכול להכיל אותיות, ספרות, רווח, - ו-_ בלבד');
  if (!dataBase64) throw bad('חסר קובץ גופן');
  weight = Number(weight);
  if (![100, 200, 300, 400, 500, 600, 700, 800, 900].includes(weight)) throw bad('משקל גופן לא תקין');
  style = style === 'italic' ? 'italic' : 'normal';
  const ext = path.extname(String(fileName || '')).toLowerCase().replace('.', '') || 'ttf';
  if (!['ttf', 'otf', 'woff', 'woff2'].includes(ext)) throw bad('סוג קובץ גופן לא נתמך (ttf/otf/woff/woff2)');
  const buf = Buffer.from(String(dataBase64), 'base64');
  if (buf.length > 15 * 1024 * 1024) throw bad('קובץ הגופן גדול מדי');
  fs.mkdirSync(uploadedDir(), { recursive: true });
  const safe = `${family.replace(/[^\p{L}\p{N}_-]+/gu, '_')}-${weight}-${style}.${ext}`;
  const target = path.resolve(uploadedDir(), safe);
  if (path.dirname(target) !== path.resolve(uploadedDir())) throw bad('שם קובץ לא תקין');
  fs.writeFileSync(target, buf);
  const list = readUploaded().filter((f) => !(f.family === family && (f.weight || 400) === +weight && (f.style || 'normal') === style));
  list.push({ family, weight: +weight, style, file: safe });
  fs.writeFileSync(path.join(uploadedDir(), 'fonts.json'), JSON.stringify(list, null, 2));
  return listFonts();
}

export function deleteUploadedFont(family) {
  const list = readUploaded();
  for (const f of list.filter((x) => x.family === family)) {
    const target = path.resolve(uploadedDir(), path.basename(f.file));
    if (path.dirname(target) === path.resolve(uploadedDir())) fs.rmSync(target, { force: true });
  }
  fs.writeFileSync(path.join(uploadedDir(), 'fonts.json'), JSON.stringify(list.filter((x) => x.family !== family), null, 2));
  return listFonts();
}
