'use client';
import { systems } from '@/lib/overview-catalog';
import type { Summary, Session } from '@/lib/client-types';
import { engineeringStatusLabel, dateLabel, fillCount, fillPercent, sourceValidationLabel } from '@/lib/client-types';
import { OverviewIcon, Arrow, Lock } from './icons';
import { Modal } from './modal';

export const departmentLabel=(department:string)=>({MECHANICS:'מכאניקה — חלוקת אחריות מוצעת',LV:'מתח נמוך',HV:'מתח גבוה',LV_HV:'ממשקים ואינטגרציה',COORDINATOR:'רכז מסמכים'}[department]||department);
const descriptions:Record<string,string>={SES:'שקילות מבנית · שלדה, מתלים, מארזים והנעה',TSAL:'חיווי מצב מערכת ההנעה',SDC:'שרשרת ניתוק בטיחות',PDU:'חלוקת מתח והגנות',DASHBOARD:'ממשק הנהג וחיווי תקלות',BRAKE_LIGHT:'חיווי בלימה',BSPD:'בקרת סבירות בלימה',RTD:'אישור וצליל מוכנות לנסיעה',LVMS:'מפסק ראשי למתח נמוך',TSMS:'מפסק ראשי למערכת ההנעה',BMS:'ניהול וניטור תאי המצבר',IMD:'ניטור בידוד חשמלי',PRECHARGE:'טעינה מוקדמת של הקבלים',DISCHARGE:'פריקת הקבלים לאחר ניתוק',LV_BATTERY:'הזנת מערכות המתח הנמוך',AIR:'מגעי ניתוק מצבר ההנעה',HVD:'ניתוק מתח גבוה לתחזוקה',HV_CONNECTORS:'מחברים וחיווט מתח גבוה',CHARGER:'טעינת מצבר ההנעה',ACCUMULATOR:'תאים, מארז ותיעוד ASES',DRIVE:'מנוע, אינוורטר ובקרת מומנט',INTEGRATION:'ממשקים ותיעוד בין המערכות'};


function ProgressIcon({id,percent}:{id:string;percent:number}){
 const value=Math.max(0,Math.min(100,percent));
 return <span className={`overview-icon-wrap ${value===100?'complete':''}`}><svg className="overview-progress-ring" viewBox="0 0 80 80" aria-hidden="true"><circle className="ring-track" cx="40" cy="40" r="36"/><circle className="ring-value" cx="40" cy="40" r="36" pathLength="100" strokeDasharray={`${value} 100`} transform="rotate(-90 40 40)" style={{opacity:value===0?0:1}} data-progress-percent={value}/></svg><OverviewIcon id={id}/></span>;
}

export function SystemMap({items,session,selected,onSelect,onOpen,demo,demoPercent}:{items:Summary[];session:Session|null;selected:string|null;onSelect:(id:string|null)=>void;onOpen:(id:string)=>void;demo:boolean;demoPercent:number}){
 const lookup=Object.fromEntries(items.map(item=>[item.id,item]));
 const active=systems.find(s=>s.id===selected);const summary=selected?lookup[selected]:null;
 const allowed=(id:string)=>demo||session?.systemIds.includes(id)||session?.role==='coordinator';
 if(!items.length)return <div className="empty-state" role="status"><h2>לא נמצאה מערכת שמתאימה לחיפוש</h2><p>אפשר לשנות את החיפוש או את הסינון.</p></div>;
 return <div className="systems-overview engineering-board" aria-label="מערכות ענף החשמל">
  <div className="overview-heading"><span role="status" aria-live="polite" aria-atomic="true"><i aria-hidden="true"/> {items.length===1?'מערכת אחת בתצוגה':`${items.length} מערכות בתצוגה`}</span><span>מילוי התיעוד <span className="overview-key-line" aria-hidden="true"/></span></div>
  <div className="overview-grid">{items.map(item=>{
   const system=systems.find(s=>s.id===item.id)!;
   const percent=demo?demoPercent:fillPercent(item.progress);
   return <button type="button" className={`system-card ${percent===100?'complete':''} ${selected===item.id?'selected':''}`} key={item.id} onClick={()=>onSelect(item.id)} aria-haspopup="dialog" aria-expanded={selected===item.id} aria-label={`${system.label}, ${descriptions[item.id]}, ${percent}% מילוי התיעוד, פתיחת פרטי המערכת${allowed(item.id)?'':', ללא הרשאת עריכה'}`}>
    <span className="tile-symbol"><OverviewIcon id={item.id}/></span>
    <span className="tile-copy"><span className="tile-name" dir="auto">{system.label}</span><span className="tile-description">{descriptions[item.id]}</span></span>
    <span className="tile-meter"><span className="tile-progress"><bdi>{percent}<small>%</small></bdi></span><span className="tile-progress-track" aria-hidden="true"><span style={{width:`${percent}%`}} data-progress-percent={percent}/></span><span className="tile-count">{demo?'נתוני הדמיה':<><bdi>{fillCount(item.progress)} / {item.progress.total}</bdi> שדות</>}</span></span>
    <span className="tile-open" aria-hidden="true">{allowed(item.id)?<Arrow/>:<Lock/>}</span>
   </button>;
  })}</div>
  {active&&summary&&<Modal title={active.label} onClose={()=>onSelect(null)}><div className="overview-details"><div className="overview-detail-top"><ProgressIcon id={active.id} percent={demo?demoPercent:fillPercent(summary.progress)}/><div><p>{descriptions[active.id]}</p><small>צוות אחראי: {departmentLabel(active.department)} · תחום פעולה: <bdi>{active.electricalDomain}</bdi></small></div></div><div className="overview-detail-metrics"><div><strong><bdi>{demo?demoPercent:fillPercent(summary.progress)}%</bdi></strong><span>מילוי התיעוד</span><small>{demo?'נתוני הדמיה':`${fillCount(summary.progress)} מתוך ${summary.progress.total} שדות תיעוד מולאו`}</small></div><div><span>אימות מקורות</span><p>{sourceValidationLabel(summary.progress)}</p></div></div><p className="overview-engineering-status">בדיקה הנדסית: <strong>{engineeringStatusLabel(summary.status)}</strong></p><div className="missing-preview"><h3>להשלמה ולאימות</h3>{summary.progress.missing.length?<ul>{summary.progress.missing.slice(0,3).map(m=><li key={m.id}><span>{m.label}</span>{m.reason&&<small className="missing-reason">{m.reason}</small>}</li>)}</ul>:<p>התיעוד ואימות המקורות הושלמו. הבדיקה ההנדסית מוצגת בנפרד.</p>}{summary.progress.missing.length>3&&<small>ועוד {summary.progress.missing.length-3} שדות בטופס</small>}</div><small className="muted">שמירה אחרונה: {dateLabel(summary.updatedAt)}</small>{active.interfaces?.length>0&&<details className="interfaces"><summary>ממשקים לפי מיפוי המקור</summary><p>{active.interfaces.map((i:unknown)=>typeof i==='string'?i:JSON.stringify(i)).join(' · ')}</p><small>זו רשימת ממשקים לתיעוד; אינה תרשים חיווט מאושר.</small></details>}{allowed(active.id)?<button className="button primary full overview-continue" onClick={()=>onOpen(active.id)}>פתיחת התיעוד <Arrow/></button>:<p className="notice">הגישה לטופס דורשת הרשאה מהרכז.</p>}</div></Modal>}
 </div>;
}
