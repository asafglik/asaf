// Decoding XML / JSON bytes from legacy systems. Order of precedence:
// byte order mark, an explicit charset (HTTP Content-Type), the XML
// declaration (<?xml ... encoding="WINDOWS-1255"?>), then UTF-8 - and if the
// bytes are not valid UTF-8, Hebrew Windows (windows-1255).

const ALIASES = {
  'iso-8859-8-i': 'iso-8859-8', 'iso-8859-8-e': 'iso-8859-8', 'hebrew': 'iso-8859-8',
  'cp1255': 'windows-1255', 'win-1255': 'windows-1255', 'x-cp1255': 'windows-1255',
  'utf8': 'utf-8', 'ucs-2': 'utf-16le', 'utf-16': 'utf-16le',
};

function normalize(cs) {
  const c = String(cs || '').trim().toLowerCase().replace(/^["']|["']$/g, '');
  return ALIASES[c] || c;
}

function decoder(cs, fatal = false) {
  try {
    return new TextDecoder(normalize(cs), { fatal });
  } catch {
    return null; // unknown encoding name
  }
}

/** The encoding named in the XML declaration, if any. */
export function declaredEncoding(bytes) {
  const head = String.fromCharCode(...bytes.subarray(0, Math.min(bytes.length, 200)));
  const m = /^\s*<\?xml[^>]*encoding\s*=\s*["']([A-Za-z0-9._:-]+)["']/i.exec(head);
  return m ? m[1] : null;
}

/** Decode bytes (Uint8Array / Buffer) to text. charset: optional, e.g. from Content-Type. */
export function decodeBytes(bytes, charset) {
  if (typeof bytes === 'string') return bytes;
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8').decode(b.subarray(3));
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  for (const cs of [charset, declaredEncoding(b)]) {
    const d = cs && decoder(cs);
    if (d) return d.decode(b);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    return new TextDecoder('windows-1255').decode(b);
  }
}

/** charset parameter of a Content-Type header ("application/xml; charset=windows-1255"). */
export function charsetOf(contentType) {
  const m = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType || '');
  return m ? m[1] : null;
}
