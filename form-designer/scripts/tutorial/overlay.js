module.exports = { overlay };
// ---- overlay injected into every page: captions, title cards, cursor, highlight
function overlay() {
  localStorage.setItem('fd-tour-designer', '1');
  localStorage.setItem('fd-tour-manage', '1');
  const css = `
  #v-layer{position:fixed;inset:0;margin:0;padding:0;border:0;background:transparent;width:100vw;height:100vh;max-width:none;max-height:none;overflow:visible;pointer-events:none;font-family:Heebo,Rubik,Arial,sans-serif}
  #v-cap{position:absolute;left:50%;bottom:26px;transform:translateX(-50%);max-width:980px;direction:rtl;text-align:center;background:rgba(15,23,42,.92);color:#fff;border-radius:14px;padding:14px 26px 16px;box-shadow:0 10px 30px rgba(0,0,0,.35);transition:opacity .35s;opacity:0}
  #v-cap.on{opacity:1}
  #v-cap b{display:block;font-size:15px;color:#93c5fd;font-weight:600;margin-bottom:4px;letter-spacing:.2px}
  #v-cap span{font-size:23px;line-height:1.45;font-weight:500}
  #v-card{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;direction:rtl;background:linear-gradient(135deg,#0f172a 0%,#1e3a8a 100%);color:#fff;opacity:0;transition:opacity .5s;text-align:center}
  #v-card.on{opacity:1}
  #v-card h1{font-size:54px;margin:0 0 14px;font-weight:700}
  #v-card h2{font-size:26px;margin:0 0 34px;font-weight:400;color:#bfdbfe}
  #v-card ul{list-style:none;padding:0;margin:0;font-size:27px;line-height:2.05;text-align:right}
  #v-card li::before{content:"";display:inline-block;width:12px;height:12px;border-radius:50%;background:#60a5fa;margin-inline-end:16px;vertical-align:middle}
  #v-card .num{display:inline-block;min-width:44px;height:44px;line-height:44px;border-radius:50%;background:#2563eb;margin-inline-end:16px;font-weight:700;text-align:center}
  #v-card ul.steps li::before{display:none}
  #v-card code{direction:ltr;display:inline-block;background:rgba(255,255,255,.12);padding:2px 12px;border-radius:8px;font-size:22px}
  #v-cur{position:absolute;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(239,68,68,.55);border:2px solid #fff;box-shadow:0 0 0 2px rgba(239,68,68,.6);transition:transform .12s;left:-50px;top:-50px}
  #v-cur.down{transform:scale(.7)}
  #v-hl{position:absolute;border:3px solid #f59e0b;border-radius:10px;box-shadow:0 0 0 9999px rgba(15,23,42,.28);opacity:0;transition:opacity .35s, all .35s}
  #v-hl.on{opacity:1}`;
  const init = () => {
    if (document.getElementById('v-layer')) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const layer = document.createElement('div'); layer.id = 'v-layer'; layer.setAttribute('popover', 'manual');
    layer.innerHTML = '<div id="v-hl"></div><div id="v-card"></div><div id="v-cap"><b></b><span></span></div><div id="v-cur"></div>';
    document.body.appendChild(layer);
    layer.showPopover();
    const raise = () => { try { layer.hidePopover(); layer.showPopover(); } catch {} };
    window.__raise = raise;
    // keep the overlay above modal dialogs (top layer)
    new MutationObserver((m) => { if (m.some((r) => r.attributeName === 'open' && r.target.open)) raise(); })
      .observe(document.body, { attributes: true, subtree: true, attributeFilter: ['open'] });
    const cur = layer.querySelector('#v-cur');
    const mv = (e) => { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px'; };
    addEventListener('mousemove', mv, true); addEventListener('dragover', mv, true); addEventListener('drag', (e) => { if (e.clientX) mv(e); }, true);
    addEventListener('mousedown', () => cur.classList.add('down'), true);
    addEventListener('mouseup', () => cur.classList.remove('down'), true);
    addEventListener('drop', () => cur.classList.remove('down'), true);
  };
  window.__cap = (title, text) => {
    init();
    const c = document.getElementById('v-cap');
    if (!text) { c.classList.remove('on'); return; }
    c.querySelector('b').textContent = title || '';
    c.querySelector('b').style.display = title ? '' : 'none';
    c.querySelector('span').innerHTML = text;
    c.classList.add('on');
  };
  window.__card = (html) => {
    init();
    const c = document.getElementById('v-card');
    if (!html) { c.classList.remove('on'); document.getElementById('v-cur').style.opacity = 1; return; }
    c.innerHTML = html; c.classList.add('on');
    document.getElementById('v-cur').style.opacity = 0;
  };
  window.__hl = (sel, pad = 6) => {
    init();
    const h = document.getElementById('v-hl');
    const el = sel && document.querySelector(sel);
    if (!el) { h.classList.remove('on'); return; }
    const r = el.getBoundingClientRect();
    Object.assign(h.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    h.classList.add('on');
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
}

