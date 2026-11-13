// Guided tour: highlights one part of the screen at a time with an explanation.
// startTour(steps) - steps: [{ el: 'css selector', title, text, before?: () => void, place?: 'auto'|'center' }]

let current = null;

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export function startTour(steps, { onEnd } = {}) {
  endTour();
  const shade = el('div', 'tour-shade');
  const spot = el('div', 'tour-spot');
  const card = el('div', 'tour-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-live', 'polite');
  document.body.append(shade, spot, card);
  let i = 0;

  const visible = (s) => {
    const t = s.el && document.querySelector(s.el);
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? t : null;
  };

  function show() {
    const s = steps[i];
    s.before?.();
    // let the UI react to before() (tab switches, menus) before measuring
    requestAnimationFrame(() => requestAnimationFrame(() => place(s)));
  }

  function place(s) {
    const target = visible(s);
    card.innerHTML = `
      <div class="tour-step">${i + 1} / ${steps.length}</div>
      <h3>${s.title}</h3>
      <div class="tour-text">${s.text}</div>
      <div class="tour-actions">
        <button type="button" class="btn" data-t="skip">סיום ההדרכה</button>
        <span class="spacer"></span>
        ${i > 0 ? '<button type="button" class="btn" data-t="prev">הקודם</button>' : ''}
        <button type="button" class="btn btn-primary" data-t="next">${i === steps.length - 1 ? 'סיום' : 'הבא'}</button>
      </div>`;
    if (target) {
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = target.getBoundingClientRect();
      const pad = 6;
      Object.assign(spot.style, { display: 'block', left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
      shade.classList.remove('full');
      // card beside the target: below when there is room, otherwise above / at the side
      const cw = Math.min(360, window.innerWidth - 24);
      card.style.width = `${cw}px`;
      const ch = card.offsetHeight;
      let top = r.bottom + 14;
      if (top + ch > window.innerHeight - 8) top = r.top - ch - 14;
      if (top < 8) top = Math.min(window.innerHeight - ch - 8, Math.max(8, r.top + r.height / 2 - ch / 2));
      let left = r.left + r.width / 2 - cw / 2;
      if (r.width > window.innerWidth * 0.5 && top > r.top && top < r.bottom) left = r.left + 20;
      left = Math.max(12, Math.min(window.innerWidth - cw - 12, left));
      Object.assign(card.style, { top: `${top}px`, left: `${left}px`, transform: 'none' });
    } else {
      spot.style.display = 'none';
      shade.classList.add('full');
      Object.assign(card.style, { width: `${Math.min(420, window.innerWidth - 24)}px`, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' });
    }
    card.querySelector('[data-t="next"]').focus();
  }

  function go(d) {
    i += d;
    if (i < 0) i = 0;
    if (i >= steps.length) return endTour();
    show();
  }

  card.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-t]')?.dataset.t;
    if (t === 'next') go(1);
    else if (t === 'prev') go(-1);
    else if (t === 'skip') endTour();
  });
  const onKey = (ev) => {
    if (ev.key === 'Escape') endTour();
    else if (ev.key === 'ArrowLeft' || ev.key === 'Enter') { ev.preventDefault(); go(1); }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); go(-1); }
    ev.stopPropagation();
  };
  const onResize = () => place(steps[i]);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  current = () => {
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    shade.remove();
    spot.remove();
    card.remove();
    onEnd?.();
  };
  show();
}

export function endTour() {
  if (current) {
    const c = current;
    current = null;
    c();
  }
}

/** Show the tour automatically the first time a screen is opened. */
export function firstVisit(key) {
  try {
    if (localStorage.getItem(key)) return false;
    localStorage.setItem(key, '1');
    return true;
  } catch {
    return false;
  }
}
