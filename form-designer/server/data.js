// Parsing the data world (XML or JSON) and describing its structure.
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export function detectFormat(content) {
  const s = String(content).replace(/^﻿/, '').trimStart();
  return s.startsWith('<') ? 'xml' : 'json';
}

/**
 * Parse XML or JSON into a plain object.
 * XML rules: attributes become "@name", text next to attributes is "#text",
 * the root element is unwrapped, and paths listed in `arrays`
 * (e.g. "items.item") are always arrays even when they appear once.
 */
export function parseData(content, { format, arrays = [] } = {}) {
  if (content === null || content === undefined) return {};
  if (typeof content === 'object' && !Buffer.isBuffer(content)) return content;
  const text = String(content).replace(/^﻿/, '');
  if (!text.trim()) return {};
  const fmt = format || detectFormat(text);
  if (fmt === 'json') {
    try {
      return JSON.parse(text);
    } catch (e) {
      throw Object.assign(new Error('JSON לא תקין: ' + e.message), { status: 400 });
    }
  }
  const arraySet = new Set(arrays);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    textNodeName: '#text',
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    ignoreDeclaration: true,
    ignorePiTags: true,
    removeNSPrefix: true,
    isArray: (name, jpath, isLeaf, isAttr) => {
      if (isAttr) return false;
      const p = String(jpath).split('.').slice(1).join('.');
      return arraySet.has(p);
    },
  });
  let obj;
  try {
    const valid = XMLValidator.validate(text);
    if (valid !== true) throw new Error(`${valid.err.msg} (שורה ${valid.err.line})`);
    obj = parser.parse(text);
  } catch (e) {
    throw Object.assign(new Error('XML לא תקין: ' + e.message), { status: 400 });
  }
  const keys = Object.keys(obj).filter((k) => !k.startsWith('?'));
  if (keys.length === 1) {
    const root = obj[keys[0]];
    return root && typeof root === 'object' ? root : { [keys[0]]: root };
  }
  return obj;
}

/** Collect array paths ("items.item") so single occurrences stay arrays. */
export function findArrays(data, prefix = '', out = new Set()) {
  if (Array.isArray(data)) {
    if (prefix) out.add(prefix);
    for (const it of data.slice(0, 50)) findArrays(it, prefix, out);
  } else if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data)) findArrays(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

function mergeItems(items) {
  const merged = {};
  for (const it of items.slice(0, 50)) {
    if (it && typeof it === 'object' && !Array.isArray(it)) {
      for (const [k, v] of Object.entries(it)) {
        if (!(k in merged) || merged[k] === '' || merged[k] === null) merged[k] = v;
        else if (Array.isArray(v) && !Array.isArray(merged[k])) merged[k] = v;
      }
    }
  }
  return merged;
}

function sampleOf(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && '#text' in v) return String(v['#text']).slice(0, 80);
  if (typeof v === 'object') return '';
  return String(v).slice(0, 80);
}

/**
 * A tree describing the data for the designer.
 * Node: { name, path, kind: 'object'|'array'|'value', sample, children }
 * Paths inside arrays are relative to the array item (what table columns use).
 */
export function buildTree(data, path = '', name = '') {
  if (Array.isArray(data)) {
    const merged = mergeItems(data);
    const scalarItems = data.length && data.every((x) => x === null || typeof x !== 'object');
    return {
      name, path, kind: 'array', count: data.length,
      sample: scalarItems ? sampleOf(data[0]) : '',
      children: scalarItems ? [] : childrenOf(merged, ''),
    };
  }
  if (data && typeof data === 'object') {
    const onlyText = Object.keys(data).every((k) => k === '#text' || k.startsWith('@'));
    if (onlyText && '#text' in data) {
      return { name, path, kind: 'value', sample: sampleOf(data), children: childrenOf(data, path).filter((c) => c.name !== '#text') };
    }
    return { name, path, kind: 'object', children: childrenOf(data, path) };
  }
  return { name, path, kind: 'value', sample: sampleOf(data) };
}

function childrenOf(obj, base) {
  return Object.entries(obj).map(([k, v]) => buildTree(v, base ? `${base}.${k}` : k, k));
}

export function describeData(content, opts = {}) {
  const format = opts.format || (typeof content === 'string' ? detectFormat(content) : 'json');
  const data = parseData(content, { format, arrays: opts.arrays });
  const arrays = [...findArrays(data)];
  return { format, data, arrays, tree: buildTree(data) };
}
