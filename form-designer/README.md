# מעצב טפסים ושרת הפקת PDF

מערכת לעיצוב תבניות של טפסים ולהפקת קובצי PDF מנתוני XML או JSON.

* **מעצב (Designer)** – אפליקציית דפדפן לבניית תבנית: טקסט קבוע, שדות נתונים, שדות מחושבים, טבלאות, תמונות, ברקודים ו-QR, טקסט מעוצב כמו ב-Word, קווים ומסגרות. בונים כל תבנית על **עולם נתונים** (דוגמת XML או JSON). אפשר גם ליצור תבנית מקובץ **PDF** או **Word**.
* **שרת הפקה (Render server)** – מקבל **מספר תבנית** ונתונים **באותו מבנה** של עולם הנתונים, ומחזיר PDF. אפשר להתקין אותו בשרת של הלקוח, כולל מצב "הפקה בלבד" בלי המעצב.

```
 מערכת קוראת (Caché/IRIS, ‎.NET, Java...)                 שרת הפקה
 ─────────────────────────────────────       POST /api/render/1001       ┌──────────────────────────┐
  <invoice>...</invoice>  או  {...}   ───────────────────────────────▶   │ storage/templates/1001.json│
                                       ◀───────────────────────────────   │ Chrome ללא ממשק → PDF      │
                         application/pdf                                  └──────────────────────────┘
```

## התקנה והרצה

דרישות:

* Node.js בגרסה 18 ומעלה.
* דפדפן Chrome, Chromium או Edge בשרת. השרת מאתר אותו לבד, או לפי `CHROME_PATH`.
* LibreOffice – רשות. נדרש רק לייבוא Word "כפריסה מדויקת".

```bash
cd form-designer
npm install
npm start                # מעצב + API  →  http://localhost:3700
```

אם אין דפדפן בשרת: `npx puppeteer browsers install chrome`. אחר כך מגדירים את `CHROME_PATH` לנתיב שהפקודה מדפיסה. האפשרות השנייה היא להתקין Chrome או Edge רגיל.

תבנית לדוגמה (#1001, חשבונית מס) כבר נמצאת ב-`storage/templates`. הנתונים שלה נמצאים ב-`examples/invoice.xml`.

### התקנה בשרת לקוח (הפקה בלבד)

1. מעתיקים לשרת את תיקיית `form-designer` בלי `node_modules`.
2. מריצים `npm install --omit=dev`.
3. מעתיקים את קובצי התבניות (`storage/templates/<מספר>.json`). כל תבנית היא קובץ אחד שמכיל הכול: תמונות וקובץ PDF מקור. גופנים שהועלו נמצאים ב-`storage/fonts` ומעתיקים גם אותם.
4. מריצים `npm run start:render`, או `FD_MODE=render`.

במצב `render` אין ממשק עיצוב ואין API לשינוי תבניות. רק הפקה, צפייה ברשימת התבניות ובדיקת מצב (`/api/health`).

**Windows כשירות:** למשל עם [NSSM](https://nssm.cc):
`nssm install FormRender "C:\Program Files\nodejs\node.exe" "C:\form-designer\server\index.js --mode=render"`.
מגדירים בשירות את משתני הסביבה (`PORT`, `FD_API_KEY`) לפי הצורך.
**Linux:** שירות systemd עם `ExecStart=/usr/bin/node /opt/form-designer/server/index.js --mode=render`.

### הגדרות

משתני סביבה, או קובץ `config.json` (ראו `config.example.json`):

| משתנה | config.json | ברירת מחדל | תיאור |
|---|---|---|---|
| `PORT` | `port` | `3700` | פורט |
| `HOST` | `host` | `0.0.0.0` | כתובת האזנה |
| `FD_MODE` / `--mode=` | `mode` | `full` | `full` = מעצב + הפקה, `render` = הפקה בלבד |
| `FD_STORAGE` | `storageDir` | `storage` | תיקיית התבניות והגופנים |
| `CHROME_PATH` | `chromePath` | איתור אוטומטי | נתיב ל-chrome.exe / msedge.exe / chromium |
| `FD_API_KEY` | `apiKey` | ריק | אם מוגדר, כל קריאה ל-`/api` חייבת לכלול כותרת `x-api-key` |
| `FD_MAX_CONCURRENT` | `maxConcurrent` | `4` | מספר הפקות במקביל |
| `FD_BODY_LIMIT` | `bodyLimit` | `60mb` | גודל בקשה מרבי |
| `FD_ALLOW_REMOTE_IMAGES` | `allowRemoteImages` | `false` | לאפשר תמונות מכתובות http(s) בנתונים |
| `SOFFICE_PATH` | `sofficePath` | איתור אוטומטי | נתיב ל-LibreOffice |

> **אבטחה:** אין במעצב מנגנון משתמשים. מריצים אותו ברשת פנימית, או מגדירים `FD_API_KEY`. המעצב מבקש את המפתח פעם אחת ושומר אותו בדפדפן. בזמן ההפקה הדפדפן חוסם כל גישה לרשת (חוץ מתמונות, אם הותרו), וכל ערך מהנתונים עובר escaping.

## עבודה במעצב

1. **עולם נתונים** – לוחצים "עולם נתונים", מדביקים דוגמת XML או JSON או טוענים קובץ. מבנה הנתונים מופיע בלשונית **נתונים**.
2. **רכיבים** – גוררים רכיב מהסרגל לדף, או לוחצים עליו כדי להוסיף אותו.
   * גרירת **שדה** מעולם הנתונים יוצרת שדה נתונים.
   * גרירת **רשימה** (☰) יוצרת טבלה עם עמודות.
   * לחיצה על שדה בעץ מקשרת אותו לרכיב שנבחר.
3. **מאפיינים** – הלוח השמאלי. אפשר לערוך מיקום וגודל במ"מ, גופן, גודל, צבע, יישור, כיוון, מסגרת, רקע, עיצוב ערכים ותנאי הצגה.
4. **תצוגה מקדימה PDF** – מפיקה PDF אמיתי בשרת עם נתוני הדוגמה, או עם נתונים אחרים שמדביקים בחלון.
5. **שמירה** – שומרים לפי **מספר תבנית**. זה המספר שהמערכת הקוראת שולחת.

### סוגי רכיבים

| רכיב | מה עושה |
|---|---|
| טקסט קבוע | טקסט רגיל. אפשר לשלב בו שדות: `לכבוד {{customer.name}}` |
| שדה נתונים | ערך מהנתונים, עם עיצוב (מספר, מטבע, תאריך...), טקסט לפני ואחרי, וטקסט כשאין ערך |
| שדה מחושב | נוסחה, למשל `sum(items.item, price * qty) * 1.18` |
| טקסט מעוצב | עריכה כמו ב-Word (לחיצה כפולה): גופנים, גדלים, צבעים, יישור, רשימות, טבלאות, שדות. אפשר להמשיך אותו בעמודים הבאים |
| טבלה | נבנית מרשימה בנתונים. לכל עמודה: שדה או ביטוי, עיצוב, יישור ושורת סיכום. אפשר גם תא מסוג תמונה או ברקוד, סינון, מיון והדגשת שורות. **טבלה ארוכה ממשיכה בעמוד חדש** והכותרת חוזרת |
| תמונה | קובץ קבוע (נשמר בתוך התבנית), או מהנתונים: Base64 או כתובת |
| ברקוד / QR | Code128, Code39, EAN-13/8, UPC-A, ITF-14, GS1-128, QR, DataMatrix, PDF417, Aztec. הערך יכול להיות קבוע, שדה או ביטוי |
| תיבת סימון | מסומנת כשהערך הוא true / 1 / Y / כן / X |
| קו, מלבן, אליפסה | עיצוב גרפי |

### ביטויים ושדות בטקסט

* **נתיבים:** `customer.name`, `items.item[0].price`, `order["first-name"]`. ב-XML, מאפיין נכתב עם `@`: `@number`.
* **בטבלה:** שמות שדות מתייחסים לשורה הנוכחית. `$row` הוא מספר השורה, ו-`$rows` (בשורת הסיכום) הוא כל השורות.
* **אופרטורים:** `+ - * / %`, `== != < > <= >=`, `and or not`, `? :`, ושרשור עם `&`.
* **פונקציות:**
  * חישוב: `sum, avg, min, max, count, round, floor, ceil, abs`
  * תנאים: `if, coalesce, isEmpty`
  * טקסט: `concat, upper, lower, trim, len, left, right, substr, replace, padLeft, contains, join`
  * תאריכים: `today, now, date, addDays, addMonths, diffDays, year, month, day, age`
  * עיצוב: `format`
  * לכל פונקציית צבירה אפשר להעביר ביטוי שמחושב לכל פריט: `sum(items.item, price * qty)`.
* **בטקסט:**
  * שדה: `{{customer.name}}`
  * חישוב: `{{price * qty | currency}}`
  * תאריך: `{{date | date:dd/MM/yyyy}}`
  * מספרי עמודים: `{{page}}` ו-`{{pages}}`
* **עיצובים:**
  * מספרים: `number:2`, `plain:2`
  * מטבע: `currency` (ש"ח), `currency:USD`
  * אחוזים: `percent:1`
  * תאריך ושעה: `date:d MMMM yyyy`, `datetime`, `time`
  * טקסט: `upper`, `lower`
  * ערך בוליאני: `bool:כן/לא`

### מעבר עמודים

כשטבלה (או טקסט מעוצב שהוגדר "להמשיך בעמוד הבא") לא נכנסת בתיבה שלה, המערכת מוסיפה **עמוד המשך**. עמוד ההמשך הוא העתק של אותו עמוד בתבנית, עם השורות הבאות.

* אפשר לקבוע לעמוד ההמשך מיקום וגובה אחרים לטבלה (`Y בעמוד המשך`, `גובה בעמוד המשך`).
* לכל רכיב יש הגדרה **"הצג ב"**: כל העמודים, עמוד ראשון בלבד (למשל פרטי הלקוח), עמוד אחרון בלבד (למשל סיכומים וחתימה), כל העמודים מלבד הראשון, או כל העמודים מלבד האחרון.
* שורת הסיכום של הטבלה מופיעה רק בסוף הטבלה.

### יצירת תבנית מ-PDF או Word

* **PDF** – כל עמוד הופך לעמוד בתבנית. העמוד המקורי מונח כרקע **וקטורי** מתחת לתוכן שמוסיפים (חד, בלי איבוד איכות). מתאים לטפסים קיימים: מוסיפים שדות מעל המקומות הריקים.
* **Word כפריסה מדויקת** – ממיר ל-PDF עם LibreOffice בשרת, ומשם ממשיך כמו PDF.
* **Word כטקסט לעריכה** – התוכן (כותרות, הדגשות, רשימות, טבלאות ותמונות) נכנס לרכיב טקסט מעוצב. אפשר לערוך אותו ולשלב בו `{{שדות}}`, והוא ממשיך לעמודים הבאים.

### גופנים

המערכת כוללת גופנים פתוחים עם עברית: Heebo, Rubik, Assistant, Noto Sans/Serif Hebrew, Alef, Varela Round, Secular One, Suez One, Frank Ruhl Libre, David Libre, Miriam Libre ועוד.

השמות Arial, Times New Roman, Courier New, David ו-Miriam משתמשים בגופן המותקן בשרת אם הוא קיים. אם לא, משתמשים בגופן חלופי עם מידות זהות.

אפשר להעלות גופנים נוספים (TTF/OTF/WOFF) דרך התפריט ⋯ → "ניהול גופנים". כל הגופנים מוטמעים בקובץ ה-PDF.

### קיצורי מקלדת

| קיצור | פעולה |
|---|---|
| `Ctrl+S` | שמירה |
| `Ctrl+Z` / `Ctrl+Y` | ביטול / חזרה |
| `Ctrl+C` / `Ctrl+V` / `Ctrl+D` | העתקה / הדבקה / שכפול |
| `Delete` | מחיקה |
| חיצים | הזזה של 1 מ"מ (`Shift`: 5 מ"מ, `Alt`: 0.1 מ"מ) |
| `Shift`+לחיצה, או גרירה על שטח ריק | בחירה מרובה |
| `Ctrl`+גלגלת | זום |
| `PageUp` / `PageDown` | מעבר בין עמודים |

## API

| שיטה | נתיב | תיאור |
|---|---|---|
| POST | `/api/render/{templateId}` | גוף הבקשה הוא ה-XML או ה-JSON עצמו (`Content-Type: application/xml` או `application/json`). מחזיר `application/pdf` |
| POST | `/api/render` | `{ "templateId": "1001", "data": <אובייקט או מחרוזת XML/JSON>, "output": "base64" }`. עם `output=base64` מוחזר `{ pdfBase64, pages, warnings }` |
| GET | `/api/templates` | רשימת תבניות |
| GET | `/api/templates/{id}` | תבנית (JSON) |
| GET | `/api/health` | מצב השרת, הדפדפן שנמצא ומספר התבניות |
| GET | `/api/barcode?type=qrcode&text=...` | ברקוד כ-SVG |

פרמטרים להפקה: `?download=1`, `?fileName=name.pdf`, `?output=base64`, `?format=xml|json`.

כותרות בתשובה:

* `X-Render-Pages` – מספר העמודים
* `X-Render-Ms` – זמן ההפקה
* `X-Render-Warnings` – מספר השגיאות בביטויים

```bash
curl -X POST http://localhost:3700/api/render/1001 \
  -H "Content-Type: application/xml" --data-binary @examples/invoice.xml -o invoice.pdf
```

דוגמאות קוד בתיקייה `clients/`:

* `FormDesigner.Client.cls` – ObjectScript (Caché/IRIS): `RenderToFile`, `RenderToStream`, `RenderToBase64`
* `RenderClient.cs` – C#
* `render.ps1` – PowerShell

### הפקה משורת הפקודה (בלי שרת HTTP)

```bash
node cli/render.js --template 1001 --data examples/invoice.xml --out invoice.pdf
node cli/render.js --template-file my-template.json --data data.json --out out.pdf
```

## כללי המרת XML

* אלמנט השורש **מושמט**: ב-`<invoice><customer>...` הנתיב הוא `customer.name`.
* מאפיינים נשמרים כ-`@name`. אם לאלמנט יש גם מאפיינים וגם טקסט, הטקסט נמצא ב-`#text`, וגם `name` לבדו מחזיר את הטקסט.
* אלמנט שחוזר על עצמו הופך לרשימה (`items.item`). הנתיבים שזוהו כרשימות בדוגמה נשמרים בתבנית (`schema.arrays`), ולכן הם נשארים רשימות גם כשמגיע פריט אחד.
* הערכים נשמרים כטקסט, כך שאפסים מובילים לא נמחקים (`00123`). בחישובים הם מומרים למספרים.

## מבנה הפרויקט

```
form-designer/
├── server/            שרת Express, אחסון, ניתוח נתונים, גופנים, ברקודים, ייבוא Word
│   └── render/        בניית HTML, חלוקה לעמודים בדפדפן, Chrome → PDF, מיזוג רקע PDF (pdf-lib)
├── shared/            קוד משותף לשרת ולמעצב: שפת הביטויים, עיצוב ערכים, בניית HTML של הרכיבים
├── public/            המעצב (HTML/CSS/JS ללא שלב בנייה)
├── cli/render.js      הפקה משורת הפקודה
├── clients/           דוגמאות קריאה: ObjectScript, C#, PowerShell
├── examples/          נתוני דוגמה ותבנית 1001
├── storage/templates  קובצי התבניות (‎<מספר>.json) והיסטוריית גרסאות
└── test/              בדיקות (npm test)
```

המעצב והשרת משתמשים **באותו קוד** כדי לבנות את ה-HTML של כל רכיב (`shared/elements.js`), ולכן מה שרואים במעצב הוא מה שמודפס. מידות נשמרות במ"מ וגדלי גופן בנקודות (pt).

## בדיקות

```bash
npm test
```

הבדיקות מכסות את שפת הביטויים, המרת XML/JSON, ה-API והפקת PDF מלאה: עמוד אחד, טבלה שממשיכה כמה עמודים, ורקע PDF. בדיקות ההפקה מדולגות כשאין דפדפן בשרת.
