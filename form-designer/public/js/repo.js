// Template repository page: a customer lists and downloads the templates built
// for it (API key or design key); the admin picks a customer.
import { api } from './api.js';
import { escapeHtml } from '/shared/elements.js';
import { download } from './util.js';

const $ = (s) => document.querySelector(s);
let me = { role: 'admin' };
let customerId = '';

function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show ' + kind;
  setTimeout(() => { t.className = 'toast'; }, kind === 'error' ? 6000 : 2800);
}
const q = () => (me.role === 'admin' ? `?customer=${encodeURIComponent(customerId)}` : '');
const fmt = (d) => (d ? new Date(d).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

async function loadList() {
  const rows = customerId || me.role !== 'admin' ? await api.get('/api/repo/templates' + q()) : [];
  $('#repo-body').innerHTML = rows.map((t) => `
    <tr>
      <td class="t-id">#${escapeHtml(t.id)}</td>
      <td class="t-name"><b>${escapeHtml(t.name || 'ללא שם')}</b>${t.format ? ` <span class="badge">${escapeHtml(String(t.format).toUpperCase())}</span>` : ''}<small>${escapeHtml(t.description || '')}</small></td>
      <td class="t-num">${t.pages}</td>
      <td>${(t.languages || []).map((l) => `<span class="tag">${escapeHtml(l)}</span>`).join(' ')}</td>
      <td class="t-num">${t.placeholders || '—'}</td>
      <td class="t-num">${fmt(t.updatedAt)}</td>
      <td class="t-actions"><button class="btn" data-dl="${escapeHtml(t.id)}">הורדה</button></td>
    </tr>`).join('');
  $('#repo-empty').hidden = rows.length > 0;
  $('#repo-bundle').disabled = !rows.length;
}

async function init() {
  me = await api.get('/api/me');
  if (me.role === 'render') $('#nav-manage').hidden = true;
  $('#who').innerHTML = `${me.customer ? `לקוח: <b>${escapeHtml(me.customer.name)}</b>` : 'מנהל'} <button class="link" id="logout" type="button">החלפת מפתח</button>`;
  $('#logout').onclick = () => { try { localStorage.removeItem('fd-api-key'); } catch { /* ignore */ } location.reload(); };
  if (me.role === 'admin') {
    const customers = await api.get('/api/customers');
    const sel = $('#repo-customer');
    sel.hidden = false;
    sel.innerHTML = '<option value="">בחירת לקוח...</option>' + customers.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
    sel.onchange = () => { customerId = sel.value; loadList().catch((e) => toast(e.message, 'error')); };
    $('#repo-sub').textContent = 'התבניות של כל לקוח, כפי שהלקוח רואה אותן ומוריד אותן.';
  }
  const origin = location.origin;
  $('#repo-env').textContent = `FD_MODE=render\nFD_REPO_URL=${origin}\nFD_REPO_KEY=<YOUR-RENDER-KEY>\n# docker: deploy/docker-compose.render.yml + deploy/.env`;
  $('#repo-cli').textContent = `node cli/sync.js --repo ${origin} --key <YOUR-RENDER-KEY>\nnode cli/import-bundle.js bundle-customer-${me.customer?.id || '<id>'}.json --prune`;
  $('#repo-curl').textContent = `curl -X POST http://<your-server>:3700/api/render/<template-id> \\\n  -H "x-api-key: <YOUR-RENDER-KEY>" -H "Content-Type: application/xml" \\\n  --data-binary @data.xml -o out.pdf`;
  await loadList();
}

document.addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-dl]');
  if (!b) return;
  try {
    const res = await api.raw('GET', `/api/repo/templates/${encodeURIComponent(b.dataset.dl)}${q()}${q() ? '&' : '?'}download=1`);
    download(`template-${b.dataset.dl}.json`, await res.blob());
  } catch (e) {
    toast(e.message, 'error');
  }
});
$('#repo-bundle').onclick = async () => {
  try {
    const res = await api.raw('GET', '/api/repo/bundle' + q());
    download(`bundle-customer-${me.customer?.id || customerId}.json`, await res.blob());
  } catch (e) {
    toast(e.message, 'error');
  }
};
init().catch((e) => toast(e.message, 'error'));
