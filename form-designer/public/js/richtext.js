// Word-like inline editor for rich text elements (double click to edit).
import { state, change, emit } from './state.js';
import { escapeHtml } from '/shared/elements.js';
import { allValuePaths } from './datatree.js';

let editing = null;

export function isRichEditing() {
  return !!editing;
}

const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48];

function toolbarHtml() {
  const fonts = state.fonts.map((f) => `<option value="${escapeHtml(f.family)}">${escapeHtml(f.family)}</option>`).join('');
  const paths = allValuePaths().map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  return `
  <select data-cmd="fontName" title="גופן"><option value="">גופן</option>${fonts}</select>
  <select data-cmd="fontSizePt" title="גודל"><option value="">גודל</option>${SIZES.map((s) => `<option>${s}</option>`).join('')}</select>
  <button data-cmd="bold" title="מודגש (Ctrl+B)"><b>B</b></button>
  <button data-cmd="italic" title="נטוי (Ctrl+I)"><i>I</i></button>
  <button data-cmd="underline" title="קו תחתון (Ctrl+U)"><u>U</u></button>
  <button data-cmd="strikeThrough" title="קו חוצה"><s>S</s></button>
  <label class="rt-color" title="צבע טקסט">A<input type="color" data-cmd="foreColor" value="#000000"></label>
  <label class="rt-color rt-hl" title="צבע הדגשה">ab<input type="color" data-cmd="hiliteColor" value="#fff59d"></label>
  <span class="rt-sep"></span>
  <button data-cmd="justifyRight" title="יישור לימין">⇥</button>
  <button data-cmd="justifyCenter" title="מרכוז">≡</button>
  <button data-cmd="justifyLeft" title="יישור לשמאל">⇤</button>
  <button data-cmd="justifyFull" title="יישור לשני הצדדים">☰</button>
  <button data-cmd="insertUnorderedList" title="תבליטים">•</button>
  <button data-cmd="insertOrderedList" title="מספור">1.</button>
  <select data-cmd="formatBlock" title="סגנון"><option value="">סגנון</option><option value="p">פסקה</option><option value="h1">כותרת 1</option><option value="h2">כותרת 2</option><option value="h3">כותרת 3</option></select>
  <span class="rt-sep"></span>
  <select data-cmd="insertField" title="הוספת שדה"><option value="">+ שדה</option>${paths}<option value="__page">מספר עמוד</option><option value="__pages">סה"כ עמודים</option></select>
  <button data-cmd="insertTable" title="טבלה קבועה">▦</button>
  <button data-cmd="removeFormat" title="ניקוי עיצוב">⌫</button>
  <span class="rt-sep"></span>
  <button data-cmd="done" class="rt-done">סיום</button>`;
}

export function startRichEdit(el, node) {
  if (editing) return;
  node.innerHTML = el.html || '<p><br></p>';
  node.contentEditable = 'true';
  node.classList.add('rt-editing');
  node.style.overflow = 'auto';
  node.focus();
  document.execCommand('styleWithCSS', false, true);

  const bar = document.createElement('div');
  bar.className = 'rt-toolbar';
  bar.innerHTML = toolbarHtml();
  document.body.appendChild(bar);
  const place = () => {
    const r = node.getBoundingClientRect();
    bar.style.top = Math.max(60, r.top - bar.offsetHeight - 8) + 'px';
    bar.style.left = Math.max(8, Math.min(r.left, window.innerWidth - bar.offsetWidth - 8)) + 'px';
  };
  place();
  const scroller = document.getElementById('canvas-scroll');
  scroller.addEventListener('scroll', place);

  let savedRange = null;
  const saveSel = () => {
    const s = window.getSelection();
    if (s.rangeCount && node.contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange();
  };
  const restoreSel = () => {
    node.focus();
    if (savedRange) {
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(savedRange);
    }
  };
  document.addEventListener('selectionchange', saveSel);

  bar.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) e.preventDefault();
  });

  function exec(cmd, val) {
    restoreSel();
    if (cmd === 'fontSizePt') {
      document.execCommand('fontSize', false, '7');
      node.querySelectorAll('font[size="7"]').forEach((f) => {
        const sp = document.createElement('span');
        sp.style.fontSize = val + 'pt';
        sp.innerHTML = f.innerHTML;
        f.replaceWith(sp);
      });
      node.querySelectorAll('span[style*="xxx-large"], span[style*="-webkit-xxx-large"]').forEach((s) => { s.style.fontSize = val + 'pt'; });
    } else if (cmd === 'insertField') {
      const txt = val === '__page' ? '{{page}}' : val === '__pages' ? '{{pages}}' : `{{${val}}}`;
      document.execCommand('insertText', false, txt);
    } else if (cmd === 'insertTable') {
      const rows = +(prompt('מספר שורות', '2') || 0);
      const cols = +(prompt('מספר עמודות', '3') || 0);
      if (rows > 0 && cols > 0) {
        const tr = `<tr>${'<td>&nbsp;</td>'.repeat(cols)}</tr>`;
        document.execCommand('insertHTML', false, `<table style="width:100%"><tbody>${tr.repeat(rows)}</tbody></table><p><br></p>`);
      }
    } else if (cmd === 'formatBlock') {
      document.execCommand('formatBlock', false, val);
    } else {
      document.execCommand(cmd, false, val);
    }
    saveSel();
  }

  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.cmd === 'done') return finish(true);
    exec(b.dataset.cmd);
  });
  bar.addEventListener('change', (e) => {
    const t = e.target;
    if (!t.dataset.cmd || t.value === '') return;
    exec(t.dataset.cmd, t.value);
    if (t.tagName === 'SELECT') t.value = '';
  });

  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') finish(true);
  };
  node.addEventListener('keydown', onKey);

  const outside = (e) => {
    if (node.contains(e.target) || bar.contains(e.target)) return;
    finish(true);
  };
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);

  function finish(save) {
    if (!editing) return;
    editing = null;
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('selectionchange', saveSel);
    scroller.removeEventListener('scroll', place);
    node.removeEventListener('keydown', onKey);
    bar.remove();
    const html = cleanHtml(node.innerHTML);
    node.contentEditable = 'false';
    if (save && html !== el.html) change(() => { el.html = html; });
    else emit('all');
  }
  editing = { el, finish };
}

function cleanHtml(html) {
  return html
    .replace(/<font size="7">/g, '<span>')
    .replace(/<\/font>/g, '</span>')
    .replace(/\s*class="[^"]*"/g, (m) => (m.includes('fd-') ? '' : m));
}
