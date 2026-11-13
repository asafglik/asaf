// Runs inside the headless browser after the document is laid out.
// Splits overflowing tables / rich text (elements marked data-flow) into
// continuation pages, applies "show on first/last page" rules and fills in
// page numbers. Returns, for every output page, the template page index, the
// signature / upload placeholders and warnings about clipped content.
// This function must stay self-contained: it is serialized into the page.
export function paginate() {
  const MM = 96 / 25.4;
  const EPS = 0.5;
  const warnings = [];
  const pages = Array.from(document.querySelectorAll('.fd-page'));
  const INLINE = /^(B|STRONG|I|EM|U|S|STRIKE|SPAN|FONT|A|SUB|SUP|BR|IMG|CODE|SMALL|BIG|MARK)$/;

  function applyShowOn(page, idx, count) {
    page.querySelectorAll('[data-show-on]').forEach((el) => {
      const r = el.getAttribute('data-show-on');
      const first = idx === 0;
      const last = idx === count - 1;
      const keep = r === 'first' ? first : r === 'last' ? last : r === 'notFirst' ? !first : r === 'notLast' ? !last : true;
      if (!keep) el.remove();
    });
  }

  function splitHeights(heights, boxFirst, boxNext, fixedTop, footH) {
    // returns [[from, to, showFooter], ...]
    if (!heights.length) return [[0, 0, true]];
    const segs = [];
    let i = 0;
    let first = true;
    for (let guard = 0; guard < 10000; guard++) {
      const H = (first ? boxFirst : boxNext) - fixedTop;
      let sum = 0;
      let j = i;
      while (j < heights.length && sum + heights[j] <= H + EPS) sum += heights[j++];
      if (j === i && i < heights.length) { sum += heights[j]; j++; }
      if (j >= heights.length) {
        if (sum + footH <= H + EPS || footH === 0) { segs.push([i, j, true]); break; }
        let k = j;
        let s2 = sum;
        while (k > i && s2 + footH > H + EPS) { k--; s2 -= heights[k]; }
        if (k === i) { segs.push([i, j, false]); segs.push([j, j, true]); break; }
        segs.push([i, k, false]);
        i = k;
        first = false;
        continue;
      }
      segs.push([i, j, false]);
      i = j;
      first = false;
    }
    return segs;
  }

  // ---- rich text: make every top-level child a block that can be measured and moved
  function wrapInlineRuns(flow) {
    let run = null;
    for (const n of Array.from(flow.childNodes)) {
      const inline = n.nodeType === 3 || (n.nodeType === 1 && INLINE.test(n.tagName));
      if (inline) {
        if (n.nodeType === 3 && !n.textContent.trim() && !run) { n.remove(); continue; }
        if (n.nodeType === 1 && n.tagName === 'BR') {
          // a line break ends the current line
          if (!run) { run = document.createElement('div'); n.before(run); }
          run.appendChild(n);
          run = null;
          continue;
        }
        if (!run) { run = document.createElement('div'); n.before(run); }
        run.appendChild(n);
      } else run = null;
    }
  }

  /** Replace a too-tall container child by pieces that can go on separate pages. */
  function expand(child) {
    const tag = child.tagName;
    const pieces = [];
    if (tag === 'UL' || tag === 'OL') {
      let n = Number(child.getAttribute('start') || 1);
      for (const li of Array.from(child.children)) {
        const c = child.cloneNode(false);
        if (tag === 'OL') c.setAttribute('start', String(n++));
        c.style.marginTop = '0';
        c.style.marginBottom = '0';
        c.appendChild(li);
        pieces.push(c);
      }
    } else if (tag === 'TABLE') {
      const head = child.tHead;
      const rows = Array.from(child.rows).filter((r) => !head || !head.contains(r));
      for (const r of rows) {
        const c = child.cloneNode(false);
        if (head && pieces.length === 0) c.appendChild(head.cloneNode(true));
        const body = document.createElement('tbody');
        body.appendChild(r);
        c.appendChild(body);
        pieces.push(c);
      }
    } else if (['DIV', 'BLOCKQUOTE', 'SECTION', 'ARTICLE'].includes(tag) && child.children.length) {
      const holder = child.cloneNode(false);
      for (const n of Array.from(child.childNodes)) holder.appendChild(n);
      wrapInlineRuns(holder);
      if (holder.children.length === 1) {
        // a wrapper around a single block (typical for Word import): unwrap it and split the inner block
        child.replaceWith(holder.children[0]);
        return true;
      }
      for (const n of Array.from(holder.children)) {
        const c = child.cloneNode(false);
        c.appendChild(n);
        pieces.push(c);
      }
    }
    if (pieces.length > 1) {
      child.replaceWith(...pieces);
      return true;
    }
    return false;
  }

  function measureRich(flow, box) {
    wrapInlineRuns(flow);
    // break up children that cannot fit on any page by themselves
    for (let guard = 0; guard < 500; guard++) {
      const tall = Array.from(flow.children).find((k) => k.getBoundingClientRect().height > box + EPS && expand(k));
      if (!tall) break;
    }
    const cs = getComputedStyle(flow);
    const kids = Array.from(flow.children);
    const tops = kids.map((k) => k.offsetTop);
    const end = flow.scrollHeight - parseFloat(cs.paddingBottom);
    return kids.map((k, i) => (i + 1 < kids.length ? tops[i + 1] : end) - tops[i]);
  }

  /** Segments for one flow element, or null when it fits. */
  function planFlow(flow) {
    const boxFirst = flow.clientHeight;
    const boxNext = flow.hasAttribute('data-cheight') ? parseFloat(flow.getAttribute('data-cheight')) * MM : boxFirst;
    const table = flow.querySelector(':scope > table.fd-tbl');
    if (table) {
      if (table.getBoundingClientRect().height <= boxFirst + EPS) return null;
      const thead = table.tHead ? table.tHead.getBoundingClientRect().height : 0;
      const tfoot = table.tFoot ? table.tFoot.getBoundingClientRect().height : 0;
      const rows = table.tBodies[0] ? Array.from(table.tBodies[0].rows) : [];
      const heights = rows.map((r) => r.getBoundingClientRect().height);
      if (heights.some((h) => h + thead > Math.max(boxFirst, boxNext) + EPS)) warnings.push('שורה בטבלה גבוהה מהתיבה ונחתכה');
      return { kind: 'table', segs: splitHeights(heights, boxFirst, boxNext, thead, tfoot) };
    }
    if (flow.scrollHeight <= flow.clientHeight + EPS) return null;
    const cs = getComputedStyle(flow);
    const padV = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const heights = measureRich(flow, Math.min(boxFirst, boxNext) - padV);
    if (heights.some((h) => h > Math.max(boxFirst, boxNext) - padV + EPS)) warnings.push('חלק מהטקסט המעוצב גבוה מהתיבה ונחתך');
    return { kind: 'rich', segs: splitHeights(heights, boxFirst - padV, boxNext - padV, 0, 0) };
  }

  for (const page of pages) {
    const flows = Array.from(page.querySelectorAll('.fd-el[data-flow]'));
    // plan every flow element on the page; the page repeats as often as the longest needs
    const plans = flows.map((f) => ({ f, plan: planFlow(f) }));
    const count = Math.max(1, ...plans.map((p) => (p.plan ? p.plan.segs.length : 1)));
    if (count <= 1) { applyShowOn(page, 0, 1); continue; }

    flows.forEach((f, i) => f.setAttribute('data-flow-i', String(i)));
    const proto = page.cloneNode(true);
    let prev = page;
    const segPages = [page];
    for (let s = 1; s < count; s++) {
      const np = proto.cloneNode(true);
      prev.after(np);
      segPages.push(np);
      prev = np;
    }
    segPages.forEach((pg, s) => {
      plans.forEach(({ plan }, fi) => {
        const f = pg.querySelector(`.fd-el[data-flow-i="${fi}"]`);
        if (!f) return;
        if (s > 0) {
          if (f.hasAttribute('data-ctop')) f.style.top = f.getAttribute('data-ctop') + 'mm';
          if (f.hasAttribute('data-cheight')) f.style.height = f.getAttribute('data-cheight') + 'mm';
        }
        if (!plan) {
          // a flow element that fits stays on the first page only
          if (s > 0) f.remove();
          return;
        }
        const seg = plan.segs[s];
        if (!seg) { f.remove(); return; } // this element already ended
        const [from, to, foot] = seg;
        if (plan.kind === 'table') {
          const t = f.querySelector(':scope > table.fd-tbl');
          const rows = t.tBodies[0] ? Array.from(t.tBodies[0].rows) : [];
          rows.forEach((r, i) => { if (i < from || i >= to) r.remove(); });
          if (!foot && t.tFoot) t.tFoot.remove();
        } else {
          Array.from(f.children).forEach((k, i) => { if (i < from || i >= to) k.remove(); });
        }
      });
      applyShowOn(pg, s, segPages.length);
    });
  }

  let all = Array.from(document.querySelectorAll('.fd-page'));
  // header / footer rules relative to the whole document
  all.forEach((pg, i) => {
    const first = i === 0;
    const last = i === all.length - 1;
    pg.querySelectorAll('[data-doc-show]').forEach((el) => {
      const r = el.getAttribute('data-doc-show');
      const keep = r === 'notFirst' ? !first : r === 'firstOnly' ? first : r === 'notLast' ? !last : r === 'lastOnly' ? last : true;
      if (!keep) el.remove();
    });
  });
  all = Array.from(document.querySelectorAll('.fd-page'));
  all.forEach((pg, i) => {
    pg.querySelectorAll('.fd-pn').forEach((e) => { e.textContent = String(i + 1); });
    pg.querySelectorAll('.fd-pc').forEach((e) => { e.textContent = String(all.length); });
    pg.querySelectorAll('.fd-el[data-flow]').forEach((f) => {
      if (f.scrollHeight > f.clientHeight + 2 && !f.querySelector(':scope > table.fd-tbl')) warnings.push(`תוכן נחתך בעמוד ${i + 1}`);
    });
  });
  // placeholder names stay unique: a repeated area gets the page number as a suffix
  const placeholders = [];
  const seen = new Set();
  all.forEach((pg, i) => {
    pg.querySelectorAll('[data-ph]').forEach((el) => {
      const base = el.getAttribute('data-ph');
      const name = seen.has(base) ? `${base}_p${i + 1}` : base;
      seen.add(base);
      let meta = {};
      try { meta = JSON.parse(el.getAttribute('data-ph-meta') || '{}'); } catch { meta = {}; }
      placeholders.push({
        meta,
        name,
        baseName: base,
        type: el.getAttribute('data-ph-type'),
        label: el.getAttribute('data-ph-label') || '',
        required: el.hasAttribute('data-ph-required'),
        page: i + 1,
        x: parseFloat(el.style.left), y: parseFloat(el.style.top), width: parseFloat(el.style.width), height: parseFloat(el.style.height),
      });
    });
  });
  return { map: all.map((pg) => Number(pg.getAttribute('data-tpl-page'))), placeholders, warnings: [...new Set(warnings)] };
}
