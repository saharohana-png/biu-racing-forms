'use client';

import { RecoveryPanel } from '@/components/racing/recovery-panel';

export default function PageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RecoveryPanel code="BIU RACING / RETRY" title="העמוד לא נטען כראוי" actions={<>
    <button className="button primary" type="button" onClick={reset}>ניסיון נוסף</button>
    <a className="button secondary" href="/">חזרה ללוח המערכות</a>
  </>}>
    <p>אפשר לנסות שוב. המידע שכבר נשמר באתר נשאר זמין.</p>
    <p>אם ערכת טופס לפני התקלה, בדוק את מצב השמירה אחרי החזרה אליו.</p>
  </RecoveryPanel>;
}
