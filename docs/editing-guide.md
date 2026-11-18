<div dir="rtl">

# איפה משנים כל דבר באתר?

[חזרה לעמוד הראשי](../README.md) · [הפעלה מקומית](getting-started.md) · [הגשת שינוי](../CONTRIBUTING.md)

התחילו מהשורה שמתאימה למשימה. בצעו שינוי ממוקד ובדקו אותו בעותק המקומי לפני פתיחת בקשת שינוי.

## מסכים ועיצוב

| השינוי הרצוי | קובץ להתחלה |
| --- | --- |
| עמוד הבית | [app/page.tsx](../app/page.tsx) |
| מפת המערכות והניווט | [system-map.tsx](../components/racing/system-map.tsx) |
| עריכת תשובות ושמירה | [editor.tsx](../components/racing/editor.tsx) |
| מסך רכז | [coordinator.tsx](../components/racing/coordinator.tsx) |
| הודעות התקדמות התרגום | [automatic-translation.tsx](../components/racing/automatic-translation.tsx) |
| תצוגת טופס רשמי | [official-document.tsx](../components/racing/official-document.tsx) |
| צבעים, ריווח וסגנון גלובלי | [app/globals.css](../app/globals.css) |
| לוגו הקבוצה | [public/brand](../public/brand) |

בדקו גם חלון צר, עברית מימין לשמאל ומספרים או שמות רכיבים באנגלית. הודעת מצב צריכה לתאר את מה שבאמת נשמר או הושלם.

## שאלות, מערכות ושיוך צוותים

| השינוי הרצוי | קובץ להתחלה |
| --- | --- |
| שם מערכת, נוסח שאלה, עמודות טבלה | [systems.normalized.json](../data/systems.normalized.json) |
| שאלות שמופיעות אצל הרכז | [coordinator.normalized.json](../data/coordinator.normalized.json) |
| הגדרת רשומות משותפות | [shared-records.normalized.json](../data/shared-records.normalized.json) |
| צוותי המכניקה ומצב אימות השיוך | [mechanical-teams.json](../data/mechanical-teams.json) |
| טעינת הקטלוג וטיפוסי השדות | [lib/catalog.ts](../lib/catalog.ts) |
| קשר לשדות רשמיים וכיסוי טופס | [coverage.normalized.json](../data/coverage.normalized.json) |

לדוגמה, לשינוי ניסוח שאלה: חפשו את מזהה השדה או הנוסח בקובץ המערכות, ערכו את `label` או `prompt` המתאים, והשאירו את `id` כפי שהוא. אחרי שינוי בקטלוג המערכות הריצו:

</div>

```sh
npm run catalog:generate
npm run catalog:check
npm run check
```

<div dir="rtl">

בדקו את ההפרש גם במקור וגם בקובץ התצוגה שנוצר. הוספת שדה, שינוי סוגו או מיפויו לתא רשמי דורשים גם עדכון כיסוי ובדיקת ייצוא. שינוי שם תצוגה אינו סיבה להחליף מזהה קבוע.

שיוך צוות מכני לטופס מסומן כרגע כהצעה. שינוי התווית ל״מאומת״ דורש מקור המאשר את האחריות בפועל.

## תרגום אוטומטי

| השינוי הרצוי | קובץ להתחלה |
| --- | --- |
| המודל, הגרסה וקובצי ההרצה | [local-translation-config.ts](../lib/local-translation-config.ts) |
| מילון הנדסי ושמירה על מספרים ושמות רכיבים | [local-translation.mjs](../lib/local-translation.mjs) |
| תור התרגום בדפדפן | [browser-translation.ts](../lib/browser-translation.ts) |
| הרצת המודל ברקע | [translation.worker.ts](../lib/translation.worker.ts) |
| חלוקת תוכן לקטעי תרגום | [translation-content.ts](../lib/translation-content.ts) |
| גרסת מנגנון וזיהוי תוצאה ישנה | [translation-version.ts](../lib/translation-version.ts) |

שינוי מודל או מילון מחייב עדכון גרסה ובדיקת משפטים הנדסיים, שלילה, יחידות ושמות רכיבים. בדקו יציאה משדה, עריכה חוזרת מהירה, רענון הדף וייצוא באנגלית. [הסבר המנגנון](translation-runtime.md).

## קבצים רשמיים וייצוא

| השינוי הרצוי | קובץ להתחלה |
| --- | --- |
| ייצוא ESF ו־ASES | [official-workbooks.ts](../lib/official-workbooks.ts) |
| כתיבה לטופס SES ובדיקת תאים | [ses-workbook.ts](../lib/ses-workbook.ts) |
| הגנות תאי SES | [ses-export-guards.json](../data/ses-export-guards.json) |
| גרסאות וחתימות תבניות | [template-metadata.json](../data/template-metadata.json) |
| כתובות ומקור התבניות | [source-manifest.json](../data/source-manifest.json) |
| הורדת תבניות והכנת קלט הבנייה | [prepare-templates.mjs](../scripts/prepare-templates.mjs) |
| חבילת נתונים וייצוא כללי | [data-export.ts](../lib/data-export.ts) |

לא מחליפים רק קישור לתבנית חדשה: משווים גרסה, חתימה, גיליונות, תאים, נוסחאות וטווחים מותרים. פותחים ייצוא אמיתי בתוכנת גיליונות ובודקים חישוב מחדש. הגרסאות שבמאגר עדיין אינן אישור התאמה לתחרות 2027.

## הרשאות ושמירת נתונים

| השינוי הרצוי | קובץ להתחלה |
| --- | --- |
| שמירה, חברות בקבוצה והרשאות פעולה | [lib/server.ts](../lib/server.ts) |
| בדיקת זהות בכניסה לשרת | [worker/index.ts](../worker/index.ts) ו־[access-identity.ts](../lib/access-identity.ts) |
| מסלול בקשת שרת מסוים | [app/api](../app/api) |
| שינוי מבנה מסד | מיגרציה חדשה ב־[drizzle](../drizzle) |

שינוי אבטחה או מבנה נתונים דורש בדיקה ממוקדת: בעלים, תורם וסוקר; ניסיון גישה שאינו מורשה; ושמירת תשובות קיימות. אין לערוך מיגרציה שכבר הופעלה בשרת כדי ״לתקן את העבר״ — מוסיפים שינוי חדש ומתכננים את ההעברה.

</div>
