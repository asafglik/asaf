// A small, safe expression language for computed fields (no eval / Function).
//
//   customer.name                     path into the data
//   items[0].price, order["first-name"]
//   price * qty * (1 + vat / 100)
//   sum(items, price * qty)           aggregate with a per-row expression
//   if(total > 1000, "גבוה", "רגיל")  conditionals, also  a ? b : c
//   "שלום " & customer.name           string concatenation
//
// Identifiers resolve through a scope chain: the current table row first,
// then the root data. Paths through arrays map over the items
// (items.price -> list of prices).

import { toNumber, isNumeric, parseDate, parseDateAs, fromHorolog, secondsToTime, fixVisualHebrew, formatValue, formatDate, valueToString } from './format.js';

export class ExprError extends Error {}

// ---------------------------------------------------------------- tokenizer
const ID_START = /[\p{L}_$@#]/u;
const ID_PART = /[\p{L}\p{N}_$@#]/u;

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1]))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      if (/[eE]/.test(src[j]) && /[-+0-9]/.test(src[j + 1])) {
        j += 2;
        while (j < src.length && /[0-9]/.test(src[j])) j++;
      }
      tokens.push({ t: 'num', v: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) {
          const n = src[j + 1];
          s += n === 'n' ? '\n' : n === 't' ? '\t' : n;
          j += 2;
        } else s += src[j++];
      }
      if (j >= src.length) throw new ExprError('מחרוזת לא סגורה');
      tokens.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    if (ID_START.test(c)) {
      let j = i + 1;
      while (j < src.length && ID_PART.test(src[j])) j++;
      tokens.push({ t: 'id', v: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||', '<>'].includes(two)) {
      tokens.push({ t: 'op', v: two === '<>' ? '!=' : two });
      i += 2;
      continue;
    }
    if ('+-*/%()[],.?:<>!&='.includes(c)) {
      tokens.push({ t: 'op', v: c === '=' ? '==' : c });
      i++;
      continue;
    }
    throw new ExprError(`תו לא צפוי '${c}'`);
  }
  tokens.push({ t: 'eof' });
  return tokens;
}

// ---------------------------------------------------------------- parser
const BINARY = {
  '||': 1, or: 1,
  '&&': 2, and: 2,
  '==': 3, '!=': 3,
  '<': 4, '<=': 4, '>': 4, '>=': 4,
  '&': 5,
  '+': 6, '-': 6,
  '*': 7, '/': 7, '%': 7,
};

function parse(src) {
  const tokens = tokenize(src);
  let p = 0;
  const peek = () => tokens[p];
  const next = () => tokens[p++];
  const isOp = (v) => peek().t === 'op' && peek().v === v;
  const expect = (v) => {
    if (!isOp(v)) throw new ExprError(`חסר '${v}'`);
    p++;
  };

  function parseExpr(minPrec = 0) {
    let left = parseUnary();
    for (;;) {
      const tk = peek();
      let op = null;
      if (tk.t === 'op' && BINARY[tk.v]) op = tk.v;
      else if (tk.t === 'id' && (tk.v === 'and' || tk.v === 'or')) op = tk.v === 'and' ? '&&' : '||';
      if (op && BINARY[op] > minPrec) {
        p++;
        const right = parseExpr(BINARY[op]);
        left = { k: 'bin', op, a: left, b: right };
        continue;
      }
      if (tk.t === 'op' && tk.v === '?' && minPrec === 0) {
        p++;
        const a = parseExpr(0);
        expect(':');
        const b = parseExpr(0);
        left = { k: 'cond', c: left, a, b };
        continue;
      }
      return left;
    }
  }

  function parseUnary() {
    const tk = peek();
    if (tk.t === 'op' && (tk.v === '-' || tk.v === '+' || tk.v === '!')) {
      p++;
      return { k: 'un', op: tk.v, a: parseUnary() };
    }
    if (tk.t === 'id' && tk.v === 'not') {
      p++;
      return { k: 'un', op: '!', a: parseUnary() };
    }
    return parsePostfix(parsePrimary());
  }

  function parsePrimary() {
    const tk = next();
    if (tk.t === 'num' || tk.t === 'str') return { k: 'lit', v: tk.v };
    if (tk.t === 'op' && tk.v === '(') {
      const e = parseExpr(0);
      expect(')');
      return e;
    }
    if (tk.t === 'id') {
      if (tk.v === 'true') return { k: 'lit', v: true };
      if (tk.v === 'false') return { k: 'lit', v: false };
      if (tk.v === 'null') return { k: 'lit', v: null };
      if (isOp('(')) {
        p++;
        const args = [];
        if (!isOp(')')) {
          do args.push(parseExpr(0));
          while (isOp(',') && ++p);
        }
        expect(')');
        return { k: 'call', name: tk.v, args };
      }
      return { k: 'id', name: tk.v };
    }
    if (tk.t === 'eof') throw new ExprError('ביטוי לא שלם');
    throw new ExprError(`חסר ערך לפני '${tk.v}'`);
  }

  function parsePostfix(node) {
    for (;;) {
      if (isOp('.')) {
        p++;
        const tk = next();
        if (tk.t !== 'id' && tk.t !== 'num') throw new ExprError('חסר שם שדה אחרי נקודה');
        node = { k: 'get', o: node, key: { k: 'lit', v: String(tk.v) } };
      } else if (isOp('[')) {
        p++;
        const key = parseExpr(0);
        expect(']');
        node = { k: 'get', o: node, key, index: true };
      } else return node;
    }
  }

  const ast = parseExpr(0);
  if (peek().t !== 'eof') throw new ExprError(`טקסט מיותר בסוף הביטוי: '${peek().v ?? ''}'`);
  return ast;
}

const cache = new Map();
export function compile(src) {
  if (src.length > 4000) throw new ExprError('ביטוי ארוך מדי');
  let ast = cache.get(src);
  if (!ast) {
    ast = parse(src);
    if (cache.size > 5000) cache.clear();
    cache.set(src, ast);
  }
  return ast;
}

// ---------------------------------------------------------------- scopes
export function makeScope(vars, parent = null) {
  return { vars: vars ?? {}, parent };
}

function lookup(scope, name) {
  for (let s = scope; s; s = s.parent) {
    const v = s.vars;
    if (v && typeof v === 'object') {
      if (Object.prototype.hasOwnProperty.call(v, name)) return v[name];
      // XML attribute of the current row: code -> @code
      if (name[0] !== '@' && name[0] !== '$' && Object.prototype.hasOwnProperty.call(v, '@' + name)) return v['@' + name];
    }
  }
  return undefined;
}

function getProp(obj, key) {
  if (obj === null || obj === undefined) return undefined;
  if (Array.isArray(obj)) {
    if (typeof key === 'number' || /^\d+$/.test(key)) return obj[+key];
    if (key === 'length') return obj.length;
    // map over items, flattening nested arrays
    const out = [];
    for (const it of obj) {
      const v = getProp(it, key);
      if (Array.isArray(v)) out.push(...v);
      else if (v !== undefined) out.push(v);
    }
    return out;
  }
  if (typeof obj === 'object') {
    if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
    // XML attributes are stored as "@name": allow items.code to find @code
    if (Object.prototype.hasOwnProperty.call(obj, '@' + key)) return obj['@' + key];
    return undefined;
  }
  if (typeof obj === 'string' && key === 'length') return obj.length;
  return undefined;
}

function scalar(v) {
  if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && '#text' in v) return v['#text'];
  return v;
}

function truthy(v) {
  v = scalar(v);
  if (Array.isArray(v)) return v.length > 0;
  if (v === 'false' || v === '0') return false;
  return !!v;
}

// the same set of "checked" values the checkbox element uses
export function isTrueValue(v) {
  v = scalar(v);
  return v === true || v === 1 || ['true', '1', 'y', 'yes', 'כן', 'x', 'v', '✓'].includes(String(v ?? '').trim().toLowerCase());
}

const DATE_RE = /^(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})([ T]\d{1,2}:\d{2}(:\d{2})?)?$/;
const isDateLike = (v) => v instanceof Date || (typeof v === 'string' && DATE_RE.test(v.trim()));

function equals(a, b) {
  a = scalar(a);
  b = scalar(b);
  if ((a === null || a === undefined || a === '') && (b === null || b === undefined || b === '')) return true;
  if (isNumeric(a) && isNumeric(b)) return toNumber(a) === toNumber(b);
  if (typeof a === 'boolean') return a === isTrueValue(b);
  if (typeof b === 'boolean') return b === isTrueValue(a);
  if (isDateLike(a) && isDateLike(b)) return (parseDate(a)?.getTime() ?? NaN) === (parseDate(b)?.getTime() ?? NaN);
  return valueToString(a) === valueToString(b);
}

function compare(a, b) {
  a = scalar(a);
  b = scalar(b);
  if ((isNumeric(a) || typeof a === 'number') && (isNumeric(b) || typeof b === 'number')) return toNumber(a) - toNumber(b);
  if (isDateLike(a) && isDateLike(b)) {
    const da = parseDate(a);
    const db = parseDate(b);
    return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
  }
  return valueToString(a).localeCompare(valueToString(b), 'he');
}

function num(v) {
  const n = toNumber(scalar(v));
  return Number.isFinite(n) ? n : 0;
}

function round(n, d = 0) {
  const f = Math.pow(10, d);
  return Math.round((n + Number.EPSILON) * f) / f;
}

function asList(v) {
  if (v === null || v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

// ---------------------------------------------------------------- functions
// Functions listed in LAZY receive unevaluated argument nodes so that an
// expression can be evaluated per item: sum(items, price * qty).
function itemScope(scope, item, index) {
  const vars = item && typeof item === 'object' && !Array.isArray(item) ? { ...item } : {};
  vars.$item = item;
  vars.$index = index;
  vars.$row = index + 1;
  return makeScope(vars, scope);
}

function mapItems(args, scope, fname) {
  if (args.length === 0) throw new ExprError(`${fname}: חסר ארגומנט`);
  const list = asList(evaluate(args[0], scope));
  if (args.length < 2) return list;
  return list.map((it, i) => evaluate(args[1], itemScope(scope, it, i)));
}

function minMax(args, scope, which) {
  const f = which === 'min' ? Math.min : Math.max;
  if (!args.length) return 0;
  const first = evaluate(args[0], scope);
  const listMode = args.length === 1 || (args.length === 2 && Array.isArray(first));
  const vals = listMode ? mapItems(args, scope, which).map(num) : args.map((a) => num(evaluate(a, scope)));
  return vals.length ? vals.reduce((m, v) => f(m, v)) : 0;
}

const LAZY = {
  sum: (args, scope) => mapItems(args, scope, 'sum').reduce((a, v) => a + num(v), 0),
  avg: (args, scope) => {
    const l = mapItems(args, scope, 'avg');
    return l.length ? l.reduce((a, v) => a + num(v), 0) / l.length : 0;
  },
  // min(list), min(list, itemExpr) or min(a, b, ...)
  min: (args, scope) => minMax(args, scope, 'min'),
  max: (args, scope) => minMax(args, scope, 'max'),
  count: (args, scope) => {
    const list = asList(evaluate(args[0], scope));
    if (args.length < 2) return list.length;
    return list.filter((it, i) => truthy(evaluate(args[1], itemScope(scope, it, i)))).length;
  },
  filter: (args, scope) => {
    const list = asList(evaluate(args[0], scope));
    return list.filter((it, i) => truthy(evaluate(args[1], itemScope(scope, it, i))));
  },
  map: (args, scope) => mapItems(args, scope, 'map'),
  join: (args, scope) => {
    const list = asList(evaluate(args[0], scope));
    const sep = args.length > 1 ? valueToString(evaluate(args[1], scope)) : ', ';
    const vals = args.length > 2 ? list.map((it, i) => evaluate(args[2], itemScope(scope, it, i))) : list;
    return vals.map((v) => valueToString(scalar(v))).filter((s) => s !== '').join(sep);
  },
  if: (args, scope) => (truthy(evaluate(args[0], scope)) ? evaluate(args[1], scope) : args.length > 2 ? evaluate(args[2], scope) : ''),
  iif: (args, scope) => LAZY.if(args, scope),
  coalesce: (args, scope) => {
    for (const a of args) {
      const v = scalar(evaluate(a, scope));
      if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) return v;
    }
    return '';
  },
};

const s = (v) => valueToString(scalar(v));

const FUNCS = {
  round: (x, d) => round(num(x), d === undefined ? 0 : num(d)),
  floor: (x) => Math.floor(num(x)),
  ceil: (x) => Math.ceil(num(x)),
  abs: (x) => Math.abs(num(x)),
  pow: (x, y) => Math.pow(num(x), num(y)),
  sqrt: (x) => Math.sqrt(num(x)),
  num: (x) => num(x),
  number: (x) => num(x),
  str: (x) => s(x),
  text: (x) => s(x),
  concat: (...a) => a.map(s).join(''),
  upper: (x) => s(x).toUpperCase(),
  lower: (x) => s(x).toLowerCase(),
  trim: (x) => s(x).trim(),
  len: (x) => (Array.isArray(x) ? x.length : s(x).length),
  length: (x) => (Array.isArray(x) ? x.length : s(x).length),
  substr: (x, start, l) => s(x).substr(num(start), l === undefined ? undefined : num(l)),
  left: (x, n) => s(x).slice(0, num(n)),
  right: (x, n) => { const t = s(x); return t.slice(Math.max(0, t.length - num(n))); },
  replace: (x, a, b) => s(x).split(s(a)).join(s(b)),
  contains: (x, y) => (Array.isArray(x) ? x.some((v) => equals(v, y)) : s(x).includes(s(y))),
  startsWith: (x, y) => s(x).startsWith(s(y)),
  endsWith: (x, y) => s(x).endsWith(s(y)),
  padLeft: (x, n, ch = ' ') => s(x).padStart(num(n), s(ch) || ' '),
  padRight: (x, n, ch = ' ') => s(x).padEnd(num(n), s(ch) || ' '),
  isEmpty: (x) => { x = scalar(x); return x === null || x === undefined || x === '' || (Array.isArray(x) && !x.length); },
  first: (l) => asList(l)[0],
  last: (l) => { l = asList(l); return l[l.length - 1]; },
  at: (l, i) => asList(l)[num(i)],
  format: (x, spec) => formatValue(scalar(x), s(spec)),
  today: () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; },
  now: () => new Date(),
  date: (x, pattern) => (pattern === undefined ? parseDate(scalar(x)) : parseDateAs(scalar(x), s(pattern))),
  hdate: (x) => fromHorolog(scalar(x)),
  htime: (x) => secondsToTime(scalar(x)),
  visual: (x) => fixVisualHebrew(s(x)),
  formatDate: (x, p) => formatDate(scalar(x), p === undefined ? 'dd/MM/yyyy' : s(p)),
  year: (x) => { const d = parseDate(scalar(x)); return d ? d.getFullYear() : 0; },
  month: (x) => { const d = parseDate(scalar(x)); return d ? d.getMonth() + 1 : 0; },
  day: (x) => { const d = parseDate(scalar(x)); return d ? d.getDate() : 0; },
  addDays: (x, n) => { const d = parseDate(scalar(x)); if (!d) return null; const r = new Date(d); r.setDate(r.getDate() + num(n)); return r; },
  addMonths: (x, n) => { const d = parseDate(scalar(x)); if (!d) return null; const r = new Date(d); r.setMonth(r.getMonth() + num(n)); return r; },
  diffDays: (a, b) => { const da = parseDate(scalar(a)); const db = parseDate(scalar(b)); return da && db ? Math.round((db - da) / 86400000) : 0; },
  age: (x) => {
    const d = parseDate(scalar(x)); if (!d) return 0;
    const n = new Date(); let a = n.getFullYear() - d.getFullYear();
    if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
    return a;
  },
};

export const FUNCTION_HELP = [
  ['sum(רשימה, ביטוי)', 'סכום. לדוגמה sum(items, price * qty)'],
  ['avg / min / max / count', 'ממוצע, מינימום, מקסימום, ספירה (count(items, qty > 0))'],
  ['round(x, ספרות)', 'עיגול'],
  ['if(תנאי, אם_כן, אחרת)', 'תנאי, וגם תנאי ? א : ב'],
  ['concat(...) או א & ב', 'שרשור טקסט'],
  ['format(x, "number:2")', 'עיצוב ערך (number / currency / percent / date:dd/MM/yyyy)'],
  ['today() / now()', 'התאריך / השעה הנוכחיים'],
  ['date(x, "ddMMyyyy")', 'קריאת תאריך בתבנית ידועה (yyMMdd, ddMMyy...)'],
  ['hdate(x) / htime(x)', 'תאריך ושעה בפורמט Caché ($H)'],
  ['visual(x)', 'תיקון עברית שנשמרה הפוכה'],
  ['addDays(d, n) / diffDays(a, b)', 'חישובי תאריכים'],
  ['upper / lower / trim / len / left / right / replace / padLeft', 'פעולות טקסט'],
  ['coalesce(a, b, ...)', 'הערך הראשון שאינו ריק'],
  ['join(רשימה, ", ", ביטוי)', 'חיבור רשימה לטקסט'],
  ['$row / $index', 'מספר השורה בטבלה (מ-1) / אינדקס (מ-0)'],
];

// ---------------------------------------------------------------- evaluator
export function evaluate(node, scope) {
  switch (node.k) {
    case 'lit':
      return node.v;
    case 'id': {
      if (node.name === '$root') {
        let sc = scope;
        while (sc.parent) sc = sc.parent;
        return sc.vars;
      }
      return lookup(scope, node.name);
    }
    case 'get': {
      const o = evaluate(node.o, scope);
      const key = evaluate(node.key, scope);
      if (node.index && typeof key === 'number' && !Array.isArray(o) && o && typeof o === 'object') {
        // XML: a single element was not wrapped in an array; [0] still works
        return key === 0 ? o : undefined;
      }
      return getProp(o, typeof key === 'number' ? key : valueToString(key));
    }
    case 'un': {
      const a = evaluate(node.a, scope);
      if (node.op === '!') return !truthy(a);
      if (node.op === '-') return -num(a);
      return num(a);
    }
    case 'cond':
      return truthy(evaluate(node.c, scope)) ? evaluate(node.a, scope) : evaluate(node.b, scope);
    case 'bin': {
      if (node.op === '&&') return truthy(evaluate(node.a, scope)) && truthy(evaluate(node.b, scope));
      if (node.op === '||') {
        const a = evaluate(node.a, scope);
        return truthy(a) ? a : evaluate(node.b, scope);
      }
      const a = scalar(evaluate(node.a, scope));
      const b = scalar(evaluate(node.b, scope));
      switch (node.op) {
        case '+':
          if ((isNumeric(a) || typeof a === 'number' || a == null || a === '') && (isNumeric(b) || typeof b === 'number' || b == null || b === '')) return num(a) + num(b);
          return s(a) + s(b);
        case '-': return num(a) - num(b);
        case '*': return num(a) * num(b);
        case '/': { const d = num(b); return d === 0 ? 0 : num(a) / d; }
        case '%': { const d = num(b); return d === 0 ? 0 : num(a) % d; }
        case '&': return s(a) + s(b);
        case '==': return equals(a, b);
        case '!=': return !equals(a, b);
        case '<': return compare(a, b) < 0;
        case '<=': return compare(a, b) <= 0;
        case '>': return compare(a, b) > 0;
        case '>=': return compare(a, b) >= 0;
      }
      throw new ExprError('אופרטור לא מוכר ' + node.op);
    }
    case 'call': {
      const lazy = Object.hasOwn(LAZY, node.name) ? LAZY[node.name] : null;
      if (lazy) return lazy(node.args, scope);
      const fn = Object.hasOwn(FUNCS, node.name) ? FUNCS[node.name] : null;
      if (!fn) throw new ExprError(`פונקציה לא מוכרת: ${node.name}`);
      return fn(...node.args.map((a) => evaluate(a, scope)));
    }
  }
  throw new ExprError('ביטוי לא תקין');
}

export function evalExpr(src, scope) {
  if (src === undefined || src === null || String(src).trim() === '') return '';
  return scalar(evaluate(compile(String(src)), scope));
}

/** Evaluate and never throw: returns { value } or { error }. */
export function tryEval(src, scope) {
  try {
    return { value: evalExpr(src, scope) };
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

export function validateExpr(src) {
  try {
    compile(String(src));
    return null;
  } catch (e) {
    return e.message;
  }
}

// ---------------------------------------------------------------- templates
// Text with placeholders: "שלום {{customer.name}}, סה״כ {{total * 1.17 | currency}}".
// The part after a single '|' is a format spec (see format.js).
function splitFormat(inner) {
  let q = null;
  for (let i = inner.length - 1; i >= 0; i--) {
    const c = inner[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '|' && inner[i - 1] !== '|' && inner[i + 1] !== '|') {
      return [inner.slice(0, i).trim(), inner.slice(i + 1).trim()];
    }
  }
  return [inner.trim(), ''];
}

export const PAGE_TOKENS = { page: '\u0000PAGE\u0000', pages: '\u0000PAGES\u0000' };

/**
 * Replace {{...}} placeholders. Returns a string; page/pages tokens are left
 * as markers that the paginator fills in later. onError receives errors.
 */
export function interpolate(text, scope, { escape = (x) => x, escapeValue = escape, onError, html = false } = {}) {
  if (!text) return '';
  let out = '';
  let last = 0;
  const re = /\{\{([\s\S]*?)\}\}/g;
  let m;
  while ((m = re.exec(text))) {
    out += escape(text.slice(last, m.index));
    last = re.lastIndex;
    // in rich text the expression may contain formatting tags and entities; plain text is used as is
    let inner = html ? m[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : m[1];
    if (inner.startsWith('=')) inner = inner.slice(1);
    const [expr, fmt] = splitFormat(inner);
    if (expr === 'page' || expr === 'pages') {
      out += PAGE_TOKENS[expr];
      continue;
    }
    try {
      const v = evalExpr(expr, scope);
      out += escapeValue(formatValue(v, fmt));
    } catch (e) {
      if (onError) onError(e, expr);
      out += escapeValue('#שגיאה');
    }
  }
  out += escape(text.slice(last));
  return out;
}

/** A data path as an expression: segments that are not identifiers use ["..."] (first-name, Total Sum, 2nd). */
const SEG = /^[\p{L}_$@#][\p{L}\p{N}_$@#]*$/u;
export function exprPath(path, root = '$root') {
  return String(path).split('.').reduce((acc, s, i) => {
    const idx = /^(.*?)((\[\d+\])*)$/.exec(s); // keep [0] indexes
    const name = idx[1];
    const tail = idx[2];
    if (SEG.test(name) || name === '') return (i ? `${acc}.${name}` : name) + tail;
    return `${i ? acc : root}["${name.replace(/["\\]/g, '\\$&')}"]${tail}`;
  }, '');
}

export function scopeFor(data) {
  return makeScope(data && typeof data === 'object' ? data : {});
}
