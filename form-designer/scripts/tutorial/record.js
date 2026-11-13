// Narrated walkthrough (v2): each scene lasts as long as its narration clip.
// Writes raw/*.webm and marks.json (scene start times, ms from the video start).
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { overlay } = require('./overlay.js');

// FD_URL: the central server; FD_ADMIN_KEY: admin key; FD_DESIGN_KEY: a demo customer's design key
const BASE = process.env.FD_URL || 'http://localhost:3700';
const ADMIN = process.env.FD_ADMIN_KEY || '';
const DESIGN = process.env.FD_DESIGN_KEY || '';
const DUR = JSON.parse(fs.readFileSync(path.join(__dirname, 'durations.json'), 'utf8'));
const OUT = path.join(__dirname, 'raw');
fs.rmSync(OUT, { recursive: true, force: true });

const AI_CARD = `
<style>
 @keyframes vin { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none } }
 @keyframes vpulse { 0%,100% { box-shadow: 0 0 0 0 rgba(96,165,250,.55) } 50% { box-shadow: 0 0 0 22px rgba(96,165,250,0) } }
 .flow { display: flex; align-items: center; gap: 34px; direction: rtl; margin-top: 10px }
 .col { display: flex; flex-direction: column; gap: 14px }
 .box { background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.22); border-radius: 14px; padding: 14px 22px; font-size: 22px; min-width: 250px; text-align: center; opacity: 0; animation: vin .6s forwards }
 .box small { display: block; font-size: 15px; color: #bfdbfe; margin-top: 3px }
 .agent { width: 190px; height: 190px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #60a5fa, #1d4ed8 70%); display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 26px; font-weight: 700; opacity: 0; animation: vin .6s 1.4s forwards, vpulse 2s 2s infinite }
 .agent span { font-size: 44px }
 .arrow { font-size: 40px; color: #93c5fd; opacity: 0; animation: vin .5s forwards }
 .out .box { background: rgba(34,197,94,.16); border-color: rgba(134,239,172,.5) }
</style>
<h1 style="font-size:40px;margin-bottom:6px">סוכן הבינה המלאכותית</h1>
<h2 style="margin-bottom:18px">מהנתונים לטופס מוכן</h2>
<div class="flow">
  <div class="col">
    <div class="box" style="animation-delay:.3s">עולם נתונים<small>XML / JSON</small></div>
    <div class="box" style="animation-delay:.7s">טופס דוגמה<small>PDF / Word (רשות)</small></div>
    <div class="box" style="animation-delay:1.1s">בקשה בכתב<small>"הוסף כותרת תחתונה..."</small></div>
  </div>
  <div class="arrow" style="animation-delay:1.3s">◀</div>
  <div class="agent"><span>✨</span>סוכן AI</div>
  <div class="arrow" style="animation-delay:2.2s">◀</div>
  <div class="col out">
    <div class="box" style="animation-delay:4s">כל שדה במקום שלו</div>
    <div class="box" style="animation-delay:6.5s">טבלאות ואזורי חתימה</div>
    <div class="box" style="animation-delay:9.5s">שיפורי עיצוב</div>
    <div class="box" style="animation-delay:12.5s">שינויים לפי בקשה</div>
  </div>
</div>`;

const PARTS_CARD = `
<style>
 @keyframes vin { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none } }
 .parts { display: flex; gap: 24px; direction: rtl; margin-top: 12px }
 .part { width: 300px; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.2); border-radius: 18px; padding: 24px 22px; text-align: center; opacity: 0; animation: vin .7s forwards }
 .part b { display: block; font-size: 46px; margin-bottom: 8px }
 .part h3 { margin: 0 0 8px; font-size: 26px }
 .part p { margin: 0; font-size: 18px; color: #bfdbfe; line-height: 1.5 }
</style>
<h1 style="font-size:40px">שלושה חלקים</h1>
<div class="parts">
  <div class="part" style="animation-delay:.6s"><b>✏️</b><h3>1. המעצב + סוכן AI</h3><p>בניית תבניות לכל לקוח, ידנית או בעזרת הסוכן החכם</p></div>
  <div class="part" style="animation-delay:5.5s"><b>🗂️</b><h3>2. מאגר התבניות</h3><p>כל לקוח מקבל את התבניות שנבנו בשבילו</p></div>
  <div class="part" style="animation-delay:10.5s"><b>⚙️</b><h3>3. מנגנון ההפקה</h3><p>נתונים נכנסים, PDF ונתוני חתימה יוצאים. בענן או אצל הלקוח</p></div>
</div>`;

const RUNTIME_CARD = `
<style>
 @keyframes vin { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none } }
 .rt { display: flex; align-items: center; gap: 22px; direction: rtl; margin: 16px 0 26px }
 .n { background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.22); border-radius: 14px; padding: 16px 22px; font-size: 22px; text-align: center; opacity: 0; animation: vin .6s forwards }
 .n small { display: block; font-size: 15px; color: #bfdbfe; margin-top: 4px }
 .a { font-size: 17px; color: #93c5fd; text-align: center; opacity: 0; animation: vin .6s forwards }
 .stats { display: flex; gap: 18px; justify-content: center; direction: rtl }
 .st { background: rgba(34,197,94,.16); border: 1px solid rgba(134,239,172,.5); border-radius: 12px; padding: 10px 20px; font-size: 21px; opacity: 0; animation: vin .6s forwards }
</style>
<h1 style="font-size:40px">שרת ההפקה אצל הלקוח</h1>
<div class="rt">
  <div class="n" style="animation-delay:.4s">מאגר התבניות<small>השרת המרכזי</small></div>
  <div class="a" style="animation-delay:1.4s">◀ סנכרון אוטומטי ◀<br>כל כמה דקות</div>
  <div class="n" style="animation-delay:2.4s">שרת הפקה<small>ברשת של הלקוח</small></div>
  <div class="a" style="animation-delay:5s">◀ PDF + נתוני חתימה<br>▶ XML / JSON</div>
  <div class="n" style="animation-delay:5.8s">המערכת של הלקוח<small>Caché, ‎.NET, Java...</small></div>
</div>
<div class="stats">
  <div class="st" style="animation-delay:9.5s">1,000 קריאות במקביל</div>
  <div class="st" style="animation-delay:11.5s">קובצי נתונים עד 50MB</div>
</div>`;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: OUT, size: { width: 1280, height: 720 } }, locale: 'he-IL' });
  await ctx.addInitScript(overlay);
  await ctx.addInitScript((k) => { if (!localStorage.getItem('fd-api-key')) localStorage.setItem('fd-api-key', k); }, ADMIN);
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const t0 = Date.now();
  const marks = {};
  const wait = (ms) => page.waitForTimeout(ms);
  const cap = (title, text) => page.evaluate(([a, b]) => window.__cap(a, b), [title, text]);
  const card = (html) => page.evaluate((h) => window.__card(h), html);
  const hl = (sel, pad) => page.evaluate(([s, p]) => window.__hl(s, p), [sel, pad]);
  const moveTo = (x, y, steps = 25) => page.mouse.move(x, y, { steps });
  const centerOf = async (loc) => { const b = await loc.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const click = async (loc, after = 500) => {
    loc = typeof loc === 'string' ? page.locator(loc).first() : loc;
    await loc.scrollIntoViewIfNeeded();
    const [x, y] = await centerOf(loc);
    await moveTo(x, y); await wait(250);
    await page.mouse.down(); await wait(90); await page.mouse.up();
    await wait(after);
  };
  const type = async (loc, text) => { await click(loc, 150); await loc.pressSequentially(text, { delay: 55 }); await wait(250); };
  const drag = async (src, x, y) => {
    src = typeof src === 'string' ? page.locator(src).first() : src;
    await src.scrollIntoViewIfNeeded();
    const [sx, sy] = await centerOf(src);
    await moveTo(sx, sy); await wait(300);
    for (let i = 1; i <= 30; i++) {
      const cx = sx + (x - sx) * i / 30, cy = sy + (y - sy) * i / 30;
      await page.evaluate(([a, b]) => { const c = document.getElementById('v-cur'); c.style.left = a + 'px'; c.style.top = b + 'px'; c.classList.add('down'); }, [cx, cy]);
      await wait(22);
    }
    const box = await page.locator('#canvas-scroll').boundingBox();
    await src.dragTo(page.locator('#canvas-scroll'), { targetPosition: { x: x - box.x, y: y - box.y } });
    await page.evaluate(() => document.getElementById('v-cur').classList.remove('down'));
    await page.mouse.move(x, y);
    await wait(600);
  };
  // a scene: its actions run while the narration plays; it lasts at least the clip
  const scene = async (key, fn) => {
    const start = Date.now();
    marks[key] = start - t0;
    await fn();
    const left = DUR[key] * 1000 + 600 - (Date.now() - start);
    if (left > 0) await wait(left);
  };
  const tagAgentCards = () => page.evaluate(() => document.querySelectorAll('#agent-pane .ag-card').forEach((c, i) => { c.id = 'v-ag' + i; }));
  const showCard = async (id) => {
    await page.evaluate((i) => document.getElementById(i)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), id);
    await wait(700);
    await hl('#' + id, 4);
  };

  // ================================================================ intro
  await page.goto(BASE + '/');
  await wait(800);
  await scene('n00', async () => {
    await card(`<h1>מעצב הטפסים החכם</h1><h2>עיצוב טפסים והפקת PDF, בעזרת בינה מלאכותית</h2><div style="font-size:64px;margin-top:10px">✨</div>`);
  });
  await scene('n01', async () => { await card(PARTS_CARD); });
  await scene('n02', async () => { await card(AI_CARD); });

  // ================================================================ AI in the designer
  await page.goto(BASE + '/designer.html#1001');
  await page.waitForSelector('#canvas-scroll', { timeout: 15000 });
  await wait(1500);
  await page.locator('[data-action="new"]').click();
  await wait(800);
  await card('');
  await scene('n03', async () => {
    await cap('סוכן ה-AI במעצב', 'ארבע דרכים לעבוד עם הסוכן');
    await click('.tab[data-tab="agent"]', 700);
    await tagAgentCards();
    await hl('#agent-pane', 0);
  });
  await scene('n04', async () => {
    await cap('1. טופס חדש מעולם הנתונים', 'בלי שום דוגמה: לוחצים, והטופס נבנה');
    await tagAgentCards();
    await showCard('v-ag1');
    await wait(2500);
    await hl(null);
    await click('[data-ag="from-data"]', 1500);
  });
  await scene('n05', async () => {
    await hl('#canvas-scroll', 0);
    await cap('1. טופס חדש מעולם הנתונים', 'מצב בסיס (בלי חיבור לסוכן): שדות בקבוצות, טבלה וחתימה');
    await wait(7000);
    await hl(null);
    await page.mouse.click(1010, 700); // clear the selection
    await cap('1. טופס חדש מעולם הנתונים', 'עם הסוכן: תוויות בעברית, סיכומים בטבלאות ועיצוב מלא');
  });
  await scene('n06', async () => {
    await tagAgentCards();
    await cap('2. טופס דוגמה ב-PDF או ב-Word', 'הסוכן ממקם כל שדה במקום הריק שלו, או בונה את הטופס מחדש');
    await showCard('v-ag2');
  });
  await scene('n07', async () => {
    await cap('3. חוות דעת על טופס קיים', 'ציון, המלצות לשיפור, ומיפוי כל ערך לשדה בנתונים');
    await showCard('v-ag0');
  });
  await scene('n08', async () => {
    await cap('4. התכתבות עם הסוכן', 'כותבים מה לשנות, והסוכן מבצע. כל שינוי אפשר לבטל');
    await showCard('v-ag3');
    await wait(1500);
    await hl('[data-ag="improve"]', 6);
    await wait(5000);
    await hl('#v-ag3', 4);
    await page.locator('#ag-req').scrollIntoViewIfNeeded();
    await click('#ag-req', 200);
    await page.locator('#ag-req').pressSequentially('הוסף כותרת תחתונה עם "עמוד X מתוך Y" במרכז', { delay: 45 }).catch(() => {});
  });
  await hl(null);

  // ================================================================ manual design
  await page.goto(BASE + '/');
  await page.goto(BASE + '/designer.html#1001');
  await page.waitForSelector('#canvas-scroll', { timeout: 15000 });
  await wait(1200);
  await scene('n09', async () => {
    await cap('עיצוב ידני', 'גוררים שדה מעולם הנתונים לדף');
    await click('.tab[data-tab="data"]', 500);
    await drag(page.locator('#data-tree .dt-node[data-path="notes"] > .dt-row').first(), 820, 495);
  });
  await page.keyboard.press('Escape');
  await scene('n10', async () => {
    await cap('אזורי חתימה ומילוי', 'כותרת, תיאור וחובה. ה-API מחזיר את המיקום של כל אזור');
    await click('.tab[data-tab="tools"]', 400);
    await drag('.tool:has-text("אזור חתימה")', 470, 500);
    const field = (label) => page.locator('#props label', { hasText: label }).locator('input, textarea').first();
    await type(field('כותרת ראשית'), 'אישור הלקוח');
    await click(page.locator('#props label', { hasText: 'חובה' }).locator('input').first(), 600);
  });
  await scene('n11', async () => {
    await cap('תצוגה מקדימה', 'ה-PDF שהשרת מפיק');
    let gotPdf; const pdfReady = new Promise((r) => { gotPdf = r; });
    await page.route('**/api/preview', async (route) => { const res = await route.fetch(); const body = await res.body(); gotPdf(body); await route.fulfill({ response: res, body }); });
    await click('[data-action="preview"]', 200);
    const pdf = await pdfReady;
    fs.writeFileSync(path.join(__dirname, 'preview.pdf'), pdf);
    execFileSync('pdftoppm', ['-png', '-r', '110', '-f', '1', '-l', '1', '-singlefile', path.join(__dirname, 'preview.pdf'), path.join(__dirname, 'preview')]);
    const png = fs.readFileSync(path.join(__dirname, 'preview.png')).toString('base64');
    await wait(500);
    // headless Chromium has no PDF viewer: show the real PDF's first page as an image
    await page.evaluate((b64) => {
      const f = document.querySelector('#pv-frame');
      if (!f) return;
      const box = document.createElement('div');
      box.style.cssText = `overflow:auto;background:#525659;padding:14px;text-align:center;width:${f.offsetWidth || 700}px;height:${f.offsetHeight || 500}px;box-sizing:border-box`;
      box.innerHTML = `<img src="data:image/png;base64,${b64}" style="width:92%;box-shadow:0 2px 12px rgba(0,0,0,.5);background:#fff">`;
      f.replaceWith(box);
      box.id = 'pv-box';
    }, png);
    await wait(1500);
    await page.evaluate(() => document.getElementById('pv-box')?.scrollTo({ top: 520, behavior: 'smooth' }));
  });
  await page.keyboard.press('Escape');
  await page.unroute('**/api/preview');

  // ================================================================ customers, repository, runtime
  await page.goto(BASE + '/#customers');
  await wait(1200);
  await scene('n12', async () => {
    await cap('לקוחות ומפתחות', 'מפתח הפקה לכל לקוח, ומפתח עיצוב ללקוח שמעצב בעצמו');
    await hl('.cust', 4);
    await wait(2500);
    await hl(null);
    await click(page.locator('.cust [data-act="c-edit"]').first(), 900);
    await hl('dialog[open] #c-key', 4);
    await wait(1800);
    await hl('dialog[open] #c-dkey', 4);
  });
  await hl(null);
  await page.keyboard.press('Escape');
  await page.evaluate((k) => localStorage.setItem('fd-api-key', k), DESIGN);
  await page.goto(BASE + '/');
  await wait(1200);
  await scene('n13', async () => {
    await cap('כניסת לקוח עם מפתח עיצוב', 'הלקוח רואה רק את התבניות שלו');
    await hl('#who', 6);
    await wait(2500);
    await hl('.mtable-wrap', 4);
  });
  await hl(null);
  await page.goto(BASE + '/repo.html');
  await wait(1200);
  await scene('n14', async () => {
    await cap('מאגר התבניות', 'הורדת תבנית בודדת או חבילה מלאה');
    await hl('.mtable-wrap', 4);
    await wait(2500);
    await hl('#repo-bundle', 6);
    const b = await page.locator('#repo-bundle').boundingBox();
    await moveTo(b.x + b.width / 2, b.y + b.height / 2);
  });
  await hl(null);
  await cap('', '');
  await scene('n15', async () => { await card(RUNTIME_CARD); });
  await scene('n16', async () => {
    await card(`<h1>מעצב הטפסים החכם</h1><ul style="font-size:26px;line-height:2.1"><li>עיצוב בעזרת בינה מלאכותית</li><li>מאגר תבניות לכל לקוח</li><li>הפקה מהירה, בענן או אצל הלקוח</li></ul>`);
  });
  await wait(1500);
  await page.evaluate((k) => localStorage.setItem('fd-api-key', k), ADMIN);
  fs.writeFileSync(path.join(__dirname, 'marks.json'), JSON.stringify(marks, null, 1));
  const video = page.video();
  await ctx.close();
  await browser.close();
  console.log('video:', await video.path(), 'total', (Date.now() - t0) / 1000);
})().catch((e) => { console.error(e); process.exit(1); });
