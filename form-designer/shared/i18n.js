// Multi-language templates. One template, several print languages:
//   template.defaultLanguage = 'he'
//   template.languages       = ['he', 'en', 'ar', 'ru']
//   element.tr = { en: { text: 'Dear {{customer.name}}' }, ar: { ... } }
//   column.tr  = { en: { header: 'Qty' } }
// When a document is printed in a language written in the other direction
// (Hebrew template printed in English), text direction and right/left
// alignment are mirrored; positions stay the same.

export const LANGUAGES = {
  he: { name: 'עברית', dir: 'rtl', locale: 'he-IL', yes: 'כן', no: 'לא' },
  en: { name: 'English', dir: 'ltr', locale: 'en-GB', yes: 'Yes', no: 'No' },
  ar: { name: 'العربية', dir: 'rtl', locale: 'ar-IL-u-nu-latn', yes: 'نعم', no: 'لا' },
  ru: { name: 'Русский', dir: 'ltr', locale: 'ru-RU', yes: 'Да', no: 'Нет' },
  fr: { name: 'Français', dir: 'ltr', locale: 'fr-FR', yes: 'Oui', no: 'Non' },
  am: { name: 'አማርኛ', dir: 'ltr', locale: 'am-ET', yes: 'አዎ', no: 'አይ' },
};

/** Element properties that hold text to translate. */
export const TRANSLATABLE = ['text', 'html', 'label', 'prefix', 'suffix', 'emptyText', 'title', 'subtitle', 'description'];
/** Table column properties that hold text to translate. */
export const COL_TRANSLATABLE = ['header', 'footer', 'text', 'prefix', 'suffix', 'emptyText'];

export function baseLanguage(t) {
  return t?.defaultLanguage && LANGUAGES[t.defaultLanguage] ? t.defaultLanguage : 'he';
}

export function templateLanguages(t) {
  const base = baseLanguage(t);
  const list = (Array.isArray(t?.languages) ? t.languages : []).filter((l) => LANGUAGES[l]);
  return [base, ...list.filter((l) => l !== base)];
}

export function langDir(lang) {
  return LANGUAGES[lang]?.dir || 'ltr';
}

const flip = { right: 'left', left: 'right' };
const swapAlign = (a) => flip[a] || a;

/** Text of an element property in a language (falls back to the default language). */
export function trGet(obj, key, lang, base) {
  if (lang && lang !== base) {
    const v = obj?.tr?.[lang]?.[key];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return obj?.[key];
}

/** The element as it prints in `lang`. */
export function localizeElement(el, lang, base = 'he') {
  if (!lang || lang === base) return el;
  const c = { ...el };
  for (const k of TRANSLATABLE) {
    const v = el.tr?.[lang]?.[k];
    if (v !== undefined && v !== null && v !== '') c[k] = v;
  }
  const mirror = langDir(lang) !== langDir(base) && el.mirror !== false;
  if (mirror) {
    const st = { ...(el.style || {}) };
    st.direction = langDir(lang);
    st.align = swapAlign(st.align || 'right');
    c.style = st;
    if (el.headerStyle) c.headerStyle = { ...el.headerStyle, align: swapAlign(el.headerStyle.align || 'center') };
  }
  if (Array.isArray(el.columns)) {
    c.columns = el.columns.map((col) => {
      const cc = { ...col };
      for (const k of COL_TRANSLATABLE) {
        const v = col.tr?.[lang]?.[k];
        if (v !== undefined && v !== null && v !== '') cc[k] = v;
      }
      if (mirror && cc.align) cc.align = swapAlign(cc.align);
      return cc;
    });
  }
  return c;
}

/**
 * Whether positions are mirrored too (x -> pageWidth - x - w) when the print language
 * is written in the other direction: template.mirrorLayout = 'auto' (default: yes,
 * except on pages with a PDF / image background, whose layout is fixed) | 'never'.
 */
export function mirrorsLayout(t, lang, page) {
  const base = baseLanguage(t);
  if (!lang || lang === base || langDir(lang) === langDir(base) || t.mirrorLayout === 'never') return false;
  return !(page && page.background);
}

/** The whole template as it prints in `lang` (pageWidth in mm, for mirrored layouts). */
export function localizeTemplate(t, lang, { pageWidth } = {}) {
  const base = baseLanguage(t);
  if (!lang || lang === base) return t;
  const loc = (els, mirror) => (els || []).map((e) => {
    const c = localizeElement(e, lang, base);
    if (mirror && pageWidth && e.mirror !== false) c.x = Math.round((pageWidth - Number(e.x || 0) - Number(e.w || 0)) * 100) / 100;
    return c;
  });
  const out = { ...t, pages: (t.pages || []).map((p) => ({ ...p, elements: loc(p.elements, mirrorsLayout(t, lang, p)) })) };
  const bandsMirror = mirrorsLayout(t, lang) && !(t.pages || []).some((p) => p.background);
  for (const b of ['header', 'footer']) if (t[b]) out[b] = { ...t[b], elements: loc(t[b].elements, bandsMirror) };
  return out;
}

// only texts with letters outside {{placeholders}} and tags need a translation
const needsTranslation = (v) => /\p{L}/u.test(String(v).replace(/\{\{[^}]*\}\}/g, '').replace(/<[^>]*>/g, ''));

/** Every translatable text of a template: [{ owner, key, text }] (owner = element or column). */
export function translatableTexts(t) {
  const out = [];
  const els = [...(t.pages || []).flatMap((p) => p.elements || []), ...(t.header?.elements || []), ...(t.footer?.elements || [])];
  for (const e of els) {
    for (const k of TRANSLATABLE) if (typeof e[k] === 'string' && needsTranslation(e[k])) out.push({ owner: e, key: k, text: e[k] });
    for (const c of e.columns || []) {
      for (const k of COL_TRANSLATABLE) if (typeof c[k] === 'string' && needsTranslation(c[k])) out.push({ owner: c, key: k, text: c[k] });
    }
  }
  return out;
}

/** How many texts still have no translation in `lang`. */
export function missingTranslations(t, lang) {
  if (lang === baseLanguage(t)) return [];
  return translatableTexts(t).filter(({ owner, key }) => !owner.tr?.[lang]?.[key]);
}
