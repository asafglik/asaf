# סרטון ההדרכה

הסקריפטים שהפיקו את סרטון ההדרכה המוקרן. אפשר להריץ אותם מחדש, למשל בשרת שמחובר לסוכן ה-AI (`ANTHROPIC_API_KEY`).

1. `pip install edge-tts && python3 narrate.py`: מפיק את קובצי הקריינות מ-`narration.json` (קול נוירוני של Microsoft, ‏`he-IL-HilaNeural`). שומר את האורך של כל קטע ב-`durations.json`.
2. `FD_URL=http://localhost:3700 FD_ADMIN_KEY=... FD_DESIGN_KEY=... node record.js`: מקליט את המערכת בדפדפן (Playwright). כל סצנה נמשכת בדיוק כמו הקריינות שלה, ונקודות הזמן נשמרות ב-`marks.json`. צריך לקוח הדגמה עם מפתח עיצוב, שמשויכות אליו התבניות 1001 ו-1002.
3. `python3 mix.py out.mp4`: מחבר את הווידאו, הקריינות ומוזיקת הרקע (`music.m4a`, מוזיקה מקורית שנוצרה בקוד). המוזיקה מונמכת אוטומטית בזמן שהקריינית מדברת.

נדרשים Node.js עם Playwright, Python 3, ffmpeg ו-pdftoppm.
