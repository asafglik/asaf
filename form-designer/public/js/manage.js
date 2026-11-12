// Template management: list, edit, duplicate, delete, link to customers;
// customers with their API keys and installation bundles.
import { api } from './api.js';
import { escapeHtml } from '/shared/elements.js';
import { readFileAsText, download } from './util.js';

const $ = (s, r = document) => r.querySelector(s);
let templates = [];
let customers = [];

// ---------------------------------------------------------------- ui helpers
let toastTimer;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, kind === 'error' ? 6000 : 2800);
}

const dlg = $('#dlg');
function openDialog({ title, html, buttons = [], wide = false, onOpen }) {
  $('#dlg-title').textContent = title;
  $('#dlg-body').innerHTML = html;
  const foot = $('#dlg-foot');
  foot.innerHTML = '';
  dlg.classList.toggle('wide', wide);
  return new Promise((resolve) => {
    let done = false;
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn' + (b.primary ? ' btn-primary' : '') + (b.danger ? ' btn-danger' : '');
      btn.textContent = b.label;
      btn.onclick = async () => {
        if (!b.action) { done = true; dlg.close(); resolve(b.value); return; }
        try {
          btn.disabled = true;
          const r = await b.action($('#dlg-body'));
          if (r === false) { btn.disabled = false; return; }
          done = true;
          dlg.close();
          resolve(r);
        } catch (e) {
          btn.disabled = false;
          toast(e.message, 'error');
        }
      };
      foot.appendChild(btn);
    }
    dlg.onclose = () => { if (!done) resolve(undefined); };
    dlg.showModal();
    onOpen?.($('#dlg-body'));
  });
}

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
const custName = (id) => customers.find((c) => c.id === id)?.name || `#${id}`;

// ---------------------------------------------------------------- data
async function load() {
  [templates, customers] = await Promise.all([api.get('/api/templates'), api.get('/api/customers')]);
  renderTemplates();
  renderCustomers();
  const sel = $('#tpl-customer');
  const cur = sel.value;
  sel.innerHTML = '<option value="">כל הלקוחות</option><option value="__none">ללא לקוח</option>' + customers.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
  sel.value = cur;
}

// ---------------------------------------------------------------- templates
function renderTemplates() {
  const q = $('#tpl-search').value.trim().toLowerCase();
  const cf = $('#tpl-customer').value;
  const list = templates.filter((t) => {
    if (q && !`${t.id} ${t.name} ${t.description}`.toLowerCase().includes(q)) return false;
    if (cf === '__none') return !t.customers.length;
    if (cf) return t.customers.includes(cf);
    return true;
  });
  $('#tpl-count').textContent = `${templates.length} תבניות${list.length !== templates.length ? ` · מוצגות ${list.length}` : ''}`;
  $('#tpl-empty').hidden = templates.length > 0;
  $('#tpl-noresults').hidden = !(templates.length && !list.length);
  $('#tpl-table tbody').innerHTML = list.map((t) => `
    <tr data-id="${escapeHtml(t.id)}">
      <td class="t-id">#${escapeHtml(t.id)}</td>
      <td class="t-name"><a href="/designer.html#${encodeURIComponent(t.id)}">${escapeHtml(t.name || 'ללא שם')}</a>
        ${t.hasSource ? '<span class="badge src" title="נבנתה על קובץ PDF מקור">PDF</span>' : ''} ${t.format ? `<span class="badge">${escapeHtml(String(t.format).toUpperCase())}</span>` : ''}
        <small>${escapeHtml(t.description || '')}</small></td>
      <td><div class="tags">${t.customers.map((c) => `<span class="tag">${escapeHtml(custName(c))}</span>`).join('')}<button class="tag add" data-act="link" title="שיוך ללקוחות">+ שיוך</button></div></td>
      <td class="t-num">${t.pages}</td>
      <td class="t-num">${t.placeholders || '—'}</td>
      <td class="t-num">${fmtDate(t.updatedAt) || '—'}</td>
      <td class="t-actions">
        <a class="btn" href="/designer.html#${encodeURIComponent(t.id)}">עריכה</a>
        <button class="btn" data-act="duplicate">שכפול</button>
        <span class="more"><button class="btn" data-act="more" aria-haspopup="true">⋯</button></span>
      </td>
    </tr>`).join('');
}

function closeMenus() {
  document.querySelectorAll('.more-pop').forEach((m) => m.remove());
}

async function duplicate(id) {
  const t = templates.find((x) => x.id === id);
  const { id: next } = await api.get('/api/next-id');
  const res = await openDialog({
    title: `שכפול תבנית #${id}`,
    html: `<label class="f"><span>מספר התבנית החדשה</span><input id="d-id" class="input-lg" dir="ltr" value="${escapeHtml(next)}"></label>
      <label class="f"><span>שם</span><input id="d-name" class="input-lg" value="${escapeHtml((t?.name || '') + ' (עותק)')}"></label>
      <p class="hint">העותק כולל את כל העיצוב, עולם הנתונים, קובץ המקור והשיוך ללקוחות.</p>`,
    buttons: [{ label: 'ביטול' }, { label: 'שכפול', primary: true, action: (b) => api.post(`/api/templates/${encodeURIComponent(id)}/duplicate`, { id: $('#d-id', b).value.trim(), name: $('#d-name', b).value.trim() }) }],
  });
  if (res) {
    toast(`נוצרה תבנית #${res.id}`, 'ok');
    await load();
  }
}

async function linkCustomers(id) {
  if (!customers.length) {
    toast('עדיין אין לקוחות. צרו לקוח בלשונית "לקוחות".');
    return;
  }
  const t = templates.find((x) => x.id === id);
  const res = await openDialog({
    title: `שיוך תבנית #${id} ללקוחות`,
    html: `<div class="check-list">${customers.map((c) => `<label><input type="checkbox" value="${escapeHtml(c.id)}"${t.customers.includes(c.id) ? ' checked' : ''}> ${escapeHtml(c.name)} <span class="muted">${escapeHtml(c.code || '')}</span></label>`).join('')}</div>`,
    buttons: [{ label: 'ביטול' }, { label: 'שמירה', primary: true, action: (b) => api.put(`/api/templates/${encodeURIComponent(id)}/customers`, { customers: [...b.querySelectorAll('input:checked')].map((i) => i.value) }) }],
  });
  if (res) { toast('השיוך נשמר', 'ok'); await load(); }
}

async function previewTemplate(id) {
  const w = window.open('', '_blank');
  try {
    const t = await api.get(`/api/templates/${encodeURIComponent(id)}`);
    const res = await api.raw('POST', '/api/preview', { template: t, data: t.schema?.sample || {} });
    const blob = await res.blob();
    w.location.href = URL.createObjectURL(blob);
  } catch (e) {
    w.close();
    toast(e.message, 'error');
  }
}

async function showPlaceholders(id) {
  const r = await api.get(`/api/templates/${encodeURIComponent(id)}/placeholders`);
  const rows = r.placeholders.map((p) => `<tr><td><code dir="ltr">${escapeHtml(p.name)}</code></td><td>${p.type === 'signature' ? 'חתימה' : 'העלאת תמונה'}</td><td>${escapeHtml(p.label)}</td><td>${p.band ? (p.band === 'header' ? 'כותרת עליונה' : 'כותרת תחתונה') : p.page}</td><td><bdi>${p.mm.x}, ${p.mm.y}</bdi></td><td><bdi>${p.mm.width} × ${p.mm.height}</bdi></td></tr>`).join('');
  await openDialog({
    title: `אזורי חתימה ותמונה – תבנית ${id}`,
    wide: true,
    html: r.placeholders.length
      ? `<table class="help-table ph-table"><thead><tr><th>שם</th><th>סוג</th><th>תווית</th><th>עמוד</th><th>X, Y (מ"מ)</th><th>רוחב × גובה</th></tr></thead><tbody>${rows}</tbody></table>
         <pre dir="ltr">GET /api/templates/${escapeHtml(id)}/placeholders</pre>`
      : '<p class="muted">אין בתבנית אזורי חתימה או העלאת תמונה.</p>',
    buttons: [{ label: 'סגירה', primary: true }],
  });
}

async function deleteTemplate(id) {
  const t = templates.find((x) => x.id === id);
  const ok = await openDialog({
    title: 'מחיקת תבנית',
    html: `<p>למחוק את תבנית <b>#${escapeHtml(id)}</b> (${escapeHtml(t?.name || '')})? מערכות שמפיקות מסמכים עם המספר הזה יקבלו שגיאה.</p>`,
    buttons: [{ label: 'ביטול', value: false }, { label: 'מחיקה', danger: true, value: true }],
  });
  if (!ok) return;
  await api.del(`/api/templates/${encodeURIComponent(id)}`);
  toast('התבנית נמחקה');
  await load();
}

$('#tpl-table').addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-act]');
  if (!b) return;
  const id = b.closest('tr')?.dataset.id;
  try {
    switch (b.dataset.act) {
      case 'duplicate': await duplicate(id); break;
      case 'link': await linkCustomers(id); break;
      case 'more': {
        ev.stopPropagation();
        const open = b.parentElement.querySelector('.more-pop');
        closeMenus();
        if (open) return;
        const pop = document.createElement('div');
        pop.className = 'more-pop';
        // fixed position so the table container does not clip it; open upwards near the bottom
        const r = b.getBoundingClientRect();
        pop.style.position = 'fixed';
        pop.style.left = `${Math.max(8, r.left)}px`;
        if (window.innerHeight - r.bottom < 230) pop.style.bottom = `${window.innerHeight - r.top + 4}px`;
        else pop.style.top = `${r.bottom + 4}px`;
        pop.innerHTML = `<button data-act="preview">תצוגה מקדימה PDF</button><button data-act="link">שיוך ללקוחות</button><button data-act="placeholders">אזורי חתימה ותמונה</button><button data-act="export">ייצוא (JSON)</button><hr><button data-act="delete" class="danger">מחיקה</button>`;
        b.parentElement.appendChild(pop);
        break;
      }
      case 'preview': closeMenus(); await previewTemplate(id); break;
      case 'placeholders': closeMenus(); await showPlaceholders(id); break;
      case 'export': {
        closeMenus();
        const t = await api.get(`/api/templates/${encodeURIComponent(id)}`);
        download(`template-${id}.json`, JSON.stringify(t, null, 2));
        break;
      }
      case 'delete': closeMenus(); await deleteTemplate(id); break;
    }
  } catch (e) {
    toast(e.message, 'error');
  }
});
document.addEventListener('click', (ev) => { if (!ev.target.closest('.more')) closeMenus(); });
$('#tpl-search').addEventListener('input', renderTemplates);
$('#tpl-customer').addEventListener('change', renderTemplates);

// ---------------------------------------------------------------- customers
function renderCustomers() {
  $('#cust-grid').innerHTML = customers.length ? customers.map((c) => `
    <article class="cust" data-id="${escapeHtml(c.id)}">
      <h3>${escapeHtml(c.name)} ${c.code ? `<span class="code">${escapeHtml(c.code)}</span>` : ''}</h3>
      <div class="meta">${[c.contact, c.email, c.phone].filter(Boolean).map(escapeHtml).join(' · ') || '&nbsp;'}</div>
      <div class="tags">${c.templates.map((id) => `<span class="tag" title="${escapeHtml(templates.find((t) => t.id === id)?.name || '')}">#${escapeHtml(id)}</span>`).join('') || '<span class="muted">אין תבניות משויכות</span>'}</div>
      <div class="key">${c.hasApiKey ? `🔑 מפתח API מוגדר (מסתיים ב-<bdi>${escapeHtml(c.apiKeyHint || '')}</bdi>) – הלקוח יכול להפיק רק את התבניות שלו` : 'ללא מפתח API ייעודי'}</div>
      <div class="btn-row">
        <button class="btn" data-act="c-templates">תבניות</button>
        <button class="btn" data-act="c-edit">עריכה</button>
        <button class="btn" data-act="c-bundle" title="קובץ להתקנת התבניות בשרת הלקוח">חבילת התקנה</button>
        <button class="btn danger-text" data-act="c-delete">מחיקה</button>
      </div>
    </article>`).join('') : '<div class="empty-hint">אין עדיין לקוחות.</div>';
}

function randomKey() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return 'fdk_' + [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function editCustomer(c = {}) {
  const res = await openDialog({
    title: c.id ? `עריכת לקוח – ${c.name}` : 'לקוח חדש',
    html: `
      <label class="f"><span>שם *</span><input id="c-name" class="input-lg" value="${escapeHtml(c.name || '')}"></label>
      <label class="f"><span>קוד לקוח</span><input id="c-code" class="input-lg" value="${escapeHtml(c.code || '')}"></label>
      <label class="f"><span>איש קשר</span><input id="c-contact" class="input-lg" value="${escapeHtml(c.contact || '')}"></label>
      <label class="f"><span>אימייל</span><input id="c-email" class="input-lg" dir="ltr" value="${escapeHtml(c.email || '')}"></label>
      <label class="f"><span>טלפון</span><input id="c-phone" class="input-lg" dir="ltr" value="${escapeHtml(c.phone || '')}"></label>
      <label class="f"><span>${c.hasApiKey ? 'מפתח API חדש' : 'מפתח API'}</span><input id="c-key" class="input-lg" dir="ltr" value="" placeholder="${c.hasApiKey ? `מוגדר מפתח שמסתיים ב-${escapeHtml(c.apiKeyHint || '')} – השאירו ריק כדי לא לשנות` : 'ללא'}"></label>
      <div class="btn-row"><button type="button" class="btn" id="c-gen">יצירת מפתח</button>${c.hasApiKey ? '<label class="f-check"><input type="checkbox" id="c-rmkey"> הסרת המפתח הקיים</label>' : ''}</div>
      <p class="hint" id="c-keyhint">עם המפתח בכותרת <code dir="ltr">x-api-key</code> הלקוח יכול להפיק רק תבניות שמשויכות אליו. המפתח נשמר בשרת בצורה מוצפנת (hash) ולא יוצג שוב – העתיקו אותו עכשיו.</p>
      <label class="f f-col"><span>הערות</span><textarea id="c-notes" rows="2">${escapeHtml(c.notes || '')}</textarea></label>`,
    buttons: [{ label: 'ביטול' }, { label: 'שמירה', primary: true, action: (b) => {
      const body = {
        name: $('#c-name', b).value, code: $('#c-code', b).value, contact: $('#c-contact', b).value,
        email: $('#c-email', b).value, phone: $('#c-phone', b).value, apiKey: $('#c-key', b).value.trim(), notes: $('#c-notes', b).value,
        removeApiKey: !!$('#c-rmkey', b)?.checked,
      };
      return c.id ? api.put(`/api/customers/${c.id}`, body) : api.post('/api/customers', body);
    } }],
    onOpen: (b) => {
      $('#c-gen', b).onclick = () => {
        const k = $('#c-key', b);
        k.value = randomKey();
        k.select();
        navigator.clipboard?.writeText(k.value).then(() => toast('המפתח הועתק ללוח'), () => {});
      };
      $('#c-name', b).focus();
    },
  });
  if (res) { toast('הלקוח נשמר', 'ok'); await load(); }
}

async function customerTemplates(c) {
  const res = await openDialog({
    title: `תבניות של ${c.name}`,
    html: templates.length
      ? `<input type="search" id="ct-q" class="input-lg" placeholder="חיפוש..."><div class="check-list" id="ct-list">${templates.map((t) => `<label data-q="${escapeHtml(`${t.id} ${t.name}`.toLowerCase())}"><input type="checkbox" value="${escapeHtml(t.id)}"${c.templates.includes(t.id) ? ' checked' : ''}><span class="t-id">#${escapeHtml(t.id)}</span>${escapeHtml(t.name)}</label>`).join('')}</div>`
      : '<p class="muted">אין תבניות.</p>',
    buttons: [{ label: 'ביטול' }, { label: 'שמירה', primary: true, action: (b) => api.put(`/api/customers/${c.id}/templates`, { templates: [...b.querySelectorAll('#ct-list input:checked')].map((i) => i.value) }) }],
    onOpen: (b) => {
      const q = $('#ct-q', b);
      if (q) q.oninput = () => b.querySelectorAll('#ct-list label').forEach((l) => { l.style.display = l.dataset.q.includes(q.value.toLowerCase()) ? '' : 'none'; });
    },
  });
  if (res) { toast('השיוך נשמר', 'ok'); await load(); }
}

async function bundle(c) {
  const res = await api.raw('GET', `/api/customers/${c.id}/bundle`);
  download(`bundle-customer-${c.id}.json`, await res.blob());
  await openDialog({
    title: 'חבילת התקנה',
    html: `<p>הקובץ כולל את ${c.templates.length} התבניות של ${escapeHtml(c.name)}. להתקנה בשרת הלקוח:</p>
      <pre dir="ltr">node cli/import-bundle.js bundle-customer-${escapeHtml(c.id)}.json
npm run start:render</pre>`,
    buttons: [{ label: 'סגירה', primary: true }],
  });
}

$('#cust-grid').addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-act]');
  if (!b) return;
  const c = customers.find((x) => x.id === b.closest('.cust').dataset.id);
  try {
    if (b.dataset.act === 'c-edit') await editCustomer(c);
    else if (b.dataset.act === 'c-templates') await customerTemplates(c);
    else if (b.dataset.act === 'c-bundle') await bundle(c);
    else if (b.dataset.act === 'c-delete') {
      const ok = await openDialog({ title: 'מחיקת לקוח', html: `<p>למחוק את ${escapeHtml(c.name)}? השיוך לתבניות יוסר (התבניות עצמן לא נמחקות).</p>`, buttons: [{ label: 'ביטול', value: false }, { label: 'מחיקה', danger: true, value: true }] });
      if (ok) { await api.del(`/api/customers/${c.id}`); await load(); }
    }
  } catch (e) {
    toast(e.message, 'error');
  }
});

// ---------------------------------------------------------------- page actions
document.addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-act="customer-new"], [data-act="import-json"]');
  if (!b) return;
  try {
    if (b.dataset.act === 'customer-new') await editCustomer();
    else {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.json,application/json';
      inp.onchange = async () => {
        try {
          const t = JSON.parse(await readFileAsText(inp.files[0]));
          if (!t.pages) throw new Error('הקובץ אינו תבנית');
          let saved;
          try {
            saved = await api.post('/api/templates', t);
          } catch (e) {
            if (!/כבר קיימת/.test(e.message) || !confirm(`${e.message}. לדרוס?`)) throw e;
            saved = await api.post('/api/templates?overwrite=1', t);
          }
          toast(`התבנית #${saved.id} יובאה`, 'ok');
          await load();
        } catch (e) {
          toast(e.message, 'error');
        }
      };
      inp.click();
    }
  } catch (e) {
    toast(e.message, 'error');
  }
});

document.querySelector('.mtabs').addEventListener('click', (ev) => {
  const b = ev.target.closest('.mtab');
  if (!b) return;
  showView(b.dataset.view);
  history.replaceState(null, '', b.dataset.view === 'customers' ? '#customers' : '#');
});
function showView(v) {
  document.querySelectorAll('.mtab').forEach((x) => x.classList.toggle('on', x.dataset.view === v));
  document.querySelectorAll('.view').forEach((x) => x.classList.toggle('on', x.dataset.view === v));
}

if (location.hash === '#customers') showView('customers');
load().catch((e) => toast(e.message, 'error'));
api.get('/api/health').then((h) => {
  $('#server-info').textContent = h.chrome ? '' : '⚠ לא נמצא דפדפן להפקת PDF בשרת';
}).catch(() => {});
