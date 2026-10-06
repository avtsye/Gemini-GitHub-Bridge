# Gemini GitHub Bridge

תוסף Chrome/Edge שמוסיף ל-Gemini גשר מאובטח ל-GitHub באמצעות פרוטוקול JSON מובנה.

## מה חדש ב-v0.2.0

- בחירת מאגר מתוך רשימת המאגרים שה-Token מורשה אליהם.
- בחירת branch מתוך רשימת הענפים במאגר.
- כפתור **GitHub** בתוך Gemini לטעינת קבצים מהמאגר ישירות לפרומפט.
- תצוגת Diff לפני כל שינוי.
- שינוי של כמה קבצים נשמר כ-**commit יחיד**.
- מצב מומלץ: יצירת Branch חדש + commit יחיד + Pull Request.
- תמיכה ביצירה, עדכון ומחיקה של קבצים.
- אימות repository, base branch, נתיבי קבצים וגרסת פרוטוקול.
- אין ביצוע אוטומטי: המשתמש חייב לאשר את השינוי בחלונית התוסף.

## התקנה

1. הורד או שכפל את המאגר.
2. פתח `chrome://extensions` או `edge://extensions`.
3. הפעל **Developer mode**.
4. לחץ **Load unpacked / טען תוסף שלא נארז**.
5. בחר את תיקיית המאגר.
6. פתח את הגדרות התוסף.
7. הדבק Fine-grained Personal Access Token.
8. לחץ **בדוק חיבור וטען מאגרים**.
9. בחר מאגר וענף ושמור.

## הרשאות Token מומלצות

הגבל את ה-Token רק למאגרים שבהם ברצונך להשתמש.

- **Contents: Read and write**
- **Pull requests: Read and write** אם משתמשים ב-Branch + PR
- גישה למטא-דאטה של המאגר ניתנת לפי מנגנון ההרשאות של GitHub.

הטוקן נשמר ב-`chrome.storage.local`, נשלח רק ל-GitHub API ואינו נכתב לפרומפט של Gemini.

## טעינת קבצים ל-Gemini

בדף Gemini מופיע כפתור **GitHub**. לחץ עליו והכנס נתיבי קבצים, אחד בכל שורה, לדוגמה:

```
src/app.js
manifest.json
README.md
```

התוסף יקרא אותם מהמאגר ומה-branch שנבחרו ויכניס אותם לתיבת ההודעה כהקשר.

## פרוטוקול השינויים

כאשר שיחת קוד דורשת שינוי ב-GitHub, התוסף מוסיף לפרומפט הוראה ל-Gemini להחזיר בסוף התשובה בלוק:

```text
<GITHUB_EXTENSION>
{
  "version": 1,
  "repository": "owner/repo",
  "base_branch": "main",
  "mode": "branch_pr",
  "commit_message": "Fix layout bug",
  "branch_name": "gemini/fix-layout",
  "pr_title": "Fix layout bug",
  "pr_body": "Summary",
  "files": [
    {
      "path": "src/app.js",
      "action": "update",
      "content": "FULL FINAL FILE CONTENT"
    }
  ]
}
</GITHUB_EXTENSION>
```

התוסף אינו מבצע את הבלוק מיד. הוא קורא את הקבצים הקיימים, מציג Diff ומבקש אישור.

## Commit מרובה קבצים

v0.2 משתמש ב-Git Data API: נוצרים blobs ו-tree חדשים, ואז commit אחד שמכיל את כל הקבצים. כך שינוי של 10 קבצים אינו יוצר 10 commits.

## אבטחה

- אין Token בפרומפט.
- המאגר בתשובת Gemini חייב להתאים למאגר שנבחר.
- גם base branch חייב להתאים לענף שנבחר.
- נתיבים מוחלטים ונתיבים עם `..` נחסמים.
- עד 50 קבצים בשינוי אחד.
- נדרש אישור ידני לפני Commit או PR.

## מגבלה

ממשק Gemini באתר אינו API יציב לתוספי דפדפן. לכן ייתכן שבעתיד שינוי DOM מצד Google יחייב עדכון של מנגנון איתור תיבת ההודעה/כפתור השליחה.
