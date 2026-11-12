// Runs inside the headless browser after the document is laid out.
// Splits overflowing tables / rich text (elements marked data-flow) into
// continuation pages, applies "show on first/last page" rules and fills in
// page numbers. Returns, for every output page, the template page index.
// This function must stay self-contained: it is serialized into the page.
export function paginate() {
  const MM = 96 / 25.4;
  const EPS = 0.5;
  const pages = Array.from(document.querySelectorAll('.fd-page'));

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

  for (const page of pages) {
    const flow = page.querySelector('.fd-el[data-flow]');
    if (!flow) { applyShowOn(page, 0, 1); continue; }
    const boxFirst = flow.clientHeight;
    const boxNext = flow.hasAttribute('data-cheight') ? parseFloat(flow.getAttribute('data-cheight')) * MM : boxFirst;
    const table = flow.querySelector(':scope > table.fd-tbl');
    let segs;
    let heights;
    if (table) {
      if (table.getBoundingClientRect().height <= boxFirst + EPS) { applyShowOn(page, 0, 1); continue; }
      const thead = table.tHead ? table.tHead.getBoundingClientRect().height : 0;
      const tfoot = table.tFoot ? table.tFoot.getBoundingClientRect().height : 0;
      const rows = table.tBodies[0] ? Array.from(table.tBodies[0].rows) : [];
      heights = rows.map((r) => r.getBoundingClientRect().height);
      segs = splitHeights(heights, boxFirst, boxNext, thead, tfoot);
    } else {
      const cs = getComputedStyle(flow);
      const padV = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      if (flow.scrollHeight <= flow.clientHeight + EPS) { applyShowOn(page, 0, 1); continue; }
      const kids = Array.from(flow.children);
      const tops = kids.map((k) => k.offsetTop);
      const end = flow.scrollHeight - parseFloat(cs.paddingBottom);
      heights = kids.map((k, i) => (i + 1 < kids.length ? tops[i + 1] : end) - tops[i]);
      segs = splitHeights(heights, boxFirst - padV, boxNext - padV, 0, 0);
    }
    if (segs.length <= 1) { applyShowOn(page, 0, 1); continue; }

    const proto = page.cloneNode(true);
    let prev = page;
    const segPages = [page];
    for (let s = 1; s < segs.length; s++) {
      const np = proto.cloneNode(true);
      prev.after(np);
      segPages.push(np);
      prev = np;
    }
    segPages.forEach((pg, s) => {
      const [from, to, foot] = segs[s];
      const f = pg.querySelector('.fd-el[data-flow]');
      if (s > 0) {
        if (f.hasAttribute('data-ctop')) f.style.top = f.getAttribute('data-ctop') + 'mm';
        if (f.hasAttribute('data-cheight')) f.style.height = f.getAttribute('data-cheight') + 'mm';
      }
      const t = f.querySelector(':scope > table.fd-tbl');
      if (t) {
        const rows = t.tBodies[0] ? Array.from(t.tBodies[0].rows) : [];
        rows.forEach((r, i) => { if (i < from || i >= to) r.remove(); });
        if (!foot && t.tFoot) t.tFoot.remove();
      } else {
        Array.from(f.children).forEach((k, i) => { if (i < from || i >= to) k.remove(); });
      }
      applyShowOn(pg, s, segPages.length);
    });
  }

  const all = Array.from(document.querySelectorAll('.fd-page'));
  all.forEach((pg, i) => {
    pg.querySelectorAll('.fd-pn').forEach((e) => { e.textContent = String(i + 1); });
    pg.querySelectorAll('.fd-pc').forEach((e) => { e.textContent = String(all.length); });
  });
  return all.map((pg) => Number(pg.getAttribute('data-tpl-page')));
}
