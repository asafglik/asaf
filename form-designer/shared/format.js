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
  { value: 'percent:0', label: 'אחוז (17%)' },
  { value: 'date:dd/MM/yyyy', label: 'תאריך 12/11/2026' },
  { value: 'date:d MMMM yyyy', label: 'תאריך 12 נובמבר 2026' },
  { value: 'datetime', label: 'תאריך ושעה' },
  { value: 'time', label: 'שעה 14:05' },
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
  return s !== '' && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s);
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
  // yyyyMMdd
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
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

export function formatValue(value, spec) {
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
      const dec = rest === '' ? (Number.isInteger(n) ? 0 : 2) : parseInt(rest, 10);
      return numberFmt(n, dec, kind === 'number');
    }
    case 'currency': {
      const n = toNumber(value);
      if (!Number.isFinite(n)) return valueToString(value);
      let code = 'ILS';
      let dec = 2;
      for (const p of parts) {
        if (/^\d+$/.test(p)) dec = +p;
        else if (p) code = p.toUpperCase();
      }
      return new Intl.NumberFormat(LOCALE, {
        style: 'currency', currency: code, minimumFractionDigits: dec, maximumFractionDigits: dec,
      }).format(n);
    }
    case 'percent': {
      const n = toNumber(value);
      if (!Number.isFinite(n)) return valueToString(value);
      const dec = rest === '' ? 0 : parseInt(rest, 10);
      // values above 1 are treated as already-multiplied percentages (17 -> 17%)
      const pct = Math.abs(n) <= 1 ? n * 100 : n;
      return numberFmt(pct, dec) + '%';
    }
    case 'date':
      return formatDate(value, rest || 'dd/MM/yyyy');
    case 'datetime':
      return formatDate(value, rest || 'dd/MM/yyyy HH:mm');
    case 'time':
      return formatDate(value, rest || 'HH:mm');
    case 'upper':
      return valueToString(value).toUpperCase();
    case 'lower':
      return valueToString(value).toLowerCase();
    case 'trim':
      return valueToString(value).trim();
    case 'bool': {
      const [yes = 'כן', no = 'לא'] = rest ? rest.split('/') : [];
      const v = value === true || value === 'true' || value === '1' || value === 1 || value === 'Y' || value === 'כן';
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
