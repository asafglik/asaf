// Value formatting shared by the server renderer and the designer canvas.
// A format spec is a string: "<kind>[:arg1[:arg2]]", for example
//   number:2        -> 1,234.50
//   currency        -> ‏1,234.50 ₪ (ILS, 2 decimals)
//   currency:USD:0  -> $1,235
//   percent:1       -> 17.0%
//   date:dd/MM/yyyy -> 12/11/2026
//   datetime        -> 12/11/2026 14:05
//   upper | lower | trim | text

export const FORMAT_PRESETS = [
  { value: '', label: 'ללא' },
  { value: 'text', label: 'טקסט' },
  { value: 'number:0', label: 'מספר שלם (1,235)' },
  { value: 'number:2', label: 'מספר עשרוני (1,234.50)' },
  { value: 'plain:2', label: 'מספר ללא מפריד אלפים (1234.50)' },
  { value: 'currency', label: 'מטבע ₪' },
  { value: 'currency:USD', label: 'מטבע $' },
  { value: 'currency:EUR', label: 'מטבע €' },
  { value: 'percent:0', label: 'אחוז משבר (0.17 → 17%)' },
  { value: 'pct:0', label: 'אחוז (17 → 17%)' },
  { value: 'date:dd/MM/yyyy', label: 'תאריך 12/11/2026' },
  { value: 'date:d MMMM yyyy', label: 'תאריך 12 נובמבר 2026' },
  { value: 'datetime', label: 'תאריך ושעה' },
  { value: 'time', label: 'שעה 14:05' },
  { value: 'hdate', label: 'תאריך Caché ($H) → 19/02/2023' },
  { value: 'htime', label: 'שעה מתוך שניות ($H) → 16:04' },
  { value: 'visual', label: 'תיקון עברית הפוכה (ויזואלית)' },
  { value: 'upper', label: 'אותיות גדולות' },
  { value: 'lower', label: 'אותיות קטנות' },
];

const LOCALE = 'he-IL';

export function toNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || v === undefined || v === '') return 0;
  if (Array.isArray(v)) return v.length === 1 ? toNumber(v[0]) : NaN;
  if (v instanceof Date) return v.getTime();
  const s = String(v).trim().replace(/,/g, '');
  if (s === '') return 0;
  const n = Number(s);
  return n;
}

export function isNumeric(v) {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v !== 'string') return false;
  const s = v.trim();
  return s !== '' && (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s) || /^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s));
}

export function parseDate(v) {
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return new Date(v);
  const s = String(v).trim();
  // dd/MM/yyyy or dd.MM.yyyy or dd-MM-yyyy (Israeli order), optional time
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return new Date(y, +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }
  // yyyy-MM-dd (no zone) -> local date
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  // 8 digits: yyyyMMdd when that is a valid date, otherwise ddMMyyyy (common in Israeli systems)
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) {
    if (+m[1] >= 1900 && +m[1] <= 2200 && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) return new Date(+m[1], +m[2] - 1, +m[3]);
    const d2 = s.match(/^(\d{2})(\d{2})(\d{4})$/);
    if (+d2[2] >= 1 && +d2[2] <= 12 && +d2[1] >= 1 && +d2[1] <= 31) return new Date(+d2[3], +d2[2] - 1, +d2[1]);
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

/** Parse a date written in a known layout, e.g. parseDateAs("250415", "yyMMdd"). */
export function parseDateAs(v, pattern) {
  const s = String(v ?? '').trim();
  const p = String(pattern || '');
  const parts = { y: 0, M: 1, d: 1, H: 0, m: 0, s: 0 };
  let i = 0;
  const re = /yyyy|yy|MM|dd|HH|mm|ss|./g;
  let t;
  while ((t = re.exec(p))) {
    const tok = t[0];
    const len = tok.length;
    if (tok.length > 1 || /[yMdHms]/.test(tok)) {
      const n = Number(s.substr(i, len));
      if (!Number.isFinite(n)) return null;
      const k = tok[0];
      parts[k] = k === 'y' && len === 2 ? 2000 + n : n;
      i += len;
    } else i += 1;
  }
  const d = new Date(parts.y, parts.M - 1, parts.d, parts.H, parts.m, parts.s);
  return isNaN(d) ? null : d;
}

/** InterSystems Caché / IRIS $HOROLOG day number (days since 31/12/1840) -> Date. */
export function fromHorolog(v) {
  const n = parseInt(String(v ?? '').split(',')[0], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(1840, 11, 31 + n);
}

/** Seconds since midnight ($H time part) -> "HH:mm". */
export function secondsToTime(v, withSeconds = false) {
  const n = parseInt(String(v ?? '').split(',').pop(), 10);
  if (!Number.isFinite(n) || n < 0) return '';
  const pad = (x) => String(x).padStart(2, '0');
  const t = `${pad(Math.floor(n / 3600) % 24)}:${pad(Math.floor(n / 60) % 60)}`;
  return withSeconds ? `${t}:${pad(n % 60)}` : t;
}

/**
 * Hebrew stored in visual order (reversed, as printed by old terminals) -> logical
 * order. Numbers and Latin words inside keep their direction: "95 ןיזנב" -> "בנזין 95".
 */
export function fixVisualHebrew(v) {
  const s = String(v ?? '');
  if (!/[\u0590-\u05FF]/.test(s)) return s;
  const rev = [...s].reverse().join('');
  const mirror = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<' };
  return rev
    .replace(/[0-9A-Za-z@][0-9A-Za-z@.,:/_+%-]*[0-9A-Za-z%]|[0-9A-Za-z]/g, (run) => [...run].reverse().join(''))
    .replace(/[()[\]{}<>]/g, (c) => mirror[c]);
}

const HEB_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const HEB_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export function formatDate(d, pattern = 'dd/MM/yyyy') {
  d = parseDate(d);
  if (!d) return '';
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  const map = {
    yyyy: d.getFullYear(),
    yy: pad(d.getFullYear() % 100),
    MMMM: HEB_MONTHS[d.getMonth()],
    MM: pad(d.getMonth() + 1),
    M: d.getMonth() + 1,
    dddd: 'יום ' + HEB_DAYS[d.getDay()],
    dd: pad(d.getDate()),
    d: d.getDate(),
    HH: pad(d.getHours()),
    H: d.getHours(),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
  };
  return pattern.replace(/yyyy|yy|MMMM|MM|M|dddd|dd|d|HH|H|mm|ss/g, (t) => String(map[t]));
}

function numberFmt(n, decimals, grouping = true) {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: grouping,
  }).format(n);
}

const clampDec = (d) => (Number.isFinite(d) ? Math.max(0, Math.min(10, d)) : 2);
const CURRENCY_ALIASES = { '₪': 'ILS', NIS: 'ILS', 'ש"ח': 'ILS', 'ש״ח': 'ILS', $: 'USD', '€': 'EUR', '£': 'GBP' };

/** Never throws: an invalid format spec falls back to the plain value. */
export function formatValue(value, spec) {
  try {
    return formatValueUnsafe(value, spec);
  } catch {
    return valueToString(value);
  }
}

function formatValueUnsafe(value, spec) {
  if (!spec) return valueToString(value);
  if (value === null || value === undefined || value === '') return '';
  const parts = String(spec).split(':');
  const kind = parts.shift().trim().toLowerCase();
  const rest = parts.join(':');
  switch (kind) {
    case 'text':
      return valueToString(value);
    case 'number':
    case 'plain': {
      const n = toNumber(value);
      if (!Number.isFinite(n)) return valueToString(value);
      const dec = rest === '' ? (Number.isInteger(n) ? 0 : 2) : clampDec(parseInt(rest, 10));
      return numberFmt(n, dec, kind === 'number');
    }
    case 'currency': {
      const n = toNumber(value);
      if (!Number.isFinite(n)) return valueToString(value);
      let code = 'ILS';
      let dec = 2;
      for (const p of parts) {
        if (/^\d+$/.test(p)) dec = clampDec(+p);
        else if (p) code = CURRENCY_ALIASES[p.trim()] || p.trim().toUpperCase();
      }
      return new Intl.NumberFormat(LOCALE, {
        style: 'currency', currency: code, minimumFractionDigits: dec, maximumFractionDigits: dec,
      }).format(n);
    }
    case 'percent': // a fraction: 0.17 -> 17%
    case 'pct': { // already a percentage: 17 -> 17%
      const n = toNumber(value);
      if (!Number.isFinite(n)) return valueToString(value);
      const dec = rest === '' ? 0 : clampDec(parseInt(rest, 10));
      return numberFmt(kind === 'percent' ? n * 100 : n, dec) + '%';
    }
    case 'date': {
      // optional source layout after '<': date:dd/MM/yyyy<yyMMdd
      const [out, src] = rest.split('<');
      return formatDate(src ? parseDateAs(value, src) : value, out || 'dd/MM/yyyy');
    }
    case 'datetime':
      return formatDate(value, rest || 'dd/MM/yyyy HH:mm');
    case 'time':
      return formatDate(value, rest || 'HH:mm');
    case 'hdate': // Caché $H day number
      return formatDate(fromHorolog(value), rest || 'dd/MM/yyyy');
    case 'htime': // seconds since midnight
      return secondsToTime(value, rest === 'ss');
    case 'visual':
      return fixVisualHebrew(valueToString(value));
    case 'upper':
      return valueToString(value).toUpperCase();
    case 'lower':
      return valueToString(value).toLowerCase();
    case 'trim':
      return valueToString(value).trim();
    case 'bool': {
      const [yes = 'כן', no = 'לא'] = rest ? rest.split('/') : [];
      const v = value === true || value === 1 || ['true', '1', 'y', 'yes', 'כן', 'x', 'v', '✓'].includes(String(value).trim().toLowerCase());
      return v ? yes : no;
    }
    default:
      return valueToString(value);
  }
}

export function valueToString(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return formatDate(v, 'dd/MM/yyyy');
  if (Array.isArray(v)) return v.map(valueToString).join(', ');
  if (typeof v === 'object') {
    if ('#text' in v) return valueToString(v['#text']);
    return '';
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    // avoid binary float noise such as 0.30000000000000004
    return String(Math.round(v * 1e10) / 1e10);
  }
  return String(v);
}
