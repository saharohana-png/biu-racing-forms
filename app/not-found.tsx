import { RecoveryPanel } from '@/components/racing/recovery-panel';

export default function NotFound() {
  return <RecoveryPanel code="404" title="העמוד הזה לא נמצא" actions={
    <a className="button primary" href="/">ללוח המערכות</a>
  }>
    <p>ייתכן שהקישור אינו מעודכן. אפשר לחזור ללוח ולפתוח משם את המערכת הרצויה.</p>
  </RecoveryPanel>;
}
