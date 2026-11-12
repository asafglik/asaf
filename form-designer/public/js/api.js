// Thin fetch wrapper for the designer.
let apiKey = '';
try { apiKey = localStorage.getItem('fd-api-key') || ''; } catch { /* storage blocked */ }

export function setApiKey(k) {
  apiKey = k;
  try { localStorage.setItem('fd-api-key', k); } catch { /* ignore */ }
}
// the key is sent only in the x-api-key header (never in URLs)
export function keyQuery() {
  return '';
}

async function request(method, url, body, { raw = false } = {}) {
  const headers = {};
  if (apiKey) headers['x-api-key'] = apiKey;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 401) {
    const k = prompt('השרת דורש מפתח API. הזינו מפתח:');
    if (k) {
      setApiKey(k);
      return request(method, url, body, { raw });
    }
  }
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  return raw ? res : res.json();
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b) => request('POST', u, b),
  put: (u, b) => request('PUT', u, b),
  del: (u) => request('DELETE', u),
  raw: (method, u, b) => request(method, u, b, { raw: true }),
};
